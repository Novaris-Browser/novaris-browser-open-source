import { describe, expect, it } from 'vitest';
import {
  DENIED_TYPES,
  guardIpcListener,
  isRendererFileUrl,
  validateIpcSender,
} from '../electron/ipc-guard.js';

// The renderer runs with the privileges of the browser itself, so the only
// thing standing between a compromised page and the vault is this check. Each
// case below is a way a message could arrive from somewhere it should not.
const frame = (url, parent = null) => ({ url, parent });
const sender = (type = 'window') => ({ getType: () => type });

// A Windows install path, because that is where this runs. The check is
// path-based, so the platform matters and the tests have to use a real one.
const APP_ROOT = 'C:\\Program Files\\Novaris\\resources\\app';
const RENDERER_URL = 'file:///C:/Program%20Files/Novaris/resources/app/dist/index.html';
const rendererFrame = () => frame(RENDERER_URL);

describe('who may call a privileged channel', () => {
  it('allows the application renderer', () => {
    expect(validateIpcSender({ sender: sender(), senderFrame: rendererFrame() }, { appRoot: APP_ROOT })).toBeNull();
  });

  // The main attack. A page in a webview has its own webContents and must never
  // reach a channel that can read the vault or fill a password.
  it('refuses a webview guest', () => {
    for (const type of DENIED_TYPES) {
      const event = { sender: sender(type), senderFrame: frame('https://example.com') };
      expect(validateIpcSender(event, { appRoot: APP_ROOT })).toMatch(/may not call/);
    }
  });

  // An iframe inside our own interface is still a document we did not write.
  it('refuses a nested frame', () => {
    const event = {
      sender: sender(),
      senderFrame: frame('https://ads.example/frame.html', frame('file:///app/dist/index.html')),
    };
    expect(validateIpcSender(event, { appRoot: APP_ROOT })).toMatch(/nested frames/);
  });

  it('refuses a web page however it is reached', () => {
    const event = { sender: sender(), senderFrame: frame('https://evil.example/') };
    expect(validateIpcSender(event, { appRoot: APP_ROOT })).toMatch(/not by a web page/);
  });

  // A local HTML file is not the browser's interface, even though it is on this
  // machine and file:// like ours.
  it('refuses a file outside the application', () => {
    const event = { sender: sender(), senderFrame: frame('file:///C:/Users/someone/evil.html') };
    expect(validateIpcSender(event, { appRoot: APP_ROOT })).toMatch(/Unexpected sender URL/);
  });

  it('refuses a message with no frame to check', () => {
    expect(validateIpcSender({ sender: sender() }, { appRoot: APP_ROOT })).toMatch(/did not identify a frame/);
    expect(validateIpcSender({ senderFrame: frame('x') }, { appRoot: APP_ROOT })).toMatch(/no sender/);
    expect(validateIpcSender(null, { appRoot: APP_ROOT })).toMatch(/no sender/);
  });

  it('refuses a frame that reports no URL', () => {
    const event = { sender: sender(), senderFrame: { url: '', parent: null } };
    expect(validateIpcSender(event, { appRoot: APP_ROOT })).toMatch(/no URL/);
  });

  it('allows the development server only when one is configured', () => {
    const event = { sender: sender(), senderFrame: frame('http://127.0.0.1:5173/index.html') };
    expect(validateIpcSender(event, { appRoot: APP_ROOT })).toMatch(/not by a web page/);
    expect(validateIpcSender(event, { appRoot: APP_ROOT, devServerUrl: 'http://127.0.0.1:5173' })).toBeNull();
  });

  // A page must not be able to reach the real interface through the dev server
  // origin, which would be an open door in every development build.
  it('does not let one origin authorise another', () => {
    const event = { sender: sender(), senderFrame: frame('https://127.0.0.1.evil.example/') };
    expect(validateIpcSender(event, { appRoot: APP_ROOT, devServerUrl: 'http://127.0.0.1:5173' })).toMatch(/not by a web page/);
  });

  it('does not widen on a malformed dev server value', () => {
    const event = { sender: sender(), senderFrame: frame('http://127.0.0.1:5173/') };
    expect(validateIpcSender(event, { appRoot: APP_ROOT, devServerUrl: 'not a url' })).toMatch(/not by a web page/);
  });
});

describe('the path check', () => {
  it('accepts a file inside the application', () => {
    expect(isRendererFileUrl('file:///C:/Program%20Files/Novaris/resources/app/dist/index.html', APP_ROOT)).toBe(true);
  });

  it('refuses a path that escapes the application', () => {
    // The traversal shapes, rather than trusting the URL scheme alone.
    expect(isRendererFileUrl('file:///C:/Program%20Files/novaris/resources/app/../../../Windows/System32/drivers/etc/hosts', APP_ROOT)).toBe(false);
    expect(isRendererFileUrl('file:///C:/Windows/System32/config/SAM', APP_ROOT)).toBe(false);
  });

  it('refuses when no application root is known', () => {
    expect(isRendererFileUrl('file:///C:/Program%20Files/Novaris/resources/app/dist/index.html', '')).toBe(false);
  });

  it('refuses something that is not a URL at all', () => {
    for (const value of ['', null, undefined, 'not a url', 42, {}]) {
      expect(isRendererFileUrl(value, APP_ROOT)).toBe(false);
    }
  });
});

describe('the guard around a listener', () => {
  it('runs the listener for a valid sender', async () => {
    const listener = guardIpcListener(async (_event, value) => `ok ${value}`, { appRoot: APP_ROOT });
    const good = {
      sender: sender(),
      senderFrame: rendererFrame(),
    };
    await expect(listener(good, 'x')).resolves.toBe('ok x');
  });

  // A rejection, not a silent undefined: the caller can tell the difference
  // between "refused" and "nothing happened".
  it('rejects rather than calling through, and says why', async () => {
    let called = false;
    const listener = guardIpcListener(async () => { called = true; }, { appRoot: APP_ROOT });
    const bad = { sender: sender('webview'), senderFrame: frame('https://example.com') };
    await expect(listener(bad)).rejects.toThrow(/Blocked:/);
    expect(called).toBe(false);
  });

  it('passes the arguments through untouched', async () => {
    const listener = guardIpcListener(async (_event, a, b) => [a, b], { appRoot: APP_ROOT });
    const good = { sender: sender(), senderFrame: rendererFrame() };
    await expect(listener(good, 1, 2)).resolves.toEqual([1, 2]);
  });
});
