import { describe, expect, it } from 'vitest';
import { chromeStoreUrl, unwrapCrx } from '../electron/extension-package.js';

describe('Chrome Web Store extension import helpers', () => {
  it('accepts only official Chrome Web Store listing URLs and IDs', () => {
    expect(chromeStoreUrl('abcdefghijklmnopabcdefghijklmnop')).toBe('https://chromewebstore.google.com/detail/abcdefghijklmnopabcdefghijklmnop');
    expect(chromeStoreUrl('https://chromewebstore.google.com/detail/example/abcdefghijklmnopabcdefghijklmnop')).toContain('chromewebstore.google.com/detail/');
    expect(chromeStoreUrl('https://example.com/detail/abcdefghijklmnopabcdefghijklmnop')).toBeNull();
    expect(chromeStoreUrl('javascript:alert(1)')).toBeNull();
  });

  it('extracts the ZIP payload offset from CRX3 headers', () => {
    const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00]);
    const header = Buffer.alloc(12);
    header.write('Cr24', 0, 'ascii');
    header.writeUInt32LE(3, 4);
    header.writeUInt32LE(0, 8);
    const result = unwrapCrx(Buffer.concat([header, zip]));
    expect(result.format).toBe('crx3');
    expect(result.zip.equals(zip)).toBe(true);
  });

  it('rejects unsupported or truncated packages', () => {
    expect(() => unwrapCrx(Buffer.from('not-an-extension'))).toThrow();
    expect(() => unwrapCrx(Buffer.from('Cr24', 'ascii'))).toThrow();
  });
});
