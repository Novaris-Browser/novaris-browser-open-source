import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PORT,
  MAX_FAILED_ATTEMPTS,
  MAX_SERVES,
  PAIRING_GROUPS,
  TransferSender,
  codesMatch,
  isPrivateAddress,
  newPairingCode,
  normalizeCode,
  parseTarget,
  receiveFrom,
} from '../electron/tab-transfer-node.js';

describe('Novaris local transfer: pairing codes', () => {
  it('produces a grouped, typable code', () => {
    const code = newPairingCode();
    expect(code.split('-')).toHaveLength(PAIRING_GROUPS);
    expect(code.replace(/-/g, '')).toMatch(/^[A-Z2-9]+$/);
    // Characters that get misread are excluded on purpose.
    expect(code).not.toMatch(/[IO01]/);
  });

  it('produces a different code every time', () => {
    const codes = new Set(Array.from({ length: 200 }, () => newPairingCode()));
    expect(codes.size).toBe(200);
  });

  it('ignores the way a code is typed', () => {
    const code = newPairingCode();
    const scrambled = code.toLowerCase().split('').reverse().join('').replace(/(.{4})/g, '$1-');
    // Reversal changes it, but formatting and case must not.
    expect(normalizeCode(`${code.toLowerCase()}`)).toBe(normalizeCode(code));
    expect(codesMatch(code, normalizeCode(code))).toBe(true);
    expect(codesMatch(code, 'AAAAA-AAAAA-AAAAA-AAAAA-AAAAA')).toBe(false);
  });

  it('never matches a short or empty code', () => {
    const code = newPairingCode();
    expect(codesMatch(code, '')).toBe(false);
    expect(codesMatch(code, 'AB')).toBe(false);
    expect(codesMatch('', '')).toBe(false);
  });
});

describe('Novaris local transfer: only the local network is reachable', () => {
  it('accepts the ranges a home network actually uses', () => {
    for (const address of ['127.0.0.1', '192.168.1.20', '10.0.0.5', '172.16.4.4', '172.31.255.1']) {
      expect(isPrivateAddress(address)).toBe(true);
    }
  });

  it('refuses anything routable off the local network', () => {
    for (const address of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.15.0.1', '172.32.0.1', '11.0.0.1', '', 'nonsense', null, undefined, 42]) {
      expect(isPrivateAddress(address)).toBe(false);
    }
  });

  it('refuses to receive from a public address', async () => {
    // The check happens before any socket is opened, so this cannot be used to
    // make Novaris connect outward.
    await expect(receiveFrom({ address: '8.8.8.8', code: newPairingCode() })).rejects.toThrow(/local network/i);
  });

  it('parses a host and port, and rejects a nonsense port', () => {
    expect(parseTarget('192.168.1.5')).toEqual({ host: '192.168.1.5', port: DEFAULT_PORT });
    expect(parseTarget('192.168.1.5:5000')).toEqual({ host: '192.168.1.5', port: 5000 });
    expect(parseTarget('192.168.1.5:0')).toBeNull();
    expect(parseTarget('192.168.1.5:99999')).toBeNull();
    expect(parseTarget('')).toBeNull();
  });
});

describe('Novaris local transfer: one device to another', () => {
  it('delivers the payload to a device that knows the code', async () => {
    const sender = new TransferSender({ port: 47881, onDelivered: () => {} });
    const envelope = JSON.stringify({ id: 'x', ciphertext: 'opaque', salt: 's', iv: 'i' });
    const offered = await sender.listen(envelope);
    expect(offered.listening).toBe(true);
    expect(sender.addresses()).toContain('127.0.0.1');

    const received = await receiveFrom({ address: '127.0.0.1', port: 47881, code: sender.code });
    expect(JSON.parse(received).ciphertext).toBe('opaque');
    expect(sender.serves).toBe(1);
    sender.close();
  });

  it('refuses a device that does not know the code', async () => {
    const sender = new TransferSender({ port: 47882, onDelivered: () => {} });
    await sender.listen('{"ciphertext":"secret"}');
    await expect(receiveFrom({ address: '127.0.0.1', port: 47882, code: newPairingCode() })).rejects.toThrow(/rejected that code/i);
    expect(sender.serves).toBe(0);
    sender.close();
  });

  it('allows a few attempts so a mistyped passphrase can be retried', async () => {
    // A strictly one-shot transfer meant a typo destroyed the payload, and let
    // anyone who had seen the pairing code ruin a transfer deliberately.
    const sender = new TransferSender({ port: 47883, onDelivered: () => {} });
    await sender.listen('{"ciphertext":"retriable"}');
    expect(sender.describe().servesRemaining).toBe(MAX_SERVES);

    const first = await receiveFrom({ address: '127.0.0.1', port: 47883, code: sender.code });
    expect(JSON.parse(first).ciphertext).toBe('retriable');
    expect(sender.describe().servesRemaining).toBe(MAX_SERVES - 1);

    const second = await receiveFrom({ address: '127.0.0.1', port: 47883, code: sender.code });
    expect(JSON.parse(second).ciphertext).toBe('retriable');
    sender.close();
  });

  it('stops serving once the attempt budget is used up', async () => {
    const sender = new TransferSender({ port: 47887, onDelivered: () => {} });
    await sender.listen('{"ciphertext":"bounded"}');
    for (let attempt = 0; attempt < MAX_SERVES; attempt += 1) {
      const received = await receiveFrom({ address: '127.0.0.1', port: 47887, code: sender.code });
      expect(JSON.parse(received).ciphertext).toBe('bounded');
    }
    expect(sender.describe().servesRemaining).toBe(0);
    // The listener is gone once the budget is spent, so a leaked code stops
    // being useful rather than working forever.
    await expect(receiveFrom({ address: '127.0.0.1', port: 47887, code: sender.code }))
      .rejects.toThrow(/could not reach|maximum number/i);
  });

  it('reports a friendly error when nothing is listening', async () => {
    await expect(receiveFrom({ address: '127.0.0.1', port: 47899, code: newPairingCode() }))
      .rejects.toThrow(/same network|could not reach/i);
  });

  it('refuses to start with an empty or oversized payload', async () => {
    const sender = new TransferSender({ port: 47884 });
    await expect(sender.listen('')).rejects.toThrow(/empty or too large/i);
    await expect(sender.listen('x'.repeat(600 * 1024))).rejects.toThrow(/empty or too large/i);
  });

  it('expires a code rather than keeping it open all day', async () => {
    const sender = new TransferSender({ port: 47885 });
    const offered = await sender.listen('{"a":1}');
    expect(offered.expiresAt).toBeGreaterThan(Date.now());
    // Simulate the window passing.
    sender.expiresAt = Date.now() - 1;
    expect(sender.expiresAt).toBeLessThan(Date.now());
    sender.close();
  });

  it('counts wrong codes and gives up rather than guessing', async () => {
    const sender = new TransferSender({ port: 47886 });
    await sender.listen('{"ciphertext":"secret"}');
    expect(sender.failures).toBe(0);
    expect(MAX_FAILED_ATTEMPTS).toBeGreaterThan(0);
    sender.close();
  });
});
