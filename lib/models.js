/**
 * @file Data model factory functions for Tab Oasis Firefox extension.
 * Pure functions that create well-formed data objects with consistent shapes, IDs, and timestamps.
 */

import { generateId } from './utils.js';

/**
 * Creates a tab group object.
 * @param {Object} params
 * @param {string} [params.name]
 * @param {string} [params.domain]
 * @param {Array} [params.tabs=[]]
 * @returns {Object}
 */
export function createTabGroup({ name, domain, tabs = [] } = {}) {
  return {
    id: generateId(),
    name: name || domain || 'Ungrouped',
    domain: domain || '',
    tabs: tabs.map(t => createSavedTab(t)),
    isPinned: false,
    isLocked: false,
    sortOrder: Date.now(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

/**
 * Creates a saved tab object.
 * @param {Object} params
 * @param {string} [params.title]
 * @param {string} [params.url]
 * @param {string} [params.favIconUrl]
 * @returns {Object}
 */
export function createSavedTab({ title, url, favIconUrl } = {}) {
  return {
    id: generateId(),
    title: title || url || 'Untitled',
    url: url || '',
    favIconUrl: favIconUrl || '',
    savedAt: Date.now(),
  };
}

/**
 * Creates a quick link object.
 * @param {Object} params
 * @param {string} [params.title]
 * @param {string} [params.url]
 * @param {string} [params.favIconUrl='']
 * @returns {Object}
 */
export function createQuickLink({ title, url, favIconUrl = '' } = {}) {
  return {
    id: generateId(),
    title: title || 'Link',
    url: url || '',
    favIconUrl: favIconUrl || '',
    sortOrder: Date.now(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

/**
 * Creates a reading list item object.
 * @param {Object} params
 * @param {string} [params.url]
 * @param {string} [params.title]
 * @param {string} [params.favIconUrl='']
 * @param {string} [params.notes='']
 * @returns {Object}
 */
export function createReadingItem({ url, title, favIconUrl = '', notes = '' } = {}) {
  return {
    id: generateId(),
    url: url || '',
    title: title || url || 'Untitled',
    favIconUrl: favIconUrl || '',
    notes: notes || '',
    isArchived: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

/**
 * Creates a todo item object.
 * @param {Object} params
 * @param {string} [params.text]
 * @returns {Object}
 */
export function createTodo({ text } = {}) {
  return {
    id: generateId(),
    text: text || '',
    isCompleted: 0,
    sortOrder: Date.now(),
    createdAt: Date.now(),
    completedAt: null,
  };
}

/**
 * Creates a session object.
 * @param {Object} params
 * @param {string} [params.name]
 * @param {Array} [params.tabIds=[]]
 * @param {Array} [params.groupIds=[]]
 * @returns {Object}
 */
export function createSession({ name, tabIds = [], groupIds = [] } = {}) {
  return {
    id: generateId(),
    name: name || 'Session ' + new Date().toLocaleString(),
    tabIds: tabIds,
    groupIds: groupIds,
    createdAt: Date.now(),
  };
}

/**
 * Creates a recycle bin entry object.
 * @param {string} originalStore - The store name the item was deleted from.
 * @param {Object} originalData - The original data object.
 * @returns {Object}
 */
export function createRecycleEntry(originalStore, originalData) {
  return {
    id: generateId(),
    originalStore: originalStore,
    originalData: originalData,
    deletedAt: Date.now(),
    expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000, // 30 days
  };
}
