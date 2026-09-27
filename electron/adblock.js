// Ad exchanges and ad networks. These are blocked for everyone by default.
const AD_NETWORKS = Object.freeze([
  '2mdn.net',
  '33across.com',
  'ad-delivery.net',
  'adform.net',
  'adkernel.com',
  'adnxs.com',
  'ads.pubmatic.com',
  'adsafeprotected.com',
  'adservice.google.com',
  'adsrvr.org',
  'adthrive.com',
  'adthrive-scdn.com',
  'advertising.com',
  'advertisingcdn.com',
  'ai-sticky-ad.com',
  'amazon-adsystem.com',
  'brightcom.com',
  'bypass.com',
  'casalemedia.com',
  'cdn.taboola.com',
  'contextweb.com',
  'criteo.com',
  'criteo.net',
  'ctbanner.com',
  'demdex.net',
  'dotomi.com',
  'doubleclick.net',
  'doubleverify.com',
  'everesttech.net',
  'exelator.com',
  'flashtalking.com',
  'googleadservices.com',
  'googlesyndicated.com',
  'googlesyndication.com',
  'gumgum.com',
  'indexexchange.com',
  'kargo.com',
  'lijit.com',
  'loopme.com',
  'mathtag.com',
  'media.net',
  'mgid.com',
  'mopub.com',
  'moatads.com',
  'nexage.com',
  'onetag-sys.com',
  'openx.net',
  'outbrain.com',
  'permutive.com',
  'piano.io',
  'pubmatic.com',
  'revcontent.com',
  'rhythmone.com',
  'richaudience.com',
  'rubiconproject.com',
  'sharethrough.com',
  'smaato.net',
  'smartadserver.com',
  'sonobi.com',
  'spotxchange.com',
  'stackadapt.com',
  'taboola.com',
  'taboolasyndication.com',
  'teads.tv',
  'triplelift.com',
  'yieldlab.net',
  'yieldmo.com',
  'zedo.com',
  'zemanta.com',
  '360yield.com',
  // Social ad servers. These are listed as individual hosts rather than their
  // parent domains on purpose: blocking facebook.com, twitter.com, pinterest.com
  // or tiktok.com would break the site itself, and the people who block ads
  // still expect the site to work.
  'an.facebook.com',
  'pixel.facebook.com',
  'ads-api.twitter.com',
  'static.ads-twitter.com',
  'ads.linkedin.com',
  'ads.pinterest.com',
  'ads.tiktok.com',
  'ads-api.tiktok.com',
  'ads-sg.tiktok.com',
  'business-api.tiktok.com',
  'ads.youtube.com',
  // Ad infrastructure on shared hosts. Also listed individually, because
  // blocking s3.amazonaws.com or adcolony.com wholesale would take down
  // unrelated services and, for Amazon, most of the internet.
  'adtago.s3.amazonaws.com',
  'advice-ads.s3.amazonaws.com',
  'analytics.s3.amazonaws.com',
  'analyticsengine.s3.amazonaws.com',
  'adcolony.com',
]);

// Analytics, tag managers, and audience platforms. Blocked by default but
// separately togglable, because a few sites depend on them to load.
const ANALYTICS_HOSTS = Object.freeze([
  'analytics.google.com',
  'analytics.tiktok.com',
  'app-measurement.com',
  'crazyegg.com',
  'google-analytics.com',
  'googletagmanager.com',
  'hotjar.com',
  'insightstat.com',
  'leadfeeder.com',
  'list-manage.com',
  'nr-data.net',
  'newrelic.com',
  'omtrdc.net',
  'quantserve.com',
  'scorecardresearch.com',
  'segment.com',
  'segment.io',
  'sentry-cdn.com',
  'simpli.fi',
  'tealiumiq.com',
  'trackjs.com',
  // Event and impression endpoints. Individually listed, not by parent domain:
  // redditmedia.com serves Reddit's images as well as its event calls, and
  // pinterest.com is a site people use.
  'events.reddit.com',
  'events.redditmedia.com',
  'analytics.pointdrive.linkedin.com',
  'log.pinterest.com',
  'trk.pinterest.com',
  'analytics-sg.tiktok.com',
  'log.byteoversea.com',
  // Product analytics and outbound click tracking. Freshmarketer is Freshworks'
  // analytics product and serves Microsoft Clarity under its own domain, which
  // is why clarity.ms is a separate entry in the strict list and Freshmarketer's
  // own Clarity host is covered by the rule here. Session replay is not in this
  // tier at all: see the note on mouseflow.com in the strict list.
  'freshmarketer.com',
  'click.googleanalytics.com',
]);

