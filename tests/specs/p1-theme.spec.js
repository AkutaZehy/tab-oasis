// @ts-check
/**
 * p1-theme.spec.js — P1 Playwright tests for theme switching.
 *
 * Covers:
 *   1. Applying the light theme (data-theme="light")
 *   2. Applying the dark theme (data-theme="dark")
 *   3. Theme persistence across sidebar reloads
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

test.describe('P1 - Theme', () => {
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

  /** Click the settings gear icon and wait for the panel to open. */
  async function openSettings() {
    await sidebarPage.locator('#settings-toggle').click();
    await sidebarPage.waitForSelector('#settings-panel', {
      state: 'visible',
      timeout: 5000,
    });
    await expect(sidebarPage.locator('#settings-panel')).toBeVisible();
  }

  /**
   * Select a theme value in the dropdown.
   * @param {'light' | 'dark' | 'system'} theme
   */
  async function selectTheme(theme) {
    await sidebarPage.locator('#theme-select').selectOption(theme);
    // Allow applyTheme / storage.setPref to execute
    await sidebarPage.waitForTimeout(300);
  }

  // -----------------------------------------------------------------------
  // Tests
  // -----------------------------------------------------------------------

  test('applies light theme', async () => {
    await openSettings();
    await selectTheme('light');

    // The #app element should have data-theme="light"
    await expect(sidebarPage.locator('#app')).toHaveAttribute(
      'data-theme',
      'light',
    );
  });

  test('applies dark theme', async () => {
    await openSettings();
    await selectTheme('dark');

    // The #app element should have data-theme="dark"
    await expect(sidebarPage.locator('#app')).toHaveAttribute(
      'data-theme',
      'dark',
    );
  });

  test('theme persists across reloads', async () => {
    // Set theme to dark
    await openSettings();
    await selectTheme('dark');
    await expect(sidebarPage.locator('#app')).toHaveAttribute(
      'data-theme',
      'dark',
    );

    // Reload the sidebar page (simulates closing/reopening)
    await sidebarPage.reload({ waitUntil: 'domcontentloaded' });
    await waitForSidebarLoaded(sidebarPage);

    // After reload, the init routine reads the saved theme preference
    // from browser.storage.local and re-applies it.
    await expect(sidebarPage.locator('#app')).toHaveAttribute(
      'data-theme',
      'dark',
    );

    // Reset to default for a clean subsequent state
    await openSettings();
    await selectTheme('system');
  });
});
