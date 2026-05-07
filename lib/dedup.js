/**
 * dedup.js — Tab deduplication logic for Tab Oasis Firefox extension.
 *
 * Provides functions to find and remove duplicate tabs based on normalized URL
 * comparison. Works with live browser tabs and saved tab groups.
 *
 * @module lib/dedup
 */

import { normalizeUrl } from './utils.js';

/**
 * Groups tabs by their normalized URL.
 *
 * Only groups with 2 or more tabs are included in the result.
 * Tabs with invalid or empty URLs are silently skipped.
 *
 * @param {Array<{id: number, url: string, title?: string}>} tabs
 *   Array of tab objects.
 * @returns {{groups: Array<Array<Object>>, duplicateCount: number}}
 *   An object with:
 *   - `groups`: array of groups, each containing tabs sharing the same normalized URL
 *   - `duplicateCount`: total number of tabs across all duplicate groups
 */
export function findDuplicates(tabs) {
  const map = new Map();

  for (const tab of tabs) {
    const key = normalizeUrl(tab.url);
    if (!key) continue;

    if (!map.has(key)) {
      map.set(key, []);
    }
    map.get(key).push(tab);
  }

  const groups = [];
  let duplicateCount = 0;

  for (const group of map.values()) {
    if (group.length >= 2) {
      groups.push(group);
      duplicateCount += group.length;
    }
  }

  return { groups, duplicateCount };
}

/**
 * Closes the specified tabs via the browser.tabs API.
 *
 * Accepts an empty array (no-op, returns `{ removed: 0 }`).
 *
 * @param {number[]} tabIds - Array of tab IDs to close.
 * @returns {Promise<{removed: number}>}
 *   Resolves with the count of tabs successfully closed.
 */
export async function removeDuplicates(tabIds) {
  if (tabIds.length === 0) {
    return { removed: 0 };
  }

  await browser.tabs.remove(tabIds);
  return { removed: tabIds.length };
}

/**
 * Finds duplicate tabs and removes them, keeping one survivor per group.
 *
 * Survivor selection priority (first match wins):
 * 1. Active tab (`tab.active === true`)
 * 2. Tab with the shortest URL string
 * 3. First tab in the group (preserves original array order)
 *
 * This ensures the currently viewed tab is never removed.
 *
 * @param {Array<{id: number, url: string, title?: string, active?: boolean}>} tabs
 *   Array of tab objects.
 * @returns {Promise<{removed: number, kept: number, groups: Array<Array<Object>>}>}
 *   Result object with:
 *   - `removed`: number of tabs closed
 *   - `kept`: number of groups where one tab was preserved
 *   - `groups`: the duplicate groups (including survivors)
 */
export async function findAndRemoveDuplicates(tabs) {
  const { groups } = findDuplicates(tabs);
  const duplicateIds = [];
  let keptCount = 0;

  for (const group of groups) {
    // Survivor selection: active tab > shortest URL > first in group
    let survivorIndex = 0;

    // 1. Prefer the active tab (must NOT remove what the user is viewing)
    const activeIndex = group.findIndex((t) => t.active);
    if (activeIndex !== -1) {
      survivorIndex = activeIndex;
    } else {
      // 2. Prefer the tab with the shortest URL (likely the canonical one)
      let shortestLen = Infinity;
      for (let i = 0; i < group.length; i++) {
        const urlLen = (group[i].url || '').length;
        if (urlLen < shortestLen) {
          shortestLen = urlLen;
          survivorIndex = i;
        }
      }
    }

    // Collect IDs of tabs to remove (all except the survivor)
    for (let i = 0; i < group.length; i++) {
      if (i !== survivorIndex) {
        duplicateIds.push(group[i].id);
      }
    }

    keptCount++;
  }

  const { removed } = await removeDuplicates(duplicateIds);

  return {
    removed,
    kept: keptCount,
    groups,
  };
}

/**
 * Finds duplicate saved tabs across all tab groups in the database.
 *
 * Flattens all tabs from every group returned by `db.getAllGroups()` and
 * detects duplicates by normalized URL. Each tab is tagged with its source
 * group (`_groupId`, `_groupName`) for traceability.
 *
 * @param {Object} db - The db.js module (must expose `getAllGroups()`).
 * @returns {Promise<{groups: Array<Array<Object>>, duplicateCount: number}>}
 *   Duplicate groups from saved tabs, same shape as {@link findDuplicates}.
 */
export async function findDuplicateSavedTabs(db) {
  const allGroups = await db.getAllGroups();

  // Flatten all tabs from all groups into a single array
  const allTabs = [];
  for (const group of allGroups) {
    if (group.tabs && Array.isArray(group.tabs)) {
      for (const tab of group.tabs) {
        allTabs.push({
          ...tab,
          _groupId: group.id,
          _groupName: group.name,
        });
      }
    }
  }

  // Reuse findDuplicates logic
  return findDuplicates(allTabs);
}
