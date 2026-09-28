// Side-by-side viewing, modelled on the way Zen Browser does it.
//
// Zen's model, and the reason this is not simply "two columns":
//   * up to four panes at once
//   * a tab is dropped on the left or right edge of a pane, not on the pane
//   * the divider between panes can be dragged to change the widths
//   * each pane carries its own handle and unsplit control
//
// The tree structure Zen uses internally is not reproduced. What matters for the
// user is that the panes are an ordered list you can insert into, drop beside,
// resize, and take out of one at a time, and that all of it is decided by pure
// arithmetic that can be tested instead of geometry that cannot.

const MAX_PANES = 4;
// Zen's zen.splitView.min-resize-width default is 7 percent of the screen. A pane
// narrower than this cannot show a page and is worse than not splitting.
const MIN_PANE_FRACTION = 0.07;
const SIDES = Object.freeze({ left: 'left', right: 'right' });

/** A tab can only be shown in a pane if there is a page in it to show. */
function isSplittableTab(tab) {
  return Boolean(tab?.hasWebView) && !tab.isNewTab && !tab.isInternalPage;
}

/** An empty, valid split: one pane showing nothing yet. */
function emptySplit() {
  return { tabIds: [], weights: [], activeIndex: 0 };
}

function isSplitOpen(split) {
  return Boolean(split && Array.isArray(split.tabIds) && split.tabIds.length);
}

/**
 * Rebuilds a split from whatever survived: closed tabs are dropped, weights are
 * re-spread across the panes that remain, and the focused pane is moved into
 * range. Returns null once no pane is left.
 */
function normalizeSplit(split, tabs = []) {
  if (!isSplitOpen(split)) return null;
  const live = [];
  for (const id of split.tabIds) {
    const tab = tabs.find((item) => item.id === id);
    if (!isSplittableTab(tab)) continue;
    if (live.includes(id)) continue;
    live.push(id);
  }
  if (!live.length) return null;
  return {
    tabIds: live,
    weights: spreadWeights(live.length, split.weights),
    activeIndex: Math.min(Math.max(Number(split.activeIndex) || 0, 0), live.length - 1),
  };
}

/**
 * Even shares, or the shares asked for rescaled to sum to one. Rescaling rather
 * than dropping the difference keeps the proportions the user chose when a pane
 * is added or removed elsewhere.
 *
 * A zero or unparseable weight is replaced rather than kept, because a pane
 * given no width is invisible and unclickable. Callers use zero as a placeholder
 * meaning "a new pane goes here", so treating it as a real share of nothing is
 * exactly the mistake this guards against.
 */
function spreadWeights(count, requested) {
  if (count <= 0) return [];
  const even = () => new Array(count).fill(1 / count);
  if (!Array.isArray(requested) || requested.length !== count) return even();
  const usable = requested.map((value) => (Number.isFinite(value) && value > 0 ? value : 1));
  const total = usable.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return even();
  const weights = usable.map((value) => value / total);
  return weights.every((value) => value > 0) ? weights : even();
}

/** Why a tab cannot join the split, or that it can. */
function canAccept(split, tabId, tabs) {
  const tab = tabs.find((item) => item.id === tabId);
  if (!isSplittableTab(tab)) return { ok: false, reason: 'A side-by-side view shows two website pages.' };
  if (isSplitOpen(split) && split.tabIds.length >= MAX_PANES && !split.tabIds.includes(tabId)) {
    return { ok: false, reason: `A side-by-side view holds up to ${MAX_PANES} pages. Close one first.` };
  }
  return { ok: true };
}

/**
 * Puts a tab into a pane beside another one. side is which edge of the pane the
 * tab lands on, which is what decides whether it ends up before or after it.
 * A tab already in the split is moved rather than duplicated, because a page
 * cannot be shown in two panes at once.
 */
function addPane(split, tabId, { atIndex = 0, side = SIDES.right } = {}) {
  const current = isSplitOpen(split) ? split : emptySplit();
  const existing = current.tabIds.indexOf(tabId);
  const rest = existing === -1 ? current.tabIds : current.tabIds.filter((id) => id !== tabId);
  const insertAt = Math.min(Math.max(Number(atIndex) || 0, 0), rest.length);
  const position = side === SIDES.left ? insertAt : insertAt + 1;
  const tabIds = [...rest.slice(0, position), tabId, ...rest.slice(position)];
  if (tabIds.length > MAX_PANES) return { ...current, rejected: MAX_PANES };
  const weights = spreadWeights(tabIds.length, weightsAround(current, rest, position));
  return { tabIds, weights, activeIndex: position };
}

