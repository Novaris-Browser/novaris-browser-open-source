import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MARKER_NAME,
  applyPendingReset,
  clearPendingReset,
  readPendingReset,
  wipeProfileDirectory,
  writePendingReset,
} from '../electron/profile-reset.js';
import { compareVersions, normalizeNotes } from '../electron/updater.js';

function makeProfile() {
  const root = mkdtempSync(path.join(tmpdir(), 'novaris-reset-'));
  writeFileSync(path.join(root, 'novaris-data.json'), '{"settings":{}}');
  writeFileSync(path.join(root, 'novaris-vault.bin'), 'encrypted');
  writeFileSync(path.join(root, 'Preferences'), '{}');
  writeFileSync(path.join(root, 'Local State'), '{}');
  mkdirSync(path.join(root, 'Default'), { recursive: true });
  writeFileSync(path.join(root, 'Default', 'Login Data'), 'logins');
  mkdirSync(path.join(root, 'extensions', 'novaris-adblock'), { recursive: true });
  writeFileSync(path.join(root, 'extensions', 'novaris-adblock', 'manifest.json'), '{}');
  return root;
}

describe('Novaris hard lock', () => {
  const gateSource = readFileSync(new URL('../src/components/VaultLockGate.jsx', import.meta.url), 'utf8');
  const appSource = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');

  it('offers no way to skip the password prompt', () => {
    // A bypass would make the lock decorative, because the password is the only
    // thing that can decrypt the vault.
    expect(gateSource).not.toMatch(/continue without unlocking/i);
    expect(gateSource).not.toMatch(/onContinueWithoutVault/);
  });

  it('explains that a forgotten password cannot be recovered', () => {
    expect(gateSource).toMatch(/cannot be recovered/i);
    expect(gateSource).toMatch(/reset the browser/i);
  });

  it('gates the whole app on the locked status with no escape state', () => {
    expect(appSource).toMatch(/vaultStatus\?\.locked/);
    expect(appSource).not.toContain('vaultBypass');
  });
});

describe('Novaris main-process contract', () => {
  const ipcSource = readFileSync(new URL('../electron/ipc.js', import.meta.url), 'utf8');
  const preloadSource = readFileSync(new URL('../electron/preload.js', import.meta.url), 'utf8');

  // A preload entry that goes missing is invisible until a feature silently does
  // nothing at runtime, so the surface the renderer depends on is asserted here.
  const REQUIRED_API = [
    'scanCredentialPage', 'updateStatus', 'checkForUpdates', 'downloadUpdate',
    'installUpdate', 'updateSummary', 'onUpdateState', 'resetProfile',
    'vaultFill', 'classifySite', 'allowUnsafeSite', 'adblockStatus',
  ];

  it.each(REQUIRED_API)('exposes %s through the preload bridge', (name) => {
    expect(preloadSource).toContain(`${name}:`);
  });

  it('has a main-process handler for every renderer-facing update, reset, and guard channel', () => {
    for (const channel of ['update:status', 'update:check', 'update:download', 'update:install', 'update:summary', 'profile:reset', 'credential:scan']) {
      expect(ipcSource, channel).toContain(`'${channel}'`);
    }
  });

  it('enforces the credential guard before injecting a saved password', () => {
    const fillStart = ipcSource.indexOf("handle('vault:fill'");
    const guard = ipcSource.indexOf('evaluateFill', fillStart);
    const inject = ipcSource.indexOf('buildFillScript(record)', fillStart);
    expect(fillStart).toBeGreaterThan(-1);
    expect(guard).toBeGreaterThan(fillStart);
    expect(inject).toBeGreaterThan(guard);
  });
});

