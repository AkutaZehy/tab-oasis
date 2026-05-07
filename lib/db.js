/**
 * db.js — IndexedDB data layer for Tab Oasis Firefox extension.
 *
 * Uses the 'idb' library for promise-based IndexedDB operations.
 * Initializes 5 object stores on first open and exports full CRUD for each,
 * plus unified search, recycle bin with auto-cleanup, and bulk import/export.
 *
 * Object Stores:
 *   1. tab-groups   — keyPath: id,   indexes: domain, sortOrder, isPinned, createdAt
 *   2. quick-links  — keyPath: id,   indexes: sortOrder, createdAt
 *   3. sessions     — keyPath: id,   indexes: createdAt, name
 *   4. recycle-bin  — keyPath: id,   indexes: deletedAt, originalStore, expiresAt
 *   5. settings     — keyPath: key
 *
 * Dependencies: ./idb.js (idb library ESM wrapper for IndexedDB)
 *
 * @module lib/db
 */

'use strict';

import { openDB } from './idb.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Database name. @type {string} */
export const DB_NAME = 'tab-oasis';

/** Schema version — bump when object stores or indexes change. @type {number} */
export const DB_VERSION = 1;

/** Items stay in the recycle bin for 30 days before auto-cleanup. @type {number} */
const RECYCLE_BIN_TTL = 30 * 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Module-level DB handle
// ---------------------------------------------------------------------------

/**
 * The open database handle. Initialized by {@link initDB}.
 * @type {IDBDatabase|null}
 */
export let db = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Generate a unique ID string.
 *
 * Uses `crypto.randomUUID()` when available (secure contexts, including
 * extension scripts). Falls back to a timestamp + random-hex pattern
 * in environments that lack it (unlikely in a WebExtension).
 *
 * @returns {string} Unique identifier.
 */
function generateId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback: 8 hex timestamp + 16 hex random chars
  const ts = Date.now().toString(16);
  const rand = Array.from({ length: 16 }, () =>
    Math.floor(Math.random() * 16).toString(16),
  ).join('');
  return ts + rand;
}

/**
 * Normalise a 0/1 numeric index value from a boolean-ish input.
 * @param {*} val
 * @returns {number} 0 or 1
 */
function toFlag(val) {
  return val ? 1 : 0;
}

// ===========================================================================
// DB INITIALIZATION
// ===========================================================================

/**
 * Open (or create) the IndexedDB database with the full schema.
 *
 * Safe to call multiple times — returns the existing handle if already open.
 * After the database is opened, expired recycle-bin entries are cleaned up.
 *
 * @returns {Promise<IDBDatabase>} The open database handle.
 */
export async function initDB() {
  if (db) return db;

  db = await openDB(DB_NAME, DB_VERSION, {
    /**
     * Schema upgrade callback — runs on `upgradeneeded` events.
     *
     * @param {IDBDatabase} upgradDB — wrapped IDBDatabase during upgrade
     * @param {number} oldVersion
     * @param {number} newVersion
     * @param {IDBTransaction} transaction
     */
    upgrade(upgradDB, oldVersion, newVersion, transaction) {
      // 1. tab-groups (v1)
      if (oldVersion < 1) {
        const groupsStore = upgradDB.createObjectStore('tab-groups', {
          keyPath: 'id',
        });
        groupsStore.createIndex('domain', 'domain', { unique: false });
        groupsStore.createIndex('sortOrder', 'sortOrder', { unique: false });
        groupsStore.createIndex('isPinned', 'isPinned', { unique: false });
        groupsStore.createIndex('createdAt', 'createdAt', { unique: false });
      }

      // 2. quick-links (v1)
      if (oldVersion < 1) {
        const linksStore = upgradDB.createObjectStore('quick-links', {
          keyPath: 'id',
        });
        linksStore.createIndex('sortOrder', 'sortOrder', { unique: false });
        linksStore.createIndex('createdAt', 'createdAt', { unique: false });
      }

      // 3. sessions (v1)
      if (oldVersion < 1) {
        const sessionsStore = upgradDB.createObjectStore('sessions', {
          keyPath: 'id',
        });
        sessionsStore.createIndex('createdAt', 'createdAt', { unique: false });
        sessionsStore.createIndex('name', 'name', { unique: false });
      }

      // 4. recycle-bin (v1)
      if (oldVersion < 1) {
        const binStore = upgradDB.createObjectStore('recycle-bin', {
          keyPath: 'id',
        });
        binStore.createIndex('deletedAt', 'deletedAt', { unique: false });
        binStore.createIndex('originalStore', 'originalStore', { unique: false });
        binStore.createIndex('expiresAt', 'expiresAt', { unique: false });
      }

      // 5. settings (v1)
      if (oldVersion < 1) {
        upgradDB.createObjectStore('settings', {
          keyPath: 'key',
        });
      }
    },
  });

  // Run expired-item cleanup once after open
  try {
    await cleanupExpiredRecycleBin();
  } catch (err) {
    console.error('[db] Initial recycle-bin cleanup failed:', err);
  }

  return db;
}

