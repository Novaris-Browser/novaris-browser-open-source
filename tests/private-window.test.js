import { describe, expect, it, vi } from 'vitest';

// The Electron module is stubbed for unit tests, so the private window factory is
// exercised through that stub rather than a real BrowserWindow.
vi.mock('electron', async () => {
  const actual = await vi.importActual('../tests/stubs/electron.mjs');
  return actual;
});

const { PRIVATE_PREFIX, isPrivatePartition, newPrivatePartition, privateWebPreferences, hardenPrivateSession } = await import('../electron/private-window.js');

describe('Novaris private windows: partition isolation', () => {
  it('gives every window its own partition so they cannot see each other', () => {
    const first = newPrivatePartition();
    const second = newPrivatePartition();
    expect(first).not.toBe(second);
    expect(first).toMatch(/^private-/);
    expect(second).toMatch(/^private-/);
  });

  it('recognises its own partitions and refuses anyone else', () => {
    expect(isPrivatePartition(`private-abc`)).toBe(true);
    expect(isPrivatePartition(newPrivatePartition())).toBe(true);
    // The profile's real partition must never be treated as disposable.
    expect(isPrivatePartition('persist:novaris')).toBe(false);
    expect(isPrivatePartition(PRIVATE_PREFIX)).toBe(false);
    expect(isPrivatePartition('')).toBe(false);
    expect(isPrivatePartition(null)).toBe(false);
    expect(isPrivatePartition(undefined)).toBe(false);
    expect(isPrivatePartition(42)).toBe(false);
  });
});

describe('Novaris private windows: tightened preferences', () => {
  it('keeps every security boundary the normal window has', () => {
    const prefs = privateWebPreferences({ preloadPath: 'x', developerTools: false });
    expect(prefs.sandbox).toBe(true);
    expect(prefs.contextIsolation).toBe(true);
    expect(prefs.nodeIntegration).toBe(false);
    expect(prefs.webSecurity).toBe(true);
    expect(prefs.allowRunningInsecureContent).toBe(false);
  });

  it('locks down what a private window does not need', () => {
    const prefs = privateWebPreferences({ preloadPath: 'x' });
    // No nested webviews, so a private page cannot open a view that would
    // inherit or leak the session.
    expect(prefs.webviewTag).toBe(false);
    expect(prefs.spellcheck).toBe(false);
    expect(prefs.partition).toMatch(new RegExp(`^${PRIVATE_PREFIX}`));
  });

  it('still honours developer tools, which is not a privacy control', () => {
    expect(privateWebPreferences({ developerTools: true }).devTools).toBe(true);
    expect(privateWebPreferences({ developerTools: false }).devTools).toBe(false);
  });
});

describe('Novaris private windows: session hardening', () => {
  function fakeSession() {
    return {
      requestHandler: null,
      checkHandler: null,
      setPermissionRequestHandler(fn) { this.requestHandler = fn; },
      setPermissionCheckHandler(fn) { this.checkHandler = fn; },
    };
  }

  it('refuses notifications and background sync in a private window', () => {
    const s = fakeSession();
    hardenPrivateSession(s);
    for (const permission of ['notifications', 'background-sync', 'background-fetch', 'periodic-background-sync']) {
      let requestAnswer = null;
      // The request handler takes a callback; the check handler returns a value.
      // Both are exercised, because Electron uses one for asking and one for
      // checking, and a page can hit either.
      s.requestHandler(null, permission, (value) => { requestAnswer = value; });
      expect(requestAnswer).toBe(false);
      expect(s.checkHandler(null, permission, 'https://example.test')).toBe(false);
    }
  });

  it('does not blanket-deny permissions a page legitimately needs to work', () => {
    // Denying everything would break video calls and logins, which is not what a
    // private window is for. Only the identifying and notifying ones are refused.
    const s = fakeSession();
    hardenPrivateSession(s);
    let answer = null;
    s.requestHandler(null, 'clipboard-read', (value) => { answer = value; });
    expect(answer).toBe(true);
  });

  it('survives a session that refuses to register handlers', () => {
    const hostile = { setPermissionRequestHandler() { throw new Error('nope'); } };
    expect(() => hardenPrivateSession(hostile)).not.toThrow();
  });
});
