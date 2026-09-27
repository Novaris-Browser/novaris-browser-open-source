// Local phishing and impersonation detection.
//
// No network requests, no API keys, and no URL ever leaves the device. That is a
// deliberate decision rather than a limitation to apologise for: the obvious
// alternative is uploading every page you open to a reputation service, which
// would undo the property that Novaris contacts no third party at all. What can
// be done offline is catch the large class of attacks that work by making a
// hostname lie about who it is.
//
// The techniques, none of which need a server:
//
//   1. Punycode, mixed scripts, and confusable characters, so an internationalised
//      domain that visually spells a brand is caught even though the bytes differ.
//   2. Typo squatting against a curated brand list, including the digit-for-letter
//      substitutions phishers rely on, such as "paypa1".
//   3. A brand name anywhere other than the registrable domain, which is how
//      "paypal.com.evil.tk" works, and the most reliably detectable case there is.
//   4. A brand combined with sign-in wording, which is the difference between an
//      impersonation and an actual credential harvest.
//
// Every signal explains itself, because a warning the user cannot interrogate
// trains them to click through the next one.

const BRANDS = Object.freeze([
  'google', 'gmail', 'youtube', 'facebook', 'instagram', 'whatsapp', 'messenger',
  'apple', 'icloud', 'microsoft', 'office365', 'outlook', 'hotmail', 'live',
  'amazon', 'aws', 'netflix', 'paypal', 'stripe', 'coinbase', 'binance',
  'metamask', 'blockchain', 'chase', 'bankofamerica', 'wellsfargo', 'citibank',
  'hsbc', 'barclays', 'santander', 'revolut', 'wise', 'monzo',
  'dhl', 'fedex', 'ups', 'usps', 'royalmail',
  'dropbox', 'github', 'gitlab', 'slack', 'discord', 'spotify',
  'steam', 'epicgames', 'roblox', 'tiktok', 'snapchat', 'linkedin', 'twitter',
  'reddit', 'telegram', 'signal', 'zoom', 'twitch',
  'walmart', 'target', 'ebay', 'etsy', 'shopify', 'aliexpress', 'temu', 'indeed',
]);

// Domains that legitimately extend a brand name and would otherwise warn on every
// visit. Being on this list is visible in the Trust Card rather than silent, so a
// user can see why a site was not flagged. Anything added here should be a domain
// the brand demonstrably owns.
const ALLOWED_DOMAINS = Object.freeze(new Set([
  'microsoftonline.com', // login.microsoftonline.com is Microsoft's own sign-in
  'office.com',
  'icloud.com',
  'amazon.com',
]));

// Suffixes frequently abused. Weighted to produce a caution on their own, never a
// verdict, because plenty of legitimate sites use them.
const RISKY_SUFFIXES = new Set([
  'tk', 'ml', 'ga', 'cf', 'gq', 'top', 'xyz', 'zip', 'mov', 'work', 'click',
  'country', 'kim', 'fit', 'loan', 'review', 'stream', 'download', 'racing',
  'party', 'gdn', 'cam', 'rest', 'quest', 'monster',
]);

// Public suffixes with two labels, so "bbc.co.uk" is not read as the domain "co.uk".
const MULTI_LABEL_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk', 'net.uk', 'sch.uk',
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au',
  'co.nz', 'co.jp', 'or.jp', 'ne.jp', 'co.kr', 'com.br', 'com.mx', 'com.ar',
  'co.in', 'net.in', 'org.in', 'co.za', 'com.tr', 'com.cn', 'com.sg', 'com.hk',
  'com.tw', 'com.pl', 'com.ua', 'com.ph', 'com.my', 'com.vn', 'com.sa',
]);

// Labels that follow a brand inside a subdomain, which turns "paypal.com" into
// part of somebody else's address.
const LOOKS_LIKE_TLD = new Set([
  'com', 'net', 'org', 'co', 'gov', 'edu', 'ac', 'info', 'biz', 'io', 'me', 'us', 'uk',
]);

const CREDENTIAL_WORDS = [
  'login', 'log-in', 'signin', 'sign-in', 'logon', 'verify', 'verification',
  'secure', 'security', 'account', 'update', 'confirm', 'recover', 'recovery',
  'unlock', 'wallet', 'banking', 'billing', 'invoice', 'suspended',
];

