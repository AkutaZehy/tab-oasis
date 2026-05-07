/**
 * background.js — MV3 service worker for Tab Oasis Firefox extension.
 *
 * Central event hub that routes messages between UI pages (sidebar, popup) and
 * the lib/ data layer.  Also manages context menus, keyboard shortcuts,
 * periodic auto-sync alarms, and new-tab-page override.
 *
 * The service worker is non-persistent (may be terminated and restarted at any
 * time).  All state is re-initialised on startup via an async IIFE — no
 * top-level await is used.
 *
 * @module background/background
 */

// =============================================================================
// IMPORTS
// =============================================================================

import { initDB, getAllGroups } from '../lib/db.js';
import * as storage from '../lib/storage.js';
import { t } from '../lib/i18n.js';

// Tab operations (see lib/tabs.js for full API documentation)
import {
  saveAllTabs,
  saveCurrentTab,
  restoreAllTabs,
  restoreToNewWindow,
  saveTabs,
  getAllTabsInWindow,
  deduplicateTabs,
} from '../lib/tabs.js';

import { SyncManager } from '../lib/sync.js';

// =============================================================================
// CONSTANTS
// =============================================================================

/** Alarm name used for periodic auto-sync (must match sync.js SYNC_ALARM_NAME). */
const SYNC_ALARM_NAME = 'tab-oasis-sync';

/** Unique context-menu item identifiers. */
const CTX_MENU = {
  SAVE_TAB: 'tab-oasis-ctx-save-tab',
  SAVE_ALL: 'tab-oasis-ctx-save-all',
};

/** Notification IDs for keyboard-shortcut feedback. */
const NOTIFY = {
  SAVE_ALL: 'tab-oasis-notify-save-all',
  SAVE_CURRENT: 'tab-oasis-notify-save-current',
};

// =============================================================================
// 1. CONTEXT MENU REGISTRATION
// =============================================================================

/**
 * Create all context-menu items.
 *
 * Called from {@link browser.runtime.onInstalled} and again on service-worker
 * startup so menus survive restarts.
 *
 * Uses `t()` for localised labels — when a translation key is missing the key
 * itself is returned as a fallback, which gives readable English defaults.
 *
 * @returns {Promise<void>}
 */
async function createContextMenus() {
  try {
    await browser.contextMenus.removeAll();

    await browser.contextMenus.create({
      id: CTX_MENU.SAVE_TAB,
      title: t('tabAction_saveCurrent'),
      contexts: ['tab'],
    });

    await browser.contextMenus.create({
      id: CTX_MENU.SAVE_ALL,
      title: t('tabAction_saveAll'),
      contexts: ['tab'],
    });
  } catch (err) {
    console.error('[bg] createContextMenus failed:', err);
  }
}

// =============================================================================
// 2. CONTEXT MENU CLICK HANDLER
// =============================================================================

async function handleContextMenuClick(info, tab) {
  try {
    switch (info.menuItemId) {
      case CTX_MENU.SAVE_TAB: {
        if (!tab || tab.id == null) return;
        await saveTabs([tab.id]);
        break;
      }
      case CTX_MENU.SAVE_ALL: {
        await saveAllTabs();
        break;
      }
      default:
        break;
    }
  } catch (err) {
    console.error('[bg] Context menu handler error:', err);
  }
}

// =============================================================================
// 3. MESSAGE HANDLING (browser.runtime.onMessage)
// =============================================================================

/**
 * Central message dispatcher.
 *
 * Every handler is wrapped in try/catch so the caller always receives a
 * structured `{ success: boolean, ... }` response.
 *
 * @param {Object} msg      — The message sent by the sidebar or popup.
 * @param {browser.runtime.MessageSender} _sender
 * @returns {Promise<Object>} Response object.
 */
