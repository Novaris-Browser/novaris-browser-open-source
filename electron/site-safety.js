// High-confidence scam, fraud, phishing, and malware hosts reported by users.
//
// Scope rules that this list must keep:
//   - Entries are exact hosts or a parent domain. A tenant such as
//     "v0-iroblox.vercel.app" must not block every other vercel.app project,
//     so parent domains are only listed when the whole parent is malicious.
//   - Matching a parent also covers its subdomains, which is intended.
//   - Every entry is reversible for the session: the user can continue once
//     from the warning screen, so a false positive is never a dead end.
const HIGH_CONFIDENCE_BLOCKLIST = Object.freeze([
  // Reported fake "security check" / CAPTCHA interstitials used to harvest
  // credentials and push malware.
  { domain: 'bot-check.spooferlab.com', category: 'scam', reason: 'Scam / malware / fraud site' },
  { domain: 'jump.offerclk.net', category: 'scam', reason: 'Scam / malware / fraud site' },
  { domain: 'rovlo.click', category: 'scam', reason: 'Scam / malware / fraud site' },
  { domain: 'walltrks.com', category: 'scam', reason: 'Scam / malware / fraud site' },
  { domain: 'iosa.click', category: 'scam', reason: 'Scam / malware / fraud site' },
  { domain: 'vilfer.app', category: 'scam', reason: 'Scam / malware / fraud site' },
  { domain: 'verifysafe.click', category: 'scam', reason: 'Scam / malware / fraud site' },
  { domain: 'claimgifts.site', category: 'scam', reason: 'Scam / malware / fraud site' },

  // Fake creator payout and reward schemes.
  { domain: 'creatorspayouts.com', category: 'fraud', reason: 'Scam / malware / fraud site' },
  { domain: 'rapidrewards.vercel.app', category: 'fraud', reason: 'Scam / malware / fraud site' },

  // Fake in-game currency and "free Robux" pages.
  { domain: 'v0-iroblox.vercel.app', category: 'scam', reason: 'Scam / malware / fraud site' },
  { domain: 'robixa.vercel.app', category: 'scam', reason: 'Scam / malware / fraud site' },
  { domain: 'rbxuser.com', category: 'scam', reason: 'Scam / malware / fraud site' },
  { domain: 'ricklambs25.github.io', category: 'scam', reason: 'Scam / malware / fraud site' },
  { domain: 'lr0bl0xl.blogspot.com', category: 'scam', reason: 'Scam / malware / fraud site' },

  // Credential-harvesting fake code redemption page. Reports indicate it
  // collects a username, password, and code, then posts them to a Discord
  // webhook together with the visitor's IP address. It is a single tenant on a
  // shared free-hosting platform, so only this host and its subdomains are
  // blocked rather than all of onrender.com.
  { domain: 'roblox-redeem-codes.onrender.com', category: 'phishing', reason: 'Fake Roblox code page that harvests passwords and sends them to a Discord webhook' },

  { domain: 'phishing.army', category: 'phishing', reason: 'Known phishing site' },
]);

function hostFor(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const parse = (input) => {
    try {
      const parsed = new URL(input);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
      return parsed.hostname.toLowerCase().replace(/^www\./i, '');
    } catch {
      return '';
    }
  };
  const direct = parse(raw);
  if (direct) return direct;
  // Accept a bare host such as "walltrks.com". Only plain hostnames qualify,
  // so this cannot turn a path or a script payload into a match.
  if (/\s/.test(raw) || raw.includes('..') || raw.includes('\\') || /^[^/]*:/.test(raw)) return '';
  return parse(`https://${raw}`);
}

class SiteSafetyManager {
  constructor() {
    this.allowedHosts = new Set();
  }

  classify(value) {
    const host = hostFor(value);
    if (!host || this.allowedHosts.has(host)) return null;
    const match = HIGH_CONFIDENCE_BLOCKLIST.find((entry) => host === entry.domain || host.endsWith(`.${entry.domain}`));
    return match ? { blocked: true, host, category: match.category, reason: match.reason } : null;
  }

  allow(value) {
    const host = hostFor(value);
    if (host) this.allowedHosts.add(host);
    return Boolean(host);
  }
}

module.exports = { HIGH_CONFIDENCE_BLOCKLIST, SiteSafetyManager, hostFor };
