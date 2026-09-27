// Assembles the Website Trust Card: everything Novaris knows about the site in
// the current tab, in one place, with nothing invented.
//
// The card deliberately reports what is true rather than a reassuring summary. A
// site can have a perfect phishing score and still be tracking you, and a site
// can be perfectly safe and still hold six permissions. Showing both is the
// point of the card.

const { inspectHost, VERDICTS } = require('./phishing');
const { SiteSafetyManager } = require('./site-safety');

const PERMISSION_LABELS = Object.freeze({
  camera: 'Camera',
  microphone: 'Microphone',
  notifications: 'Notifications',
  geolocation: 'Location',
  clipboardRead: 'Clipboard reading',
  downloads: 'Downloads',
});

const VERDICT_PRESENTATION = Object.freeze({
  [VERDICTS.safe]: {
    label: 'No impersonation detected',
    tone: 'safe',
    detail: 'Nothing in this address tries to imitate a service you trust.',
  },
  [VERDICTS.caution]: {
    label: 'Worth a second look',
    tone: 'caution',
    detail: 'Some signals about this address are unusual. Read the reasons before signing in.',
  },
  [VERDICTS.dangerous]: {
    label: 'Likely impersonation',
    tone: 'dangerous',
    detail: 'This address is built to look like a service it is not. Do not enter a password here.',
  },
});

// The blocklist is consulted through the same manager the rest of the browser
// uses, so the card can never disagree with the block page a user would actually
// get. Constructed lazily because building it touches module state.
let safetyManager = null;
function threatFor(href) {
  if (!safetyManager) safetyManager = new SiteSafetyManager();
  return safetyManager.classify(href);
}

function normalizeUrl(input) {
  // Only a string can be a URL. Coercing a number would turn 42 into the host
  // "0.0.0.42" and quietly produce a card for a page nobody is on.
  if (typeof input !== 'string') return null;
  const raw = input.trim();
  if (!raw) return null;
  try {
    const parsed = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed;
  } catch {
    return null;
  }
}

function permissionList(policy = {}) {
  return Object.keys(PERMISSION_LABELS)
    .filter((key) => policy[key] === 'allow')
    .map((key) => ({ key, label: PERMISSION_LABELS[key] }));
}

// Extensions that can act on this host. Derived from each extension's declared
// permissions and host permissions, so a user can see who is able to read the
// page they are on.
function extensionsWithAccess(extensions = [], host) {
  if (!host) return [];
  const matches = (pattern) => {
    const text = String(pattern || '').trim();
    if (!text) return false;
    if (text === '<all_urls>') return true;
    // The scheme has to come off first: it contains a slash, so stripping the
    // path before the scheme would leave "*:*" and match nothing.
    const withoutScheme = text.replace(/^\*?:\/\//, '');
    const authority = withoutScheme.split('/')[0];
    if (!authority) return false;
    if (authority === '*') return true;
    const cleaned = authority.replace(/^\*\./, '').toLowerCase();
    if (!cleaned || cleaned === host) return true;
    return host.endsWith(`.${cleaned}`);
  };
  const result = [];
  for (const extension of extensions) {
    if (!extension?.enabled) continue;
    const declared = [...(extension.permissions || []), ...(extension.hostPermissions || [])];
    if (declared.some(matches)) {
      result.push({ id: extension.id, name: extension.name, builtin: extension.builtinId === 'adblock' });
    }
  }
  return result;
}

/**
 * Builds the card for a URL. Pure apart from the blocklist lookup, so the
 * scoring can be tested without a browser.
 */
function buildTrustCard({ url, extensions: installedExtensions = [], sitePermissions = {}, adblock = {}, isInternal = false } = {}) {
  // Internal pages are recognised before the web check, because a novaris:// or
  // about: address is not a website and must not be scored as one.
  if (isInternal || (typeof url === 'string' && /^(novaris|about|chrome|devtools|data|file|blob):/i.test(url.trim()))) {
    return {
      kind: 'internal',
      host: '',
      title: 'Novaris page',
      detail: 'This is a Novaris page, not a website. It cannot be impersonated and holds no site permissions.',
      verdict: null,
      permissions: [],
      sensitivePermissions: [],
      extensions: [],
      reasons: [],
    };
  }

  const parsed = normalizeUrl(url);

  if (!parsed) {
    return {
      kind: 'none',
      title: 'No website to check',
      detail: 'Novaris internal pages are not websites and are not scored.',
      verdict: null,
      permissions: [],
      sensitivePermissions: [],
      extensions: [],
      reasons: [],
    };
  }

  const phishing = inspectHost(parsed.hostname);
  const presentation = VERDICT_PRESENTATION[phishing.verdict];
  const threat = threatFor(parsed.href);
  const onBlocklist = Boolean(threat && threat.blocked);
  const origin = parsed.origin;
  const policy = sitePermissions[origin] || sitePermissions[parsed.hostname] || {};
  const permissions = permissionList(policy);
  const extensions = extensionsWithAccess(installedExtensions, parsed.hostname);
  const https = parsed.protocol === 'https:';

  // The single most useful sentence, chosen from the strongest fact available.
  let headline = presentation.label;
  if (onBlocklist) headline = 'On the reported scam and malware list';
  else if (!https) headline = 'Not using a secure connection';

  return {
    kind: 'website',
    headline,
    url: parsed.href,
    // Normalised, so "www." is not shown as if it were part of the site's name.
    host: phishing.host || parsed.hostname,
    origin,
    https,
    verdict: { ...phishing, ...presentation },
    onBlocklist,
    blocklistReason: onBlocklist ? String(threat.reason || 'Reported as unsafe.') : '',
    // Permissions are grouped by whether they are the sensitive ones, because
    // "this site can read your clipboard" matters more than the count.
    permissions,
    sensitivePermissions: permissions.filter((item) => ['camera', 'microphone', 'geolocation', 'clipboardRead', 'notifications'].includes(item.key)),
    extensions,
    adblock: {
      enabled: adblock.enabled !== false,
      trackingProtection: adblock.trackingProtection !== false,
      blockedRequests: Number(adblock.blockedRequests) || 0,
      topBlockedHosts: Array.isArray(adblock.topBlockedHosts) ? adblock.topBlockedHosts.slice(0, 3) : [],
    },
    // Everything the card decided and why, so a wrong verdict can be argued with.
    reasons: phishing.signals,
  };
}

module.exports = {
  PERMISSION_LABELS,
  VERDICT_PRESENTATION,
  buildTrustCard,
  extensionsWithAccess,
  normalizeUrl,
  permissionList,
};