async function handleMessage(msg, _sender) {
  if (!msg || !msg.type) {
    return { success: false, error: 'Missing message type' };
  }

  try {
    switch (msg.type) {
      // ----- Tab save operations ------------------------------------------
      case 'saveAllTabs':
        return { success: true, ...(await saveAllTabs()) };

      case 'saveCurrentTab':
        return { success: true, result: await saveCurrentTab() };

      case 'saveTabs': {
        if (!Array.isArray(msg.tabIds) || msg.tabIds.length === 0) {
          return { success: false, error: 'No tabIds provided' };
        }
        return { success: true, ...(await saveTabs(msg.tabIds)) };
      }

      // ----- Tab restore operations ---------------------------------------
      case 'restoreAllTabs': {
        if (!msg.groupId) {
          return { success: false, error: 'Missing groupId' };
        }
        return { success: true, ...(await restoreAllTabs(msg.groupId)) };
      }

      case 'restoreToNewWindow': {
        if (!msg.groupId) {
          return { success: false, error: 'Missing groupId' };
        }
        return { success: true, ...(await restoreToNewWindow(msg.groupId)) };
      }

      // ----- Tab query operations -----------------------------------------
      case 'getAllTabs':
        return { success: true, tabs: await getAllTabsInWindow() };

      case 'deduplicateTabs':
        return { success: true, ...(await deduplicateTabs()) };

      // ----- Sync operations ----------------------------------------------
      case 'syncToGist': {
        const sync = new SyncManager(msg.platform || 'github');
        const syncResult = await sync.syncToGist();
        return syncResult;
      }

      case 'syncFromGist': {
        const sync = new SyncManager(msg.platform || 'github');
        const syncResult = await sync.syncFromGist();
        return syncResult;
      }

      case 'configureSync': {
        if (!msg.token) {
          return { success: false, error: 'Missing token' };
        }
        const sync = new SyncManager(msg.platform || 'github');
        const configured = await sync.configure(msg.token);
        // Also persist the platform choice
        if (configured && msg.platform) {
          await storage.setPref('gistPlatform', msg.platform);
        }
        return { success: configured };
      }

      case 'getSyncStatus': {
        const token = await storage.getPref('gistToken');
        const lastSyncTime = await storage.getPref('lastSyncTime');
        const platform = await storage.getPref('gistPlatform');
        return {
          success: true,
          configured: !!token,
          lastSyncTime: lastSyncTime || 0,
          platform: platform || 'github',
        };
      }

      case 'startAutoSync': {
        const interval = msg.interval || 30;
        const sync = new SyncManager(
          (await storage.getPref('gistPlatform')) || 'github',
        );
        await sync.startAutoSync(interval);
        return { success: true, interval };
      }

      case 'stopAutoSync': {
        const sync = new SyncManager(
          (await storage.getPref('gistPlatform')) || 'github',
        );
        await sync.stopAutoSync();
        return { success: true };
      }

      // ----- Unknown ------------------------------------------------------
      default:
        console.warn('[bg] Unknown message type:', msg.type);
        return { success: false, error: `Unknown message type: ${msg.type}` };
    }
  } catch (err) {
    console.error(`[bg] Message handler error (${msg.type}):`, err);
    return { success: false, error: err.message || 'Unknown error' };
  }
}

// =============================================================================
// 4. KEYBOARD SHORTCUTS (browser.commands.onCommand)
// =============================================================================

/**
 * Handle registered keyboard shortcuts.
 *
 * Matching `manifest.json` command names: "save-all-tabs", "save-current-tab".
 *
 * Shows a brief notification so the user gets immediate feedback.
 *
 * @param {string} command — The command name from manifest.json.
 */
async function handleCommand(command) {
  try {
    switch (command) {
      case 'save-all-tabs': {
        const result = await saveAllTabs();
        await showSaveNotification(
          NOTIFY.SAVE_ALL,
          t('tabAction_saveAll'),
          `${result.tabCount} ${t('tabs')}`,
        );
        break;
      }

      case 'save-current-tab': {
        const result = await saveCurrentTab();
        if (result) {
          await showSaveNotification(
            NOTIFY.SAVE_CURRENT,
            t('tabAction_saveCurrent'),
            result.name || result.domain || t('tabAction_saveCurrent'),
          );
        }
        break;
      }

      default:
        break;
    }
  } catch (err) {
    console.error('[bg] Command handler error:', err);
  }
}

/**
 * Show a system notification after a save-via-shortcut action.
 *
 * Falls back silently if `browser.notifications` is unavailable or the
 * extension lacks permission.
 *
 * @param {string} id       — Unique notification ID (reused to avoid spam).
 * @param {string} title    — Notification title.
 * @param {string} message  — Notification body.
 */
