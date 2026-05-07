// @ts-check
import { defineConfig } from '@playwright/test';

/**
 * Playwright configuration for Tab Oasis Firefox extension testing.
 *
 * NOTE: Extension loading requires `launchPersistentContext` with `--load-extension`.
 * This cannot be configured via standard config options — use the helpers in
 * `tests/helpers/extension-test-helper.js` within your test files.
 *
 * Usage:
 *   npx playwright test --config=tests/playwright.config.js
 */
export default defineConfig({
  /* Test file directory */
  testDir: './specs',

  /* Maximum time per test (ms) */
  timeout: 30000,

  /* Retry once on failure */
  retries: 1,

  /* Reporters */
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report' }],
  ],

  /* Shared settings for all projects and tests */
  use: {
    /* Firefox is required for WebExtensions API support */
    browserName: 'firefox',

    /* Extensions only work in headed mode */
    headless: false,

    /* Capture screenshot on failure */
    screenshot: 'only-on-failure',
  },

  /* Fail the build if the test output lacks expected coverage */
  // forbidOnly: !!process.env.CI,

  /* Shared project configuration */
  // projects: [
  //   {
  //     name: 'firefox-extension',
  //     use: {
  //       browserName: 'firefox',
  //     },
  //   },
  // ],
});
