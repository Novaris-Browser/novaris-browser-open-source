const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { safeStorage } = require('electron');
const {
  DEFAULT_KDF,
  constantTimeEquals,
  deriveKeyAsync,
  deriveKeyWithParams,
  describeCapabilities,
  newSalt,
  open: openSealed,
  preferCipher,
  seal,
  wipe,
} = require('./crypto-box');

const VAULT_MAGIC = Buffer.from('NOVARIS_VAULT_V1\n', 'utf8');
// Bumped when the master lock file moved from scrypt to Argon2id.
const LOCK_VERSION = 2;
const VERIFIER_PLAINTEXT = 'novaris-vault-verifier-v2';

// Which keyring Chromium will actually use to protect the vault file.
function storageBackend() {
  if (process.platform !== 'linux') return 'platform-default';
  if (typeof safeStorage.getSelectedStorageBackend !== 'function') return 'unknown';
  try { return String(safeStorage.getSelectedStorageBackend() || 'unknown'); } catch { return 'unknown'; }
}

// On Linux, safeStorage can select a backend called "basic_text", which encrypts
// the payload with a hardcoded password that ships in Chromium's own source.
// isEncryptionAvailable() still reports true for it, so availability alone is not
// enough to decide whether the vault is protected: a user with no desktop
// keyring would be shown "Encryption available" while anyone who copied the
// profile could read it. Requiring a real keyring keeps the claim true, and the
// passwords simply stay unavailable until the user installs one.
const INSECURE_BACKENDS = new Set(['basic_text', 'unknown']);

function storageBackendIsTrusted() {
  const backend = storageBackend();
  return !INSECURE_BACKENDS.has(backend);
}

function unavailableReason() {
  if (process.platform !== 'linux') return 'System encryption is not available.';
  const backend = storageBackend();
  if (backend === 'basic_text') {
    return 'No system keyring is available. Novaris needs GNOME Keyring, KWallet, or another Secret Service provider to encrypt the vault.';
  }
  if (backend === 'unknown') {
    return 'The system keyring could not be identified. Novaris will not guess whether it is safe.';
  }
  return 'System encryption is not available.';
}

function safeText(value, maxLength = 500) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, maxLength);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function withoutPassword(record) {
  const { password, ...safe } = record;
  return { ...safe, hasPassword: Boolean(password) };
}

function normalizeImportedRecord(item) {
  if (!item || typeof item !== 'object') return null;
  const url = safeText(item.url, 2048);
  return {
    id: safeText(item.id, 100),
    title: safeText(item.title, 160),
    url: isHttpUrl(url) ? new URL(url).toString() : '',
    username: safeText(item.username, 240),
    email: safeText(item.email, 320),
    password: typeof item.password === 'string' ? item.password.slice(0, 1024) : '',
    notes: safeText(item.notes, 2000),
    createdAt: Number.isFinite(item.createdAt) ? item.createdAt : Date.now(),
    updatedAt: Number.isFinite(item.updatedAt) ? item.updatedAt : Date.now(),
  };
}

class Vault {
  constructor(filePath) {
    this.filePath = filePath;
    this.cache = null;
    this.error = null;
    this.lockPath = `${filePath}.lock.json`;
    this.masterConfigured = false;
    this.locked = false;
    // Derived from the master password while unlocked, and wiped on lock.
    this.key = null;
    this.cipher = '';
  }

  init() {
    this.cache = null;
    this.error = null;
    this._wipeKey();
    this.masterConfigured = fs.existsSync(this.lockPath);
    this.locked = this.masterConfigured;
    if (this.locked) return;
    try {
      this._read();
    } catch (error) {
      this.error = error.message;
      this.cache = [];
    }
  }

  _wipeKey() {
    if (this.key) wipe(this.key);
    this.key = null;
  }

  isAvailable() {
    return safeStorage.isEncryptionAvailable() && storageBackendIsTrusted();
  }

  status() {
    let count = 0;
    let error = null;
    if (!this.locked) {
      try { count = this.list().length; } catch (readError) { error = readError.message; }
    }
    return {
      available: this.isAvailable(),
      backend: storageBackend(),
      reason: this.isAvailable() ? '' : unavailableReason(),
      count,
      error: error || this.error,
      locked: this.locked,
      masterConfigured: this.masterConfigured,
      cipher: this.cipher || this._cipher(),
      kdf: this.masterConfigured ? 'argon2id' : '',
      recordsSealed: Boolean(this.key),
      capabilities: describeCapabilities(),
    };
  }

