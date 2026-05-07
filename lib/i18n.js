/**
 * @file i18n wrapper for Tab Oasis Firefox extension.
 * Provides localization utilities built on browser.i18n.
 */

import { escapeHtml } from './utils.js';

/**
 * Array of supported locale codes (underscore format matching _locales directory names).
 * @type {string[]}
 */
export const SUPPORTED_LOCALES = ['zh_CN', 'en'];

/**
 * Retrieves the localized string for the given message key.
 * Falls back to the key itself if the message is not found.
 *
 * @param {string} key - The message key (e.g. 'tabAction_saveAll').
 * @param {...string} substitutions - Optional substitution values for $PLACEHOLDER$ tokens.
 * @returns {string} Localized string, or the key as a fallback.
 */
export function t(key, ...substitutions) {
  const substitutionsArg =
    substitutions.length > 0 ? substitutions : undefined;
  const message = browser.i18n.getMessage(key, substitutionsArg);
  return message || key;
}

/**
 * Same as t() but escapes HTML entities in substitution values
 * before they are interpolated into the message.
 *
 * @param {string} key - The message key.
 * @param {...string} substitutions - Optional substitution values.
 * @returns {string} Localized string with substitutions safely escaped.
 */
export function tHtml(key, ...substitutions) {
  const escaped = substitutions.map((s) => escapeHtml(s));
  const substitutionsArg = escaped.length > 0 ? escaped : undefined;
  const message = browser.i18n.getMessage(key, substitutionsArg);
  return message || key;
}

/**
 * Reads the optional [data-i18n-count] attribute from an element
 * and returns it as a single-element array suitable for t() / tHtml().
 *
 * @param {Element} el - The DOM element.
 * @returns {string[]} Array containing the count value, or empty array.
 */
function getCountSubstitutions(el) {
  const count = el.getAttribute('data-i18n-count');
  return count !== null ? [count] : [];
}

/**
 * Scans the DOM for elements with localization data attributes
 * and applies the corresponding translated strings.
 *
 * Supported attributes:
 *   - data-i18n              → element.textContent
 *   - data-i18n-title        → element.title
 *   - data-i18n-placeholder  → element.placeholder
 *   - data-i18n-html         → element.innerHTML (use with caution)
 *
 * For substitution patterns like {count}, add a data-i18n-count
 * attribute on the same element with the numeric value to substitute.
 *
 * @param {Document|Element} [rootElement=document] - The root element to scan.
 */
export function localizePage(rootElement = document) {
  // Localize textContent via data-i18n
  const textElements = rootElement.querySelectorAll('[data-i18n]');
  for (const el of textElements) {
    const key = el.getAttribute('data-i18n');
    if (!key) continue;
    el.textContent = t(key, ...getCountSubstitutions(el));
  }

  // Localize title attribute via data-i18n-title
  const titleElements = rootElement.querySelectorAll('[data-i18n-title]');
  for (const el of titleElements) {
    const key = el.getAttribute('data-i18n-title');
    if (!key) continue;
    el.title = t(key, ...getCountSubstitutions(el));
  }

  // Localize placeholder attribute via data-i18n-placeholder
  const placeholderElements = rootElement.querySelectorAll(
    '[data-i18n-placeholder]',
  );
  for (const el of placeholderElements) {
    const key = el.getAttribute('data-i18n-placeholder');
    if (!key) continue;
    el.placeholder = t(key, ...getCountSubstitutions(el));
  }

  // Localize innerHTML via data-i18n-html (use with caution)
  const htmlElements = rootElement.querySelectorAll('[data-i18n-html]');
  for (const el of htmlElements) {
    const key = el.getAttribute('data-i18n-html');
    if (!key) continue;
    el.innerHTML = tHtml(key, ...getCountSubstitutions(el));
  }
}

/**
 * Returns the current browser UI locale code.
 *
 * @returns {string} Browser UI language tag (e.g. 'zh-CN', 'en-US').
 */
export function getCurrentLocale() {
  return browser.i18n.getUILanguage();
}
