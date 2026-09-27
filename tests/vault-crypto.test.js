import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';

// electron/vault.js is CommonJS and calls require('electron'), which outside a
// real Electron process resolves to the path of the Electron binary rather than
// to the API. Seeding the CommonJS require cache with the stub is what makes the
// module under test see it.
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

const { Vault } = nodeRequire('../electron/vault.js');

const VAULT_MAGIC = Buffer.from('NOVARIS_VAULT_V1\n', 'utf8');

let dir = '';
let vault = null;

const SAMPLE = {
  title: 'Google',
  url: 'https://accounts.google.com',
  username: 'me@gmail.com',
  password: 'SuperSecret123',
  email: '',
  notes: 'recovery note',
};

function newVault(name = 'novaris-vault.bin') {
  const instance = new Vault(path.join(dir, name));
  instance.init();
  return instance;
}

// Reads the stored container the same way the vault does, so the on-disk shape
// can be asserted rather than only the API surface.
function readContainer(name = 'novaris-vault.bin') {
  return readContainerFile(path.join(dir, name));
}

function readContainerFile(filePath) {
  const buffer = readFileSync(filePath);
  if (!buffer.subarray(0, VAULT_MAGIC.length).equals(VAULT_MAGIC)) throw new Error('bad magic');
  return JSON.parse(safeStorage.decryptString(buffer.subarray(VAULT_MAGIC.length)));
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'novaris-vault-crypto-'));
  vault = newVault();
});

afterEach(() => {
  dir = '';
  vault = null;
});

describe('Novaris vault credentials', () => {
  it('stores and returns a credential without a master password', async () => {
    const saved = vault.save(SAMPLE);
    expect(vault.get(saved.id, true).password).toBe('SuperSecret123');
  });

  it('never returns a password in the list', async () => {
    vault.save(SAMPLE);
    expect(vault.list()[0].password).toBeUndefined();
    expect(vault.list()[0].hasPassword).toBe(true);
  });

  it('updates and removes a credential', async () => {
    const saved = vault.save(SAMPLE);
    expect(vault.update(saved.id, { password: 'changed' }).id).toBe(saved.id);
    expect(vault.get(saved.id, true).password).toBe('changed');
    expect(vault.remove(saved.id)).toBe(true);
    expect(vault.list()).toHaveLength(0);
  });
});

describe('Novaris vault sealing with a master password', () => {
  it('seals every record separately with a unique nonce', async () => {
    vault.save(SAMPLE);
    vault.save({ ...SAMPLE, title: 'Second', url: 'https://example.org' });
    await vault.setupMaster('correct horse battery');

    const container = readContainer();
    expect(container.sealed).toBe(true);
    expect(container.cipher).toBe('aes-256-gcm');
    expect(container.records).toHaveLength(2);
    const nonces = container.records.map((entry) => entry.sealed.nonce);
    expect(new Set(nonces).size).toBe(2);
    for (const nonce of nonces) expect(nonce).toMatch(/^[0-9a-f]{24}$/);
  });

  it('leaves no readable password in the stored file', async () => {
    vault.save(SAMPLE);
    await vault.setupMaster('correct horse battery');
    const raw = readFileSync(path.join(dir, 'novaris-vault.bin')).toString('latin1');
    expect(raw).not.toContain('SuperSecret123');
    expect(raw).not.toContain('me@gmail.com');
    expect(raw).not.toContain('recovery note');
  });

  it('binds each record to its own id', async () => {
    vault.save(SAMPLE);
    vault.save({ ...SAMPLE, title: 'Second', url: 'https://example.org' });
    await vault.setupMaster('correct horse battery');
    const container = readContainer();
    // Swapping the sealed blobs between records must not authenticate.
    const swapped = {
      ...container,
      records: [
        { ...container.records[0], sealed: container.records[1].sealed },
        { ...container.records[1], sealed: container.records[0].sealed },
      ],
    };
    vault.cache = null;
    expect(() => vault._decodeRecords(swapped)).toThrow();
  });

  it('refuses to read sealed records while locked', async () => {
    vault.save(SAMPLE);
    await vault.setupMaster('correct horse battery');
    vault.cache = null;
    vault.lock();
    expect(() => vault._read()).toThrow(/browser password/i);
  });

  it('reports its cryptographic posture', async () => {
    vault.save(SAMPLE);
    const status = await vault.setupMaster('correct horse battery');
    expect(status.kdf).toBe('argon2id');
    expect(status.cipher).toBe('aes-256-gcm');
    expect(status.recordsSealed).toBe(true);
    expect(status.capabilities).toMatchObject({ argon2id: true, aes256gcm: true, chacha20poly1305: true });
  });
});

