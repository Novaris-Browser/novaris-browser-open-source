import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const projectRoot = process.cwd();
const script = path.join(projectRoot, 'scripts', 'publish-release.mjs');
const realVersion = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8')).version;

let dir = '';

// Runs the publisher against a throwaway project so a failing safety rule is
// visible as a test rather than as a bad upload.
//
// packageVersion and manifestVersion are separate on purpose: the stale-manifest
// check only fires when the two disagree, and a test that sets both to the same
// value would pass without ever exercising it.
function makeProject({
  packageVersion = realVersion,
  manifestVersion = null,
  windows = true,
  linux = false,
  tamper = null,
} = {}) {
  const release = path.join(dir, 'release');
  const built = manifestVersion || packageVersion;
  fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
  fs.mkdirSync(release, { recursive: true });
  fs.copyFileSync(script, path.join(dir, 'scripts', 'publish-release.mjs'));
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'novaris-browser', version: packageVersion }),
    'utf8',
  );

  const write = (name, bytes) => fs.writeFileSync(path.join(release, name), bytes);
  const manifestFor = (name, url, bytes) => {
    const size = bytes.length;
    const sha512 = crypto.createHash('sha512').update(bytes).digest('base64');
    return `version: ${built}\nfiles:\n  - url: ${url}\n    sha512: ${sha512}\n    size: ${size}\npath: ${url}\nsha512: ${sha512}\nreleaseDate: '2026-01-01T00:00:00.000Z'\n`;
  };

  if (windows) {
    const original = Buffer.from('fake windows installer payload');
    const exe = 'Novaris-Browser-x-Setup.exe';
    if (tamper === 'same-size') {
      write(exe, Buffer.from('TAMPERED windows payload'.padEnd(original.length, '.')));
    } else if (tamper === 'short') {
      write(exe, Buffer.from('tiny'));
    } else {
      write(exe, original);
    }
    // The manifest always records the original bytes, so any tampering shows up
    // as a mismatch rather than being silently blessed.
    write('latest.yml', manifestFor(exe, exe, original));
  }
  if (linux) {
    const deb = Buffer.from('fake deb payload');
    const name = 'Novaris-Browser-x-Linux.deb';
    write(name, deb);
    write('latest-linux.yml', manifestFor(name, name, deb));
  }
  return release;
}

function run(bucket = 'test-bucket') {
  try {
    const out = execFileSync(process.execPath, [path.join(dir, 'scripts', 'publish-release.mjs'), '--dry-run'], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, R2_BUCKET: bucket },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, out };
  } catch (error) {
    return { code: error.status ?? 1, out: `${error.stdout || ''}${error.stderr || ''}` };
  }
}

describe('release publishing safety rules', () => {
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'novaris-publish-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('accepts a consistent single-platform build', () => {
    makeProject({ windows: true });
    const { code, out } = run();
    expect(code).toBe(0);
    expect(out).toContain('nothing uploaded');
  });

  it('stages both platforms when both manifests are present', () => {
    makeProject({ windows: true, linux: true });
    const { code, out } = run();
    expect(code).toBe(0);
    expect(out).toContain('latest.yml');
    expect(out).toContain('latest-linux.yml');
    expect(out).toContain('.exe');
    expect(out).toContain('.deb');
  });

  // The whole point of the pre-flight: a tampered or truncated build must never
  // become the published release, because the updater trusts that hash. A
  // same-length payload isolates the hash check from the size check, so each is
  // proven to work on its own.
  it('refuses an artifact whose bytes changed but whose length did not', () => {
    makeProject({ windows: true, tamper: 'same-size' });
    const { code, out } = run();
    expect(code).not.toBe(0);
    expect(out).toMatch(/does not match the SHA-512/);
    expect(out).toContain('Do not publish');
  });

  it('refuses an artifact whose size does not match the manifest', () => {
    makeProject({ windows: true, tamper: 'short' });
    const { code, out } = run();
    expect(code).not.toBe(0);
    expect(out).toMatch(/bytes but the manifest says/);
  });

  // A manifest left over from an older build points the updater at a version
  // that may never have been uploaded.
  it('refuses a manifest built for a different version than package.json', () => {
    makeProject({ packageVersion: realVersion, manifestVersion: '0.0.1' });
    const { code, out } = run();
    expect(code).not.toBe(0);
    expect(out).toMatch(/but package\.json says/);
  });

  it('refuses when the manifest names a file that is missing', () => {
    const release = makeProject({ windows: true });
    fs.rmSync(path.join(release, 'Novaris-Browser-x-Setup.exe'));
    const { code, out } = run();
    expect(code).not.toBe(0);
    expect(out).toMatch(/missing from release/);
  });

  it('refuses when no manifest has been built', () => {
    fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
    fs.copyFileSync(script, path.join(dir, 'scripts', 'publish-release.mjs'));
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version: realVersion }));
    fs.mkdirSync(path.join(dir, 'release'));
    const { code, out } = run();
    expect(code).not.toBe(0);
    expect(out).toMatch(/Run a build first/);
  });

  it('explains the bucket requirement rather than failing obscurely', () => {
    makeProject({ windows: true });
    try {
      execFileSync(process.execPath, [path.join(dir, 'scripts', 'publish-release.mjs'), '--dry-run'], {
        cwd: dir,
        encoding: 'utf8',
        env: { ...process.env, R2_BUCKET: '' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      throw new Error('should have exited non-zero');
    } catch (error) {
      expect(error.status).not.toBe(0);
      expect(`${error.stdout}${error.stderr}`).toContain('R2_BUCKET is not set');
    }
  });
});

describe('cache headers on published objects', () => {
  // A cached manifest is a stale manifest, and the effect is that users are told
  // they are up to date when they are not.
  const scriptText = fs.readFileSync(script, 'utf8');

  it('marks the update manifests as uncacheable', () => {
    expect(scriptText).toMatch(/'\.yml':\s*'no-cache/);
  });

  it('marks versioned artifacts as immutable', () => {
    expect(scriptText).toMatch(/'\.exe':\s*'public, max-age=31536000, immutable'/);
    expect(scriptText).toMatch(/'\.deb':\s*'public, max-age=31536000, immutable'/);
  });

  it('sends the right content type for each artifact', () => {
    expect(scriptText).toContain('application/vnd.microsoft.portable-executable');
    expect(scriptText).toContain('application/vnd.debian.binary-package');
  });
});
