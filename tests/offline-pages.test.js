import { describe, expect, it } from 'vitest';
import {
  MAX_DOCUMENT_BYTES,
  OFFLINE_SCHEME,
  assessCapture,
  buildOfflineDocument,
  canSave,
  escapeHtml,
  isAcceptableSize,
  listOfflinePages,
  offlineUrlFor,
} from '../electron/offline-pages.js';

const richText = 'word '.repeat(400);

describe('Novaris offline pages: what may be saved', () => {
  it('accepts ordinary web pages only', () => {
    expect(canSave('https://example.com/')).toBe(true);
    expect(canSave('http://example.com/page')).toBe(true);
  });

  it('refuses internal pages, files, and anything that is not a web address', () => {
    for (const url of ['novaris://settings', 'about:blank', 'file:///c:/secret.txt', 'chrome://settings', 'javascript:alert(1)', 'data:text/html,x', '', null, undefined, 42, {}]) {
      expect(canSave(url)).toBe(false);
    }
  });

  it('gives each URL a stable, distinct offline address', () => {
    expect(offlineUrlFor('https://example.com/a')).toBe(offlineUrlFor('https://example.com/a'));
    expect(offlineUrlFor('https://example.com/a')).not.toBe(offlineUrlFor('https://example.com/b'));
    expect(offlineUrlFor('https://example.com/a')).toMatch(new RegExp(`^${OFFLINE_SCHEME}://page/`));
  });
});

describe('Novaris offline pages: honest capture assessment', () => {
  it('accepts a page with real content', () => {
    expect(assessCapture({ url: 'https://a.test', text: richText, title: 'An Article' }).savable).toBe(true);
  });

  it('refuses a page that had nothing to save, and says why', () => {
    const result = assessCapture({ url: 'https://a.test', text: 'hi', title: 'Empty' });
    expect(result.savable).toBe(false);
    expect(result.reasons[0]).toMatch(/almost no text/i);
  });

  it('refuses a sign-in page rather than storing a useless copy', () => {
    const result = assessCapture({ url: 'https://bank.test/login', text: 'x'.repeat(300), title: 'Sign in to your bank' });
    expect(result.savable).toBe(false);
    expect(result.reasons.join(' ')).toMatch(/sign-in page/i);
  });

  it('passes through a reason the caller detected, such as a logged-in page', () => {
    const result = assessCapture({ url: 'https://a.test', text: richText, loggedInSignals: ['This page looks signed in, so the copy would contain your account.'] });
    expect(result.savable).toBe(false);
    expect(result.reasons[0]).toMatch(/signed in/i);
  });
});

describe('Novaris offline pages: the saved document', () => {
  const doc = buildOfflineDocument({ title: 'Saved <script>', url: 'https://example.com/a?x=1&y=2', savedAt: 1767225600000, html: '<p>Hello</p>' });

  it('labels the page as a copy and shows where it came from', () => {
    expect(doc).toMatch(/Saved copy of/);
    expect(doc).toMatch(/example\.com/);
  });

  it('cannot be mistaken for the live site, because it says so on the page', () => {
    // The banner carries the full address, so a reader always knows this is a copy.
    expect(doc).toContain('x=1&amp;y=2');
  });

  it('quarantines the saved markup so it cannot reach Novaris', () => {
    expect(doc).toMatch(/<iframe sandbox/);
    // The critical part: no allow-scripts and no same-origin, so saved scripts
    // cannot run against the page or the preload API.
    expect(doc).not.toMatch(/allow-scripts/);
    expect(doc).not.toMatch(/allow-same-origin/);
    expect(doc).toMatch(/referrerpolicy="no-referrer"/);
  });

  it('escapes the title and the captured markup', () => {
    expect(doc).not.toMatch(/<title>Saved <script>/);
    expect(doc).toContain('&lt;script&gt;');
    expect(escapeHtml('<img src=x onerror="alert(1)">')).not.toMatch(/onerror="alert/);
  });

  it('escapes quotes, so the srcdoc attribute cannot be broken out of', () => {
    const attack = buildOfflineDocument({ title: 't', url: 'https://a.test', savedAt: 1, html: '"><script>alert(1)</script>' });
    expect(attack).not.toMatch(/srcdoc="[^"]*"\s*>/);
  });

  it('marks a truncated capture as truncated', () => {
    expect(buildOfflineDocument({ title: 't', url: 'https://a.test', savedAt: 1, html: 'x', truncated: true })).toMatch(/truncated/);
  });

  it('handles a capture with no html without producing a broken document', () => {
    const empty = buildOfflineDocument({ title: '', url: 'not a url', savedAt: 0, html: '' });
    expect(empty).toMatch(/<html/);
    expect(empty).toMatch(/unknown time/);
  });
});

describe('Novaris offline pages: limits and listing', () => {
  it('rejects a capture that is too large to keep', () => {
    expect(isAcceptableSize(1024)).toBe(true);
    expect(isAcceptableSize(MAX_DOCUMENT_BYTES)).toBe(true);
    expect(isAcceptableSize(MAX_DOCUMENT_BYTES + 1)).toBe(false);
    expect(isAcceptableSize(0)).toBe(false);
    expect(isAcceptableSize('junk')).toBe(false);
  });

  it('lists newest first with the offline address and the host', () => {
    const list = listOfflinePages([
      { url: 'https://a.test/one', title: 'One', savedAt: 100, bytes: 10 },
      { url: 'https://b.test/two', title: 'Two', savedAt: 300, bytes: 20 },
    ]);
    expect(list.map((page) => page.title)).toEqual(['Two', 'One']);
    expect(list[0].host).toBe('b.test');
    expect(list[0].offlineUrl).toMatch(new RegExp(`^${OFFLINE_SCHEME}://page/`));
  });

  it('drops malformed entries from the list', () => {
    expect(listOfflinePages([null, {}, { url: 'https://ok.test/' }])).toHaveLength(1);
    expect(listOfflinePages('nonsense')).toEqual([]);
  });
});
