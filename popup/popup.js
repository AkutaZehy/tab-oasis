/**
 * popup.js — Toolbar popup script for Tab Oasis Firefox extension.
 *
 * Provides a compact popup with quick actions: save all tabs,
 * remove duplicates, open sidebar, and browse recent groups.
 *
 * @module popup/popup
 */

import { initDB, getAllGroups, getGroup, saveGroup } from '../lib/db.js';
import { localizePage } from '../lib/i18n.js';
import { getPref } from '../lib/storage.js';

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------
const tabCountEl = document.getElementById('popup-tab-count');
const recentListEl = document.getElementById('popup-recent-list');
const noRecentEl = document.getElementById('popup-no-recent');

const btnSaveAll = document.getElementById('btn-save-all');
const btnDedup = document.getElementById('btn-dedup');
const btnOpenWorkbench = document.getElementById('btn-open-workbench');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Close the popup window.
 */
function closePopup() {
  window.close();
}

/**
 * Send a message to the background script and return the response.
 *
 * @param {string} type - Message type.
 * @param {Object} [data={}] - Additional message data.
 * @returns {Promise<Object>} Response from background.
 */
function sendMessage(type, data = {}) {
  return browser.runtime.sendMessage({ type, ...data });
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

/**
 * Apply the user's theme preference to the body element.
 *
 * Reads from browser.storage.local prefs, falling back to 'system'.
 */
async function applyTheme() {
  try {
    const theme = await getPref('theme');
    document.body.setAttribute('data-theme', theme || 'system');
  } catch (err) {
    console.error('[popup] Failed to apply theme:', err);
    document.body.setAttribute('data-theme', 'system');
  }
}

/**
 * Query the current window's tab count and update the header indicator.
 */
async function updateTabCount() {
  try {
    const tabs = await browser.tabs.query({ currentWindow: true });
    const count = tabs.length;
    const localeKey = count === 1 ? '1 tab open' : `${count} tabs open`;
    tabCountEl.textContent = localeKey;
  } catch (err) {
    console.error('[popup] Failed to query tab count:', err);
    tabCountEl.textContent = '0 tabs open';
  }
}

/**
 * Load the 5 most recent tab groups from IndexedDB and render their tabs.
 */
async function loadRecentGroups() {
  try {
    const allGroups = await getAllGroups();
    if (allGroups.length === 0) {
      recentListEl.innerHTML = '';
      noRecentEl.classList.remove('hidden');
      return;
    }

    noRecentEl.classList.add('hidden');
    recentListEl.innerHTML = '';

    // Show up to 20 saved tabs across recent groups
    let shown = 0;
    for (const group of allGroups) {
      if (!group.tabs) continue;
      for (const tab of group.tabs) {
        if (shown >= 20) break;
        const item = renderTabItem(tab, group);
        recentListEl.appendChild(item);
        shown++;
      }
      if (shown >= 20) break;
    }
  } catch (err) {
    console.error('[popup] Failed to load recent groups:', err);
    recentListEl.innerHTML = '';
    noRecentEl.classList.remove('hidden');
  }
}

function renderTabItem(tab, group) {
  const item = document.createElement('div');
  item.className = 'recent-tab-item';

  const favicon = document.createElement('img');
  favicon.className = 'recent-favicon';
  favicon.src = tab.favIconUrl || '';
  favicon.width = 16; favicon.height = 16;
  favicon.onerror = () => { favicon.style.display = 'none'; };

  const link = document.createElement('a');
  link.className = 'recent-tab-link';
  link.href = tab.url || '#';
  link.textContent = tab.title || tab.url || 'Untitled';
  link.title = tab.url || '';
  link.addEventListener('click', (e) => {
    e.preventDefault();
    browser.tabs.create({ url: tab.url });
    closePopup();
  });

  const removeBtn = document.createElement('button');
  removeBtn.className = 'recent-tab-remove';
  removeBtn.textContent = 'x';
  removeBtn.title = 'Remove from list';
  removeBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    e.preventDefault();
    // Remove tab from its group
    const g = await getGroup(group.id);
    if (g && g.tabs) {
      g.tabs = g.tabs.filter(t => t.url !== tab.url);
      await saveGroup(g);
      item.remove();
    }
  });

  item.appendChild(favicon);
  item.appendChild(link);
  item.appendChild(removeBtn);
  return item;
}

// ---------------------------------------------------------------------------
// Button handlers
// ---------------------------------------------------------------------------

/**
 * Handle "Save All Tabs" button click.
 */
btnSaveAll.addEventListener('click', async () => {
  try {
    await sendMessage('saveAllTabs');
    closePopup();
  } catch (err) {
    console.error('[popup] Save All Tabs failed:', err);
  }
});

/**
 * Handle "Remove Duplicates" button click.
 */
btnDedup.addEventListener('click', async () => {
  try {
    const result = await sendMessage('deduplicateTabs');
    // The result will be shown briefly — background handles the actual dedup
    // We auto-close the popup after a short delay so the user can see feedback
    closePopup();
  } catch (err) {
    console.error('[popup] Deduplicate Tabs failed:', err);
  }
});

/**
 * Handle "Open Sidebar" footer button click.
 */
btnOpenWorkbench.addEventListener('click', async () => {
  try {
    await browser.tabs.create({ url: browser.runtime.getURL('workbench.html') });
    closePopup();
  } catch (err) {
    console.error('[popup] Failed to open workbench:', err);
    closePopup();
  }
});

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

/**
 * Initialize the popup on page load.
 *
 * Order: DB → theme → i18n → tab count → recent groups
 */
async function init() {
  try {
    await initDB();
  } catch (err) {
    console.error('[popup] Database init failed:', err);
    // Continue with reduced functionality
  }

  await applyTheme();
  localizePage();

  // Fire these in parallel — they don't depend on each other
  await Promise.all([
    updateTabCount(),
    loadRecentGroups(),
  ]);
}

// Kick off when the DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
