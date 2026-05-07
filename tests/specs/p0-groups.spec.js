// @ts-check
/**
 * p0-groups.spec.js — P0 Playwright tests for tab group management.
 *
 * Covers:
 *   1. Auto-grouping tabs by domain
 *   2. Pinning a group to the top
 *   3. Locking a group (protect from accidental deletion)
 *   4. Renaming a group inline
 *   5. Deleting a group to the recycle bin
 *   6. Expanding / collapsing a group
 *   7. Drag-and-drop reorder of tabs within a group
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

/** Absolute path to the unpacked extension root. */
const extensionPath = path.resolve(__dirname, '../../');

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

test.describe('P0 - Group Management', () => {
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
    context = loaded.context;
    extensionId = loaded.extensionId;
    sidebarPage = loaded.sidebarPage;
    await waitForSidebarLoaded(sidebarPage);
  });

  test.afterAll(async () => {
    await cleanup(context);
  });

  // -----------------------------------------------------------------------
  // Shared helper — save tabs if no groups exist
  // -----------------------------------------------------------------------

  /**
   * Ensure at least `minGroups` tab groups exist in the sidebar.
   * If the current group count is too low, opens diverse test tabs and
   * clicks "Save All Tabs".
   *
   * @param {number} [minGroups=2] — Minimum number of groups required.
   * @param {number} [tabCount=6]  — Number of test tabs to create.
   */
  async function ensureGroups(minGroups = 2, tabCount = 6) {
    let groupCount = await sidebarPage.locator('.group-card').count();
    if (groupCount < minGroups) {
      await addTestTabs(context, tabCount);
      await sidebarPage.waitForTimeout(1500);
      await sidebarPage.click('#btn-save-all');
      await sidebarPage.waitForTimeout(3000);

      // The empty state should disappear when groups exist
      await sidebarPage.waitForSelector('.group-card', {
        state: 'visible',
        timeout: 10000,
      });

      groupCount = await sidebarPage.locator('.group-card').count();
    }
    expect(groupCount).toBeGreaterThanOrEqual(minGroups);
    return groupCount;
  }

  // -----------------------------------------------------------------------
  // Test cases
  // -----------------------------------------------------------------------

  test('auto-groups tabs by domain', async () => {
    // Open tabs from multiple distinct domains so the auto-group creates
    // multiple groups.
    const domains = [
      'https://example.com',
      'https://example.org',
      'https://httpbin.org/html',
      'https://httpbin.org/links/10',
      'https://example.net',
      'https://example.edu',
    ];

    for (const url of domains) {
      const page = await context.newPage();
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10000 });
      } catch {
        /* network unavailable — still count the tab */
      }
    }

    await sidebarPage.waitForTimeout(1000);

    // Click "Auto Group" in the toolbar (triggers saveAllTabs internally)
    await sidebarPage.click('#btn-auto-group');
    await sidebarPage.waitForTimeout(4000);

    // Assertion — At least 2 groups appear (multiple domains)
    const groupCards = sidebarPage.locator('.group-card');
    const groupCount = await groupCards.count();
    expect(groupCount).toBeGreaterThanOrEqual(2);

    // Assertion — Each group has a name element
    const firstGroupName = await groupCards
      .first()
      .locator('.group-name')
      .textContent();
    expect(firstGroupName).toBeTruthy();

    // Multiple groups should have different names
    if (groupCount >= 2) {
      const secondGroupName = await groupCards
        .nth(1)
        .locator('.group-name')
        .textContent();
      expect(secondGroupName).toBeTruthy();
      expect(firstGroupName).not.toBe(secondGroupName);
    }
  });

  test('pins a group to top', async () => {
    await ensureGroups(2, 6);

    // Get the first group card
    const firstGroup = sidebarPage.locator('.group-card').first();

    // Click the pin button on the first group
    const pinBtn = firstGroup.locator(
      '.group-actions button[data-action="pin"]',
    );
    await pinBtn.click();

    // Wait for re-render
    await sidebarPage.waitForTimeout(2000);

    // Assertion — The first group card's data-pinned attribute is "1"
    const pinnedAttr = await firstGroup.getAttribute('data-pinned');
    expect(pinnedAttr).toBe('1');

    // Re-render may reorder groups. Find the pinned group by attribute.
    const pinnedGroup = sidebarPage.locator('.group-card[data-pinned="1"]');
    await expect(pinnedGroup).toHaveCount(1);
  });

  test('locks a group', async () => {
    await ensureGroups(1, 4);

    // Get the first group card
    const firstGroup = sidebarPage.locator('.group-card').first();

    // Click the lock button
    const lockBtn = firstGroup.locator(
      '.group-actions button[data-action="lock"]',
    );
    await lockBtn.click();

    // Wait for re-render
    await sidebarPage.waitForTimeout(2000);

    // Assertion — The group has data-locked="1"
    const lockedAttr = await firstGroup.getAttribute('data-locked');
    expect(lockedAttr).toBe('1');

    // Verify the locked group can be found by attribute after re-render
    const lockedGroup = sidebarPage.locator('.group-card[data-locked="1"]');
    await expect(lockedGroup).toHaveCount(1);
  });

  test('renames a group', async () => {
    await ensureGroups(1, 3);

    // Get the first group
    const firstGroup = sidebarPage.locator('.group-card').first();
    const originalName = await firstGroup
      .locator('.group-name')
      .textContent();
    expect(originalName).toBeTruthy();

    // Click the rename button
    const renameBtn = firstGroup.locator(
      '.group-actions button[data-action="rename"]',
    );
    await renameBtn.click();

    // The h4.group-name should become editable (contentEditable="true")
    const nameEl = firstGroup.locator('.group-name');
    await expect(nameEl).toHaveAttribute('contenteditable', 'true');

    // Clear existing text and type a new name
    await nameEl.click();
    await nameEl.press('Control+a');
    await nameEl.fill('Renamed Test Group');

    // Blur to commit the rename (click somewhere else in the sidebar)
    await sidebarPage.locator('#tab-count-indicator').click();
    await sidebarPage.waitForTimeout(1500);

    // Assertion — The name persisted
    const updatedName = await firstGroup
      .locator('.group-name')
      .textContent();
    expect(updatedName).toBe('Renamed Test Group');
  });

  test('deletes a group to recycle bin', async () => {
    await ensureGroups(1, 3);

    // Record how many groups exist before deletion
    const groupsBefore = await sidebarPage.locator('.group-card').count();
    expect(groupsBefore).toBeGreaterThan(0);

    // Grab the group ID of the first group for later verification
    const firstGroup = sidebarPage.locator('.group-card').first();
    const groupId = await firstGroup.getAttribute('data-group-id');
    expect(groupId).toBeTruthy();

    const groupName = await firstGroup
      .locator('.group-name')
      .textContent();

    // Click the delete button
    const deleteBtn = firstGroup.locator(
      '.group-actions button[data-action="delete"]',
    );
    await deleteBtn.click();

    // Confirm the deletion in the modal
    const confirmBtn = sidebarPage.locator('#modal-confirm');
    await confirmBtn.waitFor({ state: 'visible', timeout: 3000 });
    await confirmBtn.click();

    // Wait for re-render
    await sidebarPage.waitForTimeout(2000);

    // Assertion 1 — Group count decreased
    const groupsAfter = await sidebarPage.locator('.group-card').count();
    expect(groupsAfter).toBeLessThan(groupsBefore);

    // Assertion 2 — The deleted group is gone from the main view
    const deletedGroup = sidebarPage.locator(
      `.group-card[data-group-id="${groupId}"]`,
    );
    await expect(deletedGroup).toHaveCount(0);

    // Now open the recycle bin to verify the group was moved there
    // Click settings toggle to open the settings panel
    const settingsToggle = sidebarPage.locator('#settings-toggle');
    await settingsToggle.click();
    await sidebarPage.waitForTimeout(1000);

    // Click "Open Recycle Bin" button inside settings
    const openRecycleBtn = sidebarPage.locator('#btn-open-recycle');
    await openRecycleBtn.click();
    await sidebarPage.waitForTimeout(1500);

    // Assertion 3 — The recycle bin has at least one item
    const recycleItems = sidebarPage.locator(
      '#recycle-items [data-recycle-id]',
    );
    const recycleCount = await recycleItems.count();
    expect(recycleCount).toBeGreaterThan(0);

    // Assertion 4 — The recycled item references the original group name
    const recycleText = await sidebarPage
      .locator('#recycle-items')
      .textContent();
    expect(recycleText).toContain(groupName || '');
  });

  test('expands and collapses group', async () => {
    await ensureGroups(1, 3);

    const firstGroup = sidebarPage.locator('.group-card').first();

    // Verify the group is initially expanded (no "collapsed" class)
    const collapsedBefore = await firstGroup.evaluate((el) =>
      el.classList.contains('collapsed'),
    );
    expect(collapsedBefore).toBe(false);

    // Click the group header to collapse
    const header = firstGroup.locator('.group-header');
    await header.click();
    await sidebarPage.waitForTimeout(500);

    // Assertion 1 — Group now has the "collapsed" class
    const collapsedAfter = await firstGroup.evaluate((el) =>
      el.classList.contains('collapsed'),
    );
    expect(collapsedAfter).toBe(true);

    // The collapse toggle button should indicate collapsed state (CSS rotates it)
    const toggleBtn = firstGroup.locator('.collapse-toggle');
    const transformStyle = await toggleBtn.evaluate(
      (el) => el.style.transform,
    );
    expect(transformStyle).toContain('rotate');

    // Click the header again to expand
    await header.click();
    await sidebarPage.waitForTimeout(500);

    // Assertion 2 — Group is expanded again
    const expandedAgain = await firstGroup.evaluate((el) =>
      el.classList.contains('collapsed'),
    );
    expect(expandedAgain).toBe(false);
  });

  test('drag-drops tab within group', async () => {
    // Ensure we have at least one group with 3+ tabs
    await ensureGroups(1, 6);

    // Find a group that contains at least 3 tab cards
    const groupWithTabs = sidebarPage.locator('.group-card').filter({
      has: sidebarPage.locator('.tab-card'),
    });

    const groupCount = await groupWithTabs.count();
    expect(groupCount).toBeGreaterThan(0);

    const targetGroup = groupWithTabs.first();
    const tabCards = targetGroup.locator('.tab-card');
    const tabCount = await tabCards.count();

    // Need at least 2 tabs to reorder
    if (tabCount < 2) {
      test.skip(true, 'Not enough tabs in group to test drag-drop');
      return;
    }

    // Read the first tab's URL before dragging
    const firstTabUrl = await tabCards
      .first()
      .locator('.tab-url')
      .textContent();

    // Perform drag: move the first tab to the position after the last tab
    const sourceTab = tabCards.first();
    const targetTab = tabCards.last();

    // Use Playwright's dragTo
    await sourceTab.dragTo(targetTab, {
      sourcePosition: { x: 10, y: 10 },
      targetPosition: { x: 10, y: 20 }, // slightly below to indicate "after"
    });

    // Wait for the DnD persistence to complete
    await sidebarPage.waitForTimeout(2000);

    // Assertion — The first tab (by URL) is no longer the first tab card
    // After dragging to the end, it should now be the last tab
    const firstTabUrlAfter = await tabCards
      .first()
      .locator('.tab-url')
      .textContent();

    // If the drag was successful, the former first tab should NOT be in
    // position 0 anymore (it should have moved to a later position)
    expect(firstTabUrlAfter).not.toBe(firstTabUrl);
  });
});
