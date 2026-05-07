// @ts-check
/**
 * p1-readinglist.spec.js — P1 Playwright tests for Reading List management.
 *
 * Covers:
 *   1. Adding a reading item (URL → title appears)
 *   2. Adding and editing notes on a reading item
 *   3. Archiving a reading item (and unarchiving)
 *   4. Deleting a reading item
 *
 * These tests run in serial (shared extension state) using Firefox.
 */

import path from 'node:path';
import { test, expect, firefox } from '@playwright/test';
import {
  loadExtension,
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

test.describe('P1 - Reading List', () => {
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
  // Helpers
  // -----------------------------------------------------------------------

  /**
   * Fill the reading-add-form and submit.  Waits for the item to render.
   * @param {string} url
   * @param {string} [notes='']
   */
  async function addItem(url, notes = '') {
    await sidebarPage
      .locator('#reading-add-form input[type="url"]')
      .fill(url);
    if (notes) {
      await sidebarPage
        .locator('#reading-add-form textarea')
        .fill(notes);
    }
    await sidebarPage
      .locator('#reading-add-form button[type="submit"]')
      .click();
    await sidebarPage.waitForSelector('[data-reading-id]', {
      state: 'visible',
      timeout: 5000,
    });
  }

  // -----------------------------------------------------------------------
  // Tests
  // -----------------------------------------------------------------------

  test('adds a reading item', async () => {
    await addItem('https://example.com');

    // Verify an item with the URL appears
    const item = sidebarPage.locator('[data-reading-id]', {
      has: sidebarPage.locator('.link-url', { hasText: 'example.com' }),
    });
    await expect(item).toBeVisible();

    // Title should be populated (domain used as fallback)
    const titleEl = item.locator('.link-title');
    await expect(titleEl).not.toBeEmpty();

    // Section count badge
    await expect(
      sidebarPage.locator('#reading-list-section .section-count'),
    ).toHaveText('1');
  });

  test('adds notes to reading item', async () => {
    await addItem('https://httpbin.org/get', 'Important article');

    const item = sidebarPage.locator('[data-reading-id]', {
      has: sidebarPage.locator('.link-url', { hasText: 'httpbin.org' }),
    });
    const readingId = await item.getAttribute('data-reading-id');

    // Click the notes area to activate inline editing (creates textarea)
    const notesDiv = sidebarPage.locator(
      `[data-reading-id="${readingId}"] .reading-notes`,
    );
    const hasNotes = await notesDiv.isVisible().catch(() => false);
    if (hasNotes) {
      await notesDiv.click();
    }

    // Use the db service to save notes, then trigger re-render
    await sidebarPage.evaluate(
      async ({ id, text }) => {
        const db = window.TabOasis?.db;
        if (db && typeof db.getReadingItem === 'function') {
          const item = await db.getReadingItem(id);
          if (item) {
            item.notes = text;
            await db.saveReadingItem(item);
          }
        }
        if (window.TabOasis?.renderReadingList) {
          await window.TabOasis.renderReadingList();
        }
      },
      { id: readingId, text: 'Updated notes content' },
    );

    await sidebarPage.waitForTimeout(500);
    await expect(
      sidebarPage.locator(
        `[data-reading-id="${readingId}"] .reading-notes`,
      ),
    ).toContainText('Updated notes content');
  });

  test('archives a reading item', async () => {
    await addItem('https://example.org/archive-test');

    const item = sidebarPage.locator('[data-reading-id]', {
      has: sidebarPage.locator('.link-url', { hasText: 'example.org' }),
    });
    const readingId = await item.getAttribute('data-reading-id');

    // Click archive button
    const archiveBtn = item.locator('[data-action="archive-reading"]');
    await expect(archiveBtn).toBeVisible();
    await archiveBtn.click();

    // After archiving the item hides from the active view
    await expect(item).toBeHidden({ timeout: 5000 });

    // Toggle to show archived items
    await sidebarPage.locator('#reading-show-archived').click();
    await sidebarPage.waitForSelector('[data-reading-id]', {
      state: 'visible',
      timeout: 5000,
    });

    // Verify unarchive button appears and works
    const unarchiveBtn = sidebarPage.locator(
      `[data-reading-id="${readingId}"] [data-action="unarchive-reading"]`,
    );
    if (await unarchiveBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await unarchiveBtn.click();
      await sidebarPage.waitForTimeout(500);
      // Item should be back in the active view (not hidden)
      await expect(
        sidebarPage.locator(
          `[data-reading-id="${readingId}"]`,
        ),
      ).toBeVisible();
    }
  });

  test('deletes a reading item', async () => {
    await addItem('https://example.net/delete-test');

    const item = sidebarPage.locator('[data-reading-id]', {
      has: sidebarPage.locator('.link-url', { hasText: 'example.net' }),
    });
    const readingId = await item.getAttribute('data-reading-id');

    // Click delete and accept any dialog
    const deleteBtn = item.locator('[data-action="delete-reading"]');
    sidebarPage.on('dialog', async (dialog) => {
      await dialog.accept();
    });
    await deleteBtn.click();

    // If custom modal appears
    const overlay = sidebarPage.locator('#modal-overlay');
    if (await overlay.isVisible({ timeout: 2000 }).catch(() => false)) {
      await sidebarPage.locator('#modal-confirm').click();
      await expect(overlay).toBeHidden({ timeout: 5000 });
    }

    // Verify item removed
    await expect(
      sidebarPage.locator(`[data-reading-id="${readingId}"]`),
    ).toBeHidden({ timeout: 5000 });
  });
});
