/**
 * @file Pure utility functions for Tab Oasis Firefox extension.
 * This is a leaf module with no dependencies on other modules or browser APIs.
 */

/**
 * Creates a debounced version of a function.
 * The debounced function delays invoking `fn` until `delay` ms have elapsed
 * since the last invocation. Leading edge is false, trailing is true.
 *
 * @param {Function} fn - The function to debounce.
 * @param {number} delay - Delay in milliseconds.
 * @returns {Function} Debounced function with a `.cancel()` method.
 */
export function debounce(fn, delay) {
  let timerId = null;

  const debounced = function (...args) {
    if (timerId !== null) {
      clearTimeout(timerId);
    }
    timerId = setTimeout(() => {
      timerId = null;
      fn.apply(this, args);
    }, delay);
  };

  debounced.cancel = function () {
    if (timerId !== null) {
      clearTimeout(timerId);
      timerId = null;
    }
  };

  return debounced;
}

/**
 * Creates a throttled version of a function.
 * Ensures `fn` is called at most once every `limit` ms.
 *
 * @param {Function} fn - The function to throttle.
 * @param {number} limit - Throttle interval in milliseconds.
 * @returns {Function} Throttled function with a `.cancel()` method.
 */
export function throttle(fn, limit) {
  let inThrottle = false;
  let lastArgs = null;
  let lastContext = null;
  let timerId = null;

  const throttled = function (...args) {
    if (inThrottle) {
      lastArgs = args;
      lastContext = this;
      return;
    }

    fn.apply(this, args);
    inThrottle = true;

    timerId = setTimeout(() => {
      inThrottle = false;
      if (lastArgs) {
        const ctx = lastContext;
        const callArgs = lastArgs;
        lastArgs = null;
        lastContext = null;
        throttled.apply(ctx, callArgs);
      }
    }, limit);
  };

  throttled.cancel = function () {
    if (timerId !== null) {
      clearTimeout(timerId);
    }
    inThrottle = false;
    lastArgs = null;
    lastContext = null;
    timerId = null;
  };

  return throttled;
}

/**
 * Escapes special HTML characters in a string.
 * Converts & < > " ' to their HTML entity equivalents.
 *
 * @param {string} str - The string to sanitize.
 * @returns {string} Escaped string safe for HTML insertion.
 */
export function escapeHtml(str) {
  if (typeof str !== 'string') {
    return '';
  }

  const htmlChars = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };

  return str.replace(/[&<>"']/g, (char) => htmlChars[char]);
}

/**
 * Formats a timestamp into a human-readable date string.
 *
 * @param {number|Date} timestamp - Unix timestamp in milliseconds or a Date object.
 * @param {string} [locale='zh-CN'] - Locale string for Intl.DateTimeFormat.
 * @returns {string} Formatted date string (e.g., "2024-05-08 12:30").
 */
export function formatDate(timestamp, locale = 'zh-CN') {
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const formatter = new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  return formatter.format(date);
}

/**
 * Formats a timestamp into a relative time string in English.
 * Returns "just now", "X minutes ago", "X hours ago", "yesterday",
 * "X days ago", or a formatted date for timestamps older than 30 days.
 *
 * @param {number|Date} timestamp - Unix timestamp in milliseconds or a Date object.
 * @returns {string} Relative time string or formatted date.
 */
export function formatRelativeTime(timestamp) {
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);

  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSeconds < 60) {
    return 'just now';
  }

  if (diffMinutes < 60) {
    return `${diffMinutes} minute${diffMinutes === 1 ? '' : 's'} ago`;
  }

  if (diffHours < 24) {
    return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
  }

  if (diffDays === 1) {
    return 'yesterday';
  }

  if (diffDays <= 30) {
    return `${diffDays} days ago`;
  }

  // Older than 30 days: return formatted date
  const formatter = new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  return formatter.format(date);
}

/**
 * Generates a unique ID string.
 * Uses crypto.randomUUID() if available, otherwise falls back to
 * a timestamp + random hex pattern (similar to MongoDB ObjectId).
 *
 * @returns {string} Unique ID string.
 */
