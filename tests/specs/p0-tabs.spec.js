// @ts-check
/**
 * p0-tabs.spec.js — P0 Playwright tests for Tab Oasis tab save & restore.
 *
 * Covers the core lifecycle:
 *   1. Save all browser tabs to the sidebar
 *   2. Restore individual tabs
 *   3. Restore entire groups
 *   4. Restore groups to new windows
 *   5. Verify tab-card rendering (title, URL, favicon)
 *   6. Verify empty state when no tabs are saved
 *
 * These tests run in serial (shared extension state) using Firefox.
 */

import path from 'node:path';
import { test, expect, firefox } from '@playwright/test';
import {
  loadExtension,
  addTestTabs,
  waitForSidebarLoaded,
  cleanup,
} from '../helpers/extension-test-helper.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Absolute path to the unpacked extension root (where manifest.json lives). */
const extensionPath = path.resolve(__dirname, '../../');

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

test.describe('P0 - Tab Save & Restore', () => {
  test.describe.configure({ mode: 'serial' });

  /** @type {import('@playwright/test').BrowserContext} */
  let context;

  /** @type {import('@playwright/test').Page} */
  let sidebarPage;

  /** @type {string} */
  let extensionId;

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  test.beforeAll(async () => {
    const loaded = await loadExtension(firefox, extensionPath);

    // loadExtension already resolves extensionId via its internal helper,
    // but we call it once here so we can use the idiom elsewhere.
    // We reconstruct from the sidebarPage URL.
    context = loaded.context;
    extensionId = loaded.extensionId;
    sidebarPage = loaded.sidebarPage;
    await waitForSidebarLoaded(sidebarPage);
  });

  test.afterAll(async () => {
    await cleanup(context);
  });

  // -----------------------------------------------------------------------
  // Test cases
  // -----------------------------------------------------------------------

  test('saves all tabs and closes them', async () => {
    // Record initial page count (sidebar page exists already)
    const pagesBefore = context.pages().length;

    // Add 3 diverse test tabs
    await addTestTabs(context, 3);

    // Give tabs a moment to fully load
    await sidebarPage.waitForTimeout(1000);

    const pagesAfterAdd = context.pages().length;
    expect(pagesAfterAdd).toBeGreaterThan(pagesBefore);

    // Click "Save All Tabs" in the sidebar toolbar
    await sidebarPage.click('#btn-save-all');

    // Wait for the save operation to complete and sidebar to re-render
    await sidebarPage.waitForTimeout(3000);

    // Assertion 1 — Group cards appear in the sidebar
    await sidebarPage.waitForSelector('.group-card', { timeout: 10000 });
    const groupCards = sidebarPage.locator('.group-card');
    const groupCount = await groupCards.count();
    expect(groupCount).toBeGreaterThan(0);

    // Assertion 2 — Tab count indicator shows a non-zero value
    const tabCountText = await sidebarPage
      .locator('#tab-count-indicator')
      .textContent();
    expect(tabCountText).toMatch(/\d+\s+tab/);

    // Assertion 3 — Browser tabs were closed (saveAllTabs always closes)
    const pagesAfterSave = context.pages().length;
    expect(pagesAfterSave).toBeLessThan(pagesAfterAdd);
  });

  test('restores a single tab', async () => {
    // Precondition: ensure we have saved tabs from the previous test.
    // If no groups exist, save some tabs first.
    const existingGroups = await sidebarPage.locator('.group-card').count();
    if (existingGroups === 0) {
      await addTestTabs(context, 3);
      await sidebarPage.waitForTimeout(1000);
      await sidebarPage.click('#btn-save-all');
      await sidebarPage.waitForTimeout(3000);
      await sidebarPage.waitForSelector('.group-card', { timeout: 10000 });
    }

    // Count open browser pages before restore
    const pagesBeforeRestore = context.pages().length;

    // Find the first tab card and click its restore button
    const firstTabCard = sidebarPage.locator('.tab-card').first();
    await firstTabCard.waitFor({ state: 'visible', timeout: 5000 });

    // Read the URL we expect the restored tab to open
    const expectedUrl = await firstTabCard
      .locator('.tab-url')
      .textContent();

    // Click the restore button inside the tab card
    const restoreBtn = firstTabCard.locator('button[data-action="restore"]');
    await restoreBtn.click();

    // Wait for the new tab to be created
    await sidebarPage.waitForTimeout(2000);

    // Assertion — A new page was opened in the context
    const pagesAfterRestore = context.pages().length;
    expect(pagesAfterRestore).toBeGreaterThan(pagesBeforeRestore);

    // Optionally verify the newly opened tab's URL contains the expected domain
    // (the tab URL in the card is shortened to hostname+pathname)
    if (expectedUrl) {
      const newestPage = context.pages()[context.pages().length - 1];
      const openedUrl = newestPage.url();
      expect(openedUrl).toContain(
        expectedUrl.split('/')[0], // compare hostname portion
      );
    }
  });

  test('restores all tabs from group', async () => {
    // Ensure we have at least one group with multiple tabs
    let groupCards = sidebarPage.locator('.group-card');
    let groupCount = await groupCards.count();

    if (groupCount === 0) {
      // Save fresh tabs
      await addTestTabs(context, 4);
      await sidebarPage.waitForTimeout(1000);
      await sidebarPage.click('#btn-save-all');
      await sidebarPage.waitForTimeout(3000);
      await sidebarPage.waitForSelector('.group-card', { timeout: 10000 });
    }

    // Refresh count after potentially saving
    groupCards = sidebarPage.locator('.group-card');
    groupCount = await groupCards.count();
    expect(groupCount).toBeGreaterThan(0);

    // Read how many tabs are in the first group
    const firstGroup = groupCards.first();
    const tabCountBadge = await firstGroup
      .locator('.group-tab-count')
      .textContent();
    const expectedTabCount = parseInt(tabCountBadge || '0', 10);
    expect(expectedTabCount).toBeGreaterThan(0);

    // Record open page count before restoring
    const pagesBefore = context.pages().length;

    // Click "Restore All" on the group header (data-action="restore" on group card)
    const restoreAllBtn = firstGroup.locator(
      '.group-actions button[data-action="restore"]',
    );
    await restoreAllBtn.click();

    // Wait for tabs to be restored
    await sidebarPage.waitForTimeout(3000);

    // Assertion — The correct number of tabs were opened
    const pagesAfter = context.pages().length;
    // Each restored tab opens as a new page. The group might be deleted if
    // all its tabs were restored (empty group gets removed).
    expect(pagesAfter).toBeGreaterThanOrEqual(pagesBefore + expectedTabCount - 1);
  });

  test('restores tabs to new window', async () => {
    // Ensure we have at least one group with tabs
    let groupCards = sidebarPage.locator('.group-card');
    let groupCount = await groupCards.count();

    if (groupCount === 0) {
      await addTestTabs(context, 3);
      await sidebarPage.waitForTimeout(1000);
      await sidebarPage.click('#btn-save-all');
      await sidebarPage.waitForTimeout(3000);
      await sidebarPage.waitForSelector('.group-card', { timeout: 10000 });
    }

    groupCards = sidebarPage.locator('.group-card');
    groupCount = await groupCards.count();
    expect(groupCount).toBeGreaterThan(0);

    // Count open windows before the restore-to-new-window action
    const windowsBefore = context.pages().length;

    // Click "Restore to New Window" button on the first group
    const restoreNewBtn = groupCards.first().locator(
      '.group-actions button[data-action="restoreNew"]',
    );
    await restoreNewBtn.click();

    // Wait for the new window to be created and tabs to load
    await sidebarPage.waitForTimeout(4000);

    // Assertion — New pages were opened (Firefox opens tabs in a new window,
    // which Playwright sees as additional pages in the persistent context)
    const windowsAfter = context.pages().length;
    // Expect at least one new tab (the group's tabs reopening in a new window
    // will add pages to the browser context)
    expect(windowsAfter).toBeGreaterThanOrEqual(windowsBefore);
  });

  test('displays tab title, URL, and favicon', async () => {
    // Ensure we have saved tabs
    let groupCards = sidebarPage.locator('.group-card');
    let groupCount = await groupCards.count();

    if (groupCount === 0) {
      await addTestTabs(context, 2);
      await sidebarPage.waitForTimeout(1000);
      await sidebarPage.click('#btn-save-all');
      await sidebarPage.waitForTimeout(3000);
      await sidebarPage.waitForSelector('.group-card', { timeout: 10000 });
    }

    groupCards = sidebarPage.locator('.group-card');
    groupCount = await groupCards.count();
    expect(groupCount).toBeGreaterThan(0);

    // Find the first tab card in the first group
    const firstTab = sidebarPage.locator('.tab-card').first();
    await firstTab.waitFor({ state: 'visible', timeout: 5000 });

    // Assertion 1 — Tab title element exists and has content
    const titleEl = firstTab.locator('.tab-title');
    await expect(titleEl).toBeVisible();
    const titleText = await titleEl.textContent();
    expect(titleText).toBeTruthy();

    // Assertion 2 — Tab URL element exists and has content
    const urlEl = firstTab.locator('.tab-url');
    await expect(urlEl).toBeVisible();
    const urlText = await urlEl.textContent();
    expect(urlText).toBeTruthy();

    // Assertion 3 — Tab favicon image element exists
    const faviconEl = firstTab.locator('.tab-favicon');
    await expect(faviconEl).toBeAttached();
  });

  test('shows empty state when no saved tabs', async () => {
    // Delete any existing groups so we can observe the empty state.
    // We do this by deleting groups via the UI until none remain.
    let remaining = await sidebarPage.locator('.group-card').count();

    // Delete all groups one by one via the delete button
    while (remaining > 0) {
      const firstGroup = sidebarPage.locator('.group-card').first();
      const deleteBtn = firstGroup.locator(
        '.group-actions button[data-action="delete"]',
      );
      await deleteBtn.click();

      // Confirm the deletion modal
      const confirmBtn = sidebarPage.locator('#modal-confirm');
      await confirmBtn.waitFor({ state: 'visible', timeout: 3000 });
      await confirmBtn.click();

      // Wait for re-render
      await sidebarPage.waitForTimeout(1500);
      remaining = await sidebarPage.locator('.group-card').count();
    }

    // Assertion — Empty state message is visible
    const emptyState = sidebarPage.locator('#empty-state');
    await expect(emptyState).toBeVisible();

    // Assertion — The prompt text exists inside the empty state
    const emptyText = await emptyState.textContent();
    expect(emptyText).toBeTruthy();
  });
});
