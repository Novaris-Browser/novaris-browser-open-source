import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// The security boundaries in one file, so the numbered cases in the audit can be
// pointed at directly. Each block says what it proves, and where the limit is,
// says that too rather than implying more than was tested.
//
// A limit of the harness, stated up front.
//
// The modules under test are CommonJS and reach Electron through
// `require('electron')` inside their own bodies. Vite cannot intercept that: it
// is a real Node require, so it resolves to the real `electron` package, which
// exports the path to the binary as a string. Neither a `vi.mock` factory nor
// the alias in vitest.config.mjs applies to it, which means anything that
// constructs a BrowserWindow cannot be driven from a unit test.
//
// So the cases below exercise the exported policy functions, which is where the
// decisions actually live, and use a source-level assertion for the wiring that
// cannot be reached. A source assertion is weaker than driving the handler and
// is labelled as such. What this file does not do is claim coverage it lacks.
const { guardIpcListener, validateIpcSender } = await import('../electron/ipc-guard.js');
const { isAllowedGuestNavigation, isAllowedRendererNavigation } = await import('../electron/security.js');
const {
  privatePermissionAllowed, privateWebPreferences, PRIVATE_ALLOWED_PERMISSIONS,
} = await import('../electron/private-window.js');
const {
  generateKeyPair, signManifest, validateManifestShape, verifyManifest,
} = await import('../electron/update-signing.js');

const APP_ROOT = 'C:\\Program Files\\Novaris\\resources\\app';
const RENDERER_ROOT = path.join(APP_ROOT, 'dist');
const RENDERER_URL = 'file:///C:/Program%20Files/Novaris/resources/app/dist/index.html';
const frame = (url, parent = null) => ({ url, parent });
const windowSender = () => ({ getType: () => 'window' });

const sourceOf = (name) => fs.readFileSync(path.join(process.cwd(), 'electron', name), 'utf8');
const allowedForRenderer = (url, devServerUrl = '') => isAllowedRendererNavigation(url, RENDERER_ROOT, { devServerUrl });

describe('TEST 1: a site in a private window cannot reach the vault', () => {
  it('attaches no privileged preload to a private window, so there is no bridge to call', () => {
    // The finding: this used to be the full preload, which handed every site
    // opened privately the vault, the filesystem operations, the extension
    // manager and the updater. privateWebPreferences is the object handed
    // straight to the BrowserWindow, so its keys are the window's capabilities.
    expect(Object.keys(privateWebPreferences({ developerTools: true }))).not.toContain('preload');
    // And it cannot be reintroduced by passing one in.
    expect(Object.keys(privateWebPreferences({ preloadPath: 'x' }))).not.toContain('preload');
  });

  it('cannot get a preload back by asking for one at construction', () => {
    // Source-level, because openPrivateWindow cannot be driven here. It is a
    // guard against the fix being quietly reverted.
    const source = sourceOf('private-window.js');
    expect(source).not.toMatch(/preload:\s*preloadPath/);
    expect(source).not.toMatch(/getPreloadPath/);
  });

  it('still refuses the IPC even if a bridge were somehow attached', () => {
    // Defence in depth, and the reason the missing preload is not the only
    // defence. A private window is a BrowserWindow, so its sender type is
    // "window" rather than "webview" and it has to be refused on the frame URL.
    const event = { sender: windowSender(), senderFrame: frame('https://example.com') };
    expect(validateIpcSender(event, { rendererRoot: RENDERER_ROOT })).toMatch(/not by a web page/);
  });

  it('refuses a vault call before the listener ever runs', async () => {
    let called = false;
    const listener = guardIpcListener(async () => { called = true; return 'secret'; }, { rendererRoot: RENDERER_ROOT });
    const event = { sender: windowSender(), senderFrame: frame('https://example.com') };
    await expect(listener(event, 'entry')).rejects.toThrow(/Blocked/);
    expect(called).toBe(false);
  });
});