// Opt-in extras. These are more likely to affect site functionality, so they
// only apply when the user turns on strict blocking.
const STRICT_HOSTS = Object.freeze([
  'adjust.com',
  'agkn.com',
  'amplitude.com',
  'appsflyer.com',
  'branch.io',
  'bugsnag.com',
  'clarity.ms',
  'eyeota.net',
  'facebook.net',
  'fullstory.com',
  'iovation.com',
  'kount.com',
  'logrocket.com',
  'mixpanel.com',
  // Session replay. Unlike an ad server, this records the session itself:
  // movement, clicks, and text typed into forms. It is the most privacy
  // sensitive host in the project and it is still opt-in, because a site owner
  // can gate content behind a replay-driven flow, and whether to accept that
  // trade is the user's call rather than a default worth imposing.
  'mouseflow.com',
  'sc-static.net',
  'sentry.io',
  'ads-twitter.com',
]);

// Ad scripts served from the site's own origin. Most ad blocking is about remote
// hosts, but a large share of ad code is first party: the script sits on the
// site's own CDN and only the request path gives it away.
//
// The leading slash on every rule is doing the real work. A rule of "ads.js"
// matched as a plain substring would also block downloads.js, uploads.js,
// leads.js, threads.js, heads.js and roads.js, which would break download
// buttons, upload widgets and thread views across the web. Anchoring to a path
// separator means a rule only matches a whole path segment, so /js/ads.js is
// caught and /js/downloads.js is not.
const STATIC_AD_FILES = Object.freeze([
  '/ads.js',
  '/ad.js',
  '/adsbygoogle.js',
  '/pagead.js',
  '/pagead2.js',
  '/adsense.js',
  '/adcode.js',
  '/advertising.js',
  '/adframe-rotator.js',
]);

// Directories that exist to hold ad assets. These are matched only for
// resource types that can never be a page a person meant to visit, so a site
// with a legitimate /ads/ content directory keeps working.
const STATIC_AD_DIRECTORIES = Object.freeze([
  '/static/ads/',
  '/static/ad/',
  '/adserver/',
  '/adserver2/',
  '/adframe/',
  '/ad-assets/',
  '/ads/serve/',
  '/ad-frames/',
  '/advertising/',
]);

// mainFrame is excluded everywhere: a navigable path is never assumed to be an
// ad on the strength of its name alone.
const STATIC_PATH_TYPES = Object.freeze(['script', 'image', 'other', 'xmlhttprequest', 'subdocument']);

function matchesStaticAdPath(pathname, resourceType) {
  const value = String(pathname || '').toLowerCase();
  if (!value || !value.startsWith('/')) return false;
  // Query strings and fragments are not part of the path, so the caller passes
  // URL.pathname. A rule matches a whole segment because every rule starts with
  // a separator.
  for (const file of STATIC_AD_FILES) {
    if (value.includes(file)) return true;
  }
  if (!STATIC_PATH_TYPES.includes(String(resourceType || ''))) return false;
  for (const directory of STATIC_AD_DIRECTORIES) {
    if (value.includes(directory)) return true;
  }
  return false;
}

const FILTER_RESOURCE_TYPES = Object.freeze([
  'script',
  'image',
  'stylesheet',
  'object',
  'xmlhttprequest',
  'subdocument',
  'font',
  'media',
  'websocket',
  'ping',
  'csp_report',
  'other',
]);

const MAX_TRACKED_HOSTS = 40;

function normalizeHost(value) {
  return String(value || '').trim().toLowerCase().replace(/^\.+/, '').replace(/\.+$/, '');
}

function hostMatches(hostname, rule) {
  const normalized = normalizeHost(rule);
  if (!normalized) return false;
  return hostname === normalized || hostname.endsWith(`.${normalized}`);
}

// Every value that can be matched against a URL is matched with String.includes,
// so filter text never reaches RegExp, eval, or a dynamic code path.
function containsToken(haystack, token) {
  if (!token) return false;
  return String(haystack).includes(String(token));
}

