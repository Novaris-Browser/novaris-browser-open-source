import { describe, expect, it } from 'vitest';
import { parseBookmarkHtml } from '../electron/bookmark-import.js';

describe('bookmark HTML import', () => {
  it('parses safe exported bookmark links and decodes titles', () => {
    const html = '<!DOCTYPE NETSCAPE-Bookmark-file><a HREF="https://example.com/?a=1&amp;b=2">Example &amp; Co</a><a href="javascript:alert(1)">Unsafe</a>';
    expect(parseBookmarkHtml(html)).toEqual([{ url: 'https://example.com/?a=1&b=2', title: 'Example & Co' }]);
  });

  it('ignores malformed and duplicate links', () => {
    const html = '<a href="https://example.com">One</a><a href="https://example.com">Duplicate</a><a href="not a url">Bad</a>';
    expect(parseBookmarkHtml(html)).toHaveLength(1);
  });
});