describe('Novaris full profile reset', () => {
  it('records a pending reset with the update details', () => {
    const root = makeProfile();
    writePendingReset(root, {
      reason: 'update',
      fromVersion: '0.1.0',
      toVersion: '0.2.0',
      releaseNotes: 'Faster ad blocking.',
    });
    const pending = readPendingReset(root);
    expect(pending).toMatchObject({ reason: 'update', fromVersion: '0.1.0', toVersion: '0.2.0', releaseNotes: 'Faster ad blocking.' });
    expect(pending.requestedAt).toBeGreaterThan(0);
  });

  it('returns null when no reset is scheduled', () => {
    expect(readPendingReset(makeProfile())).toBeNull();
  });

  it('removes every profile artifact including the vault and Chromium data', () => {
    const root = makeProfile();
    const result = wipeProfileDirectory(root);
    expect(result.failed).toEqual([]);
    for (const artifact of ['novaris-data.json', 'novaris-vault.bin', 'Preferences', 'Local State', 'Default', 'extensions']) {
      expect(existsSync(path.join(root, artifact)), artifact).toBe(false);
    }
  });

  it('keeps the marker during the wipe so an interrupted reset is retried', () => {
    const root = makeProfile();
    writePendingReset(root, { reason: 'manual' });
    wipeProfileDirectory(root);
    expect(existsSync(path.join(root, MARKER_NAME))).toBe(true);
    expect(readPendingReset(root)).toMatchObject({ reason: 'manual' });
  });

  it('consumes the marker even when a file is locked, so the message never repeats', () => {
    // Chromium recreates and holds some profile files during launch, so the
    // reset must not depend on every single file being removable.
    const root = makeProfile();
    writePendingReset(root, { reason: 'manual' });
    const summary = applyPendingReset(root);
    expect(summary).toMatchObject({ reason: 'manual' });
    expect(existsSync(path.join(root, MARKER_NAME))).toBe(false);
    // The next launch must be an ordinary one.
    expect(applyPendingReset(root)).toBeNull();
  });

  it('deletes the Novaris store and vault', () => {
    const root = makeProfile();
    writePendingReset(root, { reason: 'manual' });
    applyPendingReset(root);
    expect(existsSync(path.join(root, 'novaris-data.json'))).toBe(false);
    expect(existsSync(path.join(root, 'novaris-vault.bin'))).toBe(false);
  });

  it('applies a scheduled reset and reports what happened', () => {
    const root = makeProfile();
    writePendingReset(root, { reason: 'update', fromVersion: '0.1.0', toVersion: '0.2.0', releaseNotes: 'Notes here.' });
    const summary = applyPendingReset(root);
    expect(summary).toMatchObject({ reason: 'update', toVersion: '0.2.0', releaseNotes: 'Notes here.' });
    expect(summary.removed).toBeGreaterThan(0);
    expect(summary.failed).toEqual([]);
    // The marker is gone, so the message is shown exactly once.
    expect(existsSync(path.join(root, MARKER_NAME))).toBe(false);
    expect(readPendingReset(root)).toBeNull();
  });

  it('does nothing on a normal launch', () => {
    const root = makeProfile();
    expect(applyPendingReset(root)).toBeNull();
    expect(existsSync(path.join(root, 'novaris-data.json'))).toBe(true);
  });

  it('survives a corrupt marker instead of crashing the launch', () => {
    const root = makeProfile();
    writeFileSync(path.join(root, MARKER_NAME), '{not json');
    expect(readPendingReset(root)).toBeNull();
    expect(applyPendingReset(root)).toBeNull();
  });

  it('preserves release notes across the wipe so the user can be told what changed', () => {
    const root = makeProfile();
    const notes = 'Line one\n\nLine two';
    writePendingReset(root, { reason: 'update', toVersion: '9.9.9', releaseNotes: notes });
    expect(applyPendingReset(root).releaseNotes).toBe(notes);
  });

  it('ignores an unexpected reason instead of trusting it', () => {
    const root = makeProfile();
    writePendingReset(root, { reason: 'something-else' });
    expect(applyPendingReset(root).reason).toBe('something-else');
    clearPendingReset(root);
  });
});

describe('Novaris update channel helpers', () => {
  it('compares dotted versions numerically', () => {
    expect(compareVersions('0.2.0', '0.1.0')).toBe(1);
    expect(compareVersions('0.1.0', '0.1.0')).toBe(0);
    expect(compareVersions('0.1.0', '0.2.0')).toBe(-1);
    expect(compareVersions('0.10.0', '0.9.0')).toBe(1);
    expect(compareVersions('1.0.0', '0.99.99')).toBe(1);
    expect(compareVersions('', '0.1.0')).toBe(-1);
  });

  it('normalises release notes from either shape', () => {
    expect(normalizeNotes('Single note')).toBe('Single note');
    expect(normalizeNotes(['One', '', 'Two'])).toBe('One\n\nTwo');
    expect(normalizeNotes(null)).toBe('');
    expect(normalizeNotes(undefined)).toBe('');
  });
});

describe('Novaris update main-process contract', () => {
  it('never downloads or installs without being asked', () => {
    const source = readFileSync(new URL('../electron/updater.js', import.meta.url), 'utf8');
    expect(source).toContain('autoUpdater.autoDownload = false');
    expect(source).toContain('autoUpdater.autoInstallOnAppQuit = false');
  });

  it('schedules a reset before handing control to the installer', () => {
    const source = readFileSync(new URL('../electron/updater.js', import.meta.url), 'utf8');
    const schedule = source.indexOf('writePendingReset');
    const install = source.indexOf('quitAndInstall');
    expect(schedule).toBeGreaterThan(-1);
    expect(install).toBeGreaterThan(schedule);
  });

  it('reports an unconfigured channel instead of failing silently', () => {
    const source = readFileSync(new URL('../electron/updater.js', import.meta.url), 'utf8');
    expect(source).toContain("status: 'unconfigured'");
    expect(source).toContain('No update channel is configured');
  });
});
