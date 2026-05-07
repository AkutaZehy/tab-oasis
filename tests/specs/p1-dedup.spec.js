// @ts-check
/**
 * p1-dedup.spec.js — P1 Playwright tests for Tab Deduplication.
 *
 * Covers:
 *   1. Removing duplicate tabs (same URL)
 *   2. Showing a notification when no duplicates exist
 *
 * These tests run in serial (shared extension state) using Firefox.
 */

import path from 'node:path';
import { test, expect, firefox } from '@playwright/test';
import {
  loadExtension,
  waitForSidebarLoaded,
  addTestTabs,
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

test.describe('P1 - Deduplication', () => {
  test.describe.configure({ mode: 'serial' });

  /** @type {import('@playwright/test').BrowserContext} */
  let context;

  /** @type {import('@playwright/test').Page} */
  let sidebarPage;

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  test.beforeAll(async () => {
    const loaded = await loadExtension(firefox, extensionPath);
    context = loaded.context;
    sidebarPage = loaded.sidebarPage;
    await waitForSidebarLoaded(sidebarPage);
  });

  test.afterAll(async () => {
    await cleanup(context);
  });

  // -----------------------------------------------------------------------
  // Tests
  // -----------------------------------------------------------------------

  test('removes duplicate tabs', async () => {
    const duplicateUrl = 'https://example.com/dup';

    // Open tabs — two with the same URL, one unique
    const tab1 = await context.newPage();
    await tab1.goto(duplicateUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 10000,
    });
    const tab2 = await context.newPage();
    await tab2.goto(duplicateUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 10000,
    });
    const tab3 = await context.newPage();
    await tab3.goto('https://example.org/unique', {
      waitUntil: 'domcontentloaded',
      timeout: 10000,
    });

    // Should have at least 4 pages (sidebar + 3 tabs)
    const pagesBefore = context.pages().length;
    expect(pagesBefore).toBeGreaterThanOrEqual(4);

    // Click deduplicate
    await sidebarPage.locator('#btn-dedup').click();

    // Wait for toast notification (background.js processes and responds)
    await sidebarPage.waitForSelector('.toast', {
      state: 'visible',
      timeout: 10000,
    });

    // At least one duplicate tab should be closed by background.js
    const tab1Closed = await tab1.isClosed().catch(() => true);
    const tab2Closed = await tab2.isClosed().catch(() => true);
    expect(tab1Closed || tab2Closed).toBeTruthy();

    // The unique tab should remain open
    const tab3Open = await tab3.isClosed().catch(() => false);
    expect(tab3Open).toBeFalsy();

    // Clean up
    await tab3.close().catch(() => {});
  });

  test('shows message when no duplicates', async () => {
    // Open diverse tabs with unique URLs
    const tabs = await addTestTabs(context, 3);

    // Click dedup — no duplicates exist
    await sidebarPage.locator('#btn-dedup').click();

    // Toast should appear describing no duplicates
    await sidebarPage.waitForSelector('.toast', {
      state: 'visible',
      timeout: 10000,
    });
    const toast = sidebarPage.locator('.toast');
    await expect(toast).toBeVisible();

    const text = await toast.textContent();
    const isNoDuplicatesMsg =
      text.includes('No') || text.includes('0') || /no/i.test(text);
    expect(isNoDuplicatesMsg).toBeTruthy();

    // Clean up
    for (const tab of tabs) {
      await tab.close().catch(() => {});
    }
  });
});