  list() {
    this._assertUnlocked();
    return this._read().map(withoutPassword);
  }

  get(id, includePassword = false) {
    this._assertUnlocked();
    const record = this._read().find((item) => item.id === id);
    if (!record) return null;
    return includePassword ? clone(record) : withoutPassword(record);
  }

  save(input = {}) {
    this._assertUnlocked();
    this._assertAvailable();
    const title = safeText(input.title, 160);
    const url = safeText(input.url, 2048);
    const username = safeText(input.username, 240);
    const email = safeText(input.email, 320);
    const password = typeof input.password === 'string' ? input.password.slice(0, 1024) : '';
    const notes = safeText(input.notes, 2000);
    if (!title && !url) throw new Error('Add a website or a name for this login.');
    if (url && !isHttpUrl(url)) throw new Error('Only HTTP and HTTPS websites can be saved.');
    if (!username && !email) throw new Error('Add a username or email address.');
    if (!password) throw new Error('Add a password.');

    const records = this._read();
    const now = Date.now();
    const record = {
      id: randomUUID(),
      title: title || new URL(url).hostname,
      url: url ? new URL(url).toString() : '',
      username,
      email,
      password,
      notes,
      createdAt: now,
      updatedAt: now,
    };
    records.unshift(record);
    this._write(records.slice(0, 500));
    return withoutPassword(record);
  }

  update(id, input = {}) {
    this._assertUnlocked();
    this._assertAvailable();
    const records = this._read();
    const index = records.findIndex((item) => item.id === id);
    if (index === -1) return null;
    const current = records[index];
    const next = {
      ...current,
      title: Object.prototype.hasOwnProperty.call(input, 'title') ? safeText(input.title, 160) : current.title,
      url: Object.prototype.hasOwnProperty.call(input, 'url') ? safeText(input.url, 2048) : current.url,
      username: Object.prototype.hasOwnProperty.call(input, 'username') ? safeText(input.username, 240) : current.username,
      email: Object.prototype.hasOwnProperty.call(input, 'email') ? safeText(input.email, 320) : current.email,
      password: Object.prototype.hasOwnProperty.call(input, 'password') ? String(input.password).slice(0, 1024) : current.password,
      notes: Object.prototype.hasOwnProperty.call(input, 'notes') ? safeText(input.notes, 2000) : current.notes,
      updatedAt: Date.now(),
    };
    if (next.url && !isHttpUrl(next.url)) throw new Error('Only HTTP and HTTPS websites can be saved.');
    if (!next.title && !next.url) throw new Error('Add a website or a name for this login.');
    if (!next.username && !next.email) throw new Error('Add a username or email address.');
    if (!next.password) throw new Error('Add a password.');
    records[index] = { ...next, url: next.url ? new URL(next.url).toString() : '' };
    this._write(records);
    return withoutPassword(records[index]);
  }

  remove(id) {
    this._assertUnlocked();
    this._assertAvailable();
    const records = this._read();
    const next = records.filter((item) => item.id !== id);
    this._write(next);
    return next.length !== records.length;
  }

  secret(id, field) {
    this._assertUnlocked();
    this._assertAvailable();
    if (!['username', 'email', 'password', 'notes'].includes(field)) {
      throw new Error('Unsupported vault field.');
    }
    const record = this.get(id, true);
    if (!record) return null;
    return record[field] || '';
  }

  async setMaster(password) {
    this._assertAvailable();
    const value = String(password || '');
    if (value.length < 8) throw new Error('Use a master password with at least 8 characters.');
    if (this.masterConfigured && this.locked) throw new Error('Unlock the vault before changing its master password.');

    // Existing records must be read with the key that can currently open them,
    // before the new key replaces it, or a re-key could not migrate them.
    const existing = this._read();

    // A fresh salt and Argon2id parameters are stored with the lock file, so a
    // future build can raise the cost without breaking existing vaults.
    const { key: derived, salt, kdf } = await deriveKeyWithParams(value);
    const lock = {
      version: LOCK_VERSION,
      kdf,
      salt,
      cipher: this._cipher(),
      // Proves the password and yields the key without ever storing it.
      verifier: seal(VERIFIER_PLAINTEXT, derived, { cipher: this._cipher(), additionalData: 'verifier' }),
    };
    const temporaryPath = `${this.lockPath}.tmp`;
    fs.writeFileSync(temporaryPath, JSON.stringify(lock), { mode: 0o600 });
    fs.rmSync(this.lockPath, { force: true });
    fs.renameSync(temporaryPath, this.lockPath);
    this._wipeKey();
    this.masterConfigured = true;
    this.locked = false;
    this.cache = null;
    this.key = derived;
    this.cipher = lock.cipher;
    // Re-encrypt every record under the new key so the old one is gone.
    this._write(existing);
    return this.status();
  }

