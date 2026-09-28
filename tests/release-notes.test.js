import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// The manifests are parsed rather than string-matched, because the notes go in
// as a YAML literal block scalar and a check that only compares text would not
// notice a file that a real YAML reader mangles.
const require = createRequire(import.meta.url);
const yaml = require('js-yaml');

// scripts/write-release-notes.mjs runs against the real release directory, so
// these tests run it in a throwaway copy of the project rather than touching the
// artifacts a build just produced.
let dir = '';
let root = '';

function makeProject(manifests) {
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(root, 'release'), { recursive: true });
  fs.copyFileSync(
    path.resolve('scripts/write-release-notes.mjs'),
    path.join(root, 'scripts', 'write-release-notes.mjs'),
  );
  fs.writeFileSync(path.join(root, 'RELEASE_NOTES.md'), '# Notes\n\nLine with: a colon and a # hash.\n\n- bullet\n', 'utf8');
  for (const [name, body] of Object.entries(manifests)) {
    fs.writeFileSync(path.join(root, 'release', name), body, 'utf8');
  }
}

function run() {
  return execFileSync(process.execPath, [path.join(root, 'scripts', 'write-release-notes.mjs')], {
    cwd: root,
    encoding: 'utf8',
  });
}

const read = (name) => fs.readFileSync(path.join(root, 'release', name), 'utf8');

const WINDOWS_MANIFEST = [
  'version: 1.2.3',
  'files:',
  '  - url: Novaris-Browser-1.2.3-Setup.exe',
  '    sha512: AAA=',
  '    size: 1234',
  'path: Novaris-Browser-1.2.3-Setup.exe',
  'sha512: AAA=',
  'releaseDate: 2026-01-01T00:00:00.000Z',
  '',
].join('\n');

const LINUX_MANIFEST = [
  'version: 1.2.3',
  'files:',
  '  - url: Novaris-Browser-1.2.3-Linux.deb',
  '    sha512: BBB=',
  '    size: 5678',
  'path: Novaris-Browser-1.2.3-Linux.deb',
  'sha512: BBB=',
  'releaseDate: 2026-01-01T00:00:00.000Z',
  '',
].join('\n');

describe('release notes injection', () => {
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'novaris-notes-'));
    root = path.join(dir, 'project');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // electron-updater reads latest.yml on Windows and latest-linux.yml on Linux,
  // so a Linux-only build would otherwise ship an update with no explanation.
  it('writes notes a YAML reader gets back intact, on both platforms', () => {
    makeProject({ 'latest.yml': WINDOWS_MANIFEST, 'latest-linux.yml': LINUX_MANIFEST });
    const output = run();
    expect(output).toContain('latest.yml');
    expect(output).toContain('latest-linux.yml');

    const expected = fs.readFileSync(path.join(root, 'RELEASE_NOTES.md'), 'utf8').replace(/\r\n/g, '\n').trimEnd();
    for (const name of ['latest.yml', 'latest-linux.yml']) {
      const parsed = yaml.load(read(name));
      expect(parsed.releaseNotes).toBe(expected);
    }
  });

  // The whole point of a literal block scalar: the notes contain colons, hashes
  // and blank lines that would break ordinary quoted YAML.
  it('keeps punctuation and blank lines that quoted YAML would mangle', () => {
    makeProject({ 'latest.yml': WINDOWS_MANIFEST });
    fs.writeFileSync(
      path.join(root, 'RELEASE_NOTES.md'),
      'Heading\n\n- key: value\n- # not a comment\n- trailing spaces   \n\nLast line.\n',
      'utf8',
    );
    run();
    const parsed = yaml.load(read('latest.yml'));
    expect(parsed.releaseNotes).toBe('Heading\n\n- key: value\n- # not a comment\n- trailing spaces   \n\nLast line.');
  });

  it('works when only the Linux manifest exists', () => {
    makeProject({ 'latest-linux.yml': LINUX_MANIFEST });
    run();
    expect(read('latest-linux.yml')).toContain('releaseNotes: |-');
    expect(fs.existsSync(path.join(root, 'release', 'latest.yml'))).toBe(false);
  });

  // The hash and size are what the update integrity check reads. Rewriting
  // either would make every user reject the download.
  it('leaves the version, size, hash and path untouched', () => {
    makeProject({ 'latest.yml': WINDOWS_MANIFEST, 'latest-linux.yml': LINUX_MANIFEST });
    run();
    for (const [name, before] of [['latest.yml', WINDOWS_MANIFEST], ['latest-linux.yml', LINUX_MANIFEST]]) {
      const after = read(name);
      for (const line of before.trim().split('\n')) {
        expect(after).toContain(line);
      }
      // Everything before the notes is byte for byte what electron-builder wrote.
      expect(after.split('releaseNotes:')[0]).toBe(before);
    }
  });

  it('does not add the notes twice on a second run', () => {
    makeProject({ 'latest.yml': WINDOWS_MANIFEST, 'latest-linux.yml': LINUX_MANIFEST });
    run();
    const first = read('latest.yml');
    const second = run();
    expect(second).toContain('already has them');
    expect(read('latest.yml')).toBe(first);
  });

  it('does nothing when no manifest has been built yet', () => {
    makeProject({});
    const output = run();
    expect(output).toContain('skipped');
    expect(output).toContain('no latest.yml');
  });
});