/**
 * Get the database handle, throwing if not yet initialised.
 *
 * @returns {IDBDatabase}
 * @throws {Error} If `initDB()` has not been called.
 */
export function getDB() {
  if (!db) {
    throw new Error(
      '[db] Database not initialised. Call initDB() first.',
    );
  }
  return db;
}

// ===========================================================================
// 1. TAB GROUPS
// ===========================================================================

/**
 * Save (insert or update) a tab group.
 *
 * If the group has an `id` that already exists in the store, it is updated
 * (and `updatedAt` is set).  Otherwise a new ID is generated and the group
 * is inserted with `createdAt` and `updatedAt` set.
 *
 * @param {Object} group
 * @param {string} [group.id]
 * @param {string} group.name
 * @param {string} [group.domain]
 * @param {Array<{title:string, url:string, favIconUrl?:string}>} [group.tabs]
 * @param {boolean|number} [group.isPinned]  — stored as 0 or 1
 * @param {boolean|number} [group.isLocked]  — stored as 0 or 1
 * @param {number} [group.sortOrder]
 * @param {number} [group.createdAt]
 * @param {number} [group.updatedAt]
 * @returns {Promise<Object>} The saved group.
 */
export async function saveGroup(group) {
  try {
    const now = Date.now();
    const isUpdate = !!group.id;

    const record = { ...group };
    record.tabs = record.tabs || [];
    record.isPinned = toFlag(record.isPinned);
    record.isLocked = toFlag(record.isLocked);

    if (isUpdate) {
      record.updatedAt = now;
    } else {
      record.id = generateId();
      record.createdAt = record.createdAt || now;
      record.updatedAt = now;
      if (record.sortOrder === undefined) {
        record.sortOrder = now;
      }
    }

    await getDB().put('tab-groups', record);
    return record;
  } catch (err) {
    console.error('[db] saveGroup failed:', err);
    throw err;
  }
}

/**
 * Get a single tab group by id.
 *
 * @param {string} id
 * @returns {Promise<Object|undefined>}
 */
export async function getGroup(id) {
  try {
    return await getDB().get('tab-groups', id);
  } catch (err) {
    console.error('[db] getGroup failed:', err);
    throw err;
  }
}

/**
 * Get all tab groups, sorted by isPinned desc → sortOrder asc → createdAt desc.
 *
 * @returns {Promise<Array<Object>>}
 */
