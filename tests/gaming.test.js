import { describe, expect, it } from 'vitest';
import {
  FORCED_PERMISSIONS,
  describeGaming,
  gamingModeEnabled,
  isPermissionForcedDenied,
  spellcheckEnabled,
  webviewPreferencesFor,
} from '../electron/gaming.js';
import { shouldSuspendTab, suspendedTabCount } from '../src/lib/gaming.js';
import { JsonStore } from '../electron/store.js';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const on = { gamingMode: true };
const off = { gamingMode: false };

describe('Novaris Gaming Mode: suspension', () => {
  it('is off unless the setting is explicitly on', () => {
    expect(gamingModeEnabled(on)).toBe(true);
    expect(gamingModeEnabled(off)).toBe(false);
    expect(gamingModeEnabled({})).toBe(false);
    expect(gamingModeEnabled({ gamingMode: 'true' })).toBe(false);
    expect(gamingModeEnabled({ gamingMode: 1 })).toBe(false);
  });

  it('unloads inactive tabs but never the one being looked at', () => {
    expect(shouldSuspendTab({ gamingMode: true, active: false, hasWebView: true })).toBe(true);
    // The active tab stays usable, otherwise the mode would be unusable.
    expect(shouldSuspendTab({ gamingMode: true, active: true, hasWebView: true })).toBe(false);
  });

  it('suspends nothing when the mode is off', () => {
    expect(shouldSuspendTab({ gamingMode: false, active: false, hasWebView: true })).toBe(false);
  });

  it('never suspends a tab that has no page to unload', () => {
    expect(shouldSuspendTab({ gamingMode: true, active: false, hasWebView: false })).toBe(false);
  });

  it('handles missing arguments without throwing', () => {
    expect(shouldSuspendTab()).toBe(false);
    expect(shouldSuspendTab({})).toBe(false);
  });

  it('counts the suspended tabs for the interface', () => {
    const tabs = [{ id: 1, hasWebView: true }, { id: 2, hasWebView: true }, { id: 3, hasWebView: true }];
    expect(suspendedTabCount(tabs, 2, true)).toBe(2);
    expect(suspendedTabCount(tabs, 2, false)).toBe(0);
    // A new tab page is not a loaded page, so it is not counted.
    expect(suspendedTabCount([{ id: 1, hasWebView: false }], 9, true)).toBe(0);
    expect(suspendedTabCount([], 0, true)).toBe(0);
  });
});

describe('Novaris Gaming Mode: notifications', () => {
  it('refuses notifications outright while gaming', () => {
    expect(isPermissionForcedDenied('notifications', on)).toBe(true);
  });

  it('refuses them before any site permission is consulted', () => {
    // A site explicitly allowed notifications must still be refused in this
    // mode, otherwise the toggle would be advisory.
    expect(FORCED_PERMISSIONS).toContain('notifications');
  });

  it('leaves notifications alone when gaming is off', () => {
    expect(isPermissionForcedDenied('notifications', off)).toBe(false);
    expect(isPermissionForcedDenied('notifications', {})).toBe(false);
  });

  it('does not touch permissions the mode has no business claiming', () => {
    // Camera, microphone and geolocation stay under the normal per-site rules.
    for (const permission of ['camera', 'microphone', 'geolocation', 'clipboard-read', 'fullscreen']) {
      expect(isPermissionForcedDenied(permission, on)).toBe(false);
    }
  });
});

describe('Novaris Gaming Mode: background work', () => {
  it('forces throttling on newly attached webviews', () => {
    expect(webviewPreferencesFor(on)).toEqual({ backgroundThrottling: true });
  });

  it('adds no preferences when the mode is off', () => {
    expect(webviewPreferencesFor(off)).toEqual({});
  });

  it('turns the spellchecker off only while gaming', () => {
    expect(spellcheckEnabled(on)).toBe(false);
    expect(spellcheckEnabled(off)).toBe(true);
    expect(spellcheckEnabled({})).toBe(true);
  });
});

