import { describe, expect, it } from 'vitest';
import {
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
} from '../electron/split-view.js';

const tab = (id, extra = {}) => ({ id, hasWebView: true, isNewTab: false, isInternalPage: false, ...extra });
const newTab = (id) => tab(id, { isNewTab: true });
const internal = (id) => tab(id, { isInternalPage: true });

describe('what can go in a split', () => {
  it('takes a website tab', () => {
    expect(isSplittableTab(tab('a'))).toBe(true);
  });

  // A new tab has nothing to place beside a page, and a Novaris page is a panel
  // rather than a document.
  it('refuses a new tab and a Novaris page', () => {
    expect(isSplittableTab(newTab('n'))).toBe(false);
    expect(isSplittableTab(internal('i'))).toBe(false);
    expect(isSplittableTab({ id: 'x' })).toBe(false);
    expect(isSplittableTab(null)).toBe(false);
  });

  it('explains a refusal rather than failing silently', () => {
    const check = canAccept(null, 'n', [newTab('n')]);
    expect(check.ok).toBe(false);
    expect(check.reason).toMatch(/website pages/i);
  });
});

describe('adding panes, the way Zen does it', () => {
  it('drops a tab to the right of a pane', () => {
    const split = addPane(emptySplit(), 'a');
    const two = addPane(split, 'b', { atIndex: 0, side: SIDES.right });
    expect(two.tabIds).toEqual(['a', 'b']);
    expect(two.activeIndex).toBe(1);
  });

  it('drops a tab to the left of a pane', () => {
    const split = addPane(addPane(emptySplit(), 'a'), 'b', { atIndex: 0, side: SIDES.right });
    const three = addPane(split, 'c', { atIndex: 1, side: SIDES.left });
    expect(three.tabIds).toEqual(['a', 'c', 'b']);
    expect(three.activeIndex).toBe(1);
  });

  // Zen holds four. Beyond that the panes stop being readable, so the limit is
  // a refusal with a reason rather than a fifth sliver.
  it('holds up to four panes', () => {
    let split = addPane(emptySplit(), 'a');
    split = addPane(split, 'b', { atIndex: 0 });
    split = addPane(split, 'c', { atIndex: 1 });
    expect(split.tabIds).toHaveLength(3);
    const four = addPane(split, 'd', { atIndex: 2 });
    expect(four.tabIds).toHaveLength(MAX_PANES);
    const five = addPane(four, 'e', { atIndex: 3 });
    expect(five.tabIds).toHaveLength(MAX_PANES);
    expect(five.rejected).toBe(MAX_PANES);
  });

  // A page cannot be shown twice, so a tab already in the split is moved.
  it('moves a tab that is already in the split instead of duplicating it', () => {
    let split = addPane(emptySplit(), 'a');
    split = addPane(split, 'b', { atIndex: 0 });
    const moved = addPane(split, 'a', { atIndex: 1, side: SIDES.left });
    expect(moved.tabIds).toEqual(['b', 'a']);
    expect(moved.tabIds).toHaveLength(2);
  });

  it('clamps an index outside the panes', () => {
    const split = addPane(addPane(emptySplit(), 'a'), 'b', { atIndex: 99 });
    expect(split.tabIds).toEqual(['a', 'b']);
  });
});