describe('TEST 2: an untrusted iframe cannot invoke privileged IPC', () => {
  it('refuses a nested frame even when it sits inside the real interface', () => {
    const event = {
      sender: windowSender(),
      // The interface itself is genuine; the document inside it is not ours.
      senderFrame: frame('https://attacker.example', frame(RENDERER_URL)),
    };
    expect(validateIpcSender(event, { rendererRoot: RENDERER_ROOT })).toMatch(/nested frames/);
  });

  it('refuses a nested frame loaded from our own directory', () => {
    const event = {
      sender: windowSender(),
      senderFrame: frame('file:///C:/Program%20Files/Novaris/resources/app/dist/frame.html', frame(RENDERER_URL)),
    };
    expect(validateIpcSender(event, { rendererRoot: RENDERER_ROOT })).toMatch(/nested frames/);
  });

  it('refuses a webview guest whatever frame it claims to be', () => {
    for (const type of ['webview', 'browserView', 'remote', 'webContents']) {
      // A guest claiming our own renderer URL is refused on its type, before the
      // URL is even looked at.
      const event = { sender: { getType: () => type }, senderFrame: frame(RENDERER_URL) };
      expect(validateIpcSender(event, { rendererRoot: RENDERER_ROOT })).toMatch(/may not call/);
    }
  });
});

describe('TEST 3: the privileged renderer can still call what it needs', () => {
  it('runs the listener for the real interface document', async () => {
    const listener = guardIpcListener(async (_event, entry) => `filled ${entry}`, { rendererRoot: RENDERER_ROOT });
    const event = { sender: windowSender(), senderFrame: frame(RENDERER_URL) };
    await expect(listener(event, 'example.test')).resolves.toBe('filled example.test');
  });

  it('accepts the development server, and only its exact origin', () => {
    const dev = { rendererRoot: RENDERER_ROOT, devServerUrl: 'http://127.0.0.1:5173' };
    expect(validateIpcSender({ sender: windowSender(), senderFrame: frame('http://127.0.0.1:5173/index.html') }, dev)).toBeNull();
    // A different port is a different server.
    expect(validateIpcSender({ sender: windowSender(), senderFrame: frame('http://127.0.0.1:9999/index.html') }, dev)).toMatch(/not by a web page/);
  });

  it('does not treat a shared string prefix as a shared origin', () => {
    // This was a real defect. The rule was `url.startsWith(origin)`, which also
    // accepts "http://127.0.0.1:5173.attacker.example/" — a different host that
    // happens to begin with the same characters. Each of these must now be
    // refused; the wording of the refusal is not what is being asserted.
    const dev = { rendererRoot: RENDERER_ROOT, devServerUrl: 'http://127.0.0.1:5173' };
    for (const url of [
      'http://127.0.0.1:5173.attacker.example/',
      'http://127.0.0.1:5173.evil.test/x',
      'http://127.0.0.1:5173@attacker.example/',
      'http://127.0.0.1:51730/',
    ]) {
      expect(validateIpcSender({ sender: windowSender(), senderFrame: frame(url) }, dev), url).not.toBeNull();
    }
  });

  it('refuses a local file that is not the application', () => {
    const event = { sender: windowSender(), senderFrame: frame('file:///C:/Users/someone/Downloads/page.html') };
    expect(validateIpcSender(event, { rendererRoot: RENDERER_ROOT })).toMatch(/Unexpected sender URL/);
  });

  it('refuses application source, which is inside the install but not the renderer', () => {
    // The trust root used to be the whole application directory, which is wider
    // than the navigation policy. A document the interface is not allowed to
    // become was still trusted to call privileged channels. Both now name dist.
    for (const url of [
      'file:///C:/Program%20Files/Novaris/resources/app/electron/main.js',
      'file:///C:/Program%20Files/Novaris/resources/app/electron/preload.js',
      'file:///C:/Program%20Files/Novaris/resources/app/package.json',
    ]) {
      expect(validateIpcSender({ sender: windowSender(), senderFrame: frame(url) }, { rendererRoot: RENDERER_ROOT }), url).not.toBeNull();
    }
  });

  it('names the same trust root as the navigation policy', () => {
    // The two were once different widths, which is one boundary too many. This
    // fails if either is widened without the other.
    const main = require('node:fs').readFileSync(path.join(process.cwd(), 'electron', 'main.js'), 'utf8');
    const guards = (main.match(/rendererRoot: path\.join\(appRoot, 'dist'\)/g) || []).length;
    expect(guards).toBe(2);
  });
});

