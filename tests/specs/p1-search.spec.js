// @ts-check
/**
 * p1-search.spec.js — P1 Playwright tests for full-text search.
 *
 * Covers:
 *   1. Searching across all sections (quick links, reading list, todos)
 *   2. Showing empty state for unmatched queries
 *   3. Clearing search resets the view to show all items
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

test.describe('P1 - Search', () => {
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
   * Add a quick link via the form.
   * @param {string} title
   * @param {string} url
   */
  async function addLink(title, url) {
    await sidebarPage
      .locator('#quick-link-add-form input[type="text"]')
      .fill(title);
    await sidebarPage
      .locator('#quick-link-add-form input[type="url"]')
      .fill(url);
    await sidebarPage
      .locator('#quick-link-add-form button[type="submit"]')
      .click();
    await sidebarPage.waitForSelector(
      `.link-item .link-title:text("${title}")`,
      { state: 'visible', timeout: 5000 },
    );
  }

  /**
   * Add a todo via the input.
   * @param {string} text
   */
  async function addTodo(text) {
    const input = sidebarPage.locator('#todo-add-input');
    await input.fill(text);
    await input.press('Enter');
    await sidebarPage.waitForSelector(
      `.todo-item .todo-text:text("${text}")`,
      { state: 'visible', timeout: 5000 },
    );
  }

  // -----------------------------------------------------------------------
  // Tests
  // -----------------------------------------------------------------------

  test('searches across all sections', async () => {
    // Populate data across sections with overlapping keywords
    await addLink('React Docs', 'https://react.dev');
    await addLink('Vue Guide', 'https://vuejs.org');
    await addTodo('Review React PRs');
    await addTodo('Update Vue config');

    // Type a query that should match items in both sections
    const searchInput = sidebarPage.locator('#search-input');
    await searchInput.fill('React');

    // Wait for debounced search (250ms debounce + execution time)
    await sidebarPage.waitForTimeout(500);

    // Matching items should remain visible
    const reactLink = sidebarPage.locator('.link-title', {
      hasText: 'React Docs',
    });
    const reactTodo = sidebarPage.locator('.todo-text', {
      hasText: 'Review React PRs',
    });
    await expect(reactLink).toBeVisible();
    await expect(reactTodo).toBeVisible();

    // Non-matching items should be hidden
    const vueLink = sidebarPage.locator('.link-item', {
      has: sidebarPage.locator('.link-title', { hasText: 'Vue Guide' }),
    });
    await expect(vueLink).toBeHidden();
  });

  test('shows no results for unmatched query', async () => {
    await addLink('Example Link', 'https://example.com');
    await addTodo('Example Todo');

    // Search for a nonsense string
    const searchInput = sidebarPage.locator('#search-input');
    await searchInput.fill('ZZZZZZ_NONEXISTENT_ZZZZZZ');
    await sidebarPage.waitForTimeout(500);

    // All content items should be hidden
    const visibleItems = sidebarPage.locator(
      '.link-item:visible, .todo-item:visible',
    );
    await expect(visibleItems).toHaveCount(0);
  });

  test('clears search resets view', async () => {
    await addLink('Alpha Link', 'https://alpha.example');
    await addLink('Beta Link', 'https://beta.example');

    // Perform a search filtering to Alpha only
    const searchInput = sidebarPage.locator('#search-input');
    await searchInput.fill('Alpha');
    await sidebarPage.waitForTimeout(500);

    // Verify filtering
    await expect(
      sidebarPage.locator('.link-title', { hasText: 'Alpha Link' }),
    ).toBeVisible();
    const betaItem = sidebarPage.locator('.link-item', {
      has: sidebarPage.locator('.link-title', { hasText: 'Beta Link' }),
    });
    await expect(betaItem).toBeHidden();

    // Click clear button
    await sidebarPage.locator('#search-clear').click();
    await sidebarPage.waitForTimeout(500);

    // All items should be visible again
    await expect(
      sidebarPage.locator('.link-title', { hasText: 'Alpha Link' }),
    ).toBeVisible();
    await expect(
      sidebarPage.locator('.link-title', { hasText: 'Beta Link' }),
    ).toBeVisible();
  });
});