function parseOptions(raw) {
  const options = { thirdParty: null, types: new Set(), domains: [] };
  if (!raw) return options;
  for (const part of String(raw).split(',')) {
    const token = part.trim();
    if (!token) continue;
    if (token === 'third-party') options.thirdParty = true;
    else if (token === '~third-party' || token === 'first-party') options.thirdParty = false;
    else if (token === 'script' || token === 'image' || token === 'stylesheet' || token === 'object'
      || token === 'xmlhttprequest' || token === 'subdocument' || token === 'font' || token === 'media'
      || token === 'websocket' || token === 'ping' || token === 'csp_report' || token === 'other') {
      options.types.add(token);
    } else if (token.startsWith('domain=')) {
      for (const domain of token.slice(7).split('|')) {
        const normalized = normalizeHost(domain);
        if (normalized) options.domains.push(normalized);
      }
    }
  }
  return options;
}

function splitRule(rule) {
  const index = rule.indexOf('$');
  if (index === -1) return { pattern: rule, options: parseOptions('') };
  return { pattern: rule.slice(0, index), options: parseOptions(rule.slice(index + 1)) };
}

function compileFilters(filters = []) {
  const allow = [];
  const block = [];
  const cosmetic = [];
  const cosmeticAllow = [];
  for (const raw of filters) {
    const line = String(raw || '').trim();
    if (!line) continue;

    // Cosmetic rules: example.com##.ad-banner or ##.ad-banner
    // Checked before comments so "##selector" is not read as a comment.
    const cosmeticMatch = line.match(/^(?:([^#]*)##|#@#)(.+)$/);
    if (cosmeticMatch) {
      const target = cosmeticMatch[2].trim();
      if (!target) continue;
      const rule = { domains: splitDomains(cosmeticMatch[1]), selector: target };
      if (line.includes('#@#')) cosmeticAllow.push(rule);
      else cosmetic.push(rule);
      continue;
    }

    if (line.startsWith('#') || line.startsWith('!')) continue;

    const body = line.startsWith('@@') ? line.slice(2).trim() : line;
    const { pattern, options } = splitRule(body);
    if (!pattern) continue;
    const compiled = { pattern, options };
    if (line.startsWith('@@')) allow.push(compiled);
    else block.push(compiled);
  }
  return { allow, block, cosmetic, cosmeticAllow };
}

function splitDomains(value) {
  return String(value || '')
    .split(',')
    .map((item) => normalizeHost(item))
    .filter(Boolean);
}

function patternMatches(hostname, rawUrl, pattern) {
  const value = String(pattern || '').trim();
  if (!value) return false;
  // ||domain^ anchors to a hostname boundary.
  if (value.startsWith('||')) {
    const rest = value.slice(2).replace(/\^.*$/, '');
    const slash = rest.indexOf('/');
    if (slash === -1) {
      if (hostMatches(hostname, rest)) return true;
    } else {
      // ||example.com/ads.js names a host and a path. Without this split the
      // path would be compared against the hostname, the rule could never
      // match, and a user whose site breaks would have no way to exempt the one
      // file that is causing it.
      const domain = rest.slice(0, slash);
      const path = rest.slice(slash);
      if (hostMatches(hostname, domain) && String(rawUrl).toLowerCase().includes(path.toLowerCase())) return true;
    }
  }
  // A bare hostname rule such as example.com or example.com^.
  if (/^[a-z0-9.-]+\^?$/i.test(value)) return hostMatches(hostname, value.replace(/\^$/, ''));
  // |http://example.com/ anchors to the start of the URL.
  if (value.startsWith('|')) return rawUrl.includes(value.slice(1));
  // A bare substring rule; ^ is treated as a word separator.
  return containsToken(rawUrl, value.replace(/\^/g, '.'));
}

class AdBlockManager {
  constructor({ store, browserSession }) {
    this.store = store;
    this.browserSession = browserSession;
    this.installed = false;
    this.settings = this.readSettings();
    this.stats = { blocked: 0, byHost: new Map(), firstParty: 0 };
    this.cache = this.compile();
  }

  readSettings() {
    // A full store.snapshot() deep-clones bookmarks and history, which is far
    // too expensive to run for every network request.
    return this.store.readAdblockSettings();
  }

  compile() {
    const settings = this.settings;
    const custom = compileFilters(settings.filters);
    const hosts = [
      ...AD_NETWORKS,
      ...(settings.trackingProtection === false ? [] : ANALYTICS_HOSTS),
      ...(settings.strictMode ? STRICT_HOSTS : []),
    ];
    return {
      enabled: settings.enabled !== false,
      ...custom,
      hosts,
    };
  }

  refresh() {
    this.settings = this.readSettings();
    this.cache = this.compile();
    return this.status();
  }

  install() {
    if (this.installed) return;
    this.browserSession.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
      callback({ cancel: this.shouldBlock(details) });
    });
    this.installed = true;
  }

  status() {
    const settings = this.readSettings();
    return {
      ...settings,
      blockedRequests: this.stats.blocked,
      // Ad scripts served by the page's own server, blocked on the path.
      firstPartyBlocked: this.stats.firstParty,
      topBlockedHosts: [...this.stats.byHost.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([host, count]) => ({ host, count })),
    };
  }

  update(patch = {}) {
    const next = this.store.setAdblockSettings(patch);
    this.settings = next;
    this.cache = this.compile();
    return this.status();
  }

  recordBlock(hostname, kind = 'host') {
    this.stats.blocked += 1;
    // A first-party ad script is counted separately and kept out of the host
    // list. Listing the page's own domain as a blocked tracker would read as
    // "this site is known bad", which is both wrong and alarming, and it would
    // bury the real third-party trackers that panel exists to show.
    if (kind === 'path') {
      this.stats.firstParty += 1;
      return;
    }
    this.stats.byHost.set(hostname, (this.stats.byHost.get(hostname) || 0) + 1);
    if (this.stats.byHost.size > MAX_TRACKED_HOSTS) {
      const oldest = this.stats.byHost.keys().next().value;
      if (oldest) this.stats.byHost.delete(oldest);
    }
  }

  resetStats() {
    this.stats = { blocked: 0, byHost: new Map(), firstParty: 0 };
    return this.status();
  }

  optionApplies(options, details, documentHost) {
    if (options.types.size && !options.types.has(details.resourceType)) return false;
    if (options.thirdParty === true && details.resourceType === 'main_frame') return false;
    if (options.thirdParty === false && documentHost) {
      const requestHost = normalizeHost(details.hostname || '');
      if (requestHost && requestHost === documentHost) return false;
    }
    if (options.domains.length) {
      const documentHostName = normalizeHost(documentHost || details.hostname || '');
      if (!options.domains.some((domain) => hostMatches(documentHostName, domain))) return false;
    }
    return true;
  }

  matchesCompiled(rules, hostname, rawUrl, details) {
    for (const rule of rules) {
      if (!patternMatches(hostname, rawUrl, rule.pattern)) continue;
      if (!this.optionApplies(rule.options, details, details.documentHost)) continue;
      return true;
    }
    return false;
  }

  shouldBlock(details = {}) {
    if (!this.cache.enabled) return false;
    const rawUrl = String(details.url || '');
    if (!/^https?:/i.test(rawUrl)) return false;
    let parsed;
    try { parsed = new URL(rawUrl); } catch { return false; }
    const hostname = normalizeHost(parsed.hostname);
    if (!hostname) return false;
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') return false;

    const context = { ...details, hostname };
    if (this.matchesCompiled(this.cache.allow, hostname, rawUrl, context)) return false;
    // First-party ad assets, matched on the path rather than the host.
    if (matchesStaticAdPath(parsed.pathname, details.resourceType)) {
      this.recordBlock(hostname, 'path');
      return true;
    }
    if (this.matchesCompiled(this.cache.block, hostname, rawUrl, context)) {
      this.recordBlock(hostname);
      return true;
    }
    if (this.cache.hosts.some((host) => hostMatches(hostname, host))) {
      this.recordBlock(hostname);
      return true;
    }
    return false;
  }

  // Cosmetic rules for the bundled content script, honouring #@# exceptions.
  cosmeticRules() {
    const allow = this.cache.cosmeticAllow.map((rule) => rule.selector);
    return {
      block: this.cache.cosmetic.map((rule) => rule.selector),
      allow,
    };
  }
}

module.exports = {
  AdBlockManager,
  AD_NETWORKS,
  ANALYTICS_HOSTS,
  STRICT_HOSTS,
  STATIC_AD_DIRECTORIES,
  STATIC_AD_FILES,
  DEFAULT_HOSTS: AD_NETWORKS,
  FILTER_RESOURCE_TYPES,
  compileFilters,
  hostMatches,
  matchesStaticAdPath,
  normalizeHost,
  patternMatches,
};
