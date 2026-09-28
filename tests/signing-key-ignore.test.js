import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

// The update signing key is the one file in this project that has to be tracked
// and the one file that must never be. Both halves are a .pem, so which one git
// picks up is decided entirely by the order of two lines in .gitignore: git
// applies the last matching rule, so a negation placed above the broad pattern
// is silently overridden.
//
// That happened. The public key was never committed, and a fresh clone would
// have produced a build carrying no key, which refuses every update it is ever
// offered. These tests run git to find out what git actually does, rather than
// reading the file and being satisfied by what it appears to say.

const root = process.cwd();
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'novaris-ignore-'));

const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const wouldTrack = (relative) => {
  try {
    git('add', '--dry-run', '--', relative);
    return true;
  } catch {
    return false;
  }
};

afterAll(() => {
  fs.rmSync(scratch, { recursive: true, force: true });
});

describe('the update signing key is handled correctly', () => {
  it('tracks the public key, because the application verifies with it', () => {
    expect(fs.existsSync(path.join(root, 'assets', 'update-public-key.pem'))).toBe(true);
    expect(wouldTrack('assets/update-public-key.pem')).toBe(true);
  });

  it('refuses every shape of private key', () => {
    for (const name of [
      'assets/update-signing-key.pem',
      'assets/probe-private.pem',
      'update-signing-key.pem',
      'release/signing-private-key.pem',
      'keys/prod.pem',
    ]) {
      expect(wouldTrack(name)).toBe(false);
    }
  });

  it('refuses a private key even in the same directory as the public one', () => {
    // The case that matters most: the two live side by side, and a negation for
    // one directory could be taken to cover the other.
    fs.writeFileSync(path.join(root, 'assets', 'zz-probe.pem'), 'PROBE', 'utf8');
    try {
      expect(wouldTrack('assets/zz-probe.pem')).toBe(false);
    } finally {
      fs.rmSync(path.join(root, 'assets', 'zz-probe.pem'), { force: true });
    }
  });
});

describe('other key material', () => {
  it('refuses certificates and key stores', () => {
    for (const name of ['probe.pfx', 'probe.p12', 'probe.jks', 'probe.keystore', 'probe.key', 'probe.cer']) {
      expect(wouldTrack(name)).toBe(false);
    }
  });

  it('refuses the profile and the vault', () => {
    for (const name of ['novaris-data.json', 'novaris-vault.bin', '.env', '.env.local']) {
      expect(wouldTrack(name)).toBe(false);
    }
  });
});
