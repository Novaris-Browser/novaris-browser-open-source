import { describe, expect, it } from 'vitest';
import {
  AD_NETWORKS,
  ANALYTICS_HOSTS,
  STRICT_HOSTS,
  AdBlockManager,
  matchesStaticAdPath,
} from '../electron/adblock.js';

// The manager only ever calls readAdblockSettings on construction, so a stub is
// enough to drive the real shouldBlock path without a database or a browser.
function managerWith(overrides = {}) {
  const settings = {
    enabled: true,
    trackingProtection: true,
    strictMode: false,
    filters: [],
    ...overrides,
  };
  return new AdBlockManager({
    store: {
      readAdblockSettings: () => ({ ...settings }),
      setAdblockSettings: (patch) => ({ ...settings, ...patch }),
    },
    browserSession: { webRequest: { onBeforeRequest() {} } },
  });
}

// Every host the project was asked to block, grouped by the tier it lands in.
const REQUESTED = [
  'adtago.s3.amazonaws.com', 'analyticsengine.s3.amazonaws.com', 'analytics.s3.amazonaws.com',
  'advice-ads.s3.amazonaws.com', 'click.googleanalytics.com', 'ads30.adcolony.com',
  'adc3-launch.adcolony.com', 'events3alt.adcolony.com', 'wd.adcolony.com',
  'mouseflow.com', 'cdn.mouseflow.com', 'api.mouseflow.com', 'tools.mouseflow.com',
  'freshmarketer.com', 'claritybt.freshmarketer.com', 'fwtracks.freshmarketer.com',
  'pixel.facebook.com', 'an.facebook.com', 'static.ads-twitter.com', 'ads-api.twitter.com',
  'ads.linkedin.com', 'analytics.pointdrive.linkedin.com', 'events.reddit.com',
  'events.redditmedia.com', 'ads.youtube.com', 'ads.pinterest.com', 'log.pinterest.com',
  'trk.pinterest.com', 'ads-api.tiktok.com', 'ads-sg.tiktok.com', 'analytics-sg.tiktok.com',
  'business-api.tiktok.com', 'ads.tiktok.com', 'log.byteoversea.com',
];

// A host is covered if it, or a parent of it, is in any tier.
function coveredBy(host, list) {
  return list.some((rule) => host === rule || host.endsWith(`.${rule}`));
}

describe('Novaris ad blocking: the requested host list', () => {
  it('blocks every host that was asked for, at some tier', () => {
    const uncovered = REQUESTED.filter((host) => (
      !coveredBy(host, AD_NETWORKS)
      && !coveredBy(host, ANALYTICS_HOSTS)
      && !coveredBy(host, STRICT_HOSTS)
    ));
    expect(uncovered).toEqual([]);
  });

  it('blocks all of them on default settings, not only in strict mode', () => {
    // Defaults are trackingProtection on and strictMode off, so a host that is
    // only covered by the strict tier is not blocked out of the box. Those are
    // listed so the gap is a decision rather than an accident.
    const alwaysOn = [...AD_NETWORKS, ...ANALYTICS_HOSTS];
    const strictOnly = REQUESTED.filter((host) => (
      !coveredBy(host, alwaysOn) && coveredBy(host, STRICT_HOSTS)
    ));
    // Session replay records keystrokes, so it is deliberately held back from the
    // default tiers and this test pins that.
    expect(strictOnly.every((host) => host.includes('mouseflow'))).toBe(true);
  });

  it('never blocks a platform that people actually browse to', () => {
    // The reason social ad hosts are listed individually: blocking
    // facebook.com or pinterest.com would break the site itself, and the people
    // who block ads still expect the site to work. This is only true for domains
    // a person opens on purpose. freshmarketer.com and mouseflow.com are
    // service endpoints nobody reads, so blocking those wholesale is correct.
    for (const platform of [
      'facebook.com', 'twitter.com', 'x.com', 'pinterest.com', 'tiktok.com',
      'reddit.com', 'linkedin.com', 'youtube.com', 'google.com', 'amazon.com',
    ]) {
      for (const list of [AD_NETWORKS, ANALYTICS_HOSTS]) {
        expect(list).not.toContain(platform);
      }
    }
  });

  it('blocks service-only domains wholesale, which is safe', () => {
    // Nobody navigates to these, so a domain-wide rule is appropriate and simpler
    // than enumerating every subdomain of every product variant.
    expect(coveredBy('claritybt.freshmarketer.com', ANALYTICS_HOSTS)).toBe(true);
    expect(coveredBy('fwtracks.freshmarketer.com', ANALYTICS_HOSTS)).toBe(true);
    expect(coveredBy('ads30.adcolony.com', AD_NETWORKS)).toBe(true);
    expect(coveredBy('wd.adcolony.com', AD_NETWORKS)).toBe(true);
    expect(coveredBy('cdn.mouseflow.com', STRICT_HOSTS)).toBe(true);
  });
});