export function generateId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  // Fallback: timestamp (hex) + 16 random hex chars
  const timestampHex = Date.now().toString(16);
  const randomHex = Array.from({ length: 16 }, () =>
    Math.floor(Math.random() * 16).toString(16)
  ).join('');

  return timestampHex + randomHex;
}

/**
 * Extracts the domain from a URL string.
 * Strips protocol, path, query, and www prefix. Returns lowercase domain.
 *
 * @param {string} url - The URL to extract the domain from.
 * @returns {string} Lowercase domain without www prefix, or empty string if invalid.
 */
export function getDomain(url) {
  if (!url || typeof url !== 'string') {
    return '';
  }

  // Handle about:blank and similar special pages
  if (url === 'about:blank') {
    return 'about:blank';
  }

  try {
    const parsed = new URL(url);
    let hostname = parsed.hostname.toLowerCase();

    // Strip www. prefix
    if (hostname.startsWith('www.')) {
      hostname = hostname.slice(4);
    }

    return hostname;
  } catch {
    return '';
  }
}

/**
 * Truncates a string to a maximum length, appending "..." if truncated.
 * Does not break in the middle of a multi-byte character.
 *
 * @param {string} str - The string to truncate.
 * @param {number} maxLen - Maximum length including the "..." suffix.
 * @returns {string} Truncated string.
 */
export function truncate(str, maxLen) {
  if (typeof str !== 'string') {
    return '';
  }

  if (maxLen <= 0) {
    return '';
  }

  if (str.length <= maxLen) {
    return str;
  }

  // Use Array.from to handle multi-byte characters properly
  const chars = Array.from(str);
  if (chars.length <= maxLen) {
    return str;
  }

  return chars.slice(0, maxLen - 3).join('') + '...';
}

/**
 * Clamps a number between a minimum and maximum value.
 *
 * @param {number} val - The value to clamp.
 * @param {number} min - The lower bound.
 * @param {number} max - The upper bound.
 * @returns {number} The clamped value.
 */
export function clamp(val, min, max) {
  if (val < min) return min;
  if (val > max) return max;
  return val;
}

/**
 * Normalizes a URL for comparison and deduplication purposes.
 * Strips trailing slash, www prefix, fragments (#hash), and utm_* query params.
 * Lowercases the hostname.
 *
 * @param {string} url - The URL to normalize.
 * @returns {string} Normalized URL string.
 */
export function normalizeUrl(url) {
  if (!url || typeof url !== 'string') {
    return '';
  }

  try {
    const parsed = new URL(url);

    // Lowercase hostname
    parsed.hostname = parsed.hostname.toLowerCase();

    // Strip www. prefix
    if (parsed.hostname.startsWith('www.')) {
      parsed.hostname = parsed.hostname.slice(4);
    }

    // Remove fragment
    parsed.hash = '';

    // Remove utm_* query parameters
    const params = new URLSearchParams(parsed.search);
    const keysToDelete = [];
    for (const key of params.keys()) {
      if (key.startsWith('utm_')) {
        keysToDelete.push(key);
      }
    }
    for (const key of keysToDelete) {
      params.delete(key);
    }
    parsed.search = params.toString();

    // Remove trailing slash from pathname (unless it's just "/")
    let normalized = parsed.toString();

    // URL.toString() adds trailing slash if pathname is empty, so we need to
    // remove it after processing
    if (normalized.endsWith('/') && parsed.pathname !== '/') {
      normalized = normalized.slice(0, -1);
    }

    return normalized;
  } catch {
    return '';
  }
}

/**
 * Returns the singular or plural form of a word based on count.
 * For English only.
 *
 * @param {number} count - The count to determine the form.
 * @param {string} singular - The singular form.
 * @param {string} plural - The plural form.
 * @returns {string} Singular form if count === 1, plural otherwise.
 */
export function pluralize(count, singular, plural) {
  return count === 1 ? singular : plural;
}

/**
 * Returns a Promise that resolves after a specified number of milliseconds.
 *
 * @param {number} ms - Number of milliseconds to sleep.
 * @returns {Promise<void>} A promise that resolves after the delay.
 */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
