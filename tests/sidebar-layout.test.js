import { describe, expect, it } from 'vitest';
import { APPS_RAIL_WIDTH, LAYOUT_MODES, allApps, findApp, resolveApps, resolveLayout, resolveSplitTab } from '../electron/sidebar-layout.js';

describe('Novaris split view: layout arithmetic', () => {
  it('gives the whole content area to a single view', () => {
    const layout = resolveLayout({ viewportWidth: 1600, verticalTabsOpen: true });
    expect(layout.mode).toBe(LAYOUT_MODES.single);
    expect(layout.content).toBe(1600 - 232);
    expect(layout.primary).toBe(layout.content);
    expect(layout.secondary).toBe(0);
  });

  it('splits evenly and keeps both columns readable', () => {
    const layout = resolveLayout({ mode: LAYOUT_MODES.split, viewportWidth: 1800, verticalTabsOpen: true });
    expect(layout.mode).toBe(LAYOUT_MODES.split);
    expect(layout.splitDeclined).toBeUndefined();
    expect(layout.primary).toBeGreaterThan(400);
    expect(layout.secondary).toBeGreaterThan(400);
    // The two columns plus the gap must exactly fill the content area.
    expect(layout.primary + layout.secondary + layout.gap).toBe(layout.content);
  });

  it('refuses a split that would produce unreadable slivers', () => {
    const layout = resolveLayout({ mode: LAYOUT_MODES.split, viewportWidth: 700, verticalTabsOpen: false });
    expect(layout.mode).toBe(LAYOUT_MODES.single);
    expect(layout.splitDeclined).toBe(true);
    expect(layout.reason).toMatch(/wider window/i);
  });

  it('names the panel that is in the way, rather than only saying be wider', () => {
    const withBoth = resolveLayout({ mode: LAYOUT_MODES.split, viewportWidth: 900, appsOpen: true, verticalTabsOpen: true });
    expect(withBoth.splitDeclined).toBe(true);
    expect(withBoth.reason).toMatch(/side panel/i);

    const withTabs = resolveLayout({ mode: LAYOUT_MODES.split, viewportWidth: 900, appsOpen: false, verticalTabsOpen: true });
    expect(withTabs.reason).toMatch(/tab list/i);

    const withNothing = resolveLayout({ mode: LAYOUT_MODES.split, viewportWidth: 700, appsOpen: false, verticalTabsOpen: false });
    expect(withNothing.reason).toMatch(/wider window/i);
  });

  it('still allows a split that only just fits, with no panels open', () => {
    // 900 pixels with nothing reserved is enough for two readable columns, so
    // this must not be refused.
    const layout = resolveLayout({ mode: LAYOUT_MODES.split, viewportWidth: 900, appsOpen: false, verticalTabsOpen: false });
    expect(layout.splitDeclined).toBeUndefined();
    expect(layout.mode).toBe(LAYOUT_MODES.split);
  });

  it('accounts for the tab list and the apps rail in the reserved space', () => {
    const layout = resolveLayout({ viewportWidth: 2000, appsOpen: true, verticalTabsOpen: true });
    expect(layout.reserved).toBe(232 + APPS_RAIL_WIDTH);
    expect(layout.content).toBe(2000 - layout.reserved);
  });

  it('never returns negative widths, whatever it is given', () => {
    for (const width of [0, -500, 1, NaN, undefined, null, 'x']) {
      const layout = resolveLayout({ mode: LAYOUT_MODES.split, viewportWidth: width });
      expect(layout.content).toBeGreaterThanOrEqual(0);
      expect(layout.primary).toBeGreaterThanOrEqual(0);
      expect(layout.secondary).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('Novaris split view: choosing the second pane', () => {
  const web = (id) => ({ id, hasWebView: true, isInternalPage: false });
  const internal = { id: 'i', hasWebView: false, isInternalPage: true };
  const newTab = { id: 'n', hasWebView: true, isNewTab: true, isInternalPage: false };

  // The pane that is already showing is the primary one, so the second pane is
  // always a different tab. An earlier version preferred the active tab here,
  // which meant a split could show the same page twice.
  it('never picks the tab that is already the first pane', () => {
    const result = resolveSplitTab([web('a'), web('b'), web('c')], 'b');
    expect(result.ok).toBe(true);
    expect(result.tabId).toBe('a');
    expect(result.available).toEqual(['a', 'c']);
  });

  it('refuses when the only website tab is the one already showing', () => {
    expect(resolveSplitTab([web('a'), internal], 'a')).toMatchObject({ ok: false });
    expect(resolveSplitTab([web('a'), internal], 'a').reason).toMatch(/two website tabs/i);
  });

  it('refuses when there is no website tab at all', () => {
    expect(resolveSplitTab([internal], 'i')).toMatchObject({ ok: false });
    expect(resolveSplitTab([], undefined).reason).toMatch(/two website tabs/i);
  });

  it('does not offer a new tab as the second pane', () => {
    const result = resolveSplitTab([web('a'), newTab], 'a');
    expect(result.tabId).toBeUndefined();
    expect(result.ok).toBe(false);
  });
});

describe('Novaris sidebar apps', () => {
  it('ships the built-in apps the request named', () => {
    const ids = allApps([]).map((app) => app.id);
    for (const wanted of ['discord', 'youtube', 'spotify', 'canvas']) {
      expect(ids).toContain(wanted);
    }
  });

  it('keeps a custom app separate from the built-in ones', () => {
    const { builtIn, custom } = resolveApps([{ id: 'myapp', name: 'Mine', url: 'https://mine.test/' }]);
    expect(custom).toHaveLength(1);
    expect(custom[0].custom).toBe(true);
    // A custom app is never marked pinned, because pinning is a Novaris choice.
    expect(custom[0].pinned).toBe(false);
    expect(builtIn.every((app) => !app.custom)).toBe(true);
  });

  it('drops malformed custom apps instead of rendering them', () => {
    const { custom } = resolveApps([
      { id: 'ok', url: 'https://ok.test/' },
      { url: 'https://no-id.test/' },
      { id: 'no-url' },
      null,
      'nonsense',
      { id: 'x', url: 'https://x.test/', color: 'red' },
    ]);
    expect(custom.map((app) => app.id)).toEqual(['ok', 'x']);
    // An unrecognised colour falls back rather than reaching the style attribute.
    expect(custom[1].color).toBe('#7c8cff');
  });

  it('finds an app by id from either list', () => {
    expect(findApp([], 'spotify').name).toBe('Spotify');
    expect(findApp([{ id: 'mine', url: 'https://mine.test/' }], 'mine').name).toBe('mine');
    expect(findApp([], 'ghost')).toBeNull();
  });
});
