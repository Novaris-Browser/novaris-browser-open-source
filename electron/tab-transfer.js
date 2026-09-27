// Client half of tab transfer: seals a tab for the relay and opens it again.
//
// The relay stores bytes it cannot read, which is the only reason it is safe to
// run on infrastructure you do not fully control. That guarantee lives here, in
// the client, so it is worth being explicit about what it covers.
//
// The passphrase never leaves this device. The salt and nonce travel with the
// ciphertext, which is standard for AES-GCM and not a weakness: they are public
// by definition. What protects the payload is the passphrase itself, so the
// security of a transfer is the security of the words the user picks. A short
// passphrase is weak regardless of the iteration count, which is why this refuses
// to encrypt with one rather than quietly producing something that looks safe.
//
// This lives under electron/ rather than in the renderer because the main process
// needs it: the packaged application only ships the dist, electron, and assets
// directories, so a module under src/ simply is not there at runtime. Keeping the
// one copy in electron/ is what stops the renderer and the process from drifting
// apart, and it is why the renderer imports this file directly.

const PBKDF2_ITERATIONS = 310000; // OWASP's 2023 figure for PBKDF2-HMAC-SHA256.
const MIN_PASSPHRASE_LENGTH = 12;
const SALT_BYTES = 16;
const IV_BYTES = 12;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function randomId() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

function bytesToBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function bytesToBase64Url(bytes) {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(value) {
  const padded = String(value).replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function deriveKey(passphrase, salt) {
  const material = await crypto.subtle.importKey('raw', encoder.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/**
 * Rejects a passphrase too short to be worth anything. A browser cannot force a
 * strong passphrase, and 310000 iterations only help if the input has real
 * entropy, so failing loudly beats producing a blob that looks protected.
 */
function assertUsablePassphrase(passphrase) {
  const text = String(passphrase || '');
  if (text.length < MIN_PASSPHRASE_LENGTH) {
    throw new Error(`Use a passphrase of at least ${MIN_PASSPHRASE_LENGTH} characters. Short passphrases are not worth encrypting with.`);
  }
  return text;
}

/**
 * Encrypts a payload for transfer.
 *
 * The additional authenticated data binds the ciphertext to this transfer's id,
 * so a blob cannot be moved onto a different id and still open, and a tab cannot
 * be substituted by whoever holds the relay.
 */
async function sealPayload(payload, passphrase, transferId = randomId()) {
  const text = assertUsablePassphrase(passphrase);
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(text, salt);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: encoder.encode(transferId) },
    key,
    encoder.encode(JSON.stringify(payload)),
  );
  return {
    id: transferId,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext)),
    attempts: 1,
  };
}

/** Opens a payload produced by sealPayload. Throws if the passphrase is wrong. */
async function openPayload(envelope, passphrase) {
  const id = String(envelope?.id || '');
  const salt = base64UrlToBytes(envelope.salt);
  const iv = base64UrlToBytes(envelope.iv);
  const ciphertext = base64UrlToBytes(envelope.ciphertext);
  const key = await deriveKey(assertUsablePassphrase(passphrase), salt);
  let plaintext;
  try {
    plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: encoder.encode(id) },
      key,
      ciphertext,
    );
  } catch {
    // A wrong passphrase and a tampered blob are indistinguishable, which is the
    // correct behaviour: the caller learns only that it did not open.
    throw new Error('That passphrase did not open this transfer. It may be the wrong one, or the transfer may have been altered.');
  }
  const parsed = JSON.parse(decoder.decode(plaintext));
  if (!parsed || typeof parsed !== 'object' || typeof parsed.url !== 'string') {
    throw new Error('The transfer opened but did not contain a tab.');
  }
  return parsed;
}

/**
 * Builds the payload for a tab. Only what is needed to reopen the tab travels,
 * and never a credential: a vault login is not transferable, because the
 * receiving device does not hold the key that would unseal it.
 */
function tabPayload(tab = {}) {
  return {
    url: String(tab.url || 'about:blank'),
    title: String(tab.title || '').slice(0, 240),
    groupId: tab.groupId || '',
    workspaceId: tab.workspaceId || '',
    zoom: Number(tab.zoom) || 1,
    sentAt: Date.now(),
  };
}

module.exports = {
  MIN_PASSPHRASE_LENGTH,
  PBKDF2_ITERATIONS,
  assertUsablePassphrase,
  openPayload,
  randomId,
  sealPayload,
  tabPayload,
};
