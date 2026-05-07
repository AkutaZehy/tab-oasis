/**
 * workbench.js — Main JS for Tab Oasis workbench (N-Tab style).
 * Single ES module: all UI logic — groups, quick links, search, theme,
 * settings, sync, import/export, recycle bin.
 */

// =============================================================================
// 1. IMPORTS
// =============================================================================

import { localizePage, t } from './lib/i18n.js';
import * as storage from './lib/storage.js';
import {
  initDB, getAllGroups, saveGroup, getGroup, deleteGroup,
  addToRecycleBin, getRecycleBinItems, restoreFromRecycleBin,
  permanentlyDelete, emptyRecycleBin, searchAll, exportAllData, importAllData,
} from './lib/db.js';
import {
  escapeHtml, formatRelativeTime, getDomain, generateId, truncate, normalizeUrl,
} from './lib/utils.js';

// =============================================================================
// 2. STATE
// =============================================================================

let db = null;

// Theme cycle order
const THEMES = ['light', 'dark', 'system'];
const THEME_ICONS = { light: '☀️', dark: '🌙', system: '◐' };

// =============================================================================
// 3. DOM HELPERS
// =============================================================================

/** @param {string} id @returns {HTMLElement|null} */
const $ = (id) => document.getElementById(id);
/** @param {string} sel @param {HTMLElement|Document} [root=document] @returns {NodeListOf<Element>} */
const $$ = (sel, root) => (root || document).querySelectorAll(sel);

// =============================================================================
// 4. INIT
// =============================================================================

async function init() {
  try {
    db = await initDB();
  } catch (err) {
    console.error('[workbench] DB init failed:', err);
    showToast('Database init failed', 'error');
    // Continue anyway — wire up UI, but rendering will skip
  }
  localizePage(document);
  applyTheme(await storage.getPref('theme'));
  wireUI();
  initDragDrop();
  if (db) await refreshAll();
  listenSystemTheme();
}

async function refreshAll() {
  await renderAll();
}

// =============================================================================
// 5. RENDER — tab groups from DB
// =============================================================================

async function renderAll() {
  if (!db) return;
  const container = $('tab-groups-container');
  const emptyState = $('empty-state');

  let groups = [];
  try { groups = await getAllGroups(); } catch (err) {
    console.error('[workbench] getAllGroups failed:', err);
  }

  container.querySelectorAll('.group-card').forEach(c => c.remove());

  // Ensure a default group always exists
  const defaultGroup = groups.find(g => g.name === 'Saved Tabs');
  if (!defaultGroup && groups.length === 0) {
    try {
      const { createTabGroup } = await import('./lib/models.js');
      const dg = createTabGroup({ name: 'Saved Tabs', domain: '', tabs: [] });
      await saveGroup(dg);
      groups = await getAllGroups();
    } catch (_) {}
  }

  if (groups.length === 0) {
    emptyState.classList.remove('hidden');
  } else {
    emptyState.classList.add('hidden');
    for (const group of groups) {
      container.appendChild(createGroupCard(group));
    }
  }

  const totalTabs = groups.reduce((s, g) => s + (g.tabs ? g.tabs.length : 0), 0);
  $('tab-stats').textContent = `${totalTabs} tabs in ${groups.length} groups`;
}

function createGroupCard(group) {
  const tmpl = $('group-template');
  const card = /** @type {HTMLElement} */ (tmpl.content.cloneNode(true).firstElementChild);
  const tabs = group.tabs || [];

  card.setAttribute('data-group-id', group.id);
  if (group.name === 'Saved Tabs') {
    card.setAttribute('data-default', 'true');
  }
  card.querySelector('.group-name').textContent = group.name || 'Untitled';
  card.querySelector('.group-count').textContent = `${tabs.length} tabs`;
  card.querySelector('.group-date').textContent = formatRelativeTime(group.createdAt);

  // Set group favicon
  const gfav = card.querySelector('.group-favicon');
  if (gfav) {
    const tabWithFav = tabs.find(t => t.favIconUrl);
    gfav.src = tabWithFav ? tabWithFav.favIconUrl : '';
    gfav.onerror = () => { gfav.style.display = 'none'; };
  }

  const tabsContainer = card.querySelector('.group-tabs');
  for (let i = 0; i < tabs.length; i++) {
    tabsContainer.appendChild(createTabItem(tabs[i], group.id, i));
  }

  if (group.isPinned) card.setAttribute('data-pinned', 'true');
  if (group.isLocked) card.setAttribute('data-locked', 'true');

  const pinBtn = card.querySelector('[data-action="pin-group"]');
  if (pinBtn) pinBtn.textContent = group.isPinned ? t('groupAction_unpin') : t('groupAction_pin');

  const lockBtn = card.querySelector('[data-action="lock-group"]');
  if (lockBtn) lockBtn.textContent = group.isLocked ? t('groupAction_unlock') : t('groupAction_lock');

  // Set button text via i18n
  const restoreBtn = card.querySelector('[data-action="restore-group"]');
  if (restoreBtn) restoreBtn.textContent = t('tabAction_restoreAll');
  const restoreNewBtn = card.querySelector('[data-action="restore-new"]');
  if (restoreNewBtn) restoreNewBtn.textContent = t('tabAction_restoreToNewWindow');
  const renameBtn = card.querySelector('[data-action="rename-group"]');
  if (renameBtn) renameBtn.textContent = t('groupAction_rename');
  const deleteBtn = card.querySelector('[data-action="delete-group"]');
  if (deleteBtn) deleteBtn.textContent = t('groupAction_delete');

  // Default group: replace delete label
  if (group.name === 'Saved Tabs') {
    if (deleteBtn) deleteBtn.textContent = t('tabAction_clear');
  }

  return card;
}

