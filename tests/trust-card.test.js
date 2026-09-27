import { describe, expect, it } from 'vitest';
import { buildTrustCard, extensionsWithAccess, normalizeUrl, permissionList } from '../electron/trust-card.js';
import { VERDICTS } from '../electron/phishing.js';
import { HIGH_CONFIDENCE_BLOCKLIST } from '../electron/site-safety.js';

const cleanExtension = {
  id: 'a', name: 'Reader', enabled: true, permissions: ['activeTab'], hostPermissions: ['*://*.example.com/*'],
};

describe('Novaris Trust Card: address handling', () => {
  it('accepts a bare host and assumes https', () => {
    expect(normalizeUrl('example.com').href).toBe('https://example.com/');
  });

  it('rejects anything that is not an http or https page', () => {
    for (const value of ['', null, undefined, 'javascript:alert(1)', 'file:///c:/x', 'data:text/html,x', 'chrome://settings', 'not a url', 42, {}]) {
      expect(normalizeUrl(value)).toBeNull();
    }
  });

  it('does not treat a Novaris page as a website', () => {
    const card = buildTrustCard({ url: 'novaris://settings', isInternal: true });
    expect(card.kind).toBe('internal');
    expect(card.verdict).toBeNull();
  });
});

describe('Novaris Trust Card: verdicts', () => {
  it('reports a real site as safe with no impersonation warning', () => {
    const card = buildTrustCard({ url: 'https://www.google.com/search?q=x' });
    expect(card.kind).toBe('website');
    expect(card.host).toBe('google.com');
    expect(card.https).toBe(true);
    expect(card.verdict.verdict).toBe(VERDICTS.safe);
    expect(card.verdict.tone).toBe('safe');
  });

  it('reports an impersonating site as dangerous and says why', () => {
    const card = buildTrustCard({ url: 'https://login-paypal-secure.xyz/' });
    expect(card.verdict.verdict).toBe(VERDICTS.dangerous);
    expect(card.verdict.tone).toBe('dangerous');
    expect(card.headline).toMatch(/impersonation/i);
    expect(card.reasons.length).toBeGreaterThan(0);
    // Every reason has to be readable, not an internal id.
    for (const reason of card.reasons) {
      expect(reason.title.length).toBeGreaterThan(0);
      expect(reason.detail.length).toBeGreaterThan(10);
    }
  });

  it('calls out a missing secure connection even on an otherwise fine site', () => {
    const card = buildTrustCard({ url: 'http://example.com/' });
    expect(card.https).toBe(false);
    expect(card.headline).toMatch(/not using a secure connection/i);
  });

  it('overrides the impersonation verdict when the host is on the scam list', () => {
    // A reported fraud host must never read as merely "safe".
    const domain = HIGH_CONFIDENCE_BLOCKLIST[0].domain;
    const card = buildTrustCard({ url: `https://${domain}/` });
    expect(card.onBlocklist).toBe(true);
    expect(card.headline).toMatch(/scam and malware list/i);
    expect(card.blocklistReason.length).toBeGreaterThan(0);
  });
});

describe('Novaris Trust Card: permissions and extensions', () => {
  it('lists only permissions explicitly allowed', () => {
    expect(permissionList({ camera: 'allow', microphone: 'deny', geolocation: 'ask' }).map((p) => p.key)).toEqual(['camera']);
    expect(permissionList({})).toEqual([]);
  });

  it('separates the sensitive permissions from the rest', () => {
    const card = buildTrustCard({
      url: 'https://example.com/',
      sitePermissions: { 'https://example.com': { camera: 'allow', downloads: 'allow', notifications: 'deny' } },
    });
    expect(card.permissions.map((p) => p.key).sort()).toEqual(['camera', 'downloads']);
    expect(card.sensitivePermissions.map((p) => p.key)).toEqual(['camera']);
  });

  it('shows which extensions can read the current page', () => {
    const list = extensionsWithAccess([cleanExtension], 'example.com');
    expect(list.map((e) => e.name)).toEqual(['Reader']);
    expect(extensionsWithAccess([cleanExtension], 'other.org')).toEqual([]);
  });

  it('matches a wildcard host permission against a subdomain', () => {
    expect(extensionsWithAccess([cleanExtension], 'docs.example.com')).toHaveLength(1);
  });

  it('honours all_urls but ignores disabled extensions', () => {
    const everywhere = { id: 'b', name: 'Everywhere', enabled: true, permissions: [], hostPermissions: ['<all_urls>'] };
    expect(extensionsWithAccess([everywhere], 'anything.test')).toHaveLength(1);
    expect(extensionsWithAccess([{ ...everywhere, enabled: false }], 'anything.test')).toEqual([]);
  });

  it('marks the built-in blocker so it is not mistaken for a third party', () => {
    const builtin = { id: 'adblock', name: 'Novaris Ad Blocker', enabled: true, permissions: [], hostPermissions: ['<all_urls>'], builtinId: 'adblock' };
    expect(extensionsWithAccess([builtin], 'example.com')[0].builtin).toBe(true);
  });

  it('never throws on malformed extension records', () => {
    const junk = [null, {}, { id: 'x' }, { id: 'y', hostPermissions: null }, { id: 'z', hostPermissions: [null, 5, {}] }];
    expect(() => extensionsWithAccess(junk, 'example.com')).not.toThrow();
  });
});

describe('Novaris Trust Card: adblock context', () => {
  it('reports the live blocking numbers for the page', () => {
    const card = buildTrustCard({
      url: 'https://example.com/',
      adblock: { enabled: true, trackingProtection: true, blockedRequests: 7, topBlockedHosts: [{ host: 'ads.example', count: 4 }] },
    });
    expect(card.adblock.blockedRequests).toBe(7);
    expect(card.adblock.topBlockedHosts).toHaveLength(1);
  });

  it('survives an adblock status that is missing entirely', () => {
    const card = buildTrustCard({ url: 'https://example.com/' });
    expect(card.adblock.enabled).toBe(true);
    expect(card.adblock.blockedRequests).toBe(0);
    expect(card.adblock.topBlockedHosts).toEqual([]);
  });
});