describe('pane widths', () => {
  it('shares evenly when nothing was chosen', () => {
    expect(spreadWeights(4, null).every((w) => Math.abs(w - 0.25) < 1e-9)).toBe(true);
  });

  it('rescales a request that does not sum to one', () => {
    const weights = spreadWeights(2, [3, 1]);
    expect(weights[0]).toBeCloseTo(0.75, 6);
    expect(weights.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
  });

  // The invariant that matters: a pane is never given zero width, because a
  // zero-width pane is invisible and cannot be clicked. Zero is the placeholder
  // callers use for "a new pane goes here", so it must not survive.
  it('never produces a pane with no width, whatever it is handed', () => {
    for (const requested of [[0, 0], [Number.NaN, 5], [1], [-1, 2], [0, 1], [Infinity, 1], ['x', 'y']]) {
      const weights = spreadWeights(2, requested);
      expect(weights.every((w) => w > 0 && Number.isFinite(w))).toBe(true);
      expect(weights.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    }
  });

  it('falls back to an even share for a count that does not match', () => {
    expect(spreadWeights(2, [1])).toEqual([0.5, 0.5]);
    expect(spreadWeights(2, [1, 1, 1])).toEqual([0.5, 0.5]);
    expect(spreadWeights(3, null)).toEqual([1 / 3, 1 / 3, 1 / 3]);
  });

  it('gives the rounding remainder to the widest pane so the row has no seam', () => {
    // 1000 / 3 leaves 333.33 per pane, which is 999 in total and a visible gap.
    const split = { tabIds: ['a', 'b', 'c'], weights: spreadWeights(3), activeIndex: 0 };
    const widths = paneWidths(split, 1000);
    expect(widths.reduce((a, b) => a + b, 0)).toBe(1000);
    expect(widths.every((w) => Number.isInteger(w))).toBe(true);
  });

  it('returns nothing when there is no split or no width', () => {
    expect(paneWidths(null, 1000)).toEqual([]);
    expect(paneWidths({ tabIds: ['a'], weights: [1] }, 0)).toEqual([0]);
  });
});

describe('resizing by dragging the divider', () => {
  const two = () => addPane(addPane(emptySplit(), 'a'), 'b', { atIndex: 0 });

  it('moves width from the right pane to the left', () => {
    const before = two();
    const after = resizePanes(before, 0, 0.2);
    expect(after.weights[0]).toBeGreaterThan(before.weights[0]);
    expect(after.weights[0] + after.weights[1]).toBeCloseTo(1, 6);
  });

  it('moves width from the left pane to the right', () => {
    const before = two();
    const after = resizePanes(before, 0, -0.2);
    expect(after.weights[1]).toBeGreaterThan(before.weights[1]);
  });

  // A pane too narrow to read is worse than no split at all, so the drag stops.
  it('refuses to drag a pane below the minimum', () => {
    let split = two();
    for (let i = 0; i < 40; i += 1) split = resizePanes(split, 0, -0.1);
    expect(split.weights[0]).toBeGreaterThanOrEqual(MIN_PANE_FRACTION * 2 - 1e-6);
    expect(split.weights[1]).toBeGreaterThanOrEqual(MIN_PANE_FRACTION * 2 - 1e-6);
  });

  it('ignores a drag when there is nothing to drag', () => {
    const one = addPane(emptySplit(), 'a');
    expect(resizePanes(one, 0, 0.5)).toBe(one);
    expect(resizePanes(two(), 0, Number.NaN).weights[0]).toBeCloseTo(0.5, 6);
  });

  it('moves only the pair around the divider', () => {
    let split = addPane(emptySplit(), 'a');
    split = addPane(split, 'b', { atIndex: 0 });
    split = addPane(split, 'c', { atIndex: 1 });
    const before = [...split.weights];
    const after = resizePanes(split, 0, 0.15);
    expect(after.weights[2]).toBeCloseTo(before[2], 6);
    expect(after.weights[0]).toBeGreaterThan(before[0]);
  });
});

describe('taking a pane out', () => {
  it('removes one pane and shares its width among the rest', () => {
    let split = addPane(emptySplit(), 'a');
    split = addPane(split, 'b', { atIndex: 0 });
    split = resizePanes(split, 0, 0.3);
    const after = removePane(split, 'a');
    expect(after.tabIds).toEqual(['b']);
    expect(after.weights).toEqual([1]);
  });

  it('ends the split when the last pane goes', () => {
    const split = addPane(emptySplit(), 'a');
    expect(removePane(split, 'a')).toBeNull();
  });

  it('keeps the focused pane in range', () => {
    let split = addPane(emptySplit(), 'a');
    split = addPane(split, 'b', { atIndex: 0 });
    split = addPane(split, 'c', { atIndex: 1 });
    split = setActivePane(split, 2);
    const after = removePane(split, 'b');
    expect(after.activeIndex).toBeLessThanOrEqual(after.tabIds.length - 1);
    expect(after.activeIndex).toBeGreaterThanOrEqual(0);
  });
});

describe('keeping the split honest', () => {
  it('drops panes whose tab was closed', () => {
    const split = { tabIds: ['a', 'gone', 'b'], weights: [1, 1, 1], activeIndex: 0 };
    const after = normalizeSplit(split, [tab('a'), tab('b')]);
    expect(after.tabIds).toEqual(['a', 'b']);
    expect(after.weights.reduce((x, y) => x + y, 0)).toBeCloseTo(1, 6);
  });

  it('drops a pane whose tab became a new tab', () => {
    const split = { tabIds: ['a', 'b'], weights: [1, 1], activeIndex: 0 };
    const after = normalizeSplit(split, [tab('a'), newTab('b')]);
    expect(after.tabIds).toEqual(['a']);
  });

  it('ends the split once nothing is left', () => {
    expect(normalizeSplit({ tabIds: ['a'], weights: [1], activeIndex: 0 }, [])).toBeNull();
    expect(normalizeSplit(null, [tab('a')])).toBeNull();
  });

  it('removes a duplicate that could not exist on screen', () => {
    const split = { tabIds: ['a', 'a', 'b'], weights: [1, 1, 1], activeIndex: 0 };
    expect(normalizeSplit(split, [tab('a'), tab('b')]).tabIds).toEqual(['a', 'b']);
  });

  it('finds which pane a tab is in', () => {
    const split = addPane(addPane(emptySplit(), 'a'), 'b', { atIndex: 0 });
    expect(paneIndexOf(split, 'b')).toBe(1);
    expect(paneIndexOf(split, 'zz')).toBe(-1);
    expect(paneIndexOf(null, 'a')).toBe(-1);
  });

  it('reports whether a split is open without throwing on odd input', () => {
    expect(isSplitOpen(null)).toBe(false);
    expect(isSplitOpen({})).toBe(false);
    expect(isSplitOpen({ tabIds: [] })).toBe(false);
    expect(isSplitOpen({ tabIds: ['a'] })).toBe(true);
  });
});