function createTabItem(tab, groupId, index) {
  const tmpl = $('tab-template');
  const el = /** @type {HTMLElement} */ (tmpl.content.cloneNode(true).firstElementChild);

  el.setAttribute('data-tab-url', tab.url || '');
  el.setAttribute('data-tab-index', String(index));
  el.setAttribute('data-group-id', groupId);
  el.setAttribute('draggable', 'true');
  el.setAttribute('title', 'Drag to move between groups');

  const favicon = el.querySelector('.tab-favicon');
  if (tab.favIconUrl) {
    favicon.src = tab.favIconUrl;
  } else {
    favicon.style.display = 'none';
  }
  favicon.addEventListener('error', () => { favicon.style.display = 'none'; }, { once: true });

  const link = el.querySelector('.tab-link');
  link.href = tab.url || '#';
  link.textContent = tab.title || tab.url || 'Untitled';
  link.addEventListener('click', (e) => {
    // Don't open if currently editing
    if (link.contentEditable === 'true') return;
    e.preventDefault();
    if (tab.url) browser.tabs.create({ url: tab.url });
    // Auto-remove after restore if enabled
    const autoRemove = $('setting-auto-remove')?.checked;
    if (autoRemove && groupId) {
      removeTab(groupId, index);
    }
  });

  const editBtn = el.querySelector('[data-action="edit-tab"]');
  if (editBtn) editBtn.textContent = t('tab_edit');
  const removeBtn = el.querySelector('[data-action="remove-tab"]');
  if (removeBtn) removeBtn.textContent = t('tabAction_remove');

  el.querySelector('.tab-url').textContent = truncate(tab.url || '', 50);
  return el;
}

// =============================================================================
// 6. QUICK LINKS
// =============================================================================

async function renderQuickLinks() {
  const container = $('quick-links-list');
  const section = $('quick-links-section');
  const countEl = $('quick-link-count');

  let links = [];
  try { links = await getAllQuickLinks(); } catch (err) {
    console.error('[workbench] getAllQuickLinks failed:', err);
  }

  container.innerHTML = '';
  countEl.textContent = String(links.length);

  if (links.length === 0) {
    section.classList.add('collapsed');
  } else {
    section.classList.remove('collapsed');
    for (const link of links) {
      container.appendChild(createQuickLinkItem(link));
    }
  }
}

function createQuickLinkItem(link) {
  const div = document.createElement('div');
  div.className = 'quick-link-item';
  div.setAttribute('data-link-id', link.id);

  const fav = document.createElement('img');
  fav.className = 'quick-link-favicon';
  fav.src = link.favIconUrl || '';
  fav.width = 16; fav.height = 16; fav.loading = 'lazy';
  fav.onerror = () => { fav.style.display = 'none'; };

  const a = document.createElement('a');
  a.className = 'quick-link-a';
  a.href = link.url || '#';
  a.textContent = link.title || link.url || 'Untitled';
  a.target = '_blank';
  a.addEventListener('click', (e) => {
    e.preventDefault();
    browser.tabs.create({ url: link.url });
  });

  const rm = document.createElement('button');
  rm.className = 'btn-icon quick-link-remove';
  rm.setAttribute('data-action', 'delete-quick-link');
  rm.setAttribute('data-link-id', link.id);
  rm.textContent = '✕';
  rm.title = 'Remove quick link';

  div.append(fav, a, rm);
  return div;
}

async function addQuickLink(title, url) {
  try {
    await saveQuickLink({ title, url });
    await renderQuickLinks();
    showToast('Quick link added', 'success');
  } catch (err) {
    console.error('[workbench] addQuickLink failed:', err);
    showToast('Failed to add quick link', 'error');
  }
}

async function deleteQuickLinkById(id) {
  try {
    await deleteQuickLink(id);
    await renderQuickLinks();
    showToast('Quick link removed', 'success');
  } catch (err) {
    console.error('[workbench] deleteQuickLink failed:', err);
    showToast('Failed to remove quick link', 'error');
  }
}

// =============================================================================
// 7. TAB GROUP ACTIONS
// =============================================================================

async function saveAllTabs() {
  try {
    const res = await browser.runtime.sendMessage({ type: 'saveAllTabs' });
    if (res && res.success) {
      showToast(`Saved ${res.tabCount || 0} tabs`, 'success');
      await renderAll();
    } else {
      showToast(res?.error || 'Failed to save tabs', 'error');
    }
  } catch (err) {
    console.error('[workbench] saveAllTabs failed:', err);
    showToast('Failed to save tabs (is the extension active?)', 'error');
  }
}

