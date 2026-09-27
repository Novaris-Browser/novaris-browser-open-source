import { describe, expect, it } from 'vitest';
import {
  displayUrl,
  isLikelyHost,
  isWebUrl,
  normalizeAddress,
  searchEngineLabel,
} from '../src/lib/url.js';

describe('Novaris address normalization', () => {
  it('turns a bare domain into HTTPS', () => {
    expect(normalizeAddress('example.com')).toBe('https://example.com/');
  });

  it('keeps local development targets on HTTP', () => {
    expect(normalizeAddress('localhost:5173/path')).toBe('http://localhost:5173/path');
  });

  it('searches for natural-language input', () => {
    expect(normalizeAddress('weather tomorrow', 'duckduckgo')).toBe(
      'https://duckduckgo.com/?q=weather%20tomorrow',
    );
  });

  it('rejects unsafe schemes', () => {
    expect(() => normalizeAddress('javascript:alert(1)')).toThrow();
    expect(() => normalizeAddress('file:///etc/passwd')).toThrow();
  });

  it('recognizes URLs and likely hosts', () => {
    expect(isWebUrl('https://example.com')).toBe(true);
    expect(isWebUrl('javascript:alert(1)')).toBe(false);
    expect(isLikelyHost('subdomain.example.co.uk/path')).toBe(true);
    expect(isLikelyHost('a phrase to search')).toBe(false);
  });

  it('formats display URLs and search labels', () => {
    expect(displayUrl('https://example.com/')).toBe('example.com');
    expect(searchEngineLabel('google')).toBe('Google');
    expect(searchEngineLabel('brave')).toBe('Brave Search');
  });

  it('recognizes Novaris internal pages', () => {
    expect(normalizeAddress('novaris://newtab')).toBe('novaris://newtab');
    expect(normalizeAddress('novaris://bookmarks')).toBe('novaris://bookmarks');
    expect(() => normalizeAddress('novaris://unknown')).toThrow();
  });

  it('supports custom search providers and keyword shortcuts', () => {
    const engines = [{ id: 'my-search', name: 'My Search', url: 'https://search.example/?q={query}', keyword: 's', enabled: true }];
    expect(normalizeAddress('hello world', 'my-search', engines)).toBe('https://search.example/?q=hello%20world');
    expect(normalizeAddress('s privacy', 'duckduckgo', engines)).toBe('https://search.example/?q=privacy');
  });
});
