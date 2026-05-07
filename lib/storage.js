/**
 * storage.js — browser.storage.local wrapper for Tab Oasis preferences.
 *
 * All preferences are stored under a single key 'prefs' in browser.storage.local.
 * Large entity data goes to IndexedDB via db.js — this module handles small preference data only.
 *
 * @module lib/storage
 */

/**
 * Default preference values.
 * Keys not present in this object are considered unknown.
 * @type {Readonly<Object>}
 */
export const DEFAULT_PREFS = Object.freeze({
  theme: 'system',         // 'light' | 'dark' | 'system'
  gistToken: '',            // GitHub/Gitee personal access token
  gistId: '',              // Gist ID for sync
  gistPlatform: 'github',  // 'github' | 'gitee'
  syncInterval: 0,         // minutes, 0 = manual only
  autoSyncEnabled: false,  // boolean
  lastSyncTime: 0,         // timestamp
  sidebarWidth: 350,       // pixels
  collapsedSections: [],   // array of section names
  newTabEnabled: false,    // boolean
  closeAfterSave: true,    // boolean — close tabs after saving
  autoRemove: false,       // boolean — remove tab from group after restore
  language: 'zh_CN',       // 'zh_CN' | 'en'
});

/**
 * Read the full prefs object from storage, falling back to defaults.
 * @returns {Promise<Object>}
 */
async function getPrefsFromStorage() {
  try {
    const result = await browser.storage.local.get('prefs');
    const stored = result.prefs || {};
    return { ...DEFAULT_PREFS, ...stored };
  } catch (err) {
    console.error('[storage] Failed to read prefs from storage.local:', err);
    return { ...DEFAULT_PREFS };
  }
}

/**
 * Get a single preference by key.
 *
 * @param {string} key - Preference key (e.g. 'theme')
 * @returns {Promise<*>} The stored value, or the default if not set.
 */
export async function getPref(key) {
  try {
    const prefs = await getPrefsFromStorage();
    return key in prefs ? prefs[key] : DEFAULT_PREFS[key];
  } catch (err) {
    console.error(`[storage] Failed to getPref("${key}"):`, err);
    return DEFAULT_PREFS[key];
  }
}

/**
 * Get ALL preferences.
 *
 * Merges stored values with DEFAULT_PREFS (stored takes priority).
 * @returns {Promise<Object>} Full preferences object.
 */
export async function getPrefs() {
  return getPrefsFromStorage();
}

/**
 * Validate a key-value pair against DEFAULT_PREFS.
 * Logs a warning for unknown keys.
 *
 * @param {string} key
 * @param {*} value
 * @returns {boolean} Whether the key is known.
 */
function validatePref(key, value) {
  if (!(key in DEFAULT_PREFS)) {
    console.warn(`[storage] Unknown preference key "${key}". Ignoring.`);
    return false;
  }
  return true;
}

/**
 * Set a single preference key.
 *
 * Validates the key against DEFAULT_PREFS (warns if unknown).
 * Writes to browser.storage.local under the 'prefs' namespace.
 *
 * @param {string} key - Preference key to set.
 * @param {*} value - Value to store (must match the default type).
 * @returns {Promise<boolean>} true on success, false on failure.
 */
export async function setPref(key, value) {
  if (!validatePref(key, value)) return false;

  try {
    const current = await getPrefsFromStorage();
    current[key] = value;
    await browser.storage.local.set({ prefs: current });
    return true;
  } catch (err) {
    console.error(`[storage] Failed to setPref("${key}"):`, err);
    return false;
  }
}

/**
 * Set multiple preferences at once.
 *
 * Unknown keys are warned about and skipped.
 * Merges with existing stored preferences before writing.
 *
 * @param {Object} obj - Partial preferences object to merge.
 * @returns {Promise<boolean>} true on success, false on failure.
 */
export async function setPrefs(obj) {
  // Filter out unknown keys with warnings
  const entries = Object.entries(obj);
  const valid = entries.filter(([key]) => validatePref(key));
  if (valid.length === 0) return false;

  try {
    const current = await getPrefsFromStorage();
    for (const [key, value] of valid) {
      current[key] = value;
    }
    await browser.storage.local.set({ prefs: current });
    return true;
  } catch (err) {
    console.error('[storage] Failed to setPrefs:', err);
    return false;
  }
}

/**
 * Subscribe to preference changes.
 *
 * Listens to browser.storage.onChanged and filters for the 'prefs' key only.
 * The callback receives a { [key]: { oldValue, newValue } } object describing
 * which preferences changed and their before/after values.
 *
 * @param {Function} callback - Function called with changes object on every
 *   storage change that affects the 'prefs' key.
 * @returns {Function} Unsubscribe function. Call it to stop listening.
 */
export function onPrefChange(callback) {
  const handler = (changes, areaName) => {
    if (areaName !== 'local') return;
    if (!('prefs' in changes)) return;

    const { oldValue = {}, newValue = {} } = changes.prefs;

    const diff = {};
    const allKeys = new Set([...Object.keys(oldValue), ...Object.keys(newValue)]);

    for (const key of allKeys) {
      if (oldValue[key] !== newValue[key]) {
        diff[key] = {
          oldValue: key in oldValue ? oldValue[key] : DEFAULT_PREFS[key],
          newValue: key in newValue ? newValue[key] : DEFAULT_PREFS[key],
        };
      }
    }

    if (Object.keys(diff).length > 0) {
      callback(diff);
    }
  };

  browser.storage.onChanged.addListener(handler);

  return () => {
    browser.storage.onChanged.removeListener(handler);
  };
}