async function restoreGroup(groupId) {
  try {
    const res = await browser.runtime.sendMessage({ type: 'restoreAllTabs', groupId });
    if (res && res.success) {
      showToast(`Restored ${res.tabCount || 0} tabs`, 'success');
    } else {
      showToast(res?.error || 'Failed to restore tabs', 'error');
    }
  } catch (err) {
    console.error('[workbench] restoreGroup failed:', err);
    showToast('Failed to restore tabs', 'error');
  }
}

async function restoreToNewWindow(groupId) {
  try {
    const res = await browser.runtime.sendMessage({ type: 'restoreToNewWindow', groupId });
    if (res && res.success) {
      showToast('Restored to new window', 'success');
    } else {
      showToast(res?.error || 'Failed to restore to new window', 'error');
    }
  } catch (err) {
    console.error('[workbench] restoreToNewWindow failed:', err);
    showToast('Failed to restore to new window', 'error');
  }
}

async function togglePin(groupId) {
  try {
    const group = await getGroup(groupId);
    if (!group) return;
    group.isPinned = group.isPinned ? 0 : 1;
    await saveGroup(group);
    await renderAll();
  } catch (err) {
    console.error('[workbench] togglePin failed:', err);
    showToast('Failed to toggle pin', 'error');
  }
}

async function toggleLock(groupId) {
  try {
    const group = await getGroup(groupId);
    if (!group) return;
    group.isLocked = group.isLocked ? 0 : 1;
    await saveGroup(group);
    await renderAll();
  } catch (err) {
    console.error('[workbench] toggleLock failed:', err);
    showToast('Failed to toggle lock', 'error');
  }
}

async function renameGroup(groupId, newName) {
  try {
    const group = await getGroup(groupId);
    if (!group) return;
    group.name = newName.trim() || 'Untitled';
    await saveGroup(group);
    await renderAll();
  } catch (err) {
    console.error('[workbench] renameGroup failed:', err);
    showToast('Failed to rename group', 'error');
  }
}

async function deleteGroupById(groupId) {
  try {
    const group = await getGroup(groupId);
    if (!group) return;
    try { await addToRecycleBin('tab-groups', group); } catch (err) {
      console.warn('[workbench] Could not add to recycle bin:', err);
    }
    await deleteGroup(groupId);
    await renderAll();
    showToast('Group moved to recycle bin', 'success');
  } catch (err) {
    console.error('[workbench] deleteGroupById failed:', err);
    showToast('Failed to delete group', 'error');
  }
}

async function removeTab(groupId, tabIndex) {
  try {
    const group = await getGroup(groupId);
    if (!group) return;
    const tabs = group.tabs || [];
    if (tabIndex < 0 || tabIndex >= tabs.length) return;
    const removed = tabs.splice(tabIndex, 1)[0];

    if (tabs.length === 0) {
      await deleteGroupById(groupId);
    } else {
      await saveGroup(group);
      await renderAll();
    }
    showToast(`Removed "${truncate(removed.title || removed.url, 30)}"`, 'info');
  } catch (err) {
    console.error('[workbench] removeTab failed:', err);
    showToast('Failed to remove tab', 'error');
  }
}

// --- Create new group with default name ---
async function createNewGroup() {
  try {
    const { createTabGroup } = await import('./lib/models.js');
    const group = createTabGroup({ name: `New Group ${new Date().toLocaleString()}`, domain: '', tabs: [] });
    await saveGroup(group);
    await renderAll();
    showToast('New group created', 'success');
  } catch (err) {
    console.error('[workbench] createNewGroup failed:', err);
    showToast('Failed to create group', 'error');
  }
}

// --- Drag-and-drop: move tabs between groups + merge groups ---
function initDragDrop() {
  document.addEventListener('dragstart', (e) => {
    // Tab drag
    const tab = /** @type {HTMLElement} */ (e.target).closest('.tab-item');
    if (tab) {
      const groupId = tab.getAttribute('data-group-id');
      const tabIdx = tab.getAttribute('data-tab-index');
      e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'tab', groupId, tabIdx }));
      e.dataTransfer.effectAllowed = 'move';
      tab.style.opacity = '0.4';
      return;
    }
    // Group card drag (for merging)
    const gcard = /** @type {HTMLElement} */ (e.target).closest('.group-card');
    if (gcard) {
      const groupId = gcard.getAttribute('data-group-id');
      e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'group', groupId }));
      e.dataTransfer.effectAllowed = 'move';
      gcard.style.opacity = '0.4';
      return;
    }
  });

  document.addEventListener('dragend', (e) => {
    const tab = /** @type {HTMLElement} */ (e.target).closest('.tab-item');
    if (tab) { tab.style.opacity = ''; }
    const gcard = /** @type {HTMLElement} */ (e.target).closest('.group-card');
    if (gcard) { gcard.style.opacity = ''; }
    document.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
  });

  document.addEventListener('dragover', (e) => {
    const zone = /** @type {HTMLElement} */ (e.target).closest('[data-drop-zone="group"]');
    if (!zone) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    zone.classList.add('drag-over');
  });

  document.addEventListener('dragleave', (e) => {
    const zone = /** @type {HTMLElement} */ (e.target).closest('[data-drop-zone="group"]');
    if (zone) zone.classList.remove('drag-over');
  });

  document.addEventListener('drop', async (e) => {
    const zone = /** @type {HTMLElement} */ (e.target).closest('[data-drop-zone="group"]');
    if (!zone) return;
    e.preventDefault();
    zone.classList.remove('drag-over');

    let dragData;
    try { dragData = JSON.parse(e.dataTransfer.getData('text/plain')); } catch { return; }
    if (!dragData) return;

    if (dragData.type === 'tab') {
      await handleTabDrop(dragData, zone);
    } else if (dragData.type === 'group') {
      await handleGroupDrop(dragData, zone);
    }
  });
}


