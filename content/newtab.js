/**
 * newtab.js — New Tab redirect supplement for Tab Oasis.
 *
 * Checks whether the new tab / home page should redirect to the sidebar
 * experience.  This is supplemental — the manifest already registers
 * chrome_url_overrides.newtab → sidebar/sidebar.html, but this script
 * handles cases (such as about:newtab in Firefox) where the override
 * may not apply automatically.
 *
 * @module content/newtab
 */

(function () {
  'use strict';

  // Only run on about:newtab or about:home
  if (
    document.location.href !== 'about:newtab' &&
    document.location.href !== 'about:home'
  ) {
    return;
  }

  // Check the newTabEnabled pref via storage local
  browser.storage.local.get('prefs').then(function (result) {
    var prefs = result.prefs || {};
    if (prefs.newTabEnabled) {
      var sidebarUrl = browser.runtime.getURL('sidebar/sidebar.html');
      if (sidebarUrl && document.location.href !== sidebarUrl) {
        document.location.replace(sidebarUrl);
      }
    }
  }).catch(function () {
    // Silently ignore — storage may not be accessible from this context
  });

})();
