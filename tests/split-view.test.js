import { describe, expect, it } from 'vitest';
import { resolveLayout, resolveSplitTab, MIN_READING_WIDTH } from '../electron/sidebar-layout.js';

// The split feature ships arithmetic from this module into App.jsx. These tests
// pin the contract the renderer depends on, including the case that was never
// exercised before: what the layout does when a split is requested.
describe('split view geometry', () => {
  it('fills the space when there is no split', () => {
    const layout = resolveLayout({ mode: 'single', viewportWidth: 1600, verticalTabsOpen: true, verticalTabsWidth: 232 });
    expect(layout.mode).toBe('single');
    expect(layout.secondary).toBe(0);
    expect(layout.splitDeclined).toBeUndefined();
  });

  it('gives two equal columns when there is room', () => {
    const layout = resolveLayout({ mode: 'split', viewportWidth: 1600, verticalTabsOpen: true, verticalTabsWidth: 232 });
    expect(layout.splitDeclined).toBeUndefined();
    expect(layout.secondary).toBeGreaterThan(0);
    expect(layout.primary).toBeGreaterThanOrEqual(MIN_READING_WIDTH);
    expect(Math.abs(layout.primary - layout.secondary)).toBeLessThanOrEqual(1);
  });

  it('keeps both columns flush with the right edge', () => {
    // An odd number of pixels would otherwise leave a gap, because 232 is even
    // and the window rarely is.
    for (const width of [1201, 1377, 1599, 2003]) {
      const layout = resolveLayout({ mode: 'split', viewportWidth: width, verticalTabsOpen: true, verticalTabsWidth: 232 });
      if (layout.splitDeclined) continue;
      expect(layout.primary + layout.secondary + layout.gap).toBe(layout.content);
    }
  });

  // The reason the whole thing is arithmetic rather than CSS: a split that
  // produces two unreadable slivers is worse than no split.
  it('refuses a split that would squeeze both columns past readability', () => {
    const layout = resolveLayout({ mode: 'split', viewportWidth: 700, verticalTabsOpen: true, verticalTabsWidth: 232 });
    expect(layout.splitDeclined).toBe(true);
    expect(layout.secondary).toBe(0);
    expect(typeof layout.reason).toBe('string');
    expect(layout.reason.length).toBeGreaterThan(10);
  });

  it('names the panel in the way, so the advice is actionable', () => {
    const withApps = resolveLayout({ mode: 'split', viewportWidth: 1000, appsOpen: true, verticalTabsOpen: true });
    expect(withApps.reason).toMatch(/side panel/i);
    const withTabs = resolveLayout({ mode: 'split', viewportWidth: 1000, appsOpen: false, verticalTabsOpen: true });
    expect(withTabs.reason).toMatch(/tab list/i);
  });

  it('widens the split when the tab list is hidden', () => {
    // 1050 minus a 232px tab list leaves 818, which cannot hold two 420px
    // columns. Hiding the list gives the content the whole window.
    const shown = resolveLayout({ mode: 'split', viewportWidth: 1050, verticalTabsOpen: true, verticalTabsWidth: 232 });
    const hidden = resolveLayout({ mode: 'split', viewportWidth: 1050, verticalTabsOpen: false });
    expect(shown.splitDeclined).toBe(true);
    expect(hidden.splitDeclined).toBeUndefined();
  });
});

describe('choosing the second pane', () => {
  const tabs = [
    { id: 'a', hasWebView: true, isNewTab: false, isInternalPage: false },
    { id: 'b', hasWebView: true, isNewTab: false, isInternalPage: false },
    { id: 'c', hasWebView: true, isNewTab: false, isInternalPage: false },
  ];

  it('takes the first website tab that is not the primary', () => {
    const result = resolveSplitTab(tabs, 'a');
    expect(result.ok).toBe(true);
    expect(result.tabId).toBe('b');
  });

  it('lists every tab it could use, so a caller can offer a choice', () => {
    const result = resolveSplitTab(tabs, 'a');
    expect(result.available).toEqual(['b', 'c']);
  });

  // The bug this found: the old version preferred the active tab, which is the
  // one already in the primary pane, so a split could show the same page twice.
  it('never puts the primary tab in the second pane', () => {
    for (const primary of ['a', 'b', 'c']) {
      const result = resolveSplitTab(tabs, primary);
      if (result.ok) expect(result.tabId).not.toBe(primary);
    }
  });

  // The other bug: a new tab has nothing to show, so it must never be chosen.
  it('never picks a new tab or a Novaris page', () => {
    const withSpecial = [
      tabs[0],
      { id: 'new', hasWebView: true, isNewTab: true, isInternalPage: false },
      { id: 'int', hasWebView: true, isNewTab: false, isInternalPage: true },
    ];
    const result = resolveSplitTab(withSpecial, 'none');
    expect(result.ok).toBe(true);
    expect(result.tabId).toBe('a');
  });

  it('needs a second website tab besides the primary', () => {
    // The only website tab is the one already showing, so there is nothing to put
    // beside it.
    expect(resolveSplitTab([tabs[0]], 'a').ok).toBe(false);
    expect(resolveSplitTab([], 'a').ok).toBe(false);
  });

  it('excludes new tab and internal pages, which have nothing to show beside', () => {
    const onlySpecial = [
      { id: 'new', hasWebView: true, isNewTab: true, isInternalPage: false },
      { id: 'int', hasWebView: false, isNewTab: false, isInternalPage: true },
    ];
    const result = resolveSplitTab(onlySpecial, 'new');
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/two website tabs/i);
  });
});