async function handleTabDrop(dragData, zone) {
  const srcGroupId = dragData.groupId;
  const tabIdx = parseInt(dragData.tabIdx, 10);
  if (isNaN(tabIdx)) return;
  const targetCard = zone.closest(".group-card");
  const targetGroupId = targetCard ? targetCard.getAttribute("data-group-id") : null;
  if (!targetGroupId || srcGroupId === targetGroupId) return;
  try {
    const srcGroup = await getGroup(srcGroupId);
    const tgtGroup = await getGroup(targetGroupId);
    if (!srcGroup || !tgtGroup) return;
    const srcTabs = srcGroup.tabs || [];
    if (tabIdx < 0 || tabIdx >= srcTabs.length) return;
    const [movedTab] = srcTabs.splice(tabIdx, 1);
    (tgtGroup.tabs || (tgtGroup.tabs = [])).push(movedTab);
    if (srcTabs.length === 0) await deleteGroup(srcGroupId);
    else await saveGroup(srcGroup);
    await saveGroup(tgtGroup);
    await renderAll();
    showToast("Tab moved", "success");
  } catch (err) {
    console.error("[workbench] tab drop failed:", err);
    showToast("Failed to move tab", "error");
  }
}

async function handleGroupDrop(dragData, zone) {
  const srcGroupId = dragData.groupId;
  const targetCard = zone.closest(".group-card");
  const targetGroupId = targetCard ? targetCard.getAttribute("data-group-id") : null;
  if (!targetGroupId || srcGroupId === targetGroupId) return;
  try {
    const srcGroup = await getGroup(srcGroupId);
    const tgtGroup = await getGroup(targetGroupId);
    if (!srcGroup || !tgtGroup) return;
    const srcTabs = srcGroup.tabs || [];
    const tgtTabs = tgtGroup.tabs || [];
    for (const tab of srcTabs) tgtTabs.push(tab);
    tgtGroup.tabs = tgtTabs;
    await deleteGroup(srcGroupId);
    await saveGroup(tgtGroup);
    await renderAll();
    showToast("Groups merged", "success");
  } catch (err) {
    console.error("[workbench] group merge failed:", err);
    showToast("Failed to merge groups", "error");
  }
}
async function deduplicateTabs() {
  try {
    const groups = await getAllGroups();
    // Collect all tabs across groups with their group info
    const urlMap = new Map(); // normalizedUrl → [{ group, tab, tabIdx }]

    for (const group of groups) {
      if (!group.tabs) continue;
      for (let i = 0; i < group.tabs.length; i++) {
        const tab = group.tabs[i];
        const key = normalizeUrl(tab.url);
        if (!key) continue;
        if (!urlMap.has(key)) urlMap.set(key, []);
        urlMap.get(key).push({ group, tab, tabIdx: i });
      }
    }

    let removed = 0;
    for (const entries of urlMap.values()) {
      if (entries.length < 2) continue;
      // Keep first entry, remove rest
      for (let i = 1; i < entries.length; i++) {
        const { group, tabIdx } = entries[i];
        // Mark for removal (remove from end to keep indices valid)
        group.tabs.splice(tabIdx, 1);
        removed++;
        // Adjust indices for remaining entries in same group
        for (let j = i + 1; j < entries.length; j++) {
          if (entries[j].group.id === group.id && entries[j].tabIdx > tabIdx) {
            entries[j].tabIdx--;
          }
        }
      }
    }

    // Save modified groups
    for (const group of groups) {
      if (group.tabs && group.tabs.length > 0) {
        await saveGroup(group);
      }
    }

    if (removed > 0) {
      showToast(`${removed} duplicate tab${removed > 1 ? 's' : ''} removed`, 'success');
      await renderAll();
    } else {
      showToast('No duplicates found', 'info');
    }
  } catch (err) {
    console.error('[workbench] deduplicateTabs failed:', err);
    showToast('Dedup failed', 'error');
  }
}

// =============================================================================
// 8. THEME
// =============================================================================

function applyTheme(theme) {
  if (theme === 'system') {
    const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.body.setAttribute('data-theme', dark ? 'dark' : 'light');
  } else {
    document.body.setAttribute('data-theme', theme);
  }
  const btn = $('btn-theme');
  if (btn) btn.textContent = THEME_ICONS[theme] || '☀';
}

async function handleThemeChange(value) {
  applyTheme(value);
  await storage.setPref('theme', value);
}

function listenSystemTheme() {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  mq.addEventListener('change', async () => {
    if ((await storage.getPref('theme')) === 'system') applyTheme('system');
  });
}

async function cycleTheme() {
  const current = await storage.getPref('theme');
  const idx = THEMES.indexOf(current);
  const next = THEMES[(idx + 1) % THEMES.length];
  applyTheme(next);
  await storage.setPref('theme', next);
}

// =============================================================================
// 10. SETTINGS PANEL
// =============================================================================