export async function getAllGroups() {
  try {
    const all = await getDB().getAll('tab-groups');
    return all.sort((a, b) => {
      // Pinned first (1 before 0)
      if (a.isPinned !== b.isPinned) return (b.isPinned || 0) - (a.isPinned || 0);
      // Then by sortOrder ascending
      if ((a.sortOrder || 0) !== (b.sortOrder || 0)) return (a.sortOrder || 0) - (b.sortOrder || 0);
      // Then newest first
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
  } catch (err) {
    console.error('[db] getAllGroups failed:', err);
    throw err;
  }
}

/**
 * Delete a tab group by id.
 *
 * @param {string} id
 * @returns {Promise<boolean>}
 */
export async function deleteGroup(id) {
  try {
    await getDB().delete('tab-groups', id);
    return true;
  } catch (err) {
    console.error('[db] deleteGroup failed:', err);
    throw err;
  }
}

/**
 * Get all tab groups that match a given domain (via the domain index).
 *
 * @param {string} domain
 * @returns {Promise<Array<Object>>}
 */
export async function getGroupsByDomain(domain) {
  try {
    return await getDB().getAllFromIndex('tab-groups', 'domain', domain);
  } catch (err) {
    console.error('[db] getGroupsByDomain failed:', err);
    throw err;
  }
}

// ===========================================================================
// 2. QUICK LINKS
// ===========================================================================

/**
 * Save (insert or update) a quick link.
 *
 * @param {Object} link
 * @param {string} [link.id]
 * @param {string} link.title
 * @param {string} link.url
 * @param {string} [link.favIconUrl]
 * @param {number} [link.sortOrder]
 * @param {number} [link.createdAt]
 * @param {number} [link.updatedAt]
 * @returns {Promise<Object>} The saved quick link.
 */
export async function saveQuickLink(link) {
  try {
    const now = Date.now();
    const isUpdate = !!link.id;

    const record = { ...link };

    if (isUpdate) {
      record.updatedAt = now;
    } else {
      record.id = generateId();
      record.createdAt = record.createdAt || now;
      record.updatedAt = now;
      if (record.sortOrder === undefined) {
        record.sortOrder = now;
      }
    }

    await getDB().put('quick-links', record);
    return record;
  } catch (err) {
    console.error('[db] saveQuickLink failed:', err);
    throw err;
  }
}

/**
 * Get a single quick link by id.
 *
 * @param {string} id
 * @returns {Promise<Object|undefined>}
 */
export async function getQuickLink(id) {
  try {
    return await getDB().get('quick-links', id);
  } catch (err) {
    console.error('[db] getQuickLink failed:', err);
    throw err;
  }
}

/**
 * Get all quick links sorted by sortOrder ascending.
 *
 * @returns {Promise<Array<Object>>}
 */
export async function getAllQuickLinks() {
  try {
    const all = await getDB().getAll('quick-links');
    return all.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
  } catch (err) {
    console.error('[db] getAllQuickLinks failed:', err);
    throw err;
  }
}

/**
 * Delete a quick link by id.
 *
 * @param {string} id
 * @returns {Promise<boolean>}
 */
export async function deleteQuickLink(id) {
  try {
    await getDB().delete('quick-links', id);
    return true;
  } catch (err) {
    console.error('[db] deleteQuickLink failed:', err);
    throw err;
  }
}

/**
 * Update only the `sortOrder` field of a quick link.
 *
 * @param {string} id
 * @param {number} sortOrder
 * @returns {Promise<boolean>}
 */
export async function updateQuickLinkOrder(id, sortOrder) {
  try {
    const link = await getDB().get('quick-links', id);
    if (!link) return false;
    link.sortOrder = sortOrder;
    link.updatedAt = Date.now();
    await getDB().put('quick-links', link);
    return true;
  } catch (err) {
    console.error('[db] updateQuickLinkOrder failed:', err);
    throw err;
  }
}

// ===========================================================================
// 3. SESSIONS
// ===========================================================================

/**
 * Save a session (insert or update).
 *
 * @param {Object} session
 * @param {string} [session.id]
 * @param {string} session.name
 * @param {string[]} [session.tabIds]
 * @param {string[]} [session.groupIds]
 * @param {number} [session.createdAt]
 * @returns {Promise<Object>} The saved session.
 */
export async function saveSession(session) {
  try {
    const now = Date.now();
    const record = { ...session };

    if (!record.id) {
      record.id = generateId();
      record.createdAt = record.createdAt || now;
    }
    record.tabIds = record.tabIds || [];
    record.groupIds = record.groupIds || [];

    await getDB().put('sessions', record);
    return record;
  } catch (err) {
    console.error('[db] saveSession failed:', err);
    throw err;
  }
}

/**
 * Get a single session by id.
 *
 * @param {string} id
 * @returns {Promise<Object|undefined>}
 */
export async function getSession(id) {
  try {
    return await getDB().get('sessions', id);
  } catch (err) {
    console.error('[db] getSession failed:', err);
    throw err;
  }
}

/**
 * Get all sessions sorted newest-first.
 *
 * @returns {Promise<Array<Object>>}
 */
export async function getAllSessions() {
  try {
    const all = await getDB().getAll('sessions');
    return all.sort((a, b) => b.createdAt - a.createdAt);
  } catch (err) {
    console.error('[db] getAllSessions failed:', err);
    throw err;
  }
}

/**
 * Delete a session by id.
 *
 * @param {string} id
 * @returns {Promise<boolean>}
 */
export async function deleteSession(id) {
  try {
    await getDB().delete('sessions', id);
    return true;
  } catch (err) {
    console.error('[db] deleteSession failed:', err);
    throw err;
  }
}

// ===========================================================================
// 4. RECYCLE BIN
// ===========================================================================

/**
 * Move an item to the recycle bin.
 *
 * The original item is *not* deleted from its source store — the caller is
 * responsible for removing it before or after calling this helper.
 *
 * @param {string} originalStore - Name of the source store (e.g. 'tab-groups').
 * @param {Object} originalData  - The full record being soft-deleted.
 * @returns {Promise<Object>} The recycle-bin entry.
 */
export async function addToRecycleBin(originalStore, originalData) {
  try {
    const now = Date.now();
    const entry = {
      id: generateId(),
      originalStore,
      originalData,
      deletedAt: now,
      expiresAt: now + RECYCLE_BIN_TTL,
    };
    await getDB().put('recycle-bin', entry);
    return entry;
  } catch (err) {
    console.error('[db] addToRecycleBin failed:', err);
    throw err;
  }
}

/**
 * Get all recycle-bin items, newest first.
 *
 * @returns {Promise<Array<Object>>}
 */
export async function getRecycleBinItems() {
  try {
    const all = await getDB().getAll('recycle-bin');
    return all.sort((a, b) => b.deletedAt - a.deletedAt);
  } catch (err) {
    console.error('[db] getRecycleBinItems failed:', err);
    throw err;
  }
}

/**
 * Restore a single item from the recycle bin back to its original store.
 *
 * Runs inside a single readwrite transaction for atomicity:
 * 1. reads the recycle-bin entry
 * 2. puts `originalData` back into `originalStore`
 * 3. deletes the recycle-bin entry
 *
 * @param {string} id - Recycle-bin entry id.
 * @returns {Promise<Object|null>} The restored data, or null if the entry was not found.
 */
export async function restoreFromRecycleBin(id) {
  try {
    const dbh = getDB();
    const tx = dbh.transaction(['recycle-bin'], 'readwrite');
    const binStore = tx.objectStore('recycle-bin');

    const entry = await binStore.get(id);
    if (!entry) return null;

    // Put original data back into its original store
    await dbh.put(entry.originalStore, entry.originalData);

    // Delete from recycle bin
    await binStore.delete(id);
    await tx.done;

    return entry.originalData;
  } catch (err) {
    console.error('[db] restoreFromRecycleBin failed:', err);
    throw err;
  }
}

/**
 * Permanently delete a single recycle-bin entry (no restore).
 *
 * @param {string} id - Recycle-bin entry id.
 * @returns {Promise<boolean>}
 */
export async function permanentlyDelete(id) {
  try {
    await getDB().delete('recycle-bin', id);
    return true;
  } catch (err) {
    console.error('[db] permanentlyDelete failed:', err);
    throw err;
  }
}

/**
 * Delete EVERY entry from the recycle bin.
 *
 * @returns {Promise<number>} Number of entries removed.
 */
export async function emptyRecycleBin() {
  try {
    const all = await getDB().getAll('recycle-bin');
    const count = all.length;
    for (const entry of all) {
      await getDB().delete('recycle-bin', entry.id);
    }
    return count;
  } catch (err) {
    console.error('[db] emptyRecycleBin failed:', err);
    throw err;
  }
}

/**
 * Remove recycle-bin entries whose `expiresAt` has passed.
 *
 * Called automatically by {@link initDB} after the database is opened.
 * Safe to call at any time.
 *
 * @returns {Promise<number>} Number of entries cleaned up.
 */
export async function cleanupExpiredRecycleBin() {
  try {
    const now = Date.now();
    const all = await getDB().getAll('recycle-bin');
    let cleaned = 0;

    for (const entry of all) {
      if (entry.expiresAt < now) {
        await getDB().delete('recycle-bin', entry.id);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      console.log(`[db] Cleared ${cleaned} expired recycle-bin entries.`);
    }

    return cleaned;
  } catch (err) {
    console.error('[db] cleanupExpiredRecycleBin failed:', err);
    throw err;
  }
}

// ===========================================================================
// 5. SETTINGS
// ===========================================================================

/**
 * Store an arbitrary value under a key in the `settings` object store.
 *
 * NOTE: This is for non-preference data only.  User preferences live in
 * `browser.storage.local` via {@link module:lib/storage}.
 *
 * @param {string} key
 * @param {*} value
 * @returns {Promise<boolean>}
 */
export async function setSetting(key, value) {
  try {
    await getDB().put('settings', { key, value });
    return true;
  } catch (err) {
    console.error('[db] setSetting failed:', err);
    throw err;
  }
}

/**
 * Read a value from the `settings` store.
 *
 * @param {string} key
 * @returns {Promise<*|undefined>} The stored value, or undefined.
 */
export async function getSetting(key) {
  try {
    const record = await getDB().get('settings', key);
    return record ? record.value : undefined;
  } catch (err) {
    console.error('[db] getSetting failed:', err);
    throw err;
  }
}

/**
 * Remove a setting key.
 *
 * @param {string} key
 * @returns {Promise<boolean>}
 */
export async function deleteSetting(key) {
  try {
    await getDB().delete('settings', key);
    return true;
  } catch (err) {
    console.error('[db] deleteSetting failed:', err);
    throw err;
  }
}

// ===========================================================================
// 6. UNIFIED SEARCH
// ===========================================================================

/**
 * Search across tab-groups with a simple case-insensitive text match.
 *
 * Searched fields:
 * - `tab-groups`: name, domain
 *
 * @param {string} query - The search string.
 * @returns {Promise<Array<Object>>} Array of matching tab-group records.
 */
export async function searchAll(query) {
  const q = (query || '').toLowerCase();

  if (!q) {
    return [];
  }

  try {
    const groups = await getDB().getAll('tab-groups');
    return groups.filter(
      (g) =>
        (g.name && g.name.toLowerCase().includes(q)) ||
        (g.domain && g.domain.toLowerCase().includes(q)),
    );
  } catch (err) {
    console.error('[db] searchAll failed:', err);
    return [];
  }
}

// ===========================================================================
// 7. BULK IMPORT / EXPORT
// ===========================================================================

/**
 * Export all user data as a single plain object.
 *
 * Includes every record from tab-groups, quick-links, and recycle-bin.
 * Useful for backup, sync, and manual migration.
 *
 * @returns {Promise<{tabGroups: Array, quickLinks: Array, recycleBin: Array}>}
 */
export async function exportAllData() {
  try {
    const dbh = getDB();
    const [tabGroups, quickLinks, recycleBin] = await Promise.all([
      dbh.getAll('tab-groups'),
      dbh.getAll('quick-links'),
      dbh.getAll('recycle-bin'),
    ]);

    return { tabGroups, quickLinks, recycleBin };
  } catch (err) {
    console.error('[db] exportAllData failed:', err);
    throw err;
  }
}

/**
 * Import data into the database.
 *
 * Two strategies:
 * - **merge** (default): Only adds items whose `id` does not already exist in
 *   the target store.  Existing records are left untouched.
 * - **replace**: Clears each store completely before inserting the new data.
 *
 * @param {{tabGroups?: Array, quickLinks?: Array, recycleBin?: Array}} data
 *        The data to import (same shape as returned by {@link exportAllData}).
 * @param {boolean} [merge=true] Whether to merge (true) or fully replace (false).
 * @returns {Promise<{tabGroups:number, quickLinks:number, recycleBin:number}>}
 *          Counts of imported items per store.
 */
export async function importAllData(data, merge = true) {
  const dbh = getDB();

  /** @type {{tabGroups:number, quickLinks:number, recycleBin:number}} */
  const counts = {
    tabGroups: 0,
    quickLinks: 0,
    recycleBin: 0,
  };

  /** Map<storeName, Array<record>> */
  const storeMap = {
    'tab-groups': data.tabGroups || [],
    'quick-links': data.quickLinks || [],
    'recycle-bin': data.recycleBin || [],
  };

  /** Map<storeName, keyof counts> */
  const keyMap = {
    'tab-groups': 'tabGroups',
    'quick-links': 'quickLinks',
    'recycle-bin': 'recycleBin',
  };

  try {
    for (const [storeName, incoming] of Object.entries(storeMap)) {
      if (incoming.length === 0) continue;

      if (merge) {
        // Build a set of existing ids so we only add genuinely new items.
        const existing = await dbh.getAll(storeName);
        const existingIds = new Set(existing.map((r) => r.id));

        for (const record of incoming) {
          if (!existingIds.has(record.id)) {
            await dbh.put(storeName, record);
            counts[keyMap[storeName]]++;
          }
        }
      } else {
        // Replace — clear first, then bulk insert.
        await dbh.clear(storeName);
        for (const record of incoming) {
          await dbh.put(storeName, record);
        }
        counts[keyMap[storeName]] = incoming.length;
      }
    }

    return counts;
  } catch (err) {
    console.error('[db] importAllData failed:', err);
    throw err;
  }
}

// ===========================================================================
// 8. UTILITY: DELETE DATABASE
// ===========================================================================

/**
 * Close and delete the entire database.
 *
 * Resets the module-level `db` handle to `null`.  After calling this
 * you must call {@link initDB} again before using any CRUD functions.
 *
 * @returns {Promise<void>}
 */
export async function deleteDatabase() {
  try {
    if (db) {
      db.close();
      db = null;
    }
    // Import deleteDB from idb so we don't need a top-level import
    const { deleteDB } = await import('./idb.js');
    await deleteDB(DB_NAME);
  } catch (err) {
    console.error('[db] deleteDatabase failed:', err);
    throw err;
  }
}