/**
 * Keeps the widths of the panes that were not touched, so dropping a new tab in
 * does not resize everything that was already balanced.
 */
function weightsAround(current, rest, position) {
  if (rest.length !== current.tabIds.length || !current.weights.length) return null;
  const kept = rest.map((id) => current.weights[current.tabIds.indexOf(id)]).filter((value) => value > 0);
  if (!kept.length) return null;
  const at = Math.min(position, kept.length);
  return [...kept.slice(0, at), 0, ...kept.slice(at)];
}

/** Takes a pane out. The split ends when the last one goes. */
function removePane(split, tabId) {
  if (!isSplitOpen(split)) return null;
  const index = split.tabIds.indexOf(tabId);
  if (index === -1) return normalizeSplit(split, split.tabs || []);
  const tabIds = split.tabIds.filter((id) => id !== tabId);
  if (!tabIds.length) return null;
  const removed = split.weights[index] || 0;
  const kept = split.weights.filter((_, i) => i !== index);
  // The removed pane's width is shared out among the survivors, then everything
  // is rescaled, because the kept weights no longer sum to one.
  const shared = kept.map((value) => value + removed / kept.length);
  const weights = spreadWeights(tabIds.length, shared);
  const activeIndex = Math.min(split.activeIndex > index ? split.activeIndex - 1 : split.activeIndex, tabIds.length - 1);
  return { tabIds, weights, activeIndex: Math.max(0, activeIndex) };
}

function setActivePane(split, index) {
  if (!isSplitOpen(split)) return split;
  const at = Math.min(Math.max(Number(index) || 0, 0), split.tabIds.length - 1);
  return { ...split, activeIndex: at };
}

/** The index of a tab's pane, or -1. */
function paneIndexOf(split, tabId) {
  if (!isSplitOpen(split)) return -1;
  return split.tabIds.indexOf(tabId);
}

/**
 * Moves a divider by a fraction of the available width and redistributes it
 * between the two panes it separates. No pane may end up under the minimum,
 * because a pane that cannot show a page is not a split, it is a mistake.
 */
function resizePanes(split, dividerIndex, deltaFraction) {
  if (!isSplitOpen(split) || split.tabIds.length < 2) return split;
  const at = Math.min(Math.max(Number(dividerIndex) || 0, 0), split.tabIds.length - 2);
  const delta = Number(deltaFraction);
  if (!Number.isFinite(delta) || delta === 0) return split;

  const weights = [...split.weights];
  const left = weights[at];
  const right = weights[at + 1];
  const pairTotal = left + right;
  if (pairTotal <= 0) return split;

  let nextLeft = left + delta;
  // Clamp against both panes so neither can be dragged out of existence.
  const floor = MIN_PANE_FRACTION * split.tabIds.length;
  nextLeft = Math.max(floor, Math.min(pairTotal - floor, nextLeft));
  if (nextLeft === left) return split;

  const nextRight = pairTotal - nextLeft;
  weights[at] = nextLeft;
  weights[at + 1] = nextRight;
  return { ...split, weights: spreadWeights(split.tabIds.length, weights) };
}

/** Pane widths in pixels, so the renderer does no arithmetic of its own. */
function paneWidths(split, available) {
  if (!isSplitOpen(split)) return [];
  const total = Math.max(0, Number(available) || 0);
  if (!total) return split.weights.map(() => 0);
  const raw = split.weights.map((weight) => Math.floor(total * weight));
  // Hand the rounding remainder to the widest pane, so the columns always reach
  // the right edge with no seam and no overflow.
  const drift = total - raw.reduce((sum, value) => sum + value, 0);
  if (raw.length && drift) {
    const widest = raw.indexOf(Math.max(...raw));
    raw[widest] = Math.max(0, raw[widest] + drift);
  }
  return raw;
}

module.exports = {
  MAX_PANES,
  MIN_PANE_FRACTION,
  SIDES,
  addPane,
  canAccept,
  emptySplit,
  isSplitOpen,
  isSplittableTab,
  normalizeSplit,
  paneIndexOf,
  paneWidths,
  removePane,
  resizePanes,
  setActivePane,
  spreadWeights,
};
