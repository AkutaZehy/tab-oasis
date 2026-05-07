/**
 * tabs.js — browser.tabs API wrappers for Tab Oasis Firefox extension.
 *
 * Provides async functions for saving, restoring, closing, grouping, and
 * deduplicating browser tabs.  Tab data is persisted via db.js (IndexedDB)
 * and modelled via models.js helper factories.
 *
 * Dependencies:
 *   ./db.js      — saveGroup, getGroup
 *   ./models.js  — createTabGroup
 *   ./utils.js   — getDomain, normalizeUrl
 *
 * Caller is responsible for calling initDB() from ./db.js before invoking
 * any save/restore function.
 *
 * @module lib/tabs
 */

import { saveGroup, getGroup } from './db.js';
import { createTabGroup } from './models.js';
import { getDomain, normalizeUrl } from './utils.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * URL schemes that are *not* saveable.
 * Only tabs whose URL starts with http://, https://, or ftp:// are eligible.
 *
 * @type {Set<string>}
 */
const SAVEABLE_SCHEMES = new Set(['http:', 'https:', 'ftp:']);

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Determine whether a URL is safe to save.
 *
 * @param {string} url
 * @returns {boolean}
 */
function isSaveableUrl(url) {
  if (!url || typeof url !== 'string') return false;
  try {
    const scheme = new URL(url).protocol;
    return SAVEABLE_SCHEMES.has(scheme);
  } catch {
    return false;
  }
}

/**
 * Extract a flat array of tab IDs from an array of browser Tab objects.
 *
 * @param {Array<browser.tabs.Tab>} tabs
 * @returns {Array<number>}
 */
function pickTabIds(tabs) {
  return tabs.map((t) => t.id).filter((id) => id != null);
}

// ===========================================================================
// PUBLIC API
// ===========================================================================

/**
 * 1. getAllTabsInWindow — Query all tabs in a specific window (defaults to
 *    the current window).
 *
 * Each returned tab object is a lightweight view:
 *   { id, title, url, favIconUrl, pinned, index }
 *
 * @param {number} [windowId] — browser.windows.WINDOW_ID_CURRENT when omitted.
 * @returns {Promise<Array<{id:number, title:string, url:string, favIconUrl:string, pinned:boolean, index:number}>>}
 */