function openSettings() {
  $('settings-overlay').classList.remove('hidden');
  (async () => {
    const prefs = await browser.storage.local.get('prefs');
    const p = prefs.prefs || {};
    const platform = p.gistPlatform || 'github';
    const key = platform === 'gitee' ? 'gistToken_gitee' : 'gistToken_github';
    const token = p[key] || p.gistToken || '';
    const sel = $('sync-platform'); if (sel) sel.value = platform;
    const inp = $('sync-token'); if (inp && token) inp.value = token;
    const autoRm = await storage.getPref('autoRemove');
    const cb = $('setting-auto-remove'); if (cb) cb.checked = !!autoRm;
  })();
}
function closeSettings() { $('settings-overlay').classList.add('hidden'); }

// =============================================================================
// 11. SYNC
// =============================================================================

function getTokenKey() {
  const platform = $('sync-platform')?.value || 'github';
  return platform === 'gitee' ? 'gistToken_gitee' : 'gistToken_github';
}

async function handleSyncSave() {
  const token = $('sync-token')?.value?.trim();
  if (!token) { showToast('Enter a token first', 'error'); return; }
  const key = getTokenKey();
  const platform = $('sync-platform')?.value || 'github';
  // Save platform-specific token directly to storage.local (bypasses DEFAULT_PREFS whitelist)
  const prefs = await browser.storage.local.get('prefs');
  const p = prefs.prefs || {};
  p[key] = token;
  p.gistToken = token;
  p.gistPlatform = platform;
  await browser.storage.local.set({ prefs: p });
  $('sync-status').textContent = 'Token saved';
  showToast('Token saved', 'success');
}

async function handleSyncLoad() {
  const key = getTokenKey();
  const prefs = await browser.storage.local.get('prefs');
  const p = prefs.prefs || {};
  const token = p[key];
  if (token) {
    const inp = $('sync-token'); if (inp) inp.value = token;
    $('sync-status').textContent = 'Token loaded';
    showToast('Token loaded', 'info');
  } else {
    $('sync-status').textContent = 'No saved token';
    showToast('No token saved for this platform', 'error');
  }
}

async function handleSyncPush() {
  const platform = $('sync-platform')?.value || 'github';
  const token = $('sync-token')?.value?.trim() || await storage.getPref(getTokenKey());
  if (!token) { showToast('Save a token first', 'error'); return; }
  if (!$('sync-token').value) $('sync-token').value = token;
  const statusEl = $('sync-status');
  try {
    if (statusEl) statusEl.textContent = 'Pushing...';
    await browser.runtime.sendMessage({ type: 'configureSync', platform, token });
    const res = await browser.runtime.sendMessage({ type: 'syncToGist', platform });
    if (res && res.success) {
      if (statusEl) statusEl.textContent = `Pushed at ${new Date().toLocaleTimeString()}`;
      showToast('Push successful', 'success');
    } else {
      const msg = res?.error || res?.message || 'Push failed';
      if (statusEl) statusEl.textContent = msg;
      showToast(msg, 'error');
    }
  } catch (err) {
    if (statusEl) statusEl.textContent = err?.message || 'Push failed';
    showToast('Push failed', 'error');
  }
}

async function handleSyncPull() {
  const platform = $('sync-platform')?.value || 'github';
  const token = $('sync-token')?.value?.trim() || await storage.getPref(getTokenKey());
  if (!token) { showToast('Save a token first', 'error'); return; }
  if (!$('sync-token').value) $('sync-token').value = token;
  const statusEl = $('sync-status');
  try {
    if (statusEl) statusEl.textContent = 'Pulling...';
    await browser.runtime.sendMessage({ type: 'configureSync', platform, token });
    const res = await browser.runtime.sendMessage({ type: 'syncFromGist', platform });
    if (res && res.success) {
      if (statusEl) statusEl.textContent = `Pulled at ${new Date().toLocaleTimeString()}`;
      showToast('Pull successful', 'success');
      await refreshAll();
    } else {
      const msg = res?.error || res?.message || 'Pull failed';
      if (statusEl) statusEl.textContent = msg;
      showToast(msg, 'error');
    }
  } catch (err) {
    if (statusEl) statusEl.textContent = err?.message || 'Pull failed';
    showToast('Pull failed', 'error');
  }
}

// =============================================================================
// 12. IMPORT / EXPORT
// =============================================================================

async function exportJSON() {
  try {
    const data = await exportAllData();
    downloadFile(JSON.stringify(data, null, 2), 'tab-oasis-backup.json', 'application/json');
    showToast('Export successful', 'success');
  } catch (err) {
    console.error('[workbench] exportJSON failed:', err);
    showToast('Export failed', 'error');
  }
}

