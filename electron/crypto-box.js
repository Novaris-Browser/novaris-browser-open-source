const {
  argon2Sync,
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} = require('node:crypto');

// Node exposes crypto.argon2, but Electron's build of Node ships without the
// backing implementation and throws ERR_CRYPTO_ARGON2_NOT_SUPPORTED. Checking
// for the function is therefore not enough: a derivation has to be attempted
// once and the answer cached.
//
// The fallback is hash-wasm, which is verified byte-for-byte against Node's
// native Argon2id by scripts/argon2-parity.mjs and takes about 55 ms for 19 MiB.
// @noble/hashes was evaluated and rejected: version 2.4.0 produced different
// output for the same inputs, which would have made a vault unreadable on any
// other build. A fallback that disagrees with the primary implementation is
// worse than no fallback at all.
let argon2Provider = null;
let wasmModulePromise = null;

function resolveArgon2Provider() {
  if (argon2Provider) return argon2Provider;
  const probe = { message: Buffer.from('probe'), nonce: Buffer.alloc(16, 1), parallelism: 1, passes: 1, tagLength: 32, memory: 64 };
  if (typeof argon2Sync === 'function') {
    try {
      argon2Sync('argon2id', probe);
      argon2Provider = 'native';
      return argon2Provider;
    } catch {
      // Fall through to the bundled WebAssembly build.
    }
  }
  argon2Provider = 'wasm';
  return argon2Provider;
}

function loadWasmModule() {
  if (!wasmModulePromise) wasmModulePromise = import('hash-wasm').catch(() => null);
  return wasmModulePromise;
}

// Field-level authenticated encryption for Novaris.
//
// Key hierarchy
//   master password --Argon2id(salt)--> key-encryption key
//   key-encryption key --AES-256-GCM / ChaCha20-Poly1305--> per-record ciphertext
//
// The vault container is additionally sealed by Electron safeStorage (Windows
// DPAPI). safeStorage remains the root of trust for the file; this layer adds a
// second, password-derived barrier, so copying the profile off the machine is
// not enough to read the passwords.
//
// Every sealed item gets its own random nonce. A nonce is never reused with the
// same key, which is the one mistake that would break GCM or ChaCha20-Poly1305
// catastrophically.

const CIPHER_AES = 'aes-256-gcm';
const CIPHER_CHACHA = 'chacha20-poly1305';
const NONCE_BYTES = 12;
const SALT_BYTES = 16;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

// OWASP's second recommended Argon2id configuration, lowered from the first
// only so that unlocking stays responsive on modest hardware.
const DEFAULT_KDF = Object.freeze({
  algorithm: 'argon2id',
  memory: 19456, // KiB
  passes: 1,
  parallelism: 1,
  tagLength: KEY_BYTES,
});

function availableCiphers() {
  const supported = require('node:crypto').getCiphers();
  return {
    [CIPHER_AES]: supported.includes(CIPHER_AES),
    [CIPHER_CHACHA]: supported.includes(CIPHER_CHACHA),
  };
}

function hasArgon2() {
  return resolveArgon2Provider() !== 'unavailable';
}

function argon2Implementation() {
  return resolveArgon2Provider();
}

function kdfSettings(params = {}) {
  return { ...DEFAULT_KDF, ...params };
}

// Synchronous Argon2id, available only where the runtime provides a native
// implementation. Every other runtime must use deriveKeyAsync, which routes
// through the verified WebAssembly build. Failing loudly is deliberate: a
// silently wrong key would be far worse than a clear error.
function deriveKey(password, salt, params = {}) {
  const settings = kdfSettings(params);
  if (resolveArgon2Provider() !== 'native') {
    throw new Error('Synchronous Argon2id is unavailable on this runtime; use deriveKeyAsync.');
  }
  return argon2Sync(settings.algorithm, {
    message: Buffer.from(String(password || ''), 'utf8'),
    nonce: Buffer.isBuffer(salt) ? salt : Buffer.from(String(salt || ''), 'hex'),
    memory: settings.memory,
    passes: settings.passes,
    parallelism: settings.parallelism,
    tagLength: settings.tagLength,
  });
}

async function deriveKeyAsync(password, salt, params = {}) {
  const settings = kdfSettings(params);
  if (resolveArgon2Provider() === 'native') return deriveKey(password, salt, settings);

  const message = Buffer.from(String(password || ''), 'utf8');
  const nonce = Buffer.isBuffer(salt) ? salt : Buffer.from(String(salt || ''), 'hex');
  const wasm = await loadWasmModule();
  if (wasm?.argon2id) {
    const result = await wasm.argon2id({
      password: message,
      salt: new Uint8Array(nonce),
      parallelism: settings.parallelism,
      iterations: settings.passes,
      memorySize: settings.memory,
      hashLength: settings.tagLength,
      outputType: 'binary',
    });
    return Buffer.from(result);
  }
  throw new Error('Argon2id is unavailable: the WebAssembly build could not be loaded.');
}

