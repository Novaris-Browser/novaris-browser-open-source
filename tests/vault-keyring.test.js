import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// electron/vault.js is CommonJS and calls require('electron'), which outside a
// real Electron process resolves to the Electron binary path rather than the
// API. Seeding the CommonJS require cache with the stub is what makes the module
// under test see it.
const nodeRequire = createRequire(import.meta.url);
const { safeStorage, app } = await import(new URL('./stubs/electron.mjs', import.meta.url).href);
const electronEntry = nodeRequire.resolve('electron');
nodeRequire.cache[electronEntry] = {
  id: electronEntry,
  filename: electronEntry,
  loaded: true,
  exports: { safeStorage, app },
  children: [],
  paths: [],
};

const { Vault, storageBackend, storageBackendIsTrusted, unavailableReason } = nodeRequire('../electron/vault.js');

const realPlatform = process.platform;

function setPlatform(value) {
  Object.defineProperty(process, 'platform', { value, configurable: true });
}

describe('Novaris vault: the system keyring must be real', () => {
  beforeEach(() => {
    safeStorage.setEncryptionAvailable(true);
    safeStorage.setStorageBackend('gnome_libsecret');
    setPlatform('win32');
  });

  afterEach(() => {
    setPlatform(realPlatform);
    safeStorage.setStorageBackend('gnome_libsecret');
  });

  it('trusts the Windows default without asking which keyring', () => {
    expect(storageBackend()).toBe('platform-default');
    expect(storageBackendIsTrusted()).toBe(true);
  });

  it('accepts a real Linux keyring', () => {
    setPlatform('linux');
    for (const name of ['gnome_libsecret', 'kwallet5', 'kwallet6']) {
      safeStorage.setStorageBackend(name);
      expect(storageBackend()).toBe(name);
      expect(storageBackendIsTrusted()).toBe(true);
    }
  });

  // The important one. Electron reports isEncryptionAvailable() as true for
  // basic_text, so checking availability alone would tell a user with no keyring
  // that their vault is protected while it sits on disk encrypted with a
  // password that ships in Chromium's own source.
  it('refuses basic_text, which encrypts with a publicly known password', () => {
    setPlatform('linux');
    safeStorage.setStorageBackend('basic_text');
    expect(storageBackend()).toBe('basic_text');
    expect(storageBackendIsTrusted()).toBe(false);
    expect(new Vault({ store: {} }).isAvailable()).toBe(false);
  });

  it('refuses to guess when the backend cannot be identified', () => {
    setPlatform('linux');
    safeStorage.setStorageBackend('unknown');
    expect(storageBackendIsTrusted()).toBe(false);
    expect(new Vault({ store: {} }).isAvailable()).toBe(false);
  });

  it('needs both checks, because either alone is insufficient', () => {
    setPlatform('linux');
    // Electron says encryption is fine, the backend is the insecure one.
    safeStorage.setEncryptionAvailable(true);
    safeStorage.setStorageBackend('basic_text');
    expect(new Vault({ store: {} }).isAvailable()).toBe(false);
    // The backend is fine, but the platform has no encryption at all.
    safeStorage.setStorageBackend('gnome_libsecret');
    safeStorage.setEncryptionAvailable(false);
    expect(new Vault({ store: {} }).isAvailable()).toBe(false);
  });

  it('explains why, naming the missing piece', () => {
    setPlatform('linux');
    safeStorage.setStorageBackend('basic_text');
    const reason = unavailableReason();
    expect(reason).toMatch(/keyring|Keyring|Secret Service/i);
    const status = new Vault({ store: {} }).status();
    expect(status.available).toBe(false);
    expect(status.reason).toBe(reason);
    expect(status.backend).toBe('basic_text');
  });

  it('refuses to store anything rather than falling back to plaintext', () => {
    setPlatform('linux');
    safeStorage.setStorageBackend('basic_text');
    const vault = new Vault({ store: {} });
    expect(() => vault._assertAvailable()).toThrow(/plaintext/i);
  });

  it('does not name a Windows mechanism in the Linux message', () => {
    setPlatform('linux');
    safeStorage.setStorageBackend('basic_text');
    expect(unavailableReason()).not.toMatch(/DPAPI|Windows/i);
  });

  it('still works normally on Windows', () => {
    setPlatform('win32');
    safeStorage.setStorageBackend('basic_text');
    // On Windows the backend name is meaningless; DPAPI is what protects the
    // file, so an unhelpful name must not disable the vault.
    expect(new Vault({ store: {} }).isAvailable()).toBe(true);
  });
});