async function exportHTML() {
  try {
    const data = await exportAllData();
    const { tabGroups = [], quickLinks = [] } = data;

    let html = `<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="UTF-8">\n<title>Tab Oasis Export</title>\n<style>
body{font-family:-apple-system,sans-serif;max-width:800px;margin:2em auto;}
h2{border-bottom:1px solid #ccc;padding-bottom:.3em;}
.group{margin:1em 0;padding:.8em;border:1px solid #ddd;border-radius:8px;}
.group-name{font-weight:bold;}
.tab{margin:.3em 0;padding-left:1em;}
.tab a{color:inherit;}.url{color:#666;font-size:.85em;}
.favicon{width:16px;height:16px;vertical-align:middle;margin-right:4px;}
</style>\n</head>\n<body>\n<h1>Tab Oasis Bookmarks</h1>\n<p>Exported: ${new Date().toLocaleString()}</p>\n`;

    if (quickLinks.length) {
      html += '<h2>Quick Links</h2>\n<ul>\n';
      for (const l of quickLinks) html += `  <li><a href="${escapeHtmlAttr(l.url)}">${escapeHtml(l.title)}</a></li>\n`;
      html += '</ul>\n';
    }

    if (tabGroups.length) {
      html += '<h2>Tab Groups</h2>\n';
      for (const g of tabGroups) {
        const tabs = g.tabs || [];
        html += `<div class="group">\n  <div class="group-name">${escapeHtml(g.name)} (${tabs.length} tabs)</div>\n`;
        for (const t of tabs) {
          html += `  <div class="tab"><img class="favicon" src="${escapeHtmlAttr(t.favIconUrl || '')}"><a href="${escapeHtmlAttr(t.url)}">${escapeHtml(t.title)}</a> <span class="url">${escapeHtml(truncate(t.url, 60))}</span></div>\n`;
        }
        html += '</div>\n';
      }
    }

    html += '</body>\n</html>\n';
    downloadFile(html, 'tab-oasis-bookmarks.html', 'text/html');
    showToast('HTML export successful', 'success');
  } catch (err) {
    console.error('[workbench] exportHTML failed:', err);
    showToast('HTML export failed', 'error');
  }
}

async function importFile(file) {
  if (!file) return;

  try {
    const text = await readFileAsText(file);
    let data;

    if (file.name.endsWith('.json')) {
      data = JSON.parse(text);
    } else if (file.name.endsWith('.html')) {
      showToast('HTML import not supported. Use JSON format.', 'error');
      return;
    } else {
      try { data = JSON.parse(text); } catch {
        showToast('Unsupported file format. Use .json or .html.', 'error');
        return;
      }
    }

    if (!data || typeof data !== 'object') {
      showToast('Invalid data format', 'error');
      return;
    }

    if (!(await showConfirm('Import will merge with existing data. Continue?'))) return;

    const r = await importAllData(data, true);
    const total = (r.tabGroups || 0) + (r.quickLinks || 0);
    await refreshAll();
    showToast(`Imported ${total} items`, 'success');
  } catch (err) {
    console.error('[workbench] importFile failed:', err);
    showToast(`Import failed: ${err.message}`, 'error');
  }
  $('import-file').value = '';
}

// =============================================================================
// 13. RECYCLE BIN
// =============================================================================

function openRecycleBin() {
  $('recycle-overlay').classList.remove('hidden');
  renderRecycleBin();
}

function closeRecycleBin() {
  $('recycle-overlay').classList.add('hidden');
}

async function renderRecycleBin() {
  const list = $('recycle-list');
  const emptyMsg = $('recycle-empty');

  let items = [];
  try { items = await getRecycleBinItems(); } catch (err) {
    console.error('[workbench] getRecycleBinItems failed:', err);
  }

  list.innerHTML = '';
  if (items.length === 0) {
    emptyMsg.classList.remove('hidden');
  } else {
    emptyMsg.classList.add('hidden');
    for (const item of items) list.appendChild(createRecycleBinItem(item));
  }
}

function createRecycleBinItem(entry) {
  const div = document.createElement('div');
  div.className = 'recycle-item';
  div.setAttribute('data-recycle-id', entry.id);

  const original = entry.originalData || {};
  const type = entry.originalStore || 'unknown';
  const label = type === 'tab-groups'
    ? `📑 ${original.name || 'Group'} (${(original.tabs || []).length} tabs)`
    : `📎 ${original.title || original.url || entry.id}`;

  const info = document.createElement('span');
  info.className = 'recycle-info';
  info.textContent = `${label} — deleted ${formatRelativeTime(entry.deletedAt)}`;

  const actions = document.createElement('span');
  actions.className = 'recycle-actions';

  const restoreBtn = document.createElement('button');
  restoreBtn.className = 'btn-icon';
  restoreBtn.setAttribute('data-action', 'restore-recycle');
  restoreBtn.setAttribute('data-recycle-id', entry.id);
  restoreBtn.textContent = '↩';
  restoreBtn.title = 'Restore';

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'btn-icon btn-danger';
  deleteBtn.setAttribute('data-action', 'permanent-delete');
  deleteBtn.setAttribute('data-recycle-id', entry.id);
  deleteBtn.textContent = '✕';
  deleteBtn.title = 'Permanently delete';

  actions.append(restoreBtn, deleteBtn);
  div.append(info, actions);
  return div;
}

async function restoreRecycleItem(id) {
  try {
    const restored = await restoreFromRecycleBin(id);
    if (restored) {
      await renderRecycleBin();
      await renderAll();
      showToast('Item restored', 'success');
    } else {
      showToast('Item not found in recycle bin', 'error');
    }
  } catch (err) {
    console.error('[workbench] restoreRecycleItem failed:', err);
    showToast('Failed to restore item', 'error');
  }
}

