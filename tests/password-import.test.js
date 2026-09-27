import { describe, expect, it } from 'vitest';
import { parsePasswordCsv } from '../electron/password-import.js';

describe('password CSV import', () => {
  it('parses common browser export columns and quoted values', () => {
    const csv = 'name,url,username,password,note\nExample,https://example.com,user,"p,ass",note\nUnsafe,javascript:alert(1),user,secret,';
    expect(parsePasswordCsv(csv)).toEqual([
      { url: 'https://example.com/', title: 'Example', username: 'user', password: 'p,ass' },
    ]);
  });

  it('rejects files without a password column', () => {
    expect(() => parsePasswordCsv('name,url\nExample,https://example.com')).toThrow();
  });
});
