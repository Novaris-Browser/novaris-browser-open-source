// Gaming Mode: give the CPU and memory to the game instead of to background tabs.
//
// The setting is only worth having if it measurably changes what the machine
// does, so every part of it maps to a real mechanism rather than a label:
//
//   - Inactive tabs are unloaded, not just hidden. A hidden webview still runs
//     its scripts and still holds a renderer, which is the single largest source
//     of background memory use. Unloading frees it. This is a real tradeoff and
//     the interface says so: a suspended tab reloads when you return to it.
//   - Notifications are refused at the permission layer, so a page cannot show
//     one even if it asks without prompting.
//   - The spellchecker is switched off, because it runs against every page.
//   - Background throttling is forced on for newly attached webviews, so a tab
//     opened during a game starts suspended rather than at full speed.
//
// Everything here is pure so it can be tested without launching a browser.

const FORCED_PERMISSIONS = Object.freeze(['notifications']);

// Applied as webview preferences when a webview attaches during gaming mode.
const WEBVIEW_PREFERENCES = Object.freeze({ backgroundThrottling: true });

function gamingModeEnabled(settings = {}) {
  return settings.gamingMode === true;
}

// A tab is suspended when it is not the one being looked at. The active tab is
// left alone so browsing still works while the mode is on.
function shouldSuspendTab({ gamingMode, active, hasWebView } = {}) {
  if (!gamingMode) return false;
  if (!hasWebView) return false;
  return active !== true;
}

function isPermissionForcedDenied(permission, settings = {}) {
  if (!gamingModeEnabled(settings)) return false;
  return FORCED_PERMISSIONS.includes(permission);
}

function webviewPreferencesFor(settings = {}) {
  if (!gamingModeEnabled(settings)) return {};
  return { ...WEBVIEW_PREFERENCES };
}

function spellcheckEnabled(settings = {}) {
  // Spellchecking every page is measurable background work, and it is not
  // something anyone wants while a game is running.
  return !gamingModeEnabled(settings);
}

function describeGaming(settings = {}) {
  const enabled = gamingModeEnabled(settings);
  return {
    enabled,
    notificationsBlocked: enabled,
    spellcheckEnabled: spellcheckEnabled(settings),
    // Named so the cost is visible rather than discovered.
    tradeoff: enabled
      ? 'Every tab except the one you are looking at is unloaded to free memory. Coming back to a tab reloads it, so in-page form text and scroll position are lost.'
      : '',
    effects: [
      { id: 'suspend', title: 'Unloads inactive tabs', detail: 'Frees the memory each background page was holding instead of leaving it rendered behind the window.' },
      { id: 'throttle', title: 'Throttles background work', detail: 'New tabs start throttled so they cannot run at full speed while you are not looking at them.' },
      { id: 'notifications', title: 'Refuses all notifications', detail: 'Pages cannot display a notification, and are not even asked, so nothing appears over a fullscreen game.' },
      { id: 'spellcheck', title: 'Stops the spellchecker', detail: 'The spellchecker runs against every page you have open, which is work a game does not need.' },
    ],
  };
}

module.exports = {
  FORCED_PERMISSIONS,
  WEBVIEW_PREFERENCES,
  describeGaming,
  gamingModeEnabled,
  isPermissionForcedDenied,
  shouldSuspendTab,
  spellcheckEnabled,
  webviewPreferencesFor,
};
