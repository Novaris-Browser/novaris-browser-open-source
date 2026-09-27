import { describe, expect, it } from 'vitest';
import { AD_NETWORKS, ANALYTICS_HOSTS, STRICT_HOSTS, compileFilters, hostMatches, patternMatches } from '../electron/adblock.js';
import { buildAdblockContent, COSMETIC_SELECTORS } from '../electron/builtin-extension.js';

describe('Novaris ad blocking engine', () => {
  it('blocks common ad networks by hostname suffix', () => {
    for (const host of ['pagead2.googlesyndication.com', 'ads.pubmatic.com', 'ib.adnxs.com', 'cdn.taboola.com']) {
      expect(AD_NETWORKS.some((rule) => hostMatches(host, rule))).toBe(true);
    }
  });

  it('does not block ordinary hosts that merely look similar', () => {
    for (const host of ['example.com', 'notgooglesyndication.com.evil.test', 'pubmatic.com.evil.test']) {
      expect(AD_NETWORKS.some((rule) => hostMatches(host, rule))).toBe(false);
    }
  });

  it('keeps the blocking tiers separate so opt-in lists stay opt-in', () => {
    for (const rule of [...ANALYTICS_HOSTS, ...STRICT_HOSTS]) {
      expect(AD_NETWORKS).not.toContain(rule);
    }
    const combined = [...AD_NETWORKS, ...ANALYTICS_HOSTS, ...STRICT_HOSTS];
    expect(new Set(combined).size).toBe(combined.length);
  });

  it('understands ||domain^ anchors', () => {
    expect(patternMatches('ads.example.com', 'https://ads.example.com/x.js', '||example.com^')).toBe(true);
    expect(patternMatches('example.com.evil.test', 'https://example.com.evil.test/x.js', '||example.com^')).toBe(false);
  });

  it('understands plain fragment filters', () => {
    expect(patternMatches('cdn.site.test', 'https://cdn.site.test/ads/banner.js', '/ads/banner.js')).toBe(true);
    expect(patternMatches('cdn.site.test', 'https://cdn.site.test/js/app.js', '/ads/banner.js')).toBe(false);
  });

  it('separates allow rules from block rules', () => {
    const compiled = compileFilters(['||ads.example.com^', '@@||safe.example.com^/ads/']);
    expect(compiled.block).toHaveLength(1);
    expect(compiled.allow).toHaveLength(1);
  });

  it('extracts cosmetic rules and cosmetic exceptions', () => {
    const compiled = compileFilters(['##.ad-banner', 'example.com##.sponsor', '#@#.allowed-ad']);
    expect(compiled.cosmetic).toHaveLength(2);
    expect(compiled.cosmetic[1].domains).toEqual(['example.com']);
    expect(compiled.cosmeticAllow[0].selector).toBe('.allowed-ad');
    expect(compiled.block).toHaveLength(0);
  });

  it('parses resource type and third-party options', () => {
    const [rule] = compileFilters(['||tracker.test^$script,third-party']).block;
    expect(rule.options.types.has('script')).toBe(true);
    expect(rule.options.thirdParty).toBe(true);
  });

  it('parses domain= options', () => {
    const [rule] = compileFilters(['||pixel.test^$domain=news.test|blog.test']).block;
    expect(rule.options.domains).toEqual(['news.test', 'blog.test']);
  });

  it('ignores comments and empty lines', () => {
    const compiled = compileFilters(['! comment', '# another', '   ', '||real.test^']);
    expect(compiled.block).toHaveLength(1);
  });

  it('does not treat a cosmetic rule as a network rule', () => {
    const compiled = compileFilters(['##.ad']);
    expect(compiled.block).toHaveLength(0);
    expect(compiled.cosmetic).toHaveLength(1);
  });
});

describe('Novaris bundled ad blocker content script', () => {
  const script = buildAdblockContent();

  it('joins selectors with a separator so the stylesheet parses', () => {
    // A comma with no following space is a common source of invalid rules.
    expect(script).not.toContain("join(',\\\\n')");
    expect(script).toContain('join(\', \')');
  });

  it('inlines the default cosmetic selector list', () => {
    expect(script).toContain('ins.adsbygoogle');
    expect(script).toContain('[data-ad-slot]');
    expect(COSMETIC_SELECTORS.length).toBeGreaterThan(50);
  });

  it('inlines user cosmetic filters when provided', () => {
    const custom = buildAdblockContent({ cosmetic: { block: ['.my-ad'], allow: ['.keep-me'] } });
    expect(custom).toContain('.my-ad');
    expect(custom).toContain('.keep-me');
  });

  it('removes matched elements and not just hides them', () => {
    expect(script).toContain('element.remove()');
    expect(script).toContain('querySelectorAll(selector)');
  });

  it('observes later mutations so lazy-loaded ads are removed', () => {
    expect(script).toContain('MutationObserver');
  });
});
