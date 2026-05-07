/**
 * sync.js — GitHub/Gitee Gist cloud sync module for Tab Oasis Firefox extension.
 *
 * Provides bidirectional Gist-based data sync. All extension data is stored
 * as a single JSON file (`tab-oasis.json`) inside a secret Gist on either
 * GitHub or Gitee.  Uses `browser.storage.local` (via storage.js) for
 * token/config persistence and IndexedDB (via db.js) for bulk data
 * export/import.
 *
 * Dependencies:
 *   ./storage.js  — preference read/write (token, gistId, lastSyncTime, …)
 *   ./db.js       — exportAllData / importAllData
 *   ./utils.js    — generateId (for deviceId)
 *
 * @module lib/sync
 */

import * as storage from './storage.js';
import * as db from './db.js';
import { generateId } from './utils.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** GitHub REST API base URL. @type {string} */
const GITHUB_API_BASE = 'https://api.github.com';

/** Gitee OpenAPI v5 base URL. @type {string} */
const GITEE_API_BASE = 'https://gitee.com/api/v5';

/** Description embedded in every sync Gist so we can find it later. @type {string} */
const GIST_DESCRIPTION = 'Tab Oasis Sync';

/** The single file name inside the Gist. @type {string} */
const GIST_FILENAME = 'tab-oasis.json';

/** `browser.alarms` name used for periodic auto-sync. @type {string} */
const SYNC_ALARM_NAME = 'tab-oasis-sync';

/** Schema version written into the Gist payload. @type {number} */
const DATA_VERSION = 1;

/** Minimum allowed auto-sync interval in minutes. @type {number} */
const MIN_SYNC_INTERVAL = 5;

// ---------------------------------------------------------------------------
// Static guard — only install the alarm listener once, regardless of how many
// SyncManager instances are created.
// ---------------------------------------------------------------------------

/** @type {boolean} */
let _alarmListenerInstalled = false;

/**
 * Internal alarm handler.  Bound to a SyncManager instance so `this` works.
 * @this {SyncManager}
 * @param {{ name: string }} alarm
 * @returns {Promise<void>}
 */
async function _onAlarm(alarm) {
  if (alarm.name !== SYNC_ALARM_NAME) return;
  try {
    const result = await this.syncToGist();
    if (!result.success) {
      console.warn('[sync] Auto-sync push failed:', result);
    }
  } catch (err) {
    console.error('[sync] Auto-sync error:', err);
  }
}

// ===========================================================================
// SyncManager
// ===========================================================================

export class SyncManager {
  // -----------------------------------------------------------------------
  // Constructor
  // -----------------------------------------------------------------------

  /**
   * Create a SyncManager for a specific platform.
   *
   * @param {'github'|'gitee'} [platform='github'] — which Gist host to use.
   */
  constructor(platform = 'github') {
    /** @type {'github'|'gitee'} */
    this.platform = platform;

    /** @type {string} Base URL for API calls. */
    this.baseUrl = platform === 'gitee' ? GITEE_API_BASE : GITHUB_API_BASE;

    // Install the alarm listener once globally.
    if (!_alarmListenerInstalled) {
      if (
        typeof browser !== 'undefined' &&
        browser.alarms &&
        browser.alarms.onAlarm
      ) {
        browser.alarms.onAlarm.addListener(_onAlarm.bind(this));
        _alarmListenerInstalled = true;
      }
    }
  }

  // -----------------------------------------------------------------------
  // Configuration
  // -----------------------------------------------------------------------

  /**
   * Save the personal access token and mark sync as configured.
   *
   * @param {string} token — GitHub or Gitee personal access token.
   * @returns {Promise<boolean>} `true` when the token was saved successfully.
   */
  async configure(token) {
    try {
      return await storage.setPref('gistToken', token);
    } catch (err) {
      console.error('[sync] configure failed:', err);
      return false;
    }
  }

  /**
   * Retrieve the stored token.
   *
   * @returns {Promise<string>} The token, or an empty string if not set.
   */
  async getToken() {
    try {
      return (await storage.getPref('gistToken')) || '';
    } catch {
      return '';
    }
  }