// Characters that render as letters but are not, and the letter each imitates.
const CONFUSABLES = Object.freeze({
  '0': 'o', '1': 'l', '3': 'e', '5': 's', '7': 't', '8': 'b', '9': 'g',
  '@': 'a', '$': 's', '|': 'l', '!': 'i', '+': 't', '4': 'a', '2': 'z',
});

// Cyrillic and Greek characters that render as Latin ones, limited to the pairs
// actually used in phishing rather than a full confusables table.
const HOMOGLYPHS = Object.freeze({
  'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'х': 'x', 'у': 'y',
  'і': 'i', 'ј': 'j', 'һ': 'h', 'ӏ': 'l', 'ԁ': 'd', 'ԛ': 'q', 'ԝ': 'w', 'ν': 'v',
  'α': 'a', 'ο': 'o', 'ρ': 'p', 'ε': 'e', 'τ': 't', 'κ': 'k', 'χ': 'x',
  'ι': 'i', 'υ': 'u', 'А': 'a', 'В': 'b', 'Е': 'e', 'З': 'z', 'Н': 'h',
  'М': 'm', 'И': 'n', 'О': 'o', 'Р': 'p', 'Т': 't', 'У': 'y', 'Х': 'x',
});

const VERDICTS = Object.freeze({ safe: 'safe', caution: 'caution', dangerous: 'dangerous' });

const WEIGHTS = Object.freeze({
  characterSubstitutedBrand: 60,
  obfuscatedBrand: 55,
  brandWithCredentialWording: 55,
  brandDomainInSubdomain: 60,
  brandInSubdomain: 40,
  mixedScript: 30,
  punycode: 25,
  credentialMany: 25,
  riskySuffix: 22,
  credentialOne: 12,
  embeddedBrand: 15,
});

function stripWww(host) {
  return String(host || '').toLowerCase().replace(/^www\./, '');
}

function registrableDomain(host) {
  const clean = stripWww(host);
  if (!clean) return '';
  const labels = clean.split('.').filter(Boolean);
  if (labels.length <= 2) return clean;
  const lastTwo = labels.slice(-2).join('.');
  if (MULTI_LABEL_SUFFIXES.has(lastTwo) && labels.length >= 3) return labels.slice(-3).join('.');
  return lastTwo;
}

function suffixOf(host) {
  const labels = stripWww(host).split('.').filter(Boolean);
  return labels.length >= 2 ? labels[labels.length - 1] : '';
}

// The name a person would call the site, with the public suffix removed. This is
// the part that gets compared against brands, which is why the suffix is excluded:
// "github.io" is GitHub, and comparing "github.io" against "github" is nonsense.
function coreLabelOf(registrable) {
  const suffix = suffixOf(registrable);
  if (!suffix) return registrable;
  const trimmed = registrable.slice(0, registrable.length - suffix.length - 1);
  return trimmed || registrable;
}

function subdomainLabels(host) {
  const clean = stripWww(host);
  const registrable = registrableDomain(clean);
  if (!registrable || clean === registrable) return [];
  return clean.slice(0, clean.length - registrable.length).split('.').filter(Boolean);
}

function deconfuse(value) {
  let out = '';
  for (const char of String(value || '')) out += HOMOGLYPHS[char] ?? CONFUSABLES[char] ?? char;
  return out;
}

function flatten(value) {
  return String(value || '').replace(/[-_.]/g, '');
}

// Any Cyrillic or Greek in the domain is worth reporting. This deliberately does
// not require Latin alongside it: the dangerous case is a hostname written
// entirely in one script, such as the Cyrillic "apple" clone, where a
// "mixed scripts" test that looks for Latin would find nothing to complain about.
function hasNonLatinScript(value) {
  return /[\u0400-\u04FF\u0370-\u03FF]/.test(String(value || ''));
}

function isPunycode(label) {
  return /^xn--/i.test(String(label || ''));
}

