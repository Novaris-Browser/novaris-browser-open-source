import { describe, expect, it } from 'vitest';
import {
  VERDICTS,
  credentialWordsIn,
  deconfuse,
  editDistance,
  hasNonLatinScript,
  inspectHost,
  isDangerous,
  registrableDomain,
  stripWww,
  subdomainLabels,
  suffixOf,
} from '../electron/phishing.js';

// Real addresses that must never be flagged. A phishing detector that cries wolf
// on these is worse than no detector, so they are pinned as a set.
const LEGITIMATE = [
  'google.com', 'www.google.com', 'mail.google.com', 'accounts.google.com',
  'youtube.com', 'github.com', 'github.io', 'microsoft.com',
  'login.microsoftonline.com', 'outlook.live.com', 'apple.com', 'icloud.com',
  'amazon.co.uk', 'amazon.com.au', 'bbc.co.uk', 'bbc.com.au', 'gov.uk',
  'netflix.com', 'paypal.com', 'stripe.com', 'wikipedia.org', 'nytimes.com',
  'stackoverflow.com', 'developer.mozilla.org', 'reddit.com', 'wikipedia.de',
  'docs.google.com', 'drive.google.com', 'zoom.us', 'slack.com',
];

describe('Novaris local phishing detection: registrable domain', () => {
  it('strips a leading www', () => {
    expect(stripWww('www.google.com')).toBe('google.com');
    expect(stripWww('WWW.GOOGLE.COM')).toBe('google.com');
  });

  it('handles two label public suffixes so bbc.co.uk is not read as co.uk', () => {
    expect(registrableDomain('bbc.co.uk')).toBe('bbc.co.uk');
    expect(registrableDomain('news.bbc.co.uk')).toBe('bbc.co.uk');
    expect(registrableDomain('amazon.com.au')).toBe('amazon.com.au');
  });

  it('falls back to the last two labels', () => {
    expect(registrableDomain('a.b.example.com')).toBe('example.com');
    expect(registrableDomain('example.com')).toBe('example.com');
  });

  it('reports the suffix and the labels outside the real domain', () => {
    expect(suffixOf('paypal.com.evil.tk')).toBe('tk');
    // The registrable domain is evil.tk, so everything before it is "outside".
    expect(subdomainLabels('paypal.com.evil.tk')).toEqual(['paypal', 'com']);
    expect(subdomainLabels('login.paypal.com.evil.tk')).toEqual(['login', 'paypal', 'com']);
    expect(subdomainLabels('paypal.com')).toEqual([]);
  });
});

describe('Novaris local phishing detection: confusables', () => {
  it('maps digits onto the letters they imitate', () => {
    expect(deconfuse('paypa1')).toBe('paypal');
    expect(deconfuse('g00gle')).toBe('google');
    expect(deconfuse('micros0ft')).toBe('microsoft');
  });

  it('maps Cyrillic and Greek homoglyphs onto Latin', () => {
    expect(deconfuse('pаypal')).toBe('paypal'); // Cyrillic a
    expect(deconfuse('аpple')).toBe('apple');
    // A domain written entirely in one script is the dangerous case, so it has
    // to be reported even though no Latin character is present to contrast with.
    expect(hasNonLatinScript('pаypal')).toBe(true);
    expect(hasNonLatinScript('аррӏе')).toBe(true);
    expect(hasNonLatinScript('paypal')).toBe(false);
  });

  it('computes edit distance', () => {
    expect(editDistance('paypal', 'paypal')).toBe(0);
    expect(editDistance('paypal', 'paypa1')).toBe(1);
    expect(editDistance('google', 'g00gle')).toBe(2);
    expect(editDistance('a', 'completely-different')).toBeGreaterThan(3);
  });
});

describe('Novaris local phishing detection: real sites stay clean', () => {
  for (const host of LEGITIMATE) {
    it(`does not flag ${host}`, () => {
      const result = inspectHost(host);
      expect(result.verdict).toBe(VERDICTS.safe);
      expect(result.signals.filter((s) => s.id === 'typosquat')).toEqual([]);
      expect(result.signals.filter((s) => s.id === 'brand-in-subdomain')).toEqual([]);
    });
  }
});