  /**
   * Check whether a token has been configured.
   *
   * @returns {Promise<boolean>}
   */
  async isConfigured() {
    const token = await this.getToken();
    return !!token;
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /**
   * Build the HTTP headers for an API request.
   *
   * GitHub uses `Authorization: Bearer <token>` + the `application/vnd.github+json`
   * media type.  Gitee authenticates via a query parameter, so the header block
   * is lighter.
   *
   * @returns {Promise<Object<string,string>>}
   */
  async _getHeaders() {
    const token = await this.getToken();
    const headers = {
      'Content-Type': 'application/json',
    };

    if (this.platform === 'github') {
      headers['Authorization'] = `Bearer ${token}`;
      headers['Accept'] = 'application/vnd.github+json';
    } else {
      headers['Accept'] = 'application/json';
    }

    return headers;
  }

  /**
   * Low-level fetch wrapper that handles common error scenarios.
   *
   * @param {string} path   — API path relative to `this.baseUrl` (e.g. `/gists`).
   * @param {object} [options={}] — fetch options (method, body, …).
   * @returns {Promise<any>} Parsed JSON response body.
   * @throws {{ error: string, message?: string, retryAfter?: string }}
   *   Structured error on failure so callers can differentiate.
   */
  async _fetch(path, options = {}) {
    let url = `${this.baseUrl}${path}`;
    const headers = await this._getHeaders();

    // Gitee authenticates via query parameter, not a header.
    if (this.platform === 'gitee') {
      const token = await this.getToken();
      const sep = url.includes('?') ? '&' : '?';
      url += `${sep}access_token=${encodeURIComponent(token)}`;
    }

    /** @type {Response} */
    let res;
    try {
      res = await fetch(url, { ...options, headers: { ...headers, ...(options.headers || {}) } });
    } catch (err) {
      // Network-level failure (DNS, timeout, offline, …)
      throw { error: 'network', message: err.message || 'Network error' };
    }

    // ---- HTTP error classification ----------------------------------------
    if (res.status === 401 || res.status === 403) {
      throw { error: 'auth', message: 'Invalid token' };
    }

    if (res.status === 404) {
      throw { error: 'not_found' };
    }

    if (res.status === 429) {
      const retryAfter =
        res.headers.get('Retry-After') ||
        res.headers.get('X-RateLimit-Reset') ||
        null;
      throw { error: 'rate_limit', retryAfter };
    }

    if (!res.ok) {
      // Try to extract a server-supplied error message.
      let message = `HTTP ${res.status}: ${res.statusText}`;
      try {
        // Clone so we don't consume the body if it IS JSON that the caller needs.
        const body = await res.clone().json();
        if (body && body.message) message = body.message;
      } catch {
        /* ignore — non-JSON body */
      }
      throw { error: 'unknown', message };
    }

    // ---- Success — return parsed JSON -------------------------------------
    try {
      return await res.json();
    } catch (err) {
      throw { error: 'unknown', message: 'Failed to parse response' };
    }
  }

  // -----------------------------------------------------------------------
  // Gist CRUD
  // -----------------------------------------------------------------------

  /**
   * Find the Tab Oasis sync Gist among the user's Gists.
   *
   * Lists all Gists (paginated — fetches up to 100) and returns the ID of
   * the first one whose `description` matches {@link GIST_DESCRIPTION}.
   *
   * @returns {Promise<string|null>} Gist ID, or `null` if none exists.
   */
  async findExistingGist() {
    try {
      const gists = await this._fetch('/gists?per_page=100');
      if (!Array.isArray(gists)) return null;

      const match = gists.find((g) => g.description === GIST_DESCRIPTION);
      return match ? match.id : null;
    } catch (err) {
      // Auth / network errors → no point searching further.
      if (err && err.error === 'not_found') return null;
      // For other errors, re-throw so callers can decide.
      throw err;
    }
  }

  /**
   * Fetch a single Gist by ID.
   *
   * @param {string} gistId
   * @returns {Promise<Object>} Full Gist API response.
   */
  async getGist(gistId) {
    return this._fetch(`/gists/${encodeURIComponent(gistId)}`);
  }

  /**
   * Create a new secret Gist containing the supplied data.
   *
   * @param {Object} data — arbitrary JSON-serialisable payload (the full
   *   export from {@link db.exportAllData} with sync metadata).
   * @returns {Promise<Object>} The created Gist API response.
   */
  async createGist(data) {
    const body = {
      description: GIST_DESCRIPTION,
      public: false,
      files: {
        [GIST_FILENAME]: {
          content: JSON.stringify(data),
        },
      },
    };

    return this._fetch('/gists', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  /**
   * Update an existing Gist with new data.
   *
   * Only the `tab-oasis.json` file is touched; other files in the Gist are
   * left unchanged.
   *
   * @param {string} gistId
   * @param {Object} data — the new payload.
   * @returns {Promise<Object>} The updated Gist API response.
   */
  async updateGist(gistId, data) {
    const body = {
      files: {
        [GIST_FILENAME]: {
          content: JSON.stringify(data),
        },
      },
    };

    return this._fetch(`/gists/${encodeURIComponent(gistId)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  }

  // -----------------------------------------------------------------------
  // Full sync operations
  // -----------------------------------------------------------------------

  /**
   * Push all local data to the Gist.
   *
   * Steps:
   *  1. Verify token is configured.
   *  2. Export all data from IndexedDB via {@link db.exportAllData}.
   *  3. Add sync metadata (`version`, `lastUpdatedAt`, `deviceId`).
   *  4. Find or create the sync Gist, then update it.
   *  5. Persist `gistId`, `lastSyncTime`, and `gistPlatform` to prefs.
   *
   * @returns {Promise<{success: boolean, gistId?: string, syncedAt?: string, error?: string, message?: string, retryAfter?: string}>}
   */
  async syncToGist() {
    try {
      // 1. Gate: token must exist.
      if (!(await this.isConfigured())) {
        return { success: false, error: 'not_configured' };
      }

      // 2. Export local data.
      const localData = await db.exportAllData();

      // 3. Attach sync metadata.
      const deviceId = await this._getOrCreateDeviceId();
      const payload = {
        ...localData,
        version: DATA_VERSION,
        lastUpdatedAt: new Date().toISOString(),
        deviceId,
      };

      // 4. Find or create → update.
      let gistId = await this.findExistingGist();
      let gist;

      if (gistId) {
        gist = await this.updateGist(gistId, payload);
      } else {
        gist = await this.createGist(payload);
        gistId = gist.id;
      }

      const syncedAt = new Date().toISOString();

      // 5. Persist sync state.
      await storage.setPrefs({
        gistId,
        lastSyncTime: Date.now(),
        gistPlatform: this.platform,
      });

      return { success: true, gistId, syncedAt };
    } catch (err) {
      if (err && err.error) {
        return { success: false, ...err };
      }
      return { success: false, error: 'unknown', message: err.message };
    }
  }

  /**
   * Pull remote Gist data into the local database (merge mode).
   *
   * Steps:
   *  1. Verify token is configured.
   *  2. Determine the Gist ID (from prefs, or by searching).
   *  3. Fetch the Gist content.
   *  4. Parse the `tab-oasis.json` payload.
   *  5. Import into IndexedDB via {@link db.importAllData}.
   *  6. Update `lastSyncTime` in prefs.
   *
   * @returns {Promise<{success: boolean, imported?: Object, error?: string, message?: string, retryAfter?: string}>}
   */
  async syncFromGist() {
    try {
      // 1. Gate: token must exist.
      if (!(await this.isConfigured())) {
        return { success: false, error: 'not_configured' };
      }

      // 2. Resolve Gist ID.
      let gistId = (await storage.getPref('gistId')) || '';
      if (!gistId) {
        gistId = await this.findExistingGist();
        if (gistId) {
          await storage.setPref('gistId', gistId);
        }
      }

      if (!gistId) {
        return { success: false, error: 'not_found' };
      }

      // 3. Fetch the Gist.
      const gist = await this.getGist(gistId);
      const file = gist.files && gist.files[GIST_FILENAME];
      if (!file || !file.content) {
        return { success: false, error: 'not_found', message: 'Gist exists but tab-oasis.json is missing' };
      }

      // 4. Parse payload.
      let parsed;
      try {
        parsed = JSON.parse(file.content);
      } catch {
        return { success: false, error: 'unknown', message: 'Failed to parse Gist content' };
      }

      // 5. Import — always merge so existing local records survive.
      const imported = await db.importAllData(parsed, true);

      // 6. Update sync timestamp.
      await storage.setPref('lastSyncTime', Date.now());

      return { success: true, imported };
    } catch (err) {
      if (err && err.error) {
        return { success: false, ...err };
      }
      return { success: false, error: 'unknown', message: err.message };
    }
  }

  // -----------------------------------------------------------------------
  // Auto-sync
  // -----------------------------------------------------------------------

  /**
   * Start periodic background sync via `browser.alarms`.
   *
   * The alarm fires every `intervalMinutes` (clamped to ≥ 5).  On each tick
   * {@link syncToGist} is called automatically.
   *
   * @param {number} intervalMinutes — interval in minutes (min 5).
   * @returns {Promise<void>}
   */
  async startAutoSync(intervalMinutes) {
    const interval = Math.max(MIN_SYNC_INTERVAL, Math.floor(intervalMinutes) || MIN_SYNC_INTERVAL);

    await storage.setPrefs({ syncInterval: interval, autoSyncEnabled: true });

    if (typeof browser !== 'undefined' && browser.alarms) {
      // `create` overwrites an existing alarm with the same name.
      browser.alarms.create(SYNC_ALARM_NAME, {
        periodInMinutes: interval,
      });
    }
  }

  /**
   * Stop periodic background sync.
   *
   * @returns {Promise<void>}
   */
  async stopAutoSync() {
    await storage.setPrefs({ syncInterval: 0, autoSyncEnabled: false });

    if (typeof browser !== 'undefined' && browser.alarms) {
      try {
        await browser.alarms.clear(SYNC_ALARM_NAME);
      } catch {
        /* ignore if alarm was already cleared or doesn't exist */
      }
    }
  }

  // -----------------------------------------------------------------------
  // Status queries
  // -----------------------------------------------------------------------

  /**
   * Return the timestamp of the last successful sync.
   *
   * @returns {Promise<Date|null>} `Date` object, or `null` if never synced.
   */
  async getLastSyncTime() {
    const ts = await storage.getPref('lastSyncTime');
    if (!ts || ts <= 0) return null;
    return new Date(ts);
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  /**
   * Read or generate a persistent device identifier.
   *
   * Stored directly in `browser.storage.local` (outside the validated
   * `prefs` namespace) so it survives extension restarts.  Generated once.
   *
   * @returns {Promise<string>}
   */
  async _getOrCreateDeviceId() {
    try {
      const result = await browser.storage.local.get('deviceId');
      let deviceId = result.deviceId;
      if (!deviceId) {
        deviceId = generateId();
        await browser.storage.local.set({ deviceId });
      }
      return deviceId;
    } catch {
      // Fallback: generate fresh on each call if storage is unavailable.
      return generateId();
    }
  }
}
