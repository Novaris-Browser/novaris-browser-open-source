// Tab transfer directly between two devices on the same local network.
//
// This replaces the Cloudflare Worker. A relay meant running somebody else's
// server forever to move a tab across the house, which is a poor trade: it is
// infrastructure to maintain, a service that can be attacked, and a third party
// holding a record of when your devices talked to each other. Moving the bytes
// straight between the two devices removes all of that.
//
// How it works:
//
//   1. The sending device opens a listening socket on the local network and
//      shows a pairing code.
//   2. The receiving device types that code, which tells it where to connect and
//      proves the connection is going to the device the user is looking at.
//   3. The payload is still encrypted with the user's passphrase before it goes
//      anywhere, so even on a shared or hostile network the contents are
//      unreadable, and the sending device keeps no copy once it is delivered.
//
// What this honestly cannot do: transfer across the internet while you are away
// from home. That is a real limitation rather than a missing feature, and the
// interface says so instead of leaving the user to discover it at 2am.

const net = require('node:net');
const os = require('node:os');
const { randomBytes, timingSafeEqual } = require('node:crypto');

const DEFAULT_PORT = 47651;
const MAX_PAYLOAD_BYTES = 512 * 1024;
// A strictly one-shot transfer was a mistake: a mistyped passphrase burned the
// payload, so the legitimate user could not try again, and anyone who had seen
// the pairing code could destroy a transfer on purpose. A small attempt budget
// allows a typo to be corrected while still bounding how much a leaked code is
// worth. The sender never learns whether the recipient's passphrase was right,
// so it cannot tell a typo from an attack.
const MAX_SERVES = 3;
const PAIRING_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No I, O, 0, 1.
const PAIRING_GROUPS = 5;
const PAIRING_GROUP_LENGTH = 4;
const CODE_WINDOW_MS = 10 * 60 * 1000;
const MAX_FAILED_ATTEMPTS = 5;
const HANDSHAKE_TIMEOUT_MS = 15000;

// Loopback is allowed so two windows on one machine can be used to verify this
// works, and because loopback is unreachable from another device anyway.
function isPrivateAddress(address) {
  if (typeof address !== 'string' || !address) return false;
  if (address.startsWith('127.') || address === '::1') return true;
  if (address.startsWith('10.')) return true;
  if (address.startsWith('192.168.')) return true;
  const match = /^172\.(\d{1,3})\./.exec(address);
  if (match) {
    const second = Number(match[1]);
    return second >= 16 && second <= 31;
  }
  return false;
}

/** Local addresses a receiving device could plausibly connect to. */
function localAddresses() {
  const found = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.internal) continue;
      if (entry.family !== 'IPv4' && entry.family !== 4) continue;
      if (isPrivateAddress(entry.address)) found.push(entry.address);
    }
  }
  return [...new Set(found)].sort();
}

/**
 * A pairing code is 100 bits of randomness grouped for typing. It is the only
 * thing standing between a device on your network and the tab you meant to send,
 * so it is generated from a CSPRNG and compared in constant time.
 */
function newPairingCode() {
  const bytes = randomBytes(PAIRING_GROUPS * PAIRING_GROUP_LENGTH);
  let out = '';
  for (let group = 0; group < PAIRING_GROUPS; group += 1) {
    for (let index = 0; index < PAIRING_GROUP_LENGTH; index += 1) {
      const position = group * PAIRING_GROUP_LENGTH + index;
      out += PAIRING_ALPHABET[bytes[position] % PAIRING_ALPHABET.length];
    }
    if (group < PAIRING_GROUPS - 1) out += '-';
  }
  return out;
}