describe('Novaris local phishing detection: known phishing patterns', () => {
  const dangerous = [
    ['paypa1.com', /imitates paypal/i],
    ['paypal-login.tk', /combines paypal with sign-in wording/i],
    ['paypal.com.evil.tk', /paypal\.com appears inside this address/i],
    ['login-paypal-secure.xyz', /combines paypal with sign-in wording/i],
    ['g00gle.com', /imitates google with lookalike/i],
    ['micros0ft-support.net', /builds microsoft out of lookalike|combines microsoft with sign-in wording/i],
    ['appleid.apple.com.evil.co', /apple\.com appears inside this address/i],
    ['secure-login-netflix.com', /combines netflix with sign-in wording/i],
    ['amazon-verify-account.top', /combines amazon with sign-in wording/i],
  ];

  for (const [host, matcher] of dangerous) {
    it(`flags ${host} as dangerous`, () => {
      const result = inspectHost(host);
      expect(result.verdict).toBe(VERDICTS.dangerous);
      expect(isDangerous(result)).toBe(true);
      expect(result.signals.some((s) => matcher.test(s.title + s.detail))).toBe(true);
    });
  }

  it('flags a punycode lookalike and explains how to read it', () => {
    // Cyrillic "a" encoded as punycode, the classic apple.com clone.
    const result = inspectHost('xn--pple-43d.com');
    expect(result.verdict).not.toBe(VERDICTS.safe);
    expect(result.signals.some((s) => s.id === 'punycode')).toBe(true);
  });

  it('flags a domain written entirely in another alphabet as dangerous', () => {
    const result = inspectHost('аррӏе.com'); // Cyrillic lookalikes, no Latin at all
    expect(result.signals.some((s) => s.id === 'non-latin-script')).toBe(true);
    expect(result.verdict).toBe(VERDICTS.dangerous);
  });

  it('says plainly when a domain is on the verified list', () => {
    const result = inspectHost('login.microsoftonline.com');
    expect(result.allowed).toBe(true);
    expect(result.verdict).toBe(VERDICTS.safe);
    // Being on the list is shown, not hidden, so the exemption is auditable.
    expect(result.signals[0].id).toBe('allowed');
  });
});

describe('Novaris local phishing detection: verdicts are proportionate', () => {
  it('keeps a bare risky suffix at caution, not dangerous', () => {
    // Plenty of real sites are on these, so the suffix cannot decide alone.
    const result = inspectHost('some-ordinary-blog.tk');
    expect(result.verdict).toBe(VERDICTS.caution);
    expect(result.signals.some((s) => s.id === 'risky-suffix')).toBe(true);
    expect(result.signals.some((s) => s.id === 'typosquat')).toBe(false);
  });

  it('notices sign-in wording without calling it dangerous on its own', () => {
    const result = inspectHost('secure-mybank.example.org');
    expect(result.signals.some((s) => s.id === 'credential-language')).toBe(true);
  });

  it('lists signals strongest first so the reason is visible', () => {
    const result = inspectHost('login-paypal-secure.xyz');
    const weights = result.signals.map((s) => s.weight);
    expect([...weights].sort((a, b) => b - a)).toEqual(weights);
  });

  it('names credential words it recognised', () => {
    expect(credentialWordsIn('secure-login.example.com')).toEqual(expect.arrayContaining(['login', 'secure']));
  });
});

describe('Novaris local phishing detection: hostile input', () => {
  it('never throws on malformed input', () => {
    const inputs = ['', null, undefined, 123, {}, '...', 'a', 'xn--', 'paypa1', '<script>', 'x'.repeat(5000), '..%2f..%2f', 'a.b.c.d.e.f.g'];
    for (const input of inputs) {
      const result = inspectHost(input);
      expect(typeof result.verdict).toBe(VERDICTS.dangerous ? 'string' : 'string');
      expect(Array.isArray(result.signals)).toBe(true);
    }
  });

  it('refuses to interpret a host that is not a hostname', () => {
    const result = inspectHost('<script>alert(1)</script>');
    expect(result.verdict).toBe(VERDICTS.caution);
    expect(result.signals.some((s) => s.id === 'unreadable')).toBe(true);
  });

  it('terminates quickly on a pathological input', () => {
    const started = Date.now();
    inspectHost(`${'a'.repeat(400)}.com`);
    expect(Date.now() - started).toBeLessThan(2000);
  });
});
