// Sidebar apps and split-screen layout.
//
// The two features share one problem: they compete for the same viewport, and
// getting that wrong produces a layout that is unusable rather than merely ugly.
// So the geometry is decided here, in one place, as arithmetic that can be tested
// instead of CSS that cannot.
//
// The rule the layout follows: the reading column never becomes too narrow to
// read comfortably. When space is short, the split is refused rather than
// producing two unusable slivers, and the reason is returned so the interface
// can say so instead of silently doing nothing.

const MIN_READING_WIDTH = 420;
const MIN_SPLIT_WIDTH = 300;
const APPS_RAIL_WIDTH = 320;
const SPLIT_GAP = 8;

const LAYOUT_MODES = Object.freeze({ single: 'single', split: 'split' });

/**
 * Chooses a layout. Returns the mode plus the widths, and a reason when a split
 * was declined.
 */
function resolveLayout({
  mode = LAYOUT_MODES.single,
  viewportWidth = 0,
  appsOpen = false,
  verticalTabsOpen = true,
  verticalTabsWidth = 232,
} = {}) {
  const width = Math.max(0, Number(viewportWidth) || 0);
  const reserved = (verticalTabsOpen ? verticalTabsWidth : 0) + (appsOpen ? APPS_RAIL_WIDTH : 0);
  const content = Math.max(0, width - reserved);
  const result = { mode: LAYOUT_MODES.single, content, reserved, primary: content, secondary: 0, appsRail: appsOpen ? APPS_RAIL_WIDTH : 0 };

  if (mode !== LAYOUT_MODES.split) return result;

  const gap = SPLIT_GAP;
  // A split needs room for two readable columns plus the gap between them.
  if (content - gap < MIN_READING_WIDTH * 2) {
    // Say which panel is in the way, because "make it wider" is useless advice
    // when the user can simply close something they opened.
    let reason;
    if (appsOpen) reason = `A side-by-side view needs more room than this. Closing the side panel frees ${APPS_RAIL_WIDTH} pixels.`;
    else if (verticalTabsOpen) reason = 'A side-by-side view needs more room than this. Hiding the tab list frees some.';
    else reason = 'A side-by-side view needs a wider window.';
    return { ...result, splitDeclined: true, reason };
  }

  const half = Math.floor((content - gap) / 2);
  // Any leftover pixel goes to the primary column so the two stay flush with the
  // right edge rather than leaving a gap.
  return {
    ...result,
    mode: LAYOUT_MODES.split,
    primary: half,
    secondary: content - gap - half,
    minColumn: Math.min(half, content - gap - half),
    gap,
  };
}

/** The built-in apps, kept small and stable because each one is a pinned origin. */
const APPS = Object.freeze([
  { id: 'notes', name: 'Notes', url: 'novaris://app/notes', color: '#7c8cff', pinned: true },
  { id: 'discord', name: 'Discord', url: 'https://discord.com/app', color: '#5865f2' },
  { id: 'youtube', name: 'YouTube', url: 'https://m.youtube.com/', color: '#ff0033' },
  { id: 'spotify', name: 'Spotify', url: 'https://open.spotify.com/', color: '#1db954' },
  { id: 'canvas', name: 'Canvas', url: 'https://canvas.instructure.com/', color: '#e72429' },
  { id: 'mail', name: 'Mail', url: 'https://mail.google.com/', color: '#ea4335' },
]);

/**
 * Which apps are worth pinning to the rail.
 *
 * A third party app is a full webview with its own storage, so it is only ever
 * shown after the user picks it. Anything not in the built-in list is treated as
 * a custom app and has to be added deliberately.
 */
function resolveApps(saved = []) {
  const custom = Array.isArray(saved)
    ? saved
        .filter((app) => app && typeof app.id === 'string' && typeof app.url === 'string')
        .map((app) => ({
          id: String(app.id).slice(0, 60),
          name: String(app.name || app.id).slice(0, 60),
          url: String(app.url).slice(0, 2048),
          color: /^#[0-9a-f]{6}$/i.test(String(app.color)) ? String(app.color) : '#7c8cff',
          pinned: false,
          custom: true,
        }))
        .slice(0, 12)
    : [];
  return { builtIn: APPS.map((app) => ({ ...app, custom: false })), custom };
}

function allApps(saved) {
  const { builtIn, custom } = resolveApps(saved);
  return [...builtIn, ...custom];
}

function findApp(saved, id) {
  return allApps(saved).find((app) => app.id === id) || null;
}

/**
 * The second pane of a split view is a tab, not a URL, so that a split keeps
 * working when the active tab navigates. The pane simply follows a tab id.
 */
function resolveSplitTab(tabs = [], activeTabId) {
  const candidates = tabs.filter((tab) => tab?.hasWebView && !tab.isInternalPage);
  if (!candidates.length) return { ok: false, reason: 'Open a website tab to use a side-by-side view.' };
  const chosen = candidates.find((tab) => tab.id === activeTabId) || candidates[0];
  // The same tab cannot be in both panes, so pick the first different one.
  if (candidates.length === 1) {
    return { ok: false, reason: 'A side-by-side view needs two website tabs.' };
  }
  return { ok: true, tabId: chosen.id, available: candidates.map((tab) => tab.id) };
}

module.exports = {
  APPS,
  APPS_RAIL_WIDTH,
  LAYOUT_MODES,
  MIN_READING_WIDTH,
  MIN_SPLIT_WIDTH,
  SPLIT_GAP,
  allApps,
  findApp,
  resolveApps,
  resolveLayout,
  resolveSplitTab,
};