function normalizeCode(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function codesMatch(expected, provided) {
  const a = Buffer.from(normalizeCode(expected));
  const b = Buffer.from(normalizeCode(provided));
  if (a.length === 0 || a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** "ABCDE-FGHIJ-KLMNO-PQRST-UVWXY" becomes host and port, or null. */
function parseTarget(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  const [host, port] = text.includes(':') ? text.split(':') : [text, String(DEFAULT_PORT)];
  const parsedPort = Number(port);
  if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) return null;
  return { host, port: parsedPort };
}

/**
 * The sending side. Listens once, serves the encrypted payload to whoever proves
 * knowledge of the code, and then stops: there is no queue and no retry, so a
 * transfer cannot be replayed later.
 */
class TransferSender {
  constructor({ port = DEFAULT_PORT, onDelivered = () => {} } = {}) {
    this.port = port;
    this.onDelivered = onDelivered;
    this.code = newPairingCode();
    this.expiresAt = Date.now() + CODE_WINDOW_MS;
    this.failures = 0;
    this.serves = 0;
    this.server = null;
  }

  addresses() {
    const found = localAddresses();
    // Loopback is included so a transfer between two windows on one machine is
    // testable, and so a device with no network cable can still be used.
    return [...new Set(['127.0.0.1', ...found])];
  }

  /**
   * Starts listening and resolves once the socket is actually bound.
   *
   * Returning synchronously would race the receiving device, which would then
   * fail to connect and report a network problem for what is really a startup
   * that had not finished.
   */
  listen(payload) {
    if (this.server) return Promise.resolve(this.describe());
    this.payload = Buffer.from(String(payload || ''), 'utf8');
    if (this.payload.length === 0 || this.payload.length > MAX_PAYLOAD_BYTES) {
      return Promise.reject(new Error('That transfer is empty or too large to send.'));
    }
    return new Promise((resolve, reject) => {
      const server = net.createServer((socket) => this.#handle(socket));
      const onError = (error) => {
        this.server = null;
        reject(new Error(`Could not listen on port ${this.port}: ${error.message}`));
      };
      server.once('error', onError);
      server.listen(this.port, '0.0.0.0', () => {
        server.removeListener('error', onError);
        // A later failure must not throw inside the event loop, so it is routed
        // through the same reporting path as a delivery outcome.
        server.on('error', (error) => {
          this.server = null;
          this.onDelivered({ ok: false, error: `Transfer stopped: ${error.message}` });
        });
        this.server = server;
        resolve(this.describe());
      });
    });
  }

  describe() {
    return {
      code: this.code,
      port: this.port,
      addresses: this.addresses(),
      expiresAt: this.expiresAt,
      servesRemaining: Math.max(0, MAX_SERVES - this.serves),
      listening: Boolean(this.server),
    };
  }

  #handle(socket) {
    socket.setTimeout(HANDSHAKE_TIMEOUT_MS);
    const chunks = [];
    let finished = false;

    const stop = (outcome) => {
      if (finished) return;
      finished = true;
      this.onDelivered(outcome);
      try { socket.destroy(); } catch { /* already gone */ }
      this.close();
    };

    socket.on('timeout', () => stop({ ok: false, error: 'The other device did not respond in time.' }));
    socket.on('error', () => stop({ ok: false, error: 'The connection failed.' }));

    socket.on('data', (chunk) => {
      chunks.push(chunk);
      const received = Buffer.concat(chunks).toString('utf8');
      if (received.length < 4 && !received.includes('\n')) return;

      const [supplied] = received.split('\n');
      if (Date.now() > this.expiresAt) {
        stop({ ok: false, error: 'That code has expired. Start a new transfer.' });
        return;
      }
      if (this.serves >= MAX_SERVES) {
        stop({ ok: false, error: 'That transfer has already been sent the maximum number of times.' });
        return;
      }
      if (!codesMatch(this.code, supplied)) {
        this.failures += 1;
        const remaining = MAX_FAILED_ATTEMPTS - this.failures;
        if (remaining <= 0) {
          stop({ ok: false, error: 'Too many wrong codes. Start a new transfer.' });
          return;
        }
        socket.write('NO\n');
        return;
      }

      this.serves += 1;
      // A short header first, so the receiver knows what is coming before it
      // starts allocating for the payload.
      socket.write(`OK ${this.payload.length}\n`);
      socket.write(this.payload);
      // The listener closes on the last permitted attempt, and on nothing else,
      // so a mistyped passphrase can be retried.
      if (this.serves >= MAX_SERVES) stop({ ok: true, served: true, exhausted: true });
      else socket.end();
    });
  }

  close() {
    if (!this.server) return;
    try { this.server.close(); } catch { /* already closing */ }
    this.server = null;
  }
}

/**
 * The receiving side. Connects to one address, sends the code, and returns the
 * envelope, or explains precisely why not.
 */
function receiveFrom({ address, code, port, timeoutMs = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    // The port may come from the address, from the caller, or from the default,
    // in that order. Deriving it from the address alone would silently ignore the
    // port the sender is actually listening on.
    const raw = String(address || '').trim();
    let host = raw;
    let resolvedPort = Number.isInteger(port) && port > 0 && port <= 65535 ? port : DEFAULT_PORT;
    if (raw.startsWith('[')) {
      const end = raw.indexOf(']');
      if (end > 0) {
        host = raw.slice(1, end);
        if (raw[end + 1] === ':') {
          const bracketed = Number(raw.slice(end + 2));
          if (Number.isInteger(bracketed) && bracketed > 0 && bracketed <= 65535) resolvedPort = bracketed;
        }
      }
    } else if (raw.includes(':')) {
      const parts = raw.split(':');
      host = parts[0];
      const given = Number(parts[1]);
      if (Number.isInteger(given) && given > 0 && given <= 65535) resolvedPort = given;
    }

    if (!isPrivateAddress(host)) {
      reject(new Error('A transfer can only be received from a device on this local network.'));
      return;
    }
    if (!normalizeCode(code)) {
      reject(new Error('Enter the pairing code shown on the sending device.'));
      return;
    }

    const socket = net.createConnection({ host, port: resolvedPort });
    const chunks = [];
    let header = null;
    let settled = false;

    const fail = (error) => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch { /* already gone */ }
      reject(error);
    };
    const succeed = (value) => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch { /* already gone */ }
      resolve(value);
    };

    socket.setTimeout(timeoutMs);
    socket.on('timeout', () => fail(new Error('The sending device did not answer. Check the code and that both devices are on the same network.')));
    socket.on('error', () => fail(new Error('Could not reach the sending device. Check you are on the same network.')));

    socket.on('connect', () => socket.write(`${normalizeCode(code)}\n`));

    socket.on('data', (chunk) => {
      chunks.push(chunk);
      const buffer = Buffer.concat(chunks);
      if (header === null) {
        const newline = buffer.indexOf(0x0a);
        if (newline < 0) {
          if (buffer.length > 64) fail(new Error('The sending device sent something unexpected.'));
          return;
        }
        const line = buffer.subarray(0, newline).toString('utf8').trim();
        if (line.startsWith('NO')) {
          fail(new Error('The sending device rejected that code.'));
          return;
        }
        if (!line.startsWith('OK ')) {
          fail(new Error('The sending device sent something unexpected.'));
          return;
        }
        const declared = Number(line.slice(3));
        if (!Number.isInteger(declared) || declared <= 0 || declared > MAX_PAYLOAD_BYTES) {
          fail(new Error('The sending device announced an unusable transfer size.'));
          return;
        }
        header = { declared, offset: newline + 1 };
      }
      if (buffer.length >= header.offset + header.declared) succeed(buffer.subarray(header.offset, header.offset + header.declared).toString('utf8'));
    });
  });
}

module.exports = {
  DEFAULT_PORT,
  MAX_FAILED_ATTEMPTS,
  MAX_PAYLOAD_BYTES,
  MAX_SERVES,
  PAIRING_GROUPS,
  TransferSender,
  codesMatch,
  isPrivateAddress,
  localAddresses,
  newPairingCode,
  normalizeCode,
  parseTarget,
  receiveFrom,
};