export async function getAllTabsInWindow(windowId) {
  try {
    const tabs = await browser.tabs.query({
      windowId: windowId != null ? windowId : browser.windows.WINDOW_ID_CURRENT,
    });

    return tabs.map((tab) => ({
      id: tab.id,
      title: tab.title || '',
      url: tab.url || '',
      favIconUrl: tab.favIconUrl || '',
      pinned: !!tab.pinned,
      index: tab.index,
    }));
  } catch (err) {
    console.error('[tabs] getAllTabsInWindow failed:', err);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// 2. saveAllTabs  —  Save all saveable tabs in a window, grouped by domain.
// ---------------------------------------------------------------------------

/**
 * Save all saveable tabs in the target window, grouped by domain.
 *
 * Workflow:
 *   1. Fetch all tabs in the window.
 *   2. Filter out restricted URLs (only http/https/ftp).
 *   3. Group remaining tabs by domain via {@link groupTabsByDomain}.
 *   4. For each domain group, create a tab-group record and persist it.
 *   5. Close every saved tab.
 *   6. Return summary.
 *
 * @param {number} [windowId] — browser.windows.WINDOW_ID_CURRENT by default.
 * @returns {Promise<{groups: Array<Object>, tabCount: number}>}
 */
export async function saveAllTabs(windowId) {
  try {
    // ----- a. fetch tabs ---------------------------------------------------
    const allTabs = await getAllTabsInWindow(windowId);

    // ----- b. filter saveable ----------------------------------------------
    const saveable = allTabs.filter((t) => isSaveableUrl(t.url));
    if (saveable.length === 0) {
      return { groups: [], tabCount: 0 };
    }

    // ----- c. group by domain ----------------------------------------------
    const domainGroups = await groupTabsByDomain(saveable);

    // ----- d + e. create & save groups -------------------------------------
    const groups = [];
    for (const [, tabs] of domainGroups) {
      const domain = getDomain(tabs[0].url);
      const tg = createTabGroup({ domain, tabs });
      const saved = await saveGroup(tg);
      groups.push(saved);
    }

    // ----- f. close saved tabs ---------------------------------------------
    await browser.tabs.remove(pickTabIds(saveable));

    // ----- g. return summary -----------------------------------------------
    return { groups, tabCount: saveable.length };
  } catch (err) {
    console.error('[tabs] saveAllTabs failed:', err);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// 3. saveCurrentTab  —  Save only the active tab in the current window.
// ---------------------------------------------------------------------------

/**
 * Save the active tab of the current window.
 *
 * The tab is placed into a domain-based group.  If the URL is not saveable
 * the function returns `null`.
 *
 * @returns {Promise<Object|null>} The saved group, or null if nothing was saved.
 */
export async function saveCurrentTab() {
  try {
    const [tab] = await browser.tabs.query({
      active: true,
      currentWindow: true,
    });

    if (!tab || !isSaveableUrl(tab.url)) {
      return null;
    }

    const domain = getDomain(tab.url);
    const tg = createTabGroup({
      domain,
      name: domain || 'Ungrouped',
      tabs: [
        {
          title: tab.title,
          url: tab.url,
          favIconUrl: tab.favIconUrl,
        },
      ],
    });

    const saved = await saveGroup(tg);
    await browser.tabs.remove(tab.id);

    return saved;
  } catch (err) {
    console.error('[tabs] saveCurrentTab failed:', err);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// 4. saveTabs  —  Save specific tabs by ID.
// ---------------------------------------------------------------------------

/**
 * Save one or more specific tabs by their browser tab IDs.
 *
 * Same grouping and persistence logic as {@link saveAllTabs}, but operates
 * on an explicit list of tab IDs instead of every tab in a window.
 *
 * @param {Array<number>} tabIds — Browser tab IDs to save.
 * @returns {Promise<{groups: Array<Object>, tabCount: number}>}
 */
export async function saveTabs(tabIds) {
  try {
    if (!Array.isArray(tabIds) || tabIds.length === 0) {
      return { groups: [], tabCount: 0 };
    }

    // Fetch full tab info for each ID
    const tabs = await Promise.all(tabIds.map((id) => browser.tabs.get(id)));

    // Filter saveable
    const saveable = tabs.filter((t) => isSaveableUrl(t.url));
    if (saveable.length === 0) {
      return { groups: [], tabCount: 0 };
    }

    // Convert to lightweight shape expected by groupTabsByDomain
    const normalized = saveable.map((t) => ({
      id: t.id,
      title: t.title || '',
      url: t.url || '',
      favIconUrl: t.favIconUrl || '',
      pinned: !!t.pinned,
      index: t.index,
    }));

    // Group by domain
    const domainGroups = await groupTabsByDomain(normalized);

    // Create and save groups
    const groups = [];
    for (const [, tabsGroup] of domainGroups) {
      const domain = getDomain(tabsGroup[0].url);
      const tg = createTabGroup({ domain, tabs: tabsGroup });
      const saved = await saveGroup(tg);
      groups.push(saved);
    }

    // Close saved tabs
    await browser.tabs.remove(pickTabIds(saveable));

    return { groups, tabCount: saveable.length };
  } catch (err) {
    console.error('[tabs] saveTabs failed:', err);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// 5. restoreTab  —  Open a single previously-saved tab.
// ---------------------------------------------------------------------------

/**
 * Open a single tab from saved data.
 *
 * @param {Object} tabData — Must contain at least `{ url }`.
 * @param {string} tabData.url
 * @param {number} [windowId] — Target window.  Defaults to current window.
 * @returns {Promise<browser.tabs.Tab>} The created tab.
 */
export async function restoreTab(tabData, windowId) {
  try {
    const created = await browser.tabs.create({
      url: tabData.url,
      windowId: windowId != null ? windowId : browser.windows.WINDOW_ID_CURRENT,
      active: false,
    });
    return created;
  } catch (err) {
    console.error('[tabs] restoreTab failed:', err);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// 6. restoreAllTabs  —  Restore every tab in a saved group.
// ---------------------------------------------------------------------------

/**
 * Restore all tabs belonging to a saved tab group.
 *
 * Tabs are opened in the order they were originally saved.
 *
 * @param {string} groupId — ID of the saved tab-group in IndexedDB.
 * @param {number} [windowId] — Target window.  Defaults to current window.
 * @returns {Promise<{tabsCreated: number}>}
 */
export async function restoreAllTabs(groupId, windowId) {
  try {
    const group = await getGroup(groupId);
    if (!group || !Array.isArray(group.tabs) || group.tabs.length === 0) {
      return { tabsCreated: 0 };
    }

    for (const tabData of group.tabs) {
      await browser.tabs.create({
        url: tabData.url,
        windowId: windowId != null ? windowId : browser.windows.WINDOW_ID_CURRENT,
        active: false,
      });
    }

    return { tabsCreated: group.tabs.length };
  } catch (err) {
    console.error('[tabs] restoreAllTabs failed:', err);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// 7. restoreToNewWindow  —  Open a group in a brand-new window.
// ---------------------------------------------------------------------------

/**
 * Restore a saved group into a new, dedicated browser window.
 *
 * The first tab is opened as part of {@link browser.windows.create}; the
 * remaining tabs are created in that same window afterwards.
 *
 * @param {string} groupId
 * @returns {Promise<{windowId: number, tabsCreated: number}>}
 */
export async function restoreToNewWindow(groupId) {
  try {
    const group = await getGroup(groupId);
    if (!group || !Array.isArray(group.tabs) || group.tabs.length === 0) {
      return { windowId: null, tabsCreated: 0 };
    }

    const [first, ...rest] = group.tabs;

    // Open the first tab in a new window
    const win = await browser.windows.create({ url: first.url });

    // Open remaining tabs in that same window
    for (const tabData of rest) {
      await browser.tabs.create({
        url: tabData.url,
        windowId: win.id,
        active: false,
      });
    }

    return { windowId: win.id, tabsCreated: group.tabs.length };
  } catch (err) {
    console.error('[tabs] restoreToNewWindow failed:', err);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// 8. closeTab  —  Close a single tab by ID.
// ---------------------------------------------------------------------------

/**
 * Close a single browser tab.
 *
 * @param {number} tabId
 * @returns {Promise<void>}
 */
export async function closeTab(tabId) {
  try {
    await browser.tabs.remove(tabId);
  } catch (err) {
    console.error('[tabs] closeTab failed:', err);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// 9. groupTabsByDomain  —  Domain-based grouping helper.
// ---------------------------------------------------------------------------

/**
 * Group an array of tab objects by their domain.
 *
 * Uses {@link getDomain} (from utils.js) to extract the domain.  Tabs whose
 * URL cannot be parsed are collected under the empty-string key.
 *
 * @param {Array<Object>} tabs — Tab-like objects (must have a `url` property).
 * @returns {Map<string, Array<Object>>} A Map from domain to tab array.
 */
export async function groupTabsByDomain(tabs) {
  const map = new Map();

  for (const tab of tabs) {
    const domain = getDomain(tab.url) || '';
    if (!map.has(domain)) {
      map.set(domain, []);
    }
    map.get(domain).push(tab);
  }

  return map;
}

// ---------------------------------------------------------------------------
// 10. deduplicateTabs  —  Remove duplicate tabs in a window.
// ---------------------------------------------------------------------------

/**
 * Find and close duplicate tabs in a window.
 *
 * Two tabs are considered duplicates when {@link normalizeUrl} produces the
 * same result for both.  The first occurrence is kept; all subsequent tabs
 * with the same normalised URL are closed.
 *
 * @param {number} [windowId] — browser.windows.WINDOW_ID_CURRENT by default.
 * @returns {Promise<{removed: number}>}
 */
export async function deduplicateTabs(windowId) {
  try {
    const tabs = await getAllTabsInWindow(windowId);

    /** @type {Set<string>} */
    const seen = new Set();
    /** @type {Array<number>} */
    const toRemove = [];

    for (const tab of tabs) {
      if (!isSaveableUrl(tab.url)) continue;

      const norm = normalizeUrl(tab.url);
      if (!norm) continue;

      if (seen.has(norm)) {
        toRemove.push(tab.id);
      } else {
        seen.add(norm);
      }
    }

    if (toRemove.length > 0) {
      await browser.tabs.remove(toRemove);
    }

    return { removed: toRemove.length };
  } catch (err) {
    console.error('[tabs] deduplicateTabs failed:', err);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// 11. getCurrentWindowTabs  —  Convenience shorthand.
// ---------------------------------------------------------------------------

/**
 * Get all tabs in the current window.
 *
 * @returns {Promise<Array<{id:number, title:string, url:string, favIconUrl:string, pinned:boolean, index:number}>>}
 */
export async function getCurrentWindowTabs() {
  return getAllTabsInWindow(browser.windows.WINDOW_ID_CURRENT);
}
