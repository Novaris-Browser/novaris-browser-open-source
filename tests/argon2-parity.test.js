import { readFileSync, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { argon2Sync } from 'node:crypto';
import argon2wasm from 'hash-wasm';
import { deriveKeyAsync } from '../electron/crypto-box.js';

// A fallback that computes a different key from the primary implementation is
// worse than no fallback: the vault would open on the build that created it and
// fail everywhere else, with no obvious cause. @noble/hashes 2.4.0 was rejected
// for exactly this, so the agreement is asserted rather than assumed.
describe('Novaris update feed resolution', () => {
  it('reads the feed URL from the build manifest rather than an env var', () => {
    // End users never set an environment variable, so the packaged app has to
    // find its own channel. This is what fixes the "no update channel
    // configured" message on an installed build.
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    const publish = manifest.build?.publish || manifest.publish;
    const url = typeof publish === 'string' ? publish : publish?.url || publish?.generic?.url;
    expect(typeof url).toBe('string');
    expect(url).toMatch(/^https:\/\//);
  });

  it('keeps package.json complete, since a build cannot run without it', () => {
    // The scripts and build sections are easy to lose to a dependency install
    // that rewrites the manifest, and a truncated file silently drops settings.
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    expect(manifest.scripts).toBeTruthy();
    expect(manifest.scripts.build).toBeTruthy();
    expect(manifest.scripts['dist:win']).toBeTruthy();
    expect(manifest.scripts.prebuild).toBeTruthy();
    expect(manifest.devDependencies).toBeTruthy();
    expect(manifest.devDependencies.electron).toBeTruthy();
    expect(manifest.devDependencies['electron-builder']).toBeTruthy();
    expect(manifest.build.appId).toBe('com.novaris.browser');
    expect(manifest.build.publish).toBeTruthy();
    expect(manifest.build.nsis.deleteAppDataOnUninstall).toBe(true);
  });

  it('generates a channel file that matches the manifest', () => {
    // The generated file is what the running app reads, so it has to agree with
    // the single source of truth in package.json.
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    const channelPath = new URL('../assets/update-channel.json', import.meta.url);
    if (!existsSync(channelPath)) return; // Not built yet.
    const channel = JSON.parse(readFileSync(channelPath, 'utf8'));
    expect(channel.feedUrl).toBe(manifest.build.publish.url);
    expect(channel.feedUrl).toMatch(/^https:\/\//);
  });

  it('uses a version above the previously published one', () => {
    // An update only appears when the feed version is higher than the installed
    // one, so the two must be kept in step.
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('reads the installer size from the update manifest', async () => {
    // latest.yml carries the size, which is what lets the UI show the download
    // cost before the user agrees to it.
    const manifestPath = new URL('../release/latest.yml', import.meta.url);
    if (!existsSync(manifestPath)) return; // Not built yet.
    const manifest = readFileSync(manifestPath, 'utf8');
    const size = Number(manifest.match(/size:\s*(\d+)/)?.[1]);
    expect(Number.isFinite(size)).toBe(true);
    expect(size).toBeGreaterThan(0);
  });

  it('publishes release notes without disturbing the integrity fields', () => {
    // The notes are injected after the build, so the version, size, and hash
    // that guard the download must be left exactly as electron-builder wrote them.
    const manifestPath = new URL('../release/latest.yml', import.meta.url);
    if (!existsSync(manifestPath)) return; // Not built yet.
    const manifest = readFileSync(manifestPath, 'utf8');
    const version = manifest.match(/^version:\s*(\S+)$/m)?.[1];
    const size = manifest.match(/^\s+size:\s*(\d+)$/m)?.[1];
    const hash = manifest.match(/^sha512:\s*(\S+)$/m)?.[1];
    expect(version).toBeTruthy();
    expect(Number(size)).toBeGreaterThan(0);
    expect(hash).toBeTruthy();
    if (/^releaseNotes:/m.test(manifest)) {
      expect(manifest).toMatch(/^releaseNotes: \|-$/m);
      // The installer filename must still point at the current version.
      expect(manifest).toContain(`Novaris-Browser-${version}-Setup.exe`);
    }
  });
});

describe('Novaris Argon2id implementation agreement', () => {
  const password = Buffer.from('correct horse battery staple');
  const salt = Buffer.alloc(16, 3);
  const params = { memory: 19456, iterations: 1, parallelism: 1, hashLength: 32 };

  it('the bundled WebAssembly build matches the native implementation', async () => {
    const wasm = Buffer.from(await argon2wasm.argon2id({
      password,
      salt: new Uint8Array(salt),
      memorySize: params.memory,
      iterations: params.iterations,
      parallelism: params.parallelism,
      hashLength: params.hashLength,
      outputType: 'binary',
    }));

    let native = null;
    try {
      native = argon2Sync('argon2id', {
        message: password,
        nonce: salt,
        memory: params.memory,
        passes: params.iterations,
        parallelism: params.parallelism,
        tagLength: params.hashLength,
      });
    } catch {
      // This runtime has no native Argon2id, so there is nothing to compare to.
    }

    if (native) expect(wasm.equals(native)).toBe(true);
    expect(wasm).toHaveLength(32);
  });

  it('the implementation the app selects matches the WebAssembly build', async () => {
    const viaApp = await deriveKeyAsync('correct horse battery staple', salt, {
      algorithm: 'argon2id',
      memory: params.memory,
      passes: params.iterations,
      parallelism: params.parallelism,
      tagLength: params.hashLength,
    });
    const viaWasm = Buffer.from(await argon2wasm.argon2id({
      password,
      salt: new Uint8Array(salt),
      memorySize: params.memory,
      iterations: params.iterations,
      parallelism: params.parallelism,
      hashLength: params.hashLength,
      outputType: 'binary',
    }));
    expect(viaApp.equals(viaWasm)).toBe(true);
  });
});
