import { describe, expect, it } from 'vitest';
import {
  MIN_PASSPHRASE_LENGTH,
  assertUsablePassphrase,
  openPayload,
  randomId,
  sealPayload,
  tabPayload,
} from '../src/lib/tab-transfer.js';

const good = 'correct horse battery staple';
const tab = { url: 'https://example.test/page', title: 'Example', groupId: 'g1', workspaceId: 'ws-a' };

describe('Novaris tab transfer: passphrase strength', () => {
  it('refuses a short passphrase rather than pretending to be secure', () => {
    for (const weak of ['', 'a', 'short', '12345678901']) {
      expect(() => assertUsablePassphrase(weak)).toThrow(/at least/i);
    }
  });

  it('accepts a passphrase of the required length', () => {
    expect(assertUsablePassphrase('a'.repeat(MIN_PASSPHRASE_LENGTH))).toHaveLength(MIN_PASSPHRASE_LENGTH);
  });
});

describe('Novaris tab transfer: sealing and opening', () => {
  it('round-trips a tab', async () => {
    const envelope = await sealPayload(tab, good);
    const opened = await openPayload(envelope, good);
    expect(opened.url).toBe(tab.url);
    expect(opened.title).toBe('Example');
    expect(opened.groupId).toBe('g1');
    expect(opened.workspaceId).toBe('ws-a');
  });

  it('never puts the passphrase or the URL in the envelope', async () => {
    const envelope = await sealPayload(tab, good);
    const serialised = JSON.stringify(envelope);
    // The whole point of the relay is that it cannot read what it carries.
    expect(serialised).not.toContain(good);
    expect(serialised).not.toContain('example.test');
    expect(serialised).not.toContain(tab.title);
  });

  it('rejects the wrong passphrase without saying which part was wrong', async () => {
    const envelope = await sealPayload(tab, good);
    await expect(openPayload(envelope, 'a completely different one')).rejects.toThrow(/did not open/i);
  });

  it('refuses a blob that has been altered', async () => {
    const envelope = await sealPayload(tab, good);
    const bytes = atob(envelope.ciphertext.replace(/-/g, '+').replace(/_/g, '/'));
    const flipped = String.fromCharCode(bytes.charCodeAt(0) ^ 0xff) + bytes.slice(1);
    const tampered = { ...envelope, ciphertext: btoa(flipped).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') };
    await expect(openPayload(tampered, good)).rejects.toThrow(/did not open/i);
  });

  it('binds the ciphertext to its transfer id', async () => {
    // Moving a blob onto a different id must not open, so whoever holds the
    // relay cannot repoint a transfer at a different slot.
    const envelope = await sealPayload(tab, good);
    await expect(openPayload({ ...envelope, id: randomId() }, good)).rejects.toThrow(/did not open/i);
  });

  it('produces a different ciphertext each time for the same tab', async () => {
    const first = await sealPayload(tab, good);
    const second = await sealPayload(tab, good);
    expect(first.ciphertext).not.toBe(second.ciphertext);
    expect(first.salt).not.toBe(second.salt);
    expect(first.iv).not.toBe(second.iv);
  });

  it('generates unguessable transfer ids of a usable length', () => {
    const ids = new Set(Array.from({ length: 50 }, () => randomId()));
    expect(ids.size).toBe(50);
    for (const id of ids) {
      expect(id.length).toBeGreaterThanOrEqual(43);
      expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });
});

describe('Novaris tab transfer: payload contents', () => {
  it('refuses to send a blob that is not a tab', async () => {
    const envelope = await sealPayload({ notATab: true }, good);
    await expect(openPayload(envelope, good)).rejects.toThrow(/did not contain a tab/i);
  });

  it('never carries a credential', () => {
    const payload = tabPayload({ ...tab, password: 'hunter2', credentialId: 'c1' });
    expect(JSON.stringify(payload)).not.toContain('hunter2');
    expect(JSON.stringify(payload)).not.toContain('c1');
  });

  it('falls back to a blank tab rather than sending nothing', () => {
    expect(tabPayload({}).url).toBe('about:blank');
  });

  it('clamps a long title', () => {
    expect(tabPayload({ url: 'https://a.test', title: 'x'.repeat(500) }).title.length).toBeLessThanOrEqual(240);
  });
});