async function showSaveNotification(id, title, message) {
  try {
    if (typeof browser !== 'undefined' && browser.notifications) {
      await browser.notifications.create(id, {
        type: 'basic',
        iconUrl: browser.runtime.getURL('icons/icon-48.png'),
        title,
        message,
      });
      // Auto-clear after 3 seconds so the notification tray stays tidy.
      setTimeout(async () => {
        try {
          await browser.notifications.clear(id);
        } catch {
          /* ignore */
        }
      }, 3000);
    }
  } catch (err) {
    // Firefox may throw if the user has disabled notifications for the
    // extension — that's fine, we just log and move on.
    console.warn('[bg] Notification failed:', err.message);
  }
}

// =============================================================================
// 5. ALARM HANDLING (browser.alarms.onAlarm)
// =============================================================================

/**
 * Periodic sync alarm handler.
 *
 * When the `tab-oasis-sync` alarm fires, this handler checks whether
 * auto-sync is enabled in preferences and, if so, triggers a push sync.
 *
 * NOTE: The `SyncManager` constructor also registers an internal alarm
 * listener.  Having two listeners is intentional — the SyncManager one
 * provides a direct fast-path when the instance is alive, while this
 * top-level handler catches alarms that fire after a service-worker restart
 * (when no SyncManager instance exists yet).
 *
 * @param {{ name: string }} alarm
 */
async function handleAlarm(alarm) {
  if (alarm.name !== SYNC_ALARM_NAME) return;

  try {
    const autoSyncEnabled = await storage.getPref('autoSyncEnabled');
    if (!autoSyncEnabled) {
      console.log('[bg] Alarm fired but auto-sync is disabled — skipping.');
      return;
    }

    const platform = (await storage.getPref('gistPlatform')) || 'github';
    const sync = new SyncManager(platform);
    const result = await sync.syncToGist();

    if (!result.success) {
      console.warn('[bg] Auto-sync push failed:', result);
    } else {
      console.log('[bg] Auto-sync push completed.');
    }
  } catch (err) {
    console.error('[bg] Alarm handler error:', err);
  }
}

// =============================================================================
// 6. NEW TAB HANDLING
// =============================================================================

/**
 * Override the new-tab page with the Tab Oasis sidebar when the user has
 * enabled the "Use as New Tab Page" preference.
 *
 * Firefox does not support `chrome_url_overrides`; we intercept
 * `about:newtab` / `about:home` navigation instead.
 *
 * @param {browser.tabs.Tab} tab — The newly created tab.
 */
async function handleTabCreated(tab) {
  try {
    // Only intercept blank new tabs.
    if (!tab || !tab.id) return;
    const url = (tab.url || tab.pendingUrl || '').toLowerCase();
    if (url !== 'about:newtab' && url !== 'about:home' && url !== 'about:blank') {
      return;
    }

    const newTabEnabled = await storage.getPref('newTabEnabled');
    if (!newTabEnabled) return;

    const wbUrl = browser.runtime.getURL('workbench.html');
    await browser.tabs.update(tab.id, { url: wbUrl });
  } catch (err) {
    console.error('[bg] New-tab redirect error:', err);
  }
}

// =============================================================================
// 7. PERSISTENT LISTENERS — MUST be registered at top level (synchronously)
//    If registered inside an async function, the sidebar can send messages
//    before the listener is ready → "Receiving end does not exist" error.
// =============================================================================

// ----- Message routing (CRITICAL: must be top-level, sync) ----------------
browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handleMessage(msg, sender).then(sendResponse);
  return true; // keep channel open for async response
});

// ----- Context menu clicks ------------------------------------------------
browser.contextMenus.onClicked.addListener(handleContextMenuClick);

// ----- Keyboard shortcuts -------------------------------------------------
browser.commands.onCommand.addListener(handleCommand);

// ----- Sync alarms --------------------------------------------------------
browser.alarms.onAlarm.addListener(handleAlarm);

// ----- New tab interception -----------------------------------------------
browser.tabs.onCreated.addListener(handleTabCreated);

// =============================================================================
// 8. SERVICE WORKER STARTUP (async init — non-blocking listeners above)
// =============================================================================

(async function startup() {
  try {
    // 8a. Initialise the IndexedDB layer so all CRUD functions work.
    await initDB();
    console.log('[bg] IndexedDB initialised.');

    // 8b. Re-register context menus on every start.
    await createContextMenus();

    // 8c. Register on first install / update via onInstalled.
    browser.runtime.onInstalled.addListener(async (details) => {
      console.log('[bg] Extension installed/updated:', details.reason);
      await createContextMenus();
    });

    console.log('[bg] Tab Oasis service worker started.');
  } catch (err) {
    console.error('[bg] Startup failed:', err);
  }
})();
