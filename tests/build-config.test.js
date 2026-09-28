import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const pkg = require('../package.json');
const schema = require('app-builder-lib/scheme.json');

const build = pkg.build;

// electron-builder validates the whole config object against this schema and
// refuses to start if any key is misplaced. The failure only surfaces part way
// through a package build, long after the mistake was made, so it is checked
// here instead.
const definition = (name) => schema.definitions[name]?.properties || null;
const allowed = (defName) => definition(defName);

const sets = {
  'build.linux': allowed('LinuxConfiguration'),
  'build.deb': allowed('DebOptions'),
  'build.win': allowed('WinConfiguration'),
  'build.win.signtoolOptions': allowed('WindowsSigntoolConfiguration'),
  'build.nsis': allowed('NsisOptions'),
};

describe('Novaris build configuration', () => {
  it('only uses keys electron-builder accepts', () => {
    const problems = [];
    for (const [label, set] of Object.entries(sets)) {
      const path = label.split('.');
      let value = build;
      for (const part of path) value = value?.[part];
      if (value === undefined) continue;
      for (const key of Object.keys(value)) {
        if (!set.has(key)) problems.push(`${label}.${key}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('keeps top-level keys inside the root schema', () => {
    const rootProps = new Set(Object.keys(schema.properties));
    const problems = Object.keys(build).filter((key) => !rootProps.has(key));
    expect(problems).toEqual([]);
  });

  it('signs with a digest signtool accepts', () => {
    // Only sha1 and sha256 are valid. sha384 and sha512 are rejected, and they
    // are not the same thing as the download SHA-512 in latest.yml.
    const allowed2 = new Set(['sha1', 'sha256']);
    const used = build.win?.signtoolOptions?.signingHashAlgorithms || [];
    expect(used.length).toBeGreaterThan(0);
    for (const algorithm of used) expect(allowed2.has(algorithm)).toBe(true);
  });

  it('does not force signing when no certificate is present', () => {
    // A certificateSubjectName or a sign:true would make electron-builder fail
    // every build on a machine without the key, which is everyone without one.
    const options = build.win?.signtoolOptions || {};
    expect(options.certificateSubjectName).toBeUndefined();
    expect(options.sign).toBeUndefined();
    expect(options.certificateFile).toBeUndefined();
  });

  it('publishes Windows and Linux to the same feed', () => {
    expect(build.publish?.provider).toBe('generic');
    expect(build.win.target.map((t) => t.target)).toContain('nsis');
    expect(build.linux.target.map((t) => t.target)).toContain('deb');
  });

  it('gives the two platforms different artifact names', () => {
    // Both write into release/, so a shared template would overwrite one
    // platform's package with the other's.
    expect(build.win.artifactName).not.toBe(build.linux.artifactName);
  });

  it('uses a PNG icon on Linux, because .ico is not accepted there', () => {
    expect(String(build.linux.icon)).toMatch(/\.png$/i);
    expect(String(build.win.icon)).toMatch(/\.ico$/i);
  });

  it('registers the novaris protocol handler on Linux', () => {
    // Without this the browser opens from a .desktop entry but never receives
    // novaris:// links, which is how a saved page is handed to it.
    const mime = build.linux.desktop?.entry?.MimeType || '';
    expect(mime).toContain('x-scheme-handler/novaris');
    expect(build.linux.desktop?.entry?.Categories || '').toContain('WebBrowser');
  });

  // Electron derives its app_id from desktopName, and the .desktop entry's
  // StartupWMClass has to match it or the window is not associated with its
  // launcher or taskbar entry. desktopName is a top-level package.json field,
  // not a build key, which is why it is read from pkg rather than from build.
  it('gives the Linux desktop entry a window association', () => {
    expect(pkg.desktopName).toBeTruthy();
    expect(pkg.desktopName).not.toMatch(/[/\\]/);
    expect(build.linux.syncDesktopName).toBe(true);
  });

  it('depends on the keyring library the vault needs on Linux', () => {
    // The vault refuses to store anything without a Secret Service provider, so
    // a package that does not pull in libsecret leaves the feature dead.
    expect(build.deb.depends).toContain('libsecret-1-0');
  });

  // A Debian package is required to name a maintainer with a contact address, and
  // electron-builder refuses to package without one. It only surfaces after
  // Electron has been downloaded and unpacked, so it is checked here instead.
  // electron-updater's NsisUpdater.verifySignature() reads publisherName from
  // app-update.yml and returns null when it is absent, which skips the check
  // entirely. So verifyUpdateCodeSignature on its own is a silent no-op: the
  // project would claim to verify update signatures while verifying none.
  // publisherName is the signing certificate's own Distinguished Name, so it
  // cannot be set until a certificate exists. Flip both together, never one.
  it('never enables update signature verification without a publisher name', () => {
    const verify = build.win?.verifyUpdateCodeSignature;
    const publisher = build.win?.signtoolOptions?.publisherName;
    if (verify) {
      expect(publisher).toBeTruthy();
    } else {
      // Off with no name is the honest current state: no certificate yet.
      expect(publisher).toBeUndefined();
    }
  });

  it('has an update manifest that can be checked for a publisher name', () => {
    // If this file ever grows a publisherName, the flag above must be on too.
    const built = 'release/win-unpacked/resources/app-update.yml';
    if (!fs.existsSync(built)) return; // only present after a Windows build
    const text = fs.readFileSync(built, 'utf8');
    const hasPublisher = /^publisherName:/m.test(text);
    if (hasPublisher) expect(build.win.verifyUpdateCodeSignature).toBe(true);
  });

  it('carries the maintainer metadata a .deb requires', () => {
    expect(typeof pkg.author).toBe('object');
    expect(pkg.author.name).toBeTruthy();
    expect(pkg.author.email).toMatch(/@/);
    expect(pkg.homepage).toMatch(/^https?:\/\//);
  });

  it('keeps the app-data deletion switch on the Windows installer only', () => {
    // NSIS-only. On Linux a package manager must not delete user data.
    expect(build.nsis.deleteAppDataOnUninstall).toBe(true);
    expect(build.linux.deleteAppDataOnUninstall).toBeUndefined();
  });
});
