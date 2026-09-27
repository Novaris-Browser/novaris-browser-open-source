import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HIGH_CONFIDENCE_BLOCKLIST, SiteSafetyManager, hostFor } from '../electron/site-safety.js';

describe('Novaris unsafe-site protection', () => {
  it('classifies the reported scam host', () => {
    const manager = new SiteSafetyManager();
    expect(manager.classify('https://bot-check.spooferlab.com/cl/i/w68x72')).toMatchObject({ blocked: true, category: 'scam' });
  });

  // Every host the user reported, with or without a scheme or trailing slash.
  const REPORTED = [
    'https://jump.offerclk.net',
    'https://jump.offerclk.net/',
    'jump.offerclk.net',
    'http://jump.offerclk.net/deep/path?q=1',
    'https://creatorspayouts.com/',
    'https://v0-iroblox.vercel.app/',
    'https://rapidrewards.vercel.app/',
    'https://rovlo.click/',
    'https://walltrks.com/',
    'https://ricklambs25.github.io/',
    'https://lr0bl0xl.blogspot.com/',
    'https://claimgifts.site/',
    'https://iosa.click/',
    'https://vilfer.app/',
    'https://verifysafe.click/',
    'https://robixa.vercel.app/',
    'https://rbxuser.com/',
    'https://roblox-redeem-codes.onrender.com/',
    'roblox-redeem-codes.onrender.com',
    'https://roblox-redeem-codes.onrender.com/redeem?code=12345',
  ];

  it.each(REPORTED)('blocks reported scam site %s', (value) => {
    const result = new SiteSafetyManager().classify(value);
    expect(result, `expected ${value} to be blocked`).toMatchObject({ blocked: true });
    expect(result.reason, value).toBeTruthy();
  });

  it('describes every entry as a scam, malware, fraud, or phishing risk', () => {
    const pattern = /scam|malware|fraud|phish|harvest|steal/i;
    for (const entry of HIGH_CONFIDENCE_BLOCKLIST) {
      expect(entry.reason, entry.domain).toMatch(pattern);
    }
  });

  it('blocks every reported host over a www prefix and with any case', () => {
    const manager = new SiteSafetyManager();
    for (const entry of HIGH_CONFIDENCE_BLOCKLIST) {
      expect(manager.classify(`https://www.${entry.domain.toUpperCase()}/`), entry.domain).toMatchObject({ blocked: true });
    }
  });

  it('does not block neighbouring tenants on shared hosting platforms', () => {
    // A single malicious tenant must never take down the whole platform.
    const manager = new SiteSafetyManager();
    const safe = [
      'https://other-project.vercel.app/',
      'https://someone-else.github.io/',
      'https://other.blogspot.com/',
      'https://unrelated.click/',
      'https://offers.offerclk.net/',
      'https://onrender.com/',
      'https://some-other-app.onrender.com/',
      'https://google.com/',
      'https://notrbxuser.com/',
      'https://roblox.com/',
    ];
    for (const url of safe) {
      expect(manager.classify(url), `expected ${url} to be allowed`).toBeNull();
    }
  });

  it('lists every entry exactly once', () => {
    const domains = HIGH_CONFIDENCE_BLOCKLIST.map((entry) => entry.domain);
    expect(new Set(domains).size).toBe(domains.length);
  });

  // Shared-hosting platforms: block the scam tenant and everything under it,
  // but never the bare platform and never a different tenant on it.
  const SHARED_PLATFORM_TENANTS = [
    { tenant: 'ricklambs25.github.io', platform: 'github.io', other: 'someone-else.github.io' },
    { tenant: 'v0-iroblox.vercel.app', platform: 'vercel.app', other: 'other-project.vercel.app' },
    { tenant: 'robixa.vercel.app', platform: 'vercel.app', other: 'another-project.vercel.app' },
    { tenant: 'rapidrewards.vercel.app', platform: 'vercel.app', other: 'yet-another.vercel.app' },
    { tenant: 'lr0bl0xl.blogspot.com', platform: 'blogspot.com', other: 'someone-else.blogspot.com' },
    { tenant: 'roblox-redeem-codes.onrender.com', platform: 'onrender.com', other: 'some-other-app.onrender.com' },
  ];

  it.each(SHARED_PLATFORM_TENANTS)('blocks $tenant and all of its subdomains', ({ tenant }) => {
    const manager = new SiteSafetyManager();
    expect(manager.classify(`https://${tenant}/`), tenant).toMatchObject({ blocked: true });
    expect(manager.classify(`https://deep.sub.${tenant}/`), `sub.${tenant}`).toMatchObject({ blocked: true });
  });

  it.each(SHARED_PLATFORM_TENANTS)('does not block the $platform platform itself', ({ platform }) => {
    const manager = new SiteSafetyManager();
    expect(manager.classify(`https://${platform}/`), platform).toBeNull();
    expect(manager.classify(`http://${platform}/anything`), platform).toBeNull();
  });

  it.each(SHARED_PLATFORM_TENANTS)('does not block $other on the same platform', ({ other }) => {
    expect(new SiteSafetyManager().classify(`https://${other}/`), other).toBeNull();
  });

  it('gives every entry a lowercase host, a category, and a reason', () => {
    for (const entry of HIGH_CONFIDENCE_BLOCKLIST) {
      expect(entry.domain).toBe(entry.domain.toLowerCase().trim());
      expect(entry.domain).toMatch(/^[a-z0-9.-]+\.[a-z]{2,}$/);
      expect(['scam', 'fraud', 'phishing', 'malware']).toContain(entry.category);
      expect(typeof entry.reason).toBe('string');
      expect(entry.reason.length).toBeGreaterThan(0);
    }
  });

  it('allows an explicit one-time override', () => {
    const manager = new SiteSafetyManager();
    const url = 'https://bot-check.spooferlab.com/cl/i/w68x72';
    expect(manager.classify(url)).not.toBeNull();
    expect(manager.allow(url)).toBe(true);
    expect(manager.classify(url)).toBeNull();
  });

  it('does not classify ordinary pages', () => {
    expect(new SiteSafetyManager().classify('https://example.com')).toBeNull();
  });

  it('matches subdomains of a blocked host but not lookalike hosts', () => {
    const manager = new SiteSafetyManager();
    expect(manager.classify('https://cdn.bot-check.spooferlab.com/')).not.toBeNull();
    expect(manager.classify('https://notbot-check.spooferlab.com.attacker.test/')).toBeNull();
    expect(manager.classify('https://spooflab.com/')).toBeNull();
  });

  it('ignores non-http protocols and malformed input', () => {
    const manager = new SiteSafetyManager();
    expect(manager.classify('file:///etc/passwd')).toBeNull();
    expect(manager.classify('javascript:alert(1)')).toBeNull();
    expect(manager.classify('not a url')).toBeNull();
    expect(manager.classify(undefined)).toBeNull();
  });

  it('normalises the www prefix so it cannot bypass the list', () => {
    expect(hostFor('https://www.bot-check.spooferlab.com/x')).toBe('bot-check.spooferlab.com');
    expect(new SiteSafetyManager().classify('https://www.bot-check.spooferlab.com/x')).not.toBeNull();
  });
});

describe('Novaris unsafe-site interception points', () => {
  const securitySource = readFileSync(new URL('../electron/security.js', import.meta.url), 'utf8');
  const hookSource = readFileSync(new URL('../src/hooks/useBrowser.js', import.meta.url), 'utf8');

  // Electron never emits will-navigate for webContents.loadURL, which is how the
  // address bar navigates, so the renderer must check before navigating.
  it('checks the unsafe-site list in the renderer before navigating', () => {
    const navigateBody = hookSource.slice(hookSource.indexOf('const navigate = useCallback'));
    const check = navigateBody.indexOf('classifySiteUrl(destination)');
    expect(check).toBeGreaterThan(-1);
    expect(navigateBody.indexOf('loadURL(destination)')).toBeGreaterThan(check);
  });

  it('still blocks in-page link navigation in the main process', () => {
    expect(securitySource).toContain("contents.on('will-navigate'");
    expect(securitySource).toContain('event.preventDefault()');
  });

  it('blocks an unsafe initial webview attachment', () => {
    expect(securitySource).toContain("contents.on('will-attach-webview'");
    expect(securitySource).toContain("params.src = 'about:blank'");
  });
});