async function permanentDeleteItem(id) {
  try {
    if (!(await showConfirm('Permanently delete this item? This cannot be undone.'))) return;
    await permanentlyDelete(id);
    await renderRecycleBin();
    showToast('Item permanently deleted', 'info');
  } catch (err) {
    console.error('[workbench] permanentDeleteItem failed:', err);
    showToast('Failed to delete item', 'error');
  }
}

async function emptyAllRecycle() {
  try {
    if (!(await showConfirm('Permanently delete ALL items in the recycle bin?'))) return;
    const count = await emptyRecycleBin();
    await renderRecycleBin();
    showToast(`Cleared ${count} items from recycle bin`, 'success');
  } catch (err) {
    console.error('[workbench] emptyAllRecycle failed:', err);
    showToast('Failed to empty recycle bin', 'error');
  }
}

// =============================================================================
// 14. MODAL & TOAST
// =============================================================================

function showConfirm(message) {
  return new Promise((resolve) => {
    $('modal-message').textContent = message;
    $('modal-overlay').classList.remove('hidden');

    const cleanup = () => {
      $('modal-overlay').classList.add('hidden');
      $('modal-cancel').removeEventListener('click', onCancel);
      $('modal-confirm').removeEventListener('click', onConfirm);
    };
    const onCancel = () => { cleanup(); resolve(false); };
    const onConfirm = () => { cleanup(); resolve(true); };

    $('modal-cancel').addEventListener('click', onCancel);
    $('modal-confirm').addEventListener('click', onConfirm);
  });
}