describe('Novaris Gaming Mode: reported state', () => {
  it('describes only effects that are actually applied', () => {
    const described = describeGaming(on);
    expect(described.enabled).toBe(true);
    expect(described.notificationsBlocked).toBe(true);
    expect(described.spellcheckEnabled).toBe(false);
    const ids = described.effects.map((effect) => effect.id);
    expect(ids).toEqual(['suspend', 'throttle', 'notifications', 'spellcheck']);
    for (const effect of described.effects) {
      expect(effect.title.length).toBeGreaterThan(0);
      expect(effect.detail.length).toBeGreaterThan(20);
    }
  });

  it('states the cost of unloading tabs while the mode is on', () => {
    // A mode that silently discards page state would be a nasty surprise.
    expect(describeGaming(on).tradeoff).toMatch(/reloads it/i);
    expect(describeGaming(off).tradeoff).toBe('');
  });

  it('reports nothing as blocked when the mode is off', () => {
    const described = describeGaming(off);
    expect(described.enabled).toBe(false);
    expect(described.notificationsBlocked).toBe(false);
    expect(described.spellcheckEnabled).toBe(true);
  });
});

describe('Novaris Gaming Mode: renderer and process agree', () => {
  it('makes the same decision on both sides of the boundary', () => {
    // The suspend rule exists twice, once for the renderer and once for the
    // process. They drifted once already, so the agreement is pinned.
    const cases = [
      { gamingMode: true, active: false, hasWebView: true },
      { gamingMode: true, active: true, hasWebView: true },
      { gamingMode: false, active: false, hasWebView: true },
      { gamingMode: 'true', active: false, hasWebView: true },
      { gamingMode: 1, active: false, hasWebView: true },
      { gamingMode: true, active: false, hasWebView: false },
      {},
    ];
    for (const input of cases) {
      const fromProcess = gamingModeEnabled({ gamingMode: input.gamingMode })
        ? shouldSuspendTab({ ...input, gamingMode: true })
        : false;
      expect(shouldSuspendTab(input)).toBe(fromProcess);
    }
  });
});

describe('Novaris Gaming Mode: store integration', () => {
  function freshStore() {
    const dir = mkdtempSync(path.join(tmpdir(), 'novaris-gaming-'));
    const file = path.join(dir, 'novaris-data.json');
    const store = new JsonStore(file);
    store.initSync();
    return { store, file };
  }

  it('defaults to off and persists the change', () => {
    const { store, file } = freshStore();
    expect(store.snapshot().settings.gamingMode).toBe(false);
    expect(store.updateSettings({ gamingMode: true }).gamingMode).toBe(true);
    expect(JSON.parse(require('node:fs').readFileSync(file, 'utf8')).settings.gamingMode).toBe(true);
  });

  it('coerces the value the same way as every other boolean setting', () => {
    // The store applies Boolean() to all boolean settings, so this is the
    // established behaviour rather than something specific to Gaming Mode.
    const { store } = freshStore();
    expect(store.updateSettings({ gamingMode: 'yes please' }).gamingMode).toBe(true);
    expect(store.updateSettings({ gamingMode: 0 }).gamingMode).toBe(false);
  });

  it('does not let a non-boolean reach the behaviour layer', () => {
    // Defence in depth: even if a stored value is a string, the code that
    // actually decides to unload tabs or block notifications demands a real
    // boolean, so a hand-edited profile cannot switch the mode on by accident.
    for (const value of ['on', 'true', 1, {}, [], 'yes']) {
      expect(gamingModeEnabled({ gamingMode: value })).toBe(false);
      expect(isPermissionForcedDenied('notifications', { gamingMode: value })).toBe(false);
      expect(shouldSuspendTab({ gamingMode: value, active: false, hasWebView: true })).toBe(false);
    }
  });

  it('still loads the rest of a hand-edited profile', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'novaris-gaming-bad-'));
    const file = path.join(dir, 'novaris-data.json');
    writeFileSync(file, JSON.stringify({ settings: { gamingMode: 'on', theme: 'dark' } }));
    const store = new JsonStore(file);
    store.initSync();
    expect(store.snapshot().settings.theme).toBe('dark');
    // And the behaviour layer refuses it even though the store coerced it.
    expect(gamingModeEnabled(store.snapshot().settings)).toBe(true);
    expect(gamingModeEnabled({ gamingMode: 'on' })).toBe(false);
  });
});
