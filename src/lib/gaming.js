// The renderer's half of Gaming Mode.
//
// Which tab gets suspended is a rendering decision, so it lives here and only
// here. The main process owns the parts it can actually enforce: refusing
// notifications, turning off the spellchecker, and forcing throttling on newly
// attached webviews. Keeping the split this way means the suspend rule has a
// single implementation and cannot drift out of step with the process.

/**
 * A tab is suspended when Gaming Mode is on and the tab is not the one being
 * looked at. Suspension unloads the page, which is what actually frees the
 * memory; hiding it alone would leave the renderer running.
 *
 * The mode check is a strict comparison rather than a truthy test, so a settings
 * value that is not a real boolean can never unload somebody's tabs. This has to
 * match gamingModeEnabled in the main process exactly.
 */
export function shouldSuspendTab({ gamingMode, active, hasWebView } = {}) {
  if (gamingMode !== true) return false;
  if (!hasWebView) return false;
  return active !== true;
}

/**
 * How many of the given tabs Gaming Mode would suspend, for the interface to
 * report. The active tab is always left usable.
 */
export function suspendedTabCount(tabs = [], activeTabId, gamingMode) {
  if (gamingMode !== true) return 0;
  return tabs.filter((tab) => tab?.hasWebView && tab.id !== activeTabId).length;
}