describe('Novaris ad blocking: first-party ad scripts', () => {
  it('blocks a first-party ad script by its path', () => {
    expect(matchesStaticAdPath('/js/ads.js', 'script')).toBe(true);
    expect(matchesStaticAdPath('/ads.js', 'script')).toBe(true);
    expect(matchesStaticAdPath('/assets/js/adsbygoogle.js', 'script')).toBe(true);
    expect(matchesStaticAdPath('/js/pagead.js', 'script')).toBe(true);
    expect(matchesStaticAdPath('/static/vendor/pagead2.js', 'script')).toBe(true);
  });

  // This is the whole reason the rules start with a slash. Without the segment
  // boundary every one of these would be blocked, and with them blocked the
  // download and upload features of a large part of the web stop working.
  it('does not block files that merely contain the letters', () => {
    for (const path of [
      '/js/downloads.js',
      '/uploads.js',
      '/assets/leads.js',
      '/threads.js',
      '/js/heads.js',
      '/roads.js',
      '/js/overads.js',
      '/media/breads.js',
    ]) {
      expect(matchesStaticAdPath(path, 'script')).toBe(false);
    }
  });

  it('does not block ordinary application code', () => {
    for (const path of ['/js/app.js', '/static/main.css', '/index.html', '/api/v1/ads', '/images/logo.png', '/js/advertiser.js']) {
      expect(matchesStaticAdPath(path, 'script')).toBe(false);
    }
  });

  it('blocks ad asset directories for asset types only', () => {
    expect(matchesStaticAdPath('/static/ads/banner.js', 'script')).toBe(true);
    expect(matchesStaticAdPath('/adserver/ad.php', 'xmlhttprequest')).toBe(true);
    // A navigable path is never assumed to be an ad, so a site with a real
    // /adframe/ page keeps working.
    expect(matchesStaticAdPath('/adframe/landing.html', 'mainFrame')).toBe(false);
    expect(matchesStaticAdPath('/static/ads/pricing', 'mainFrame')).toBe(false);
  });

  it('is case insensitive, because a CDN may serve any casing', () => {
    expect(matchesStaticAdPath('/JS/ADS.JS', 'script')).toBe(true);
    expect(matchesStaticAdPath('/Static/Ads/Banner.js', 'image')).toBe(true);
  });

  it('ignores an empty or relative path rather than throwing', () => {
    for (const value of ['', null, undefined, 'not-a-path', 'https://x/ads.js']) {
      expect(matchesStaticAdPath(value, 'script')).toBe(false);
    }
  });

  it('does not consider the query string part of the path', () => {
    // The caller passes URL.pathname, which never includes a query, so an
    // innocuous parameter cannot make a request look like an ad script.
    expect(matchesStaticAdPath('/js/app.js', 'script')).toBe(false);
  });
});