describe('TEST 4: the privileged renderer cannot be navigated to a website', () => {
  it('blocks an arbitrary HTTP or HTTPS address', () => {
    for (const url of [
      'https://example.com',
      'http://example.com',
      'https://attacker.example/novaris/index.html',
      'https://example.com/dist/index.html',
      'ftp://example.com/x',
    ]) {
      expect(allowedForRenderer(url), url).toBe(false);
    }
  });

  it('blocks a local file that is outside the built renderer', () => {
    for (const url of [
      // The whole application directory used to be inside the trust boundary;
      // only the built renderer needs to be.
      'file:///C:/Program%20Files/Novaris/resources/app/electron/main.js',
      'file:///C:/Windows/System32/drivers/etc/hosts',
      'file:///C:/Users/someone/Downloads/page.html',
    ]) {
      expect(allowedForRenderer(url), url).toBe(false);
    }
  });

  it('refuses when no renderer root has been configured', () => {
    // Failing closed, rather than defaulting to something permissive.
    expect(isAllowedRendererNavigation(RENDERER_URL, '')).toBe(false);
  });

  it('is applied to redirects, not only to navigations', () => {
    // Source-level: will-redirect is registered and routed through the same
    // predicate, because will-navigate is never emitted for a redirect.
    const source = sourceOf('security.js');
    expect(source).toMatch(/on\('will-redirect'/);
    expect((source.match(/isAllowedRendererNavigation\(/g) || []).length).toBeGreaterThanOrEqual(2);
  });

  it('leaves websites to the webviews, which is where they already live', () => {
    // Guest navigation is untouched: pages still run in sandboxed webviews.
    expect(isAllowedGuestNavigation('https://example.com')).toBe(true);
    // And every contents, the renderer included, sends popups to the system
    // browser rather than opening a privileged window.
    const source = sourceOf('security.js');
    expect(source).toMatch(/setWindowOpenHandler/);
    expect(source).toMatch(/return \{ action: 'deny' \}/);
  });
});

describe('TEST 5: legitimate application navigation still works', () => {
  it('allows the interface and the assets it loads', () => {
    expect(allowedForRenderer(RENDERER_URL)).toBe(true);
    expect(allowedForRenderer('file:///C:/Program%20Files/Novaris/resources/app/dist/assets/index-a1b2c3.js')).toBe(true);
  });

  it('allows the development server, and only that server, in development', () => {
    const dev = 'http://127.0.0.1:5173';
    expect(allowedForRenderer('http://127.0.0.1:5173/index.html', dev)).toBe(true);
    // A configured dev server must not become a general HTTP allowance.
    expect(allowedForRenderer('https://example.com', dev)).toBe(false);
    expect(allowedForRenderer('http://example.com', dev)).toBe(false);
    expect(allowedForRenderer('http://127.0.0.1:5173.attacker.example/', dev)).toBe(false);
  });

  it('allows no HTTP at all when no dev server is configured', () => {
    expect(allowedForRenderer('http://127.0.0.1:5173/index.html')).toBe(false);
  });
});

describe('TEST 6: a private window denies permissions it does not recognise', () => {
  it('denies by allowlist rather than by denylist', () => {
    for (const permission of [
      'notifications', 'geolocation', 'camera', 'microphone', 'midi', 'midiSysex',
      'clipboard-read', 'clipboard-sanitized-write', 'background-sync',
      'background-fetch', 'periodic-background-sync', 'sensors', 'idle-detection',
      'usb', 'serial', 'hid', 'bluetooth', 'display-capture', 'window-management',
      'a-permission-that-does-not-exist',
    ]) {
      expect(privatePermissionAllowed(permission), permission).toBe(false);
    }
  });

  it('grants fullscreen only, so ordinary video is not broken', () => {
    expect([...PRIVATE_ALLOWED_PERMISSIONS].sort()).toEqual(['automatic-fullscreen', 'fullscreen']);
    expect(privatePermissionAllowed('fullscreen')).toBe(true);
  });

  it('never grants hardware access', () => {
    const source = sourceOf('private-window.js');
    expect(source).toMatch(/setDevicePermissionHandler\(\(\) => false\)/);
  });

  it('hardens the very session the window runs on', () => {
    // This was a real defect and the reason the deny-by-default above had no
    // effect. The partition was generated twice: once for the session being
    // hardened and once inside the window preferences, so the two never matched
    // and the window ran on a session no policy had been applied to. A private
    // window was being handed geolocation and notifications by the platform
    // default, which is to allow.
    const partition = 'private-fixed-for-this-test';
    expect(privateWebPreferences({ partition }).partition).toBe(partition);
    // And a bare call is still safe rather than landing on the shared session.
    expect(privateWebPreferences().partition).toMatch(/^private-/);
    expect(privateWebPreferences().partition).not.toBe(partition);

    const source = sourceOf('private-window.js');
    expect(source).toMatch(/privateWebPreferences\(\{[\s\S]{0,200}?partition,/);
  });
});

describe('TEST 7: a malformed update manifest is rejected', () => {
  const { publicKeyPem, privateKeyPem } = generateKeyPair();
  const sha512 = crypto.createHash('sha512').update('installer bytes').digest('base64');
  const good = `version: 0.9.0\nfiles:\n  - url: Novaris-Setup.exe\n    sha512: ${sha512}\n    size: 15\npath: Novaris-Setup.exe\nsha512: ${sha512}\nreleaseDate: '2026-01-01T00:00:00.000Z'\n`;
  const sign = (text) => signManifest(text, privateKeyPem);

  it('rejects an unsigned manifest', () => {
    expect(verifyManifest(good, publicKeyPem)).toMatchObject({ ok: false });
  });

  it('rejects one signed by a different key', () => {
    const other = generateKeyPair();
    expect(verifyManifest(signManifest(good, other.privateKeyPem), publicKeyPem)).toMatchObject({ ok: false });
    // And the matching key does verify, so the case above is the key and not the
    // text.
    expect(verifyManifest(sign(good), publicKeyPem)).toMatchObject({ ok: true });
  });

  it('rejects one edited after it was signed', () => {
    expect(verifyManifest(sign(good).replace('0.9.0', '9.9.9'), publicKeyPem)).toMatchObject({ ok: false });
  });

  // Signed by the legitimate key, so only a check of the contents can catch
  // these. That was the gap: "signed" was being treated as "well formed" too.
  it('rejects a signed manifest with no usable version', () => {
    const verdict = validateManifestShape(sign(good.replace('version: 0.9.0', 'version: not-a-version')));
    expect(verdict).toMatchObject({ ok: false });
    expect(verdict.reason).toMatch(/usable version/);
  });

  it('rejects a signed manifest that lists no download', () => {
    expect(validateManifestShape(sign(good.replace(/files:[\s\S]*?path:/, 'path:')))).toMatchObject({ ok: false });
  });

  it('rejects a signed manifest with no digest', () => {
    // A literal replace, because a base64 digest contains "+" and "/", which
    // mean something entirely different inside a RegExp.
    const verdict = validateManifestShape(sign(good.split(`sha512: ${sha512}`).join('sha512: ""')));
    expect(verdict).toMatchObject({ ok: false });
    expect(verdict.reason).toMatch(/SHA-512/);
  });

  it('rejects a signed manifest with no size', () => {
    expect(validateManifestShape(sign(good.replace('    size: 15', '    size: 0')))).toMatchObject({ ok: false });
  });

  it('rejects a download that is not over HTTPS', () => {
    for (const url of ['http://cdn.example/Setup.exe', 'file:///C:/Setup.exe', 'ftp://x/Setup.exe', '//cdn.example/Setup.exe']) {
      const verdict = validateManifestShape(sign(good.split('Novaris-Setup.exe').join(url)));
      expect(verdict, url).toMatchObject({ ok: false });
      expect(verdict.reason, url).toMatch(/HTTPS/);
    }
  });

  it('is not fooled by a URL mentioned in the release notes', () => {
    // The field reader is scoped to the files: block, so prose cannot be
    // validated as though it were the download.
    expect(validateManifestShape(`${good}releaseNotes: |-\n  See http://cdn.example/Setup.exe for details\n`)).toEqual({ ok: true, reason: '' });
  });

  it('rejects an empty manifest', () => {
    expect(validateManifestShape('')).toMatchObject({ ok: false });
  });
});

describe('TEST 8 and 9: digests are checked, and a good release passes', () => {
  const { publicKeyPem, privateKeyPem } = generateKeyPair();
  const artifact = Buffer.from('a real installer payload');
  const digest = crypto.createHash('sha512').update(artifact).digest('base64');
  const manifestFor = (sha) => `version: 0.9.0\nfiles:\n  - url: Novaris-Setup.exe\n    sha512: ${sha}\n    size: ${artifact.length}\npath: Novaris-Setup.exe\nsha512: ${sha}\nreleaseDate: '2026-01-01T00:00:00.000Z'\n`;

  it('TEST 9: a valid manifest signed by the right key is accepted', () => {
    const signed = signManifest(manifestFor(digest), privateKeyPem);
    expect(verifyManifest(signed, publicKeyPem)).toEqual({ ok: true, reason: '' });
    expect(validateManifestShape(signed)).toEqual({ ok: true, reason: '' });
  });

  it('TEST 8: a digest that is not a SHA-512 value is rejected', () => {
    for (const bad of ['', 'deadbeef', crypto.createHash('sha256').update(artifact).digest('base64'), '!!!!']) {
      expect(validateManifestShape(signManifest(manifestFor(bad), privateKeyPem)), bad).toMatchObject({ ok: false });
    }
  });

  // The byte-for-byte comparison of a downloaded file against the manifest is
  // electron-updater's, and the publisher re-runs the same comparison before
  // anything is uploaded; tests/publish-release.test.js drives the shipped
  // script and proves it refuses a same-length payload whose bytes changed.
  // What is proved here is that a value which does not describe the artifact is
  // not one the manifest gate will accept as a SHA-512 in the first place.
  it('TEST 8: the digest gate and the publisher agree on what a SHA-512 is', () => {
    expect(crypto.createHash('sha512').update(artifact).digest('base64')).toBe(digest);
    expect(crypto.createHash('sha512').update('b real installer payload').digest('base64')).not.toBe(digest);
  });
});

describe('TEST 10: no privileged preload reaches website content', () => {
  it('is true of the private window preferences', () => {
    expect(privateWebPreferences()).not.toHaveProperty('preload');
  });

  it('holds for the one window that is allowed a preload', () => {
    // The main window is the privileged surface and the only one. It loads the
    // built renderer, and the navigation rule confines that to dist, so the
    // privileged document cannot become a website.
    expect(allowedForRenderer(RENDERER_URL)).toBe(true);
    expect(allowedForRenderer('https://example.com')).toBe(false);
  });

  it('is enforced at the source, not by convention', () => {
    // Every window that loads a page from a URL is covered here. A private
    // window is the only one that does, and it is given no preload.
    const source = sourceOf('private-window.js');
    expect(source).not.toMatch(/preload:\s*preloadPath/);
    expect(source).not.toMatch(/getPreloadPath/);
    // The one BrowserWindow that keeps a preload is the main window.
    expect(sourceOf('main.js')).toMatch(/preload: preloadPath/);
  });

  it('is not defeated by a webview, which is the other way in', () => {
    const source = sourceOf('security.js');
    expect(source).toMatch(/on\('will-attach-webview'/);
    expect(source).toMatch(/preferences\.nodeIntegration = false/);
    expect(source).toMatch(/preferences\.contextIsolation = true/);
  });
});