  async setupMaster(password) {
    await this.setMaster(password);
    return this.status();
  }

  async unlock(password) {
    this._assertAvailable();
    if (!this.masterConfigured) return this.status();
    let lock;
    try { lock = JSON.parse(fs.readFileSync(this.lockPath, 'utf8')); } catch { throw new Error('The vault lock file is unavailable.'); }
    if (!lock || lock.version !== LOCK_VERSION || !lock.kdf || !/^[0-9a-f]{32,}$/i.test(String(lock.salt || '')) || !lock.verifier) {
      throw new Error('The vault lock file is invalid.');
    }
    const derived = await deriveKeyAsync(String(password || ''), Buffer.from(String(lock.salt), 'hex'), lock.kdf);
    // Opening the verifier is the password check: it only succeeds when the
    // derived key is correct, and it hands back the usable key.
    let opened;
    try {
      opened = openSealed(lock.verifier, derived, { additionalData: 'verifier' });
    } catch {
      wipe(derived);
      throw new Error('Incorrect master password.');
    }
    if (!constantTimeEquals(opened, VERIFIER_PLAINTEXT)) {
      wipe(derived);
      throw new Error('Incorrect master password.');
    }
    this.key = derived;
    this.cipher = lock.cipher || this._cipher();
    this.locked = false;
    this.cache = null;
    this._read();
    return this.status();
  }

  async changeMaster(currentPassword, newPassword) {
    this._assertAvailable();
    await this.unlock(currentPassword);
    await this.setMaster(newPassword);
    return this.status();
  }

  async disableMaster(password) {
    this._assertAvailable();
    if (!this.masterConfigured) return this.status();
    await this.unlock(password);
    const records = this._read();
    // The key must be released *before* rewriting, otherwise the container is
    // written still sealed and then becomes unreadable for good.
    this._wipeKey();
    this.cache = records;
    this._write(records);
    fs.rmSync(this.lockPath, { force: true });
    this.masterConfigured = false;
    this.locked = false;
    this.cache = null;
    this.cipher = '';
    this._read();
    return this.status();
  }

  lock() {
    if (!this.masterConfigured) return this.status();
    this._wipeKey();
    this.locked = true;
    this.cache = null;
    return this.status();
  }

  // An export must not stay bound to the master password, or it could never be
  // imported anywhere else. It is written in the plain record shape and relies
  // on the safeStorage container, as it did before per-record sealing existed.
  _encodePortable(records) {
    return records.map((record) => clone(record));
  }

  _writeContainer(targetPath, payload) {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    const encrypted = safeStorage.encryptString(JSON.stringify(payload));
    const temporaryPath = `${targetPath}.tmp`;
    if (fs.existsSync(targetPath)) fs.copyFileSync(targetPath, `${targetPath}.bak`);
    fs.writeFileSync(temporaryPath, Buffer.concat([VAULT_MAGIC, encrypted]), { mode: 0o600 });
    fs.rmSync(targetPath, { force: true });
    fs.renameSync(temporaryPath, targetPath);
  }

  exportEncrypted(destination) {
    this._assertUnlocked();
    this._assertAvailable();
    if (!fs.existsSync(this.filePath)) this._write([]);
    const target = path.resolve(String(destination));
    if (path.resolve(this.filePath) !== target) {
      this._writeContainer(target, this._encodePortable(this._read()));
    }
    return target;
  }