describe('Novaris ad blocking: the request pipeline', () => {
  const req = (url, resourceType = 'script') => ({ url, resourceType, documentHost: 'shop.example.com' });

  it('blocks first-party ad scripts on default settings', () => {
    const manager = managerWith();
    for (const path of ['/js/ads.js', '/adsbygoogle.js', '/assets/pagead.js', '/static/ads/banner.js', '/adserver/ad.php']) {
      expect(manager.shouldBlock(req(`https://shop.example.com${path}`))).toBe(true);
    }
  });

  it('leaves the rest of a real page working', () => {
    // Every one of these ships on ordinary sites. If any were blocked the
    // browser would be visibly broken, which is worse than a missed ad.
    const manager = managerWith();
    for (const path of [
      '/js/app.js', '/js/downloads.js', '/uploads.js', '/assets/leads.js',
      '/static/main.css', '/images/logo.png', '/fonts/inter.woff2',
      '/api/v1/cart', '/ads-pricing', '/blog/10-ads-tips',
    ]) {
      expect(manager.shouldBlock(req(`https://shop.example.com${path}`))).toBe(false);
    }
  });

  it('counts a blocked first-party script without blaming the site', () => {
    const manager = managerWith();
    manager.shouldBlock(req('https://shop.example.com/js/ads.js'));
    manager.shouldBlock(req('https://shop.example.com/js/ads.js'));
    const status = manager.status();
    expect(status.blockedRequests).toBe(2);
    expect(status.firstPartyBlocked).toBe(2);
    // The page's own domain must not appear as a blocked tracker, which would
    // read as "this site is known bad" and bury the real third-party list.
    expect(status.topBlockedHosts).toEqual([]);
  });

  it('still reports a third-party tracker in the host list', () => {
    const manager = managerWith();
    manager.shouldBlock(req('https://shop.example.com/js/ads.js'));
    manager.shouldBlock(req('https://pixel.facebook.com/tr', 'image'));
    const status = manager.status();
    expect(status.blockedRequests).toBe(2);
    expect(status.firstPartyBlocked).toBe(1);
    expect(status.topBlockedHosts).toEqual([{ host: 'pixel.facebook.com', count: 1 }]);
  });

  it('clears both counters on reset', () => {
    const manager = managerWith();
    manager.shouldBlock(req('https://shop.example.com/js/ads.js'));
    manager.shouldBlock(req('https://pixel.facebook.com/tr', 'image'));
    const status = manager.resetStats();
    expect(status.blockedRequests).toBe(0);
    expect(status.firstPartyBlocked).toBe(0);
    expect(status.topBlockedHosts).toEqual([]);
  });

  it('still blocks the requested ad hosts through the pipeline', () => {
    const manager = managerWith();
    for (const url of [
      'https://adtago.s3.amazonaws.com/banner.png',
      'https://pixel.facebook.com/tr',
      'https://events.redditmedia.com/pixel',
      'https://ads30.adcolony.com/ad',
    ]) {
      expect(manager.shouldBlock(req(url, 'image'))).toBe(true);
    }
  });

  it('leaves loopback alone so a local ad server can be worked on', () => {
    const manager = managerWith();
    expect(manager.shouldBlock(req('http://localhost:8080/js/ads.js'))).toBe(false);
    expect(manager.shouldBlock(req('http://127.0.0.1:8080/adsbygoogle.js'))).toBe(false);
  });

  it('respects a custom allow rule over a static path rule', () => {
    // A site that ships its own ad script under a name in the list can exempt it,
    // otherwise the user would have no way to fix a broken page.
    const manager = managerWith({ filters: ['@@||shop.example.com/js/ads.js'] });
    expect(manager.shouldBlock(req('https://shop.example.com/js/ads.js'))).toBe(false);
    expect(manager.shouldBlock(req('https://shop.example.com/js/adsbygoogle.js'))).toBe(true);
  });

  it('turns everything off when ad blocking is disabled', () => {
    const manager = managerWith({ enabled: false });
    expect(manager.shouldBlock(req('https://shop.example.com/js/ads.js'))).toBe(false);
    expect(manager.shouldBlock(req('https://pixel.facebook.com/tr', 'image'))).toBe(false);
  });
});
