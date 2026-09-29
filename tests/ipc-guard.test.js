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
// The trust root is the built renderer, not the whole application directory.
// It matches what electron/security.js will let the interface navigate to, so
// the two boundaries cannot disagree.
const RENDERER_ROOT = 'C:\\Program Files\\Novaris\\resources\\app\\dist';
const RENDERER_URL = 'file:///C:/Program%20Files/Novaris/resources/app/dist/index.html';
const rendererFrame = () => frame(RENDERER_URL);

describe('who may call a privileged channel', () => {
  it('allows the application renderer', () => {
    expect(validateIpcSender({ sender: sender(), senderFrame: rendererFrame() }, { rendererRoot: RENDERER_ROOT })).toBeNull();
  });

  // The main attack. A page in a webview has its own webContents and must never
  // reach a channel that can read the vault or fill a password.
  it('refuses a webview guest', () => {
    for (const type of DENIED_TYPES) {
      const event = { sender: sender(type), senderFrame: frame('https://example.com') };
      expect(validateIpcSender(event, { rendererRoot: RENDERER_ROOT })).toMatch(/may not call/);
    }
  });

  // An iframe inside our own interface is still a document we did not write.
  it('refuses a nested frame', () => {
    const event = {
      sender: sender(),
      senderFrame: frame('https://ads.example/frame.html', frame('file:///app/dist/index.html')),
    };
    expect(validateIpcSender(event, { rendererRoot: RENDERER_ROOT })).toMatch(/nested frames/);
  });

  it('refuses a web page however it is reached', () => {
    const event = { sender: sender(), senderFrame: frame('https://evil.example/') };
    expect(validateIpcSender(event, { rendererRoot: RENDERER_ROOT })).toMatch(/not by a web page/);
  });

  // A local HTML file is not the browser's interface, even though it is on this
  // machine and file:// like ours.
  it('refuses a file outside the application', () => {
    const event = { sender: sender(), senderFrame: frame('file:///C:/Users/someone/evil.html') };
    expect(validateIpcSender(event, { rendererRoot: RENDERER_ROOT })).toMatch(/Unexpected sender URL/);
  });

  it('refuses a message with no frame to check', () => {
    expect(validateIpcSender({ sender: sender() }, { rendererRoot: RENDERER_ROOT })).toMatch(/did not identify a frame/);
    expect(validateIpcSender({ senderFrame: frame('x') }, { rendererRoot: RENDERER_ROOT })).toMatch(/no sender/);
    expect(validateIpcSender(null, { rendererRoot: RENDERER_ROOT })).toMatch(/no sender/);
  });

  it('refuses a frame that reports no URL', () => {
    const event = { sender: sender(), senderFrame: { url: '', parent: null } };
    expect(validateIpcSender(event, { rendererRoot: RENDERER_ROOT })).toMatch(/no URL/);
  });

  it('allows the development server only when one is configured', () => {
    const event = { sender: sender(), senderFrame: frame('http://127.0.0.1:5173/index.html') };
    expect(validateIpcSender(event, { rendererRoot: RENDERER_ROOT })).toMatch(/not by a web page/);
    expect(validateIpcSender(event, { rendererRoot: RENDERER_ROOT, devServerUrl: 'http://127.0.0.1:5173' })).toBeNull();
  });

  // A page must not be able to reach the real interface through the dev server
  // origin, which would be an open door in every development build.
  it('does not let one origin authorise another', () => {
    const event = { sender: sender(), senderFrame: frame('https://127.0.0.1.evil.example/') };
    expect(validateIpcSender(event, { rendererRoot: RENDERER_ROOT, devServerUrl: 'http://127.0.0.1:5173' })).toMatch(/not by a web page/);
  });

  it('does not widen on a malformed dev server value', () => {
    const event = { sender: sender(), senderFrame: frame('http://127.0.0.1:5173/') };
    expect(validateIpcSender(event, { rendererRoot: RENDERER_ROOT, devServerUrl: 'not a url' })).toMatch(/not by a web page/);
  });
});

describe('the path check', () => {
  it('accepts a file inside the built renderer', () => {
    expect(isRendererFileUrl('file:///C:/Program%20Files/Novaris/resources/app/dist/index.html', RENDERER_ROOT)).toBe(true);
    expect(isRendererFileUrl('file:///C:/Program%20Files/Novaris/resources/app/dist/assets/index-a1b2c3.js', RENDERER_ROOT)).toBe(true);
  });

  it('refuses a file inside the application but outside the renderer', () => {
    // This is the case the narrower root was for. The navigation policy in
    // security.js refuses to load main-process source into the interface, so a
    // document there is not ours to trust either. With the application directory
    // as the root, this was accepted.
    expect(isRendererFileUrl('file:///C:/Program%20Files/Novaris/resources/app/electron/main.js', RENDERER_ROOT)).toBe(false);
    expect(isRendererFileUrl('file:///C:/Program%20Files/Novaris/resources/app/electron/preload.js', RENDERER_ROOT)).toBe(false);
    expect(isRendererFileUrl('file:///C:/Program%20Files/Novaris/resources/app/package.json', RENDERER_ROOT)).toBe(false);
  });

  it('agrees with the navigation policy about what our own document is', () => {
    // One boundary, not two. Anything the guard trusts is something the
    // interface is allowed to be, and vice versa.
    const { isAllowedRendererNavigation } = require('../electron/security.js');
    for (const url of [
      'file:///C:/Program%20Files/Novaris/resources/app/dist/index.html',
      'file:///C:/Program%20Files/Novaris/resources/app/dist/assets/index-a1b2c3.js',
      'file:///C:/Program%20Files/Novaris/resources/app/electron/main.js',
      'file:///C:/Users/someone/Downloads/page.html',
      'https://example.com',
    ]) {
      expect(isRendererFileUrl(url, RENDERER_ROOT), url)
        .toBe(isAllowedRendererNavigation(url, RENDERER_ROOT));
    }
  });

  it('refuses a path that escapes the application', () => {
    // The traversal shapes, rather than trusting the URL scheme alone.
    expect(isRendererFileUrl('file:///C:/Program%20Files/novaris/resources/app/../../../Windows/System32/drivers/etc/hosts', RENDERER_ROOT)).toBe(false);
    expect(isRendererFileUrl('file:///C:/Windows/System32/config/SAM', RENDERER_ROOT)).toBe(false);
  });

  it('refuses when no renderer root is known', () => {
    expect(isRendererFileUrl('file:///C:/Program%20Files/Novaris/resources/app/dist/index.html', '')).toBe(false);
  });

  it('refuses something that is not a URL at all', () => {
    for (const value of ['', null, undefined, 'not a url', 42, {}]) {
      expect(isRendererFileUrl(value, RENDERER_ROOT)).toBe(false);
    }
  });
});

describe('the guard around a listener', () => {
  it('runs the listener for a valid sender', async () => {
    const listener = guardIpcListener(async (_event, value) => `ok ${value}`, { rendererRoot: RENDERER_ROOT });
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
    const listener = guardIpcListener(async () => { called = true; }, { rendererRoot: RENDERER_ROOT });
    const bad = { sender: sender('webview'), senderFrame: frame('https://example.com') };
    await expect(listener(bad)).rejects.toThrow(/Blocked:/);
    expect(called).toBe(false);
  });

  it('passes the arguments through untouched', async () => {
    const listener = guardIpcListener(async (_event, a, b) => [a, b], { rendererRoot: RENDERER_ROOT });
    const good = { sender: sender(), senderFrame: rendererFrame() };
    await expect(listener(good, 1, 2)).resolves.toEqual([1, 2]);
  });
});