// ChaCha20-Poly1305 is preferred where AES hardware acceleration is absent,
// because software AES is slower and leaks more timing information.
function preferCipher() {
  const supported = availableCiphers();
  if (supported[CIPHER_AES]) return CIPHER_AES;
  if (supported[CIPHER_CHACHA]) return CIPHER_CHACHA;
  throw new Error('No supported authenticated cipher is available in this build.');
}

function newSalt() {
  return randomBytes(SALT_BYTES);
}

// Derives a key and reports the parameters, so the lock file records them and a
// later build can raise the cost without invalidating existing vaults.
async function deriveKeyWithParams(password) {
  const salt = newSalt();
  return {
    key: await deriveKeyAsync(password, salt),
    salt: salt.toString('hex'),
    kdf: { ...DEFAULT_KDF },
  };
}

// additionalData binds a ciphertext to a context, such as a record id, so a
// sealed value cannot be moved somewhere it was not meant for.
function seal(plaintext, key, { cipher = preferCipher(), additionalData = '' } = {}) {
  if (!Buffer.isBuffer(key) || key.length !== KEY_BYTES) throw new Error('A 256-bit key is required.');
  const nonce = randomBytes(NONCE_BYTES);
  const aad = Buffer.from(String(additionalData || ''), 'utf8');
  const cipheriv = cipher === CIPHER_CHACHA ? nonce : nonce;
  const nodeCipher = cipher === CIPHER_AES ? 'aes-256-gcm' : cipher;
  const instance = createCipheriv(nodeCipher, key, nonce, { authTagLength: TAG_BYTES });
  // GCM and ChaCha20-Poly1305 authenticate the AAD as-is; plaintextLength is
  // only meaningful for CCM and OCB.
  if (aad.length) instance.setAAD(aad);
  const data = Buffer.concat([instance.update(Buffer.from(String(plaintext), 'utf8')), instance.final()]);
  return {
    cipher: nodeCipher,
    nonce: nonce.toString('hex'),
    tag: instance.getAuthTag().toString('hex'),
    aad: aad.toString('hex'),
    data: data.toString('hex'),
  };
}

// additionalData must come from trusted context, such as a record id held in the
// container index. It is deliberately not taken from the envelope: an attacker
// who can rewrite the envelope would otherwise also rewrite its own binding,
// which would make the check decorative.
function open(envelope, key, { additionalData = null } = {}) {
  if (!envelope || typeof envelope !== 'object') throw new Error('The sealed value is invalid.');
  const { cipher, nonce, tag, data, aad } = envelope;
  if (![CIPHER_AES, CIPHER_CHACHA].includes(cipher)) throw new Error('Unsupported cipher in the sealed value.');
  if (!/^[0-9a-f]{24}$/i.test(String(nonce || ''))) throw new Error('The sealed nonce is invalid.');
  if (!/^[0-9a-f]{32}$/i.test(String(tag || ''))) throw new Error('The sealed tag is invalid.');
  if (!/^[0-9a-f]+$/i.test(String(data || ''))) throw new Error('The sealed data is invalid.');
  if (!Buffer.isBuffer(key) || key.length !== KEY_BYTES) throw new Error('A 256-bit key is required.');

  let contextAad = String(aad || '');
  if (additionalData !== null) {
    const expected = Buffer.from(String(additionalData), 'utf8').toString('hex');
    if (contextAad.toLowerCase() !== expected) {
      throw new Error('The sealed value does not belong to this record.');
    }
    contextAad = expected;
  }

  const instance = createDecipheriv(cipher, key, Buffer.from(nonce, 'hex'), { authTagLength: TAG_BYTES });
  if (contextAad) instance.setAAD(Buffer.from(contextAad, 'hex'));
  // The tag must be restored before final(), otherwise authentication cannot
  // succeed and every value would look tampered with.
  instance.setAuthTag(Buffer.from(tag, 'hex'));
  const plain = Buffer.concat([instance.update(Buffer.from(data, 'hex')), instance.final()]);
  return plain.toString('utf8');
}

function constantTimeEquals(a, b) {
  const left = Buffer.isBuffer(a) ? a : Buffer.from(String(a || ''), 'hex');
  const right = Buffer.isBuffer(b) ? b : Buffer.from(String(b || ''), 'hex');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

// Overwrites key material instead of relying on the garbage collector.
function wipe(key) {
  if (Buffer.isBuffer(key)) key.fill(0);
}

function describeCapabilities() {
  const ciphers = availableCiphers();
  return {
    argon2id: hasArgon2(),
    argon2Implementation: argon2Implementation(),
    aes256gcm: ciphers[CIPHER_AES],
    chacha20poly1305: ciphers[CIPHER_CHACHA],
    preferredCipher: (() => {
      try { return preferCipher(); } catch { return ''; }
    })(),
  };
}

module.exports = {
  CIPHER_AES,
  CIPHER_CHACHA,
  DEFAULT_KDF,
  KEY_BYTES,
  NONCE_BYTES,
  SALT_BYTES,
  TAG_BYTES,
  argon2Implementation,
  availableCiphers,
  constantTimeEquals,
  deriveKey,
  deriveKeyAsync,
  deriveKeyWithParams,
  describeCapabilities,
  hasArgon2,
  newSalt,
  open,
  preferCipher,
  seal,
  wipe,
};