  importEncrypted(source) {
    this._assertUnlocked();
    this._assertAvailable();
    const sourcePath = path.resolve(String(source));
    const stat = fs.statSync(sourcePath);
    if (stat.size > 20 * 1024 * 1024) throw new Error('That vault file is too large.');
    const buffer = fs.readFileSync(sourcePath);
    if (!buffer.subarray(0, VAULT_MAGIC.length).equals(VAULT_MAGIC)) throw new Error('That is not a Novaris encrypted vault.');
    const parsed = JSON.parse(safeStorage.decryptString(buffer.subarray(VAULT_MAGIC.length)));
    let sourceRecords;
    try {
      // Handles both the plain version 1 layout and a sealed version 2 vault,
      // which can only be opened with the master password it was written under.
      sourceRecords = this._decodeRecords(parsed);
    } catch {
      throw new Error('That vault file cannot be opened here. It may need its own browser password.');
    }
    const records = sourceRecords.map(normalizeImportedRecord).filter((item) => item && item.id && item.password).slice(0, 500);
    if (!records.length && sourceRecords.length) throw new Error('That vault file has no valid credentials.');
    this._write(records);
    return this.status();
  }

  _assertUnlocked() {
    if (this.locked) throw new Error('The password vault is locked.');
  }

  _assertAvailable() {
    if (this.error) throw new Error(this.error);
    if (!this.isAvailable()) {
      throw new Error(unavailableReason() + ' Novaris will not store passwords in plaintext.');
    }
  }

  _cipher() {
    if (!this.cipher) {
      try { this.cipher = preferCipher(); } catch { this.cipher = ''; }
    }
    return this.cipher;
  }

  // When a master password is set, each record is sealed individually so one
  // leaked ciphertext cannot reveal anything and every item gets its own nonce.
  _encodeRecords(records) {
    if (!this.key) return records;
    const cipher = this._cipher();
    return {
      version: LOCK_VERSION,
      sealed: true,
      cipher,
      records: records.map((record) => ({
        id: record.id,
        createdAt: record.createdAt,
        // Binding the id as additional data stops a record being swapped.
        sealed: seal(JSON.stringify(record), this.key, { cipher, additionalData: record.id }),
      })),
    };
  }

  _decodeRecords(payload) {
    if (Array.isArray(payload)) {
      // Version 1: no password layer, only the safeStorage container.
      return payload.filter((item) => item && typeof item.id === 'string');
    }
    if (!payload || typeof payload !== 'object' || payload.sealed !== true || !Array.isArray(payload.records)) {
      throw new Error('The Novaris vault contents are invalid.');
    }
    if (!this.key) {
      throw new Error('This vault is encrypted with a browser password that is not available.');
    }
    return payload.records.map((entry) => {
      if (!entry || typeof entry.id !== 'string' || !entry.sealed) throw new Error('The Novaris vault contents are invalid.');
      // The id comes from the container index, not from the envelope, so a
      // record cannot be swapped for another and still authenticate.
      return JSON.parse(openSealed(entry.sealed, this.key, { additionalData: entry.id }));
    });
  }

  _read() {
    if (this.cache) return this.cache;
    if (!fs.existsSync(this.filePath)) {
      this.cache = [];
      return this.cache;
    }

    const readEncrypted = (filePath) => {
      const buffer = fs.readFileSync(filePath);
      if (!buffer.subarray(0, VAULT_MAGIC.length).equals(VAULT_MAGIC)) throw new Error('The Novaris vault format is invalid.');
      return JSON.parse(safeStorage.decryptString(buffer.subarray(VAULT_MAGIC.length)));
    };
    let parsed;
    try {
      parsed = readEncrypted(this.filePath);
    } catch (error) {
      const backupPath = `${this.filePath}.bak`;
      if (!fs.existsSync(backupPath)) throw error;
      parsed = readEncrypted(backupPath);
    }
    this.cache = this._decodeRecords(parsed);
    return this.cache;
  }

  _write(records) {
    this._assertAvailable();
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const payload = this._encodeRecords(records);
    const encrypted = safeStorage.encryptString(JSON.stringify(payload));
    const temporaryPath = `${this.filePath}.tmp`;
    const backupPath = `${this.filePath}.bak`;
    if (fs.existsSync(this.filePath)) fs.copyFileSync(this.filePath, backupPath);
    fs.writeFileSync(temporaryPath, Buffer.concat([VAULT_MAGIC, encrypted]), { mode: 0o600 });
    fs.rmSync(this.filePath, { force: true });
    fs.renameSync(temporaryPath, this.filePath);
    this.cache = records;
  }
}

module.exports = {
  Vault,
  isHttpUrl,
  storageBackend,
  storageBackendIsTrusted,
  unavailableReason,
};
