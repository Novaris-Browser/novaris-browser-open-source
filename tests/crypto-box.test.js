import { describe, expect, it } from 'vitest';
import {
  CIPHER_AES,
  CIPHER_CHACHA,
  KEY_BYTES,
  argon2Implementation,
  constantTimeEquals,
  deriveKeyAsync,
  deriveKeyWithParams,
  describeCapabilities,
  newSalt,
  open,
  preferCipher,
  seal,
  wipe,
} from '../electron/crypto-box.js';

const hex = (buffer) => buffer.toString('hex');

describe('Novaris key derivation (Argon2id)', () => {
  // Electron's Node build exposes crypto.argon2 as a function but throws
  // ERR_CRYPTO_ARGON2_NOT_SUPPORTED, so these assert a real derivation rather
  // than the presence of the function.
  it('actually derives a key in this runtime, not merely exposes the function', async () => {
    expect(['native', 'wasm']).toContain(argon2Implementation());
    expect(await deriveKeyAsync('probe', newSalt())).toHaveLength(KEY_BYTES);
  });

  it('reports a usable Argon2id implementation', () => {
    expect(describeCapabilities().argon2id).toBe(true);
    expect(['native', 'wasm']).toContain(describeCapabilities().argon2Implementation);
  });

  it('is deterministic for the same password and salt', async () => {
    const salt = newSalt();
    expect(hex(await deriveKeyAsync('same', salt))).toBe(hex(await deriveKeyAsync('same', salt)));
  });

  it('produces a different key for a different salt', async () => {
    expect(hex(await deriveKeyAsync('same', newSalt()))).not.toBe(hex(await deriveKeyAsync('same', newSalt())));
  });

  it('produces a different key for a different password', async () => {
    const salt = newSalt();
    expect(hex(await deriveKeyAsync('one', salt))).not.toBe(hex(await deriveKeyAsync('two', salt)));
  });

  it('records its parameters so the cost can be raised later', async () => {
    const result = await deriveKeyWithParams('hunter2hunter2');
    expect(result.kdf).toMatchObject({
      algorithm: 'argon2id',
      memory: expect.any(Number),
      passes: expect.any(Number),
      parallelism: expect.any(Number),
    });
    expect(result.salt).toMatch(/^[0-9a-f]{32}$/);
    expect(result.key).toHaveLength(KEY_BYTES);
  });

  it('uses a fresh salt every time', async () => {
    const first = await deriveKeyWithParams('a');
    const second = await deriveKeyWithParams('a');
    expect(first.salt).not.toBe(second.salt);
    expect(hex(first.key)).not.toBe(hex(second.key));
  });

  it('is fast enough to unlock interactively', async () => {
    const salt = newSalt();
    const started = Date.now();
    await deriveKeyAsync('interactive unlock password', salt);
    // Generous ceiling: the WebAssembly build measures about 55 ms, while a
    // pure-JavaScript implementation was measured at over 10 seconds.
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe('Novaris authenticated encryption', () => {
  const ciphers = [CIPHER_AES, CIPHER_CHACHA].filter((cipher) => describeCapabilities().preferredCipher
    || describeCapabilities().aes256gcm || describeCapabilities().chacha20poly1305);

  for (const cipher of ciphers) {
    describe(cipher, () => {
      it('round-trips a value', async () => {
        const key = await deriveKeyAsync('vault key material', newSalt());
        const envelope = seal('correct horse battery staple', key, { cipher });
        expect(open(envelope, key)).toBe('correct horse battery staple');
      });

      it('uses a unique nonce for every item', async () => {
        const key = await deriveKeyAsync('vault key material', newSalt());
        const nonces = new Set();
        for (let i = 0; i < 200; i += 1) nonces.add(seal(`item-${i}`, key, { cipher }).nonce);
        expect(nonces.size).toBe(200);
      });

      it('produces different ciphertext for identical input', async () => {
        const key = await deriveKeyAsync('vault key material', newSalt());
        expect(seal('same', key, { cipher }).data).not.toBe(seal('same', key, { cipher }).data);
      });

      it('refuses a tampered ciphertext', async () => {
        const key = await deriveKeyAsync('vault key material', newSalt());
        const envelope = seal('secret', key, { cipher });
        const bytes = Buffer.from(envelope.data, 'hex');
        bytes[0] ^= 0xff;
        expect(() => open({ ...envelope, data: bytes.toString('hex') }, key)).toThrow();
      });

      it('refuses a tampered tag', async () => {
        const key = await deriveKeyAsync('vault key material', newSalt());
        const envelope = seal('secret', key, { cipher });
        const tag = Buffer.from(envelope.tag, 'hex');
        tag[0] ^= 0xff;
        expect(() => open({ ...envelope, tag: tag.toString('hex') }, key)).toThrow();
      });

      it('refuses a wrong key', async () => {
        const key = await deriveKeyAsync('vault key material', newSalt());
        const other = await deriveKeyAsync('a different key entirely', newSalt());
        expect(() => open(seal('secret', key, { cipher }), other)).toThrow();
      });

      it('refuses an unknown cipher rather than guessing', async () => {
        const key = await deriveKeyAsync('vault key material', newSalt());
        const envelope = seal('secret', key, { cipher });
        expect(() => open({ ...envelope, cipher: 'rc4' }, key)).toThrow(/Unsupported cipher/);
      });

      it('refuses a malformed nonce', async () => {
        const key = await deriveKeyAsync('vault key material', newSalt());
        const envelope = seal('secret', key, { cipher });
        expect(() => open({ ...envelope, nonce: 'abcd' }, key)).toThrow(/nonce/i);
        expect(() => open({ ...envelope, nonce: 'z'.repeat(24) }, key)).toThrow(/nonce/i);
      });

      it('binds the ciphertext to its context', async () => {
        const key = await deriveKeyAsync('vault key material', newSalt());
        const envelope = seal('value', key, { cipher, additionalData: 'record-a' });
        expect(open(envelope, key, { additionalData: 'record-a' })).toBe('value');
        // Opening the same envelope as a different record must fail, even though
        // the envelope still carries its original context internally.
        expect(() => open(envelope, key, { additionalData: 'record-b' })).toThrow(/does not belong/);
      });
    });
  }
});

describe('Novaris cipher selection', () => {
  it('prefers AES-256-GCM when the runtime provides it', () => {
    const capabilities = describeCapabilities();
    expect(capabilities.aes256gcm).toBe(true);
    expect(preferCipher()).toBe(CIPHER_AES);
  });

  it('reports whether the ChaCha20-Poly1305 fallback exists', () => {
    // Electron's OpenSSL build may omit it; the value is reported rather than
    // assumed, so the UI never claims a cipher the runtime cannot provide.
    expect(typeof describeCapabilities().chacha20poly1305).toBe('boolean');
  });
});

describe('Novaris key hygiene', () => {
  it('wipes key material in place', async () => {
    const key = await deriveKeyAsync('to be wiped', newSalt());
    const before = Buffer.from(key);
    wipe(key);
    expect(key.equals(before)).toBe(false);
    expect(key.every((byte) => byte === 0)).toBe(true);
  });

  it('compares values without leaking timing through length or content', () => {
    expect(constantTimeEquals(Buffer.from('aabb', 'hex'), Buffer.from('aabb', 'hex'))).toBe(true);
    expect(constantTimeEquals(Buffer.from('aabb', 'hex'), Buffer.from('aabc', 'hex'))).toBe(false);
    expect(constantTimeEquals(Buffer.from('aabb', 'hex'), Buffer.from('aa', 'hex'))).toBe(false);
  });

  it('rejects a key of the wrong size', async () => {
    const key = await deriveKeyAsync('vault key material', newSalt());
    expect(() => seal('x', Buffer.alloc(16), { cipher: CIPHER_AES })).toThrow(/256-bit key/);
    expect(() => open(seal('x', key), Buffer.alloc(64))).toThrow(/256-bit key/);
  });
});
