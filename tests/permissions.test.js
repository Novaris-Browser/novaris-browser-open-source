import { describe, expect, it } from 'vitest';
import { classifyPermission, isGrantablePermission, isSecureOrigin } from '../electron/security.js';

describe('which permissions Novaris will grant', () => {
  it('refuses the ones no browser feature needs', () => {
    // These are what anything hostile asks for first, and nothing in Novaris is
    // built on any of them.
    for (const permission of ['openExternal', 'hid', 'serial', 'usb', 'mediaKeySystem', 'pointerLock', 'speaker-selection', 'top-level-storage-access', 'midiSysex']) {
      expect(classifyPermission(permission)).toBe('denied');
      expect(isGrantablePermission(permission)).toBe(false);
    }
  });

  it('asks first for the ones a site can reasonably want', () => {
    for (const permission of ['camera', 'microphone', 'geolocation', 'notifications', 'clipboard-read', 'display-capture', 'midi', 'persistent-storage']) {
      expect(classifyPermission(permission)).toBe('ask');
      expect(isGrantablePermission(permission)).toBe(true);
    }
  });

  it('handles the media permission families', () => {
    for (const permission of ['media', 'clipboard-read', 'clipboard-sanitized-write']) {
      expect(isGrantablePermission(permission)).toBe(true);
    }
  });

  // The important default. A permission Chromium adds in a future version has to
  // be refused, not handed out because nobody enumerated it.
  it('refuses a permission nobody has classified', () => {
    for (const permission of ['somethingNew', 'aura-sensing', 'future-thing', '']) {
      expect(isGrantablePermission(permission)).toBe(false);
    }
  });

  it('does not throw on odd input', () => {
    for (const value of [null, undefined, 0, {}, []]) {
      expect(() => classifyPermission(value)).not.toThrow();
    }
  });
});

describe('which origins may hold a permission', () => {
  it('accepts https', () => {
    expect(isSecureOrigin('https://example.com')).toBe(true);
  });

  it('accepts loopback, which the platform treats as secure', () => {
    for (const origin of ['http://localhost:5173', 'http://127.0.0.1:8080', 'http://[::1]:3000']) {
      expect(isSecureOrigin(origin)).toBe(true);
    }
  });

  // A permission handed to a page delivered in the clear is a permission handed
  // to whoever is on the path, since they can serve a different page.
  it('refuses plain http on a real host', () => {
    expect(isSecureOrigin('http://example.com')).toBe(false);
    expect(isSecureOrigin('http://192.168.1.5')).toBe(false);
  });

  it('refuses anything that is not a URL', () => {
    for (const value of ['', null, undefined, 'not a url', 'file:///tmp/x', 'about:blank', 'data:text/html,x']) {
      expect(isSecureOrigin(value)).toBe(false);
    }
  });

  // A hostname that merely contains a loopback string must not pass.
  it('refuses a host that only looks like loopback', () => {
    expect(isSecureOrigin('http://localhost.evil.example')).toBe(false);
    expect(isSecureOrigin('http://127.0.0.1.evil.example')).toBe(false);
  });
});