describe('Novaris master password lifecycle', () => {
  it('locks and unlocks with the master password', async () => {
    const saved = vault.save(SAMPLE);
    await vault.setupMaster('correct horse battery');
    vault.lock();
    expect(vault.status().locked).toBe(true);
    expect(() => vault.list()).toThrow(/locked/i);

    expect((await vault.unlock('correct horse battery')).locked).toBe(false);
    expect(vault.get(saved.id, true).password).toBe('SuperSecret123');
  });

  it('rejects an incorrect master password', async () => {
    await vault.setupMaster('correct horse battery');
    await expect(vault.unlock('wrong password here')).rejects.toThrow(/Incorrect master password/);
  });

  it('leaves onboarding unlocked after setup', async () => {
    await vault.setupMaster('correct horse battery');
    expect(vault.status().locked).toBe(false);
  });

  it('wipes the derived key when locked', async () => {
    await vault.setupMaster('correct horse battery');
    expect(vault.key).not.toBeNull();
    vault.lock();
    expect(vault.key).toBeNull();
  });

  it('changes the master password and keeps credentials readable', async () => {
    const saved = vault.save(SAMPLE);
    await vault.setupMaster('first password 1234');
    await vault.changeMaster('first password 1234', 'second password 5678');
    vault.lock();
    await expect(vault.unlock('first password 1234')).rejects.toThrow(/Incorrect/);
    await vault.unlock('second password 5678');
    expect(vault.get(saved.id, true).password).toBe('SuperSecret123');
  });

  it('requires the current password to change it', async () => {
    await vault.setupMaster('first password 1234');
    await expect(vault.changeMaster('not the password', 'second password 5678')).rejects.toThrow(/Incorrect/);
  });

  it('removes the lock and leaves records readable', async () => {
    const saved = vault.save(SAMPLE);
    await vault.setupMaster('correct horse battery');
    const status = await vault.disableMaster('correct horse battery');
    expect(status.masterConfigured).toBe(false);
    expect(status.recordsSealed).toBe(false);
    expect(vault.get(saved.id, true).password).toBe('SuperSecret123');
    expect(existsSync(path.join(dir, 'novaris-vault.bin.lock.json'))).toBe(false);
    expect(readContainer()).toHaveLength(1);
  });

  it('requires the password to remove the lock', async () => {
    await vault.setupMaster('correct horse battery');
    await expect(vault.disableMaster('not the password')).rejects.toThrow(/Incorrect/);
    expect(vault.status().masterConfigured).toBe(true);
  });

  it('rejects a master password that is too short', async () => {
    await expect(vault.setupMaster('short')).rejects.toThrow(/at least 8/);
  });

  it('starts locked after a restart once a master password exists', async () => {
    vault.save(SAMPLE);
    await vault.setupMaster('correct horse battery');
    const restarted = newVault();
    expect(restarted.status().locked).toBe(true);
    expect(restarted.status().masterConfigured).toBe(true);
    expect((await restarted.unlock('correct horse battery')).locked).toBe(false);
  });
});

describe('Novaris vault format compatibility', () => {
  it('reads a version 1 container that has no password layer', async () => {
    // Written before per-record sealing existed.
    const records = [{
      id: 'legacy-1',
      title: 'Google',
      url: 'https://accounts.google.com',
      username: 'me@gmail.com',
      email: '',
      password: 'LegacySecret123',
      notes: '',
      createdAt: 1,
      updatedAt: 1,
    }];
    writeFileSync(path.join(dir, 'legacy-vault.bin'), Buffer.concat([
      VAULT_MAGIC,
      safeStorage.encryptString(JSON.stringify(records)),
    ]));

    const reader = newVault('legacy-vault.bin');
    expect(reader.list()).toHaveLength(1);
    expect(reader.get('legacy-1', true).password).toBe('LegacySecret123');
  });

  it('refuses a sealed container under a different master password', async () => {
    vault.save(SAMPLE);
    await vault.setupMaster('first password 1234');
    const source = path.join(dir, 'novaris-vault.bin');
    const copy = path.join(dir, 'copy.bin');
    writeFileSync(copy, readFileSync(source));
    writeFileSync(`${copy}.lock.json`, readFileSync(`${source}.lock.json`));

    const other = newVault('copy.bin');
    expect(other.status().locked).toBe(true);
    await expect(other.unlock('a different password 9999')).rejects.toThrow(/Incorrect master password/);
    expect(other.status().locked).toBe(true);
  });

  it('cannot recover records when the lock file is missing', async () => {
    vault.save(SAMPLE);
    await vault.setupMaster('first password 1234');
    const copy = path.join(dir, 'orphan.bin');
    writeFileSync(copy, readFileSync(path.join(dir, 'novaris-vault.bin')));
    const orphan = newVault('orphan.bin');
    expect(orphan.status().error).toMatch(/browser password/i);
  });

  it('exports a portable file that is not bound to the master password', async () => {
    const saved = vault.save(SAMPLE);
    await vault.setupMaster('correct horse battery');
    const exported = vault.exportEncrypted(path.join(dir, 'exported.nvx'));
    // The export is still encrypted at rest.
    expect(readFileSync(exported, 'utf8')).not.toContain('SuperSecret123');
    // It is not sealed with the master key, so another vault can read it.
    expect(Array.isArray(readContainerFile(exported))).toBe(true);

    const target = newVault('restored.bin');
    target.setupMaster('a different password 4321');
    target.importEncrypted(exported);
    expect(target.get(saved.id, true).password).toBe('SuperSecret123');
  });

  it('reports a clear error for a file that is not a Novaris vault', async () => {
    const bogus = path.join(dir, 'bogus.bin');
    writeFileSync(bogus, Buffer.from('not a vault at all'));
    expect(() => vault.importEncrypted(bogus)).toThrow(/not a Novaris encrypted vault/i);
  });
});
