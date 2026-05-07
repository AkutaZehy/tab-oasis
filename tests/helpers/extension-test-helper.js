// @ts-check
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

/**
 * @typedef {import('@playwright/test').BrowserContext} BrowserContext
 * @typedef {import('@playwright/test').Page} Page
 * @typedef {import('@playwright/test').FirefoxBrowserType} FirefoxBrowserType
 */

/**
 * ---------------------------------------------------------------------------
 * loadExtension
 * ---------------------------------------------------------------------------
 * Creates a persistent Firefox context with the extension loaded.
 *
 * @param {FirefoxBrowserType} browser - The Playwright `firefox` browser type.
 *        Pass the value imported from the `playwright` package or use
 *        `test['browserType']` inside a Playwright test.
 * @param {string} extensionPath - Path to the unpacked extension directory.
 *        Ideally resolved to an absolute path with `path.resolve()`.
 * @returns {Promise<{context: BrowserContext, page: Page, extensionId: string, sidebarPage: Page}>}
 */
export async function loadExtension(browser, extensionPath) {
  const extPath = path.resolve(extensionPath);

  // Verify the extension directory exists
  if (!fs.existsSync(extPath)) {
    throw new Error(`Extension path does not exist: ${extPath}`);
  }

  // Create a temporary profile directory for each test run for isolation
  const userDataDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'tab-oasis-test-'),
  );

  /** @type {BrowserContext} */
  const context = await browser.launchPersistentContext(userDataDir, {
    headless: false,
    args: [`--load-extension=${extPath}`],
  });

  // Give the extension a moment to initialise background scripts
  await sleep(3000);

  const extensionId = getExtensionId(context);
  if (!extensionId) {
    throw new Error(
      'Could not determine extension ID. ' +
        'Verify the extension loads correctly in Firefox. ' +
        'Check manifest.json for syntax errors or incompatible keys.',
    );
  }

  // Open the sidebar panel as a regular tab (Firefox chrome sidebar
  // is not accessible via Playwright's page API)
  const sidebarPage = await getSidebarPage(context);

  return { context, page: context.pages()[0], extensionId, sidebarPage };
}

/**
 * ---------------------------------------------------------------------------
 * getSidebarPage
 * ---------------------------------------------------------------------------
 * Opens (or finds) the extension sidebar in a new tab.
 *
 * In Firefox the extension's `sidebar_action` panel is rendered inside the
 * browser chrome, which is not exposed through Playwright's page API.
 * This helper opens the sidebar HTML in a regular tab instead.
 *
 * @param {BrowserContext} context
 * @returns {Promise<Page>}
 */
export async function getSidebarPage(context) {
  const extensionId = getExtensionId(context);
  if (!extensionId) {
    throw new Error('Cannot open sidebar – could not determine extension ID');
  }

  const sidebarUrl = `moz-extension://${extensionId}/sidebar/sidebar.html`;

  // Re-use existing sidebar tab if already open
  for (const p of context.pages()) {
    if (p.url() === sidebarUrl) return p;
  }

  const page = await context.newPage();
  await page.goto(sidebarUrl, { waitUntil: 'domcontentloaded' });
  return page;
}

/**
 * ---------------------------------------------------------------------------
 * waitForSidebarLoaded
 * ---------------------------------------------------------------------------
 * Waits for the sidebar's root `#app` element to become visible.
 *
 * @param {Page} page
 * @returns {Promise<boolean>}  `true` once the element is visible
 */
export async function waitForSidebarLoaded(page) {
  await page.waitForSelector('#app', { state: 'visible', timeout: 15000 });
  return true;
}

/**
 * ---------------------------------------------------------------------------
 * addTestTabs
 * ---------------------------------------------------------------------------
 * Opens `count` new tabs with diverse example URLs.
 *
 * @param {BrowserContext} context
 * @param {number}  [count=5]  Number of tabs to create
 * @returns {Promise<Page[]>}
 */
export async function addTestTabs(context, count = 5) {
  const urls = [
    'https://example.com',
    'https://example.org',
    'https://example.net',
    'https://example.edu',
    'https://httpbin.org/html',
    'https://httpbin.org/links/10',
    'https://httpbin.org/robots.txt',
    'https://httpbin.org/uuid',
  ];

  /** @type {Page[]} */
  const pages = [];

  for (let i = 0; i < count; i++) {
    const page = await context.newPage();
    try {
      await page.goto(urls[i % urls.length], {
        waitUntil: 'domcontentloaded',
        timeout: 10000,
      });
    } catch {
      // Network failures for example URLs should not halt the test
    }
    pages.push(page);
  }

  return pages;
}

/**
 * ---------------------------------------------------------------------------
 * cleanup
 * ---------------------------------------------------------------------------
 * Closes every page belonging to the context, then closes the context itself.
 * Safe to call even if the context is already closed or `null`/`undefined`.
 *
 * @param {BrowserContext | null | undefined} context
 * @returns {Promise<void>}
 */
export async function cleanup(context) {
  if (!context) return;

  await Promise.allSettled(context.pages().map((p) => p.close()));
  await context.close();
}

/**
 * ---------------------------------------------------------------------------
 * getExtensionId
 * ---------------------------------------------------------------------------
 * Extracts the extension's UUID from the browser context.
 *
 * Looks for `moz-extension://` URLs in:
 *   1. Service workers / background workers (primary source)
 *   2. Open extension pages
 *
 * @param {BrowserContext} context
 * @returns {string | null}  The UUID hostname, or `null` if not found
 */
export function getExtensionId(context) {
  // 1 — Check service workers (Firefox exposes background scripts here)
  for (const sw of context.serviceWorkers) {
    const url = sw.url();
    if (url.startsWith('moz-extension://')) {
      return new URL(url).hostname;
    }
  }

  // 2 — Fall back to any open extension page
  for (const p of context.pages()) {
    const url = p.url();
    if (url.startsWith('moz-extension://')) {
      return new URL(url).hostname;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Simple promise-based sleep.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
