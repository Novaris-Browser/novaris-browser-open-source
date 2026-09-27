// Guards credential handling against look-alike sign-in pages.
//
// Cookie isolation is already enforced by Chromium: a page on one host cannot
// read cookies belonging to another host, so a fake "security check" site has
// no way to read your google.com or youtube.com cookies directly. What these
// sites actually do is present a convincing sign-in form, or ask the user to
// paste their session cookies, and then capture whatever the user types. The
// real risk is credential theft, so that is what this module defends.

const ACCOUNT_PROVIDERS = Object.freeze([
  { id: 'google', label: 'Google', hosts: ['google.com', 'youtube.com', 'goo.gl', 'withgoogle.com', 'googleapis.com', 'gstatic.com'] },
  { id: 'microsoft', label: 'Microsoft', hosts: ['microsoft.com', 'live.com', 'msn.com', 'outlook.com', 'office.com', 'office365.com', 'microsoftonline.com', 'windowsazure.com', 'bing.com'] },
  { id: 'apple', label: 'Apple', hosts: ['apple.com', 'icloud.com', 'icloud.com.cn'] },
  { id: 'amazon', label: 'Amazon', hosts: ['amazon.com', 'amazon.co.uk', 'amazon.de', 'amazonaws.com', 'aws.amazon.com'] },
  { id: 'meta', label: 'Facebook or Instagram', hosts: ['facebook.com', 'instagram.com', 'fb.com', 'meta.com', 'threads.net'] },
  { id: 'x', label: 'X or Twitter', hosts: ['x.com', 'twitter.com', 't.co'] },
  { id: 'tiktok', label: 'TikTok', hosts: ['tiktok.com', 'musical.ly'] },
  { id: 'netflix', label: 'Netflix', hosts: ['netflix.com'] },
  { id: 'spotify', label: 'Spotify', hosts: ['spotify.com', 'spotifycdn.com'] },
  { id: 'discord', label: 'Discord', hosts: ['discord.com', 'discord.gg'] },
  { id: 'steam', label: 'Steam', hosts: ['steampowered.com', 'steamcommunity.com', 'valvesoftware.com'] },
  { id: 'roblox', label: 'Roblox', hosts: ['roblox.com', 'rbxcdn.com'] },
]);

// Short brand strings that, when seen on a page served from a host that does
// not belong to that brand, indicate an impersonation attempt.
const BRAND_SIGNALS = Object.freeze([
  { pattern: /\bgoogle\b/i, provider: 'google' },
  { pattern: /\byoutube\b/i, provider: 'google' },
  { pattern: /\bmicrosoft\b/i, provider: 'microsoft' },
  { pattern: /\b(outlook|hotmail|office ?365)\b/i, provider: 'microsoft' },
  { pattern: /\bapple ?id\b/i, provider: 'apple' },
  { pattern: /\bicloud\b/i, provider: 'apple' },
  { pattern: /\bamazon\b/i, provider: 'amazon' },
  { pattern: /\b(facebook|instagram)\b/i, provider: 'meta' },
  { pattern: /\b(twitter)\b/i, provider: 'x' },
  { pattern: /\btiktok\b/i, provider: 'tiktok' },
  { pattern: /\bnetflix\b/i, provider: 'netflix' },
  { pattern: /\bspotify\b/i, provider: 'spotify' },
  { pattern: /\bdiscord\b/i, provider: 'discord' },
  { pattern: /\broblox\b/i, provider: 'roblox' },
]);

function hostForUrl(value) {
  try {
    const parsed = new URL(String(value || ''));
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
    return parsed.hostname.toLowerCase().replace(/^www\./i, '');
  } catch {
    return '';
  }
}

function hostMatches(host, domain) {
  const normalized = String(domain || '').toLowerCase().replace(/^\.+/, '').replace(/\.+$/, '');
  if (!normalized) return false;
  return host === normalized || host.endsWith(`.${normalized}`);
}

function providerForHost(host) {
  if (!host) return null;
  for (const provider of ACCOUNT_PROVIDERS) {
    if (provider.hosts.some((domain) => hostMatches(host, domain))) return provider;
  }
  return null;
}

// A credential may only be filled into a host that the credential was saved for.
// This is the check that stops a saved Google password reaching a look-alike site.
function evaluateFill({ pageUrl, credentialUrl, classify = () => null }) {
  const pageHost = hostForUrl(pageUrl);
  const credentialHost = hostForUrl(credentialUrl);
  if (!pageHost) return { allowed: false, reason: 'The page address could not be read.' };
  if (!credentialHost) return { allowed: false, reason: 'This login has no saved website address.' };

  const threat = classify(pageUrl);
  if (threat) {
    return { allowed: false, reason: `Novaris will not enter passwords on a site flagged as ${threat.reason.toLowerCase()}.` };
  }

  if (!hostMatches(pageHost, credentialHost)) {
    const claimed = providerForHost(credentialHost);
    return {
      allowed: false,
      reason: `This login belongs to ${claimed ? claimed.label : credentialHost}, not to ${pageHost}.`,
    };
  }

  return { allowed: true, reason: '' };
}

// A page that asks for a password, or invites the user to paste a session
// token, while claiming to be a well-known brand hosted somewhere else, is
// treated as impersonation. Merely mentioning a brand name is not enough:
// plenty of ordinary pages write about Google without being a threat, so a
// credential-capture field is required before anything is reported.
function detectImpersonation({ url, title = '', text = '', hasPasswordField = false, hasPasteField = false } = {}) {
  const host = hostForUrl(url);
  if (!host) return null;
  if (providerForHost(host)) return null;
  if (!hasPasswordField && !hasPasteField) return null;

  const haystack = `${String(title || '')}\n${String(text || '')}`.slice(0, 20000);
  for (const signal of BRAND_SIGNALS) {
    if (!signal.pattern.test(haystack)) continue;
    const provider = ACCOUNT_PROVIDERS.find((item) => item.id === signal.provider);
    const label = provider?.label || signal.provider;
    const severity = hasPasswordField ? 'high' : 'low';
    return {
      detected: true,
      severity,
      provider: label,
      host,
      reason: hasPasswordField
        ? `This page is asking for a password on ${host} while claiming to be ${label}.`
        : `This page on ${host} is asking you to paste a session token while claiming to be ${label}.`,
    };
  }
  return null;
}

module.exports = {
  ACCOUNT_PROVIDERS,
  BRAND_SIGNALS,
  detectImpersonation,
  evaluateFill,
  hostForUrl,
  hostMatches,
  providerForHost,
};