function showToast(message, type = 'info') {
  const container = $('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add('toast-visible'));

  setTimeout(() => {
    toast.classList.remove('toast-visible');
    toast.addEventListener('transitionend', () => toast.remove(), { once: true });
    setTimeout(() => { if (toast.parentNode) toast.remove(); }, 400);
  }, 3000);
}

// =============================================================================
// 15. EVENT WIRING
// =============================================================================

function wireUI() {
  // Header
  $('btn-save-all')?.addEventListener('click', saveAllTabs);
  $('btn-new-group')?.addEventListener('click', createNewGroup);
  $('btn-dedup')?.addEventListener('click', deduplicateTabs);
  $('btn-settings')?.addEventListener('click', openSettings);
  $('btn-theme')?.addEventListener('click', cycleTheme);

  // Settings
  $('settings-close')?.addEventListener('click', closeSettings);
  $('settings-overlay')?.addEventListener('click', e => {
    if (e.target === $('settings-overlay')) closeSettings();
  });
  $('theme-select')?.addEventListener('change', e => handleThemeChange(e.target.value));
  $('btn-sync-save')?.addEventListener('click', handleSyncSave);
  $('btn-sync-load')?.addEventListener('click', handleSyncLoad);
  $('btn-sync-push')?.addEventListener('click', handleSyncPush);
  $('btn-sync-pull')?.addEventListener('click', handleSyncPull);
  $('setting-auto-remove')?.addEventListener('change', e => {
    storage.setPref('autoRemove', e.target.checked);
  });

  // Import/Export
  $('btn-export-json')?.addEventListener('click', exportJSON);
  $('btn-export-html')?.addEventListener('click', exportHTML);
  $('btn-import')?.addEventListener('click', () => $('import-file')?.click());
  $('import-file')?.addEventListener('change', e => {
    const file = /** @type {HTMLInputElement} */ (e.target).files?.[0];
    if (file) importFile(file);
  });

  // Recycle bin
  $('btn-recycle')?.addEventListener('click', openRecycleBin);
  $('recycle-close')?.addEventListener('click', closeRecycleBin);
  $('recycle-overlay')?.addEventListener('click', e => {
    if (e.target === $('recycle-overlay')) closeRecycleBin();
  });
  $('btn-empty-recycle')?.addEventListener('click', emptyAllRecycle);

  // ---- Main content event delegation ----
  $('main-content')?.addEventListener('click', async (e) => {
    // Act on [data-action] buttons
    const btn = /** @type {HTMLElement} */ (e.target).closest('[data-action]');
    if (btn) {
      const action = btn.getAttribute('data-action');
      const card = /** @type {HTMLElement} */ (btn.closest('.group-card'));
      const groupId = card?.getAttribute('data-group-id') || '';

      switch (action) {
        case 'restore-group':
          if (groupId) restoreGroup(groupId);
          break;
        case 'restore-new':
          if (groupId) restoreToNewWindow(groupId);
          break;
        case 'pin-group':
          if (groupId) togglePin(groupId);
          break;
        case 'lock-group':
          if (groupId) toggleLock(groupId);
          break;
        case 'rename-group': {
          if (!groupId) break;
          const nameEl = card?.querySelector('.group-name');
          if (!nameEl) break;
          nameEl.contentEditable = true;
          nameEl.focus();
          const range = document.createRange();
          range.selectNodeContents(nameEl);
          const sel = window.getSelection();
          sel?.removeAllRanges();
          sel?.addRange(range);
          const saveRename = () => {
            nameEl.contentEditable = false;
            nameEl.removeEventListener('blur', saveRename);
            nameEl.removeEventListener('keydown', onKey);
            renameGroup(groupId, nameEl.textContent || '');
          };
          const onKey = (evt) => {
            if (evt.key === 'Enter') { evt.preventDefault(); nameEl.blur(); }
            if (evt.key === 'Escape') { nameEl.contentEditable = false; renderAll(); }
          };
          nameEl.addEventListener('blur', saveRename);
          nameEl.addEventListener('keydown', onKey);
          break;
        }
        case 'delete-group': {
          if (groupId) {
            // Default/ungrouped: clear tabs to recycle bin instead of deleting
            const card = /** @type {HTMLElement} */ (btn.closest('.group-card'));
            const isDefault = card?.getAttribute('data-default') === 'true';
            if (isDefault) {
              const group = await getGroup(groupId);
              if (group && group.tabs) {
                for (const tab of group.tabs) {
                  await addToRecycleBin('tab', { ...tab, groupId, groupName: group.name });
                }
                group.tabs = [];
                await saveGroup(group);
                await renderAll();
                showToast('Cleared default group', 'info');
              }
            } else {
              deleteGroupById(groupId);
            }
          }
          break;
        }
        case 'edit-tab': {
          if (!groupId) break;
          const ti = /** @type {HTMLElement} */ (btn.closest('.tab-item'));
          const idx = parseInt(ti?.getAttribute('data-tab-index') || '-1', 10);
          if (idx < 0) break;
          const group = await getGroup(groupId);
          if (!group || !group.tabs || !group.tabs[idx]) break;
          const tab = group.tabs[idx];

          // Show edit form
          const overlay = $('tab-edit-overlay');
          const titleInput = $('tab-edit-title');
          const urlInput = $('tab-edit-url');
          titleInput.value = tab.title || '';
          urlInput.value = tab.url || '';
          overlay.classList.remove('hidden');
          titleInput.focus();
          titleInput.select();

          const save = async () => {
            overlay.classList.add('hidden');
            const newTitle = titleInput.value.trim();
            const newUrl = urlInput.value.trim();
            if (newTitle) tab.title = newTitle;
            if (newUrl) tab.url = newUrl;
            if (newTitle || newUrl) {
              await saveGroup(group);
              await renderAll();
              showToast('Tab updated', 'success');
            }
            cleanup();
          };
          const cancel = () => { overlay.classList.add('hidden'); cleanup(); };
          const onKey = (e) => { if (e.key === 'Escape') cancel(); if (e.key === 'Enter') save(); };
          const cleanup = () => {
            overlay.removeEventListener('keydown', onKey);
            $('tab-edit-save')?.removeEventListener('click', save);
            $('tab-edit-cancel')?.removeEventListener('click', cancel);
          };
          overlay.addEventListener('keydown', onKey);
          $('tab-edit-save')?.addEventListener('click', save);
          $('tab-edit-cancel')?.addEventListener('click', cancel);
          break;
        }
        case 'remove-tab': {
          if (!groupId) break;
          const ti = /** @type {HTMLElement} */ (btn.closest('.tab-item'));
          const idx = parseInt(ti?.getAttribute('data-tab-index') || '-1', 10);
          if (idx >= 0) removeTab(groupId, idx);
          break;
        }
        case 'restore-recycle': {
          const rid = btn.getAttribute('data-recycle-id');
          if (rid) restoreRecycleItem(rid);
          break;
        }
        case 'permanent-delete': {
          const rid = btn.getAttribute('data-recycle-id');
          if (rid) permanentDeleteItem(rid);
          break;
        }
      }
      return;
    }

    // Group collapse/expand via header click or collapse button
    const collapseBtn = e.target.closest('.collapse-btn');
    const header = e.target.closest('.group-header');

    if (collapseBtn) {
      const card = /** @type {HTMLElement} */ (collapseBtn.closest('.group-card'));
      if (card) {
        card.classList.toggle('collapsed');
        collapseBtn.textContent = card.classList.contains('collapsed') ? '▶' : '▼';
      }
    } else if (header && !e.target.closest('[data-action]')) {
      // Click on group-header (not on action buttons)
      const card = /** @type {HTMLElement} */ (header.closest('.group-card'));
      if (card) {
        card.classList.toggle('collapsed');
        const cb = card.querySelector('.collapse-btn');
        if (cb) cb.textContent = card.classList.contains('collapsed') ? '▶' : '▼';
      }
    }
  });

  // Modal overlay: click outside box → cancel
  $('modal-overlay')?.addEventListener('click', e => {
    if (e.target === $('modal-overlay')) $('modal-cancel')?.click();
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (!$('settings-overlay').classList.contains('hidden')) { closeSettings(); return; }
      if (!$('recycle-overlay').classList.contains('hidden')) { closeRecycleBin(); return; }
      if (!$('modal-overlay').classList.contains('hidden')) { $('modal-cancel')?.click(); return; }
    }
  });
}

// =============================================================================
// 16. UTILITY FUNCTIONS
// =============================================================================

function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(/** @type {string} */ (reader.result));
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsText(file);
  });
}

function escapeHtmlAttr(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// =============================================================================
// 17. EXPORT FOR TESTING
// =============================================================================

export const __testExports = {
  init, renderAll, createGroupCard, createTabItem,
  saveAllTabs, restoreGroup, cycleTheme,
  applyTheme, handleThemeChange, wireUI,
  showConfirm, showToast, $,
};

// =============================================================================
// 18. START
// =============================================================================

document.addEventListener('DOMContentLoaded', init);