function editDistance(a, b, cap = 4) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  const previous = new Array(b.length + 1);
  const current = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j += 1) previous[j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    let rowMin = current[0];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
      if (current[j] < rowMin) rowMin = current[j];
    }
    if (rowMin > cap) return cap + 1;
    for (let j = 0; j <= b.length; j += 1) previous[j] = current[j];
  }
  return previous[b.length];
}

function looksLikeTypo(candidate, brand) {
  const distance = editDistance(candidate, brand, 3);
  if (distance === 1) return true;
  return distance === 2 && brand.length >= 6;
}

function credentialWordsIn(host) {
  const text = deconfuse(stripWww(host));
  return CREDENTIAL_WORDS.filter((word) => text.includes(word));
}

function brandsWithin(flat, { exactOnly = false, minLength = 0 } = {}) {
  return BRANDS.filter((brand) => {
    if (brand.length < minLength) return false;
    return exactOnly ? flat === brand : flat.includes(brand);
  });
}

/**
 * Scores a hostname. Pure and offline, so it is safe to run on every navigation.
 */
function inspectHost(input) {
  const host = stripWww(typeof input === 'string' ? input : input?.hostname);
  const signals = [];

  if (!host || !/^[a-z0-9.\-\u0080-\uffff]+$/i.test(host)) {
    return {
      host: '',
      verdict: VERDICTS.caution,
      score: 0,
      allowed: false,
      signals: [{ id: 'unreadable', weight: 0, title: 'Host could not be read', detail: 'The address is not an ordinary domain name.' }],
    };
  }

  const registrable = registrableDomain(host);
  const suffix = suffixOf(registrable) || suffixOf(host);
  const core = coreLabelOf(registrable);
  const flatRaw = flatten(core);
  const flatDef = flatten(deconfuse(core));
  const subs = subdomainLabels(host);
  const labels = host.split('.').filter(Boolean);

  // A domain the brand demonstrably owns, and which merely extends the brand name.
  if (ALLOWED_DOMAINS.has(registrable)) {
    return {
      host,
      registrableDomain: registrable,
      suffix,
      core,
      allowed: true,
      verdict: VERDICTS.safe,
      score: 0,
      signals: [{ id: 'allowed', weight: 0, title: 'Recognised as a legitimate address', detail: `${registrable} is on Novaris's verified list for ${core}, so no impersonation warning is raised.` }],
    };
  }

  // When the name, as written, is exactly a brand, this is that brand's own
  // domain. Nothing further should fire for it.
  const isBrandDomain = brandsWithin(flatRaw, { exactOnly: true }).length > 0;
  const credentials = credentialWordsIn(host);
  let score = 0;

  if (labels.some(isPunycode)) {
    score += WEIGHTS.punycode;
    signals.push({ id: 'punycode', weight: WEIGHTS.punycode, title: 'Address uses an internationalised domain', detail: 'These can be built to look identical to a brand you trust. Read the name character by character.' });
  }
  if (hasNonLatinScript(core)) {
    score += WEIGHTS.mixedScript;
    signals.push({ id: 'non-latin-script', weight: WEIGHTS.mixedScript, title: 'Address is written in another alphabet', detail: `Non-Latin characters are used to imitate a brand you know. Read as "${flatDef}".` });
  }

  if (!isBrandDomain) {
    // The deconfused name is exactly a brand, so digits or lookalike characters
    // are standing in for real letters.
    if (flatDef !== flatRaw) {
      const exact = brandsWithin(flatDef, { exactOnly: true });
      if (exact.length) {
        score += WEIGHTS.characterSubstitutedBrand;
        signals.push({ id: 'substituted-brand', weight: WEIGHTS.characterSubstitutedBrand, title: `Address imitates ${exact[0]} with lookalike characters`, detail: `"${core}" reads as "${flatDef}" only because digits or characters from other alphabets stand in for letters. The real site is ${exact[0]}.` });
      } else {
        const inside = brandsWithin(flatDef, { minLength: 4 });
        if (inside.length) {
          score += WEIGHTS.obfuscatedBrand;
          signals.push({ id: 'obfuscated-brand', weight: WEIGHTS.obfuscatedBrand, title: `Address builds ${inside[0]} out of lookalike characters`, detail: `"${core}" contains a disguised form of ${inside[0]} plus extra text.` });
        }
      }
    }

    // A brand written into the domain, with or without sign-in wording. Bare
    // brand-extended names are common and legitimate, so on their own this only
    // nudges. Paired with sign-in wording it is a credential harvest.
    const rawBrands = brandsWithin(flatRaw, { minLength: 4 });
    const defBrands = flatDef === flatRaw ? rawBrands : brandsWithin(flatDef, { minLength: 4 });
    const brand = (defBrands[0] || rawBrands[0]);
    if (brand && flatDef !== brand && flatRaw !== brand) {
      if (credentials.length) {
        score += WEIGHTS.brandWithCredentialWording;
        signals.push({ id: 'brand-with-credentials', weight: WEIGHTS.brandWithCredentialWording, title: `Address combines ${brand} with sign-in wording`, detail: `The domain is "${core}", and it also asks you to sign in. This is the shape of a page built to collect a password for ${brand}.` });
      } else if (flatDef === flatRaw) {
        score += WEIGHTS.embeddedBrand;
        signals.push({ id: 'embedded-brand', weight: WEIGHTS.embeddedBrand, title: `Address contains the name ${brand}`, detail: `The real ${brand} site is ${brand}.com or similar. An address that merely contains the name is usually not it.` });
      }
    }

    // A brand domain parked in front of somebody else's address.
    const brandDomainInPath = BRANDS.find((b) => {
      const index = subs.indexOf(b);
      return index >= 0 && index + 1 < subs.length && LOOKS_LIKE_TLD.has(subs[index + 1]);
    });
    if (brandDomainInPath) {
      score += WEIGHTS.brandDomainInSubdomain;
      signals.push({ id: 'brand-domain-in-subdomain', weight: WEIGHTS.brandDomainInSubdomain, title: `${brandDomainInPath}.com appears inside this address`, detail: `The part you would read as the site is "${registrable}". Everything before it, including ${brandDomainInPath}.com, can be written by anyone.` });
    } else if (subs.length) {
      const inSubs = BRANDS.find((b) => subs.some((label) => {
        const flat = flatten(deconfuse(label));
        return flat === b || flat.includes(b);
      }));
      if (inSubs) {
        score += WEIGHTS.brandInSubdomain;
        signals.push({ id: 'brand-in-subdomain', weight: WEIGHTS.brandInSubdomain, title: `${inSubs} appears outside the real domain`, detail: `The part you would read as the site is "${registrable}". The ${inSubs} name sits in front of it, which anyone can do.` });
      }
    }
  }

  if (credentials.length) {
    const many = credentials.length >= 2;
    score += many ? WEIGHTS.credentialMany : WEIGHTS.credentialOne;
    signals.push({ id: 'credential-language', weight: many ? WEIGHTS.credentialMany : WEIGHTS.credentialOne, title: 'Address asks you to sign in', detail: `The domain contains "${credentials[0]}"${many ? ` and "${credentials[1]}"` : ''}. Sign-in pages are where passwords get stolen.` });
  }

  if (suffix && RISKY_SUFFIXES.has(suffix)) {
    score += WEIGHTS.riskySuffix;
    signals.push({ id: 'risky-suffix', weight: WEIGHTS.riskySuffix, title: `".${suffix}" is frequently used for throwaway domains`, detail: 'Not suspicious on its own, but it counts when combined with anything above.' });
  }

  const verdict = score >= 55 ? VERDICTS.dangerous : score >= 20 ? VERDICTS.caution : VERDICTS.safe;
  signals.sort((a, b) => b.weight - a.weight);
  return { host, registrableDomain: registrable, suffix, core, allowed: false, verdict, score, signals };
}

function isDangerous(result) {
  return result?.verdict === VERDICTS.dangerous;
}

module.exports = {
  ALLOWED_DOMAINS,
  BRANDS,
  CREDENTIAL_WORDS,
  VERDICTS,
  WEIGHTS,
  coreLabelOf,
  credentialWordsIn,
  deconfuse,
  editDistance,
  flatten,
  hasNonLatinScript,
  inspectHost,
  isDangerous,
  looksLikeTypo,
  registrableDomain,
  stripWww,
  subdomainLabels,
  suffixOf,
};
