import { describe, expect, it } from 'vitest';
import { detectImpersonation, evaluateFill, hostForUrl, hostMatches, providerForHost } from '../electron/credential-guard.js';
import { SiteSafetyManager } from '../electron/site-safety.js';

const safety = new SiteSafetyManager();
const classify = (value) => safety.classify(value);

describe('Novaris credential fill guard', () => {
  it('allows a credential to be filled into the site it belongs to', () => {
    const verdict = evaluateFill({ pageUrl: 'https://accounts.google.com/signin', credentialUrl: 'https://accounts.google.com', classify });
    expect(verdict).toEqual({ allowed: true, reason: '' });
  });

  it('allows a subdomain of the saved credential domain', () => {
    const verdict = evaluateFill({ pageUrl: 'https://mail.google.com/mail/u/0', credentialUrl: 'https://google.com', classify });
    expect(verdict.allowed).toBe(true);
  });

  // The bug this closes: any page with a password field used to receive the
  // saved credential.
  it('refuses to fill a Google password into an unrelated host', () => {
    const verdict = evaluateFill({ pageUrl: 'https://some-random-shop.test/login', credentialUrl: 'https://accounts.google.com', classify });
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toMatch(/Google/);
    expect(verdict.reason).toMatch(/some-random-shop\.test/);
  });

  it('refuses to fill on a site flagged as a scam even when the domain matches', () => {
    const verdict = evaluateFill({ pageUrl: 'https://robixa.vercel.app/', credentialUrl: 'https://robixa.vercel.app', classify });
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toMatch(/flagged/i);
  });

  it('names the scam reason ahead of the mismatch on a blocked host', () => {
    const verdict = evaluateFill({ pageUrl: 'https://walltrks.com/login', credentialUrl: 'https://accounts.google.com', classify });
    expect(verdict.allowed).toBe(false);
    expect(verdict.reason).toMatch(/flagged/i);
  });

  it('refuses when the credential has no saved website', () => {
    expect(evaluateFill({ pageUrl: 'https://example.com/', credentialUrl: '', classify }).allowed).toBe(false);
  });

  it('refuses when the page address cannot be read', () => {
    expect(evaluateFill({ pageUrl: 'about:blank', credentialUrl: 'https://example.com', classify }).allowed).toBe(false);
  });

  it('is not fooled by a lookalike host that merely ends with the provider name', () => {
    const verdict = evaluateFill({ pageUrl: 'https://notgoogle.com/signin', credentialUrl: 'https://google.com', classify });
    expect(verdict.allowed).toBe(false);
  });

  it('is not fooled by a provider name used as a subdomain prefix', () => {
    const verdict = evaluateFill({ pageUrl: 'https://google.com.evil.test/', credentialUrl: 'https://google.com', classify });
    expect(verdict.allowed).toBe(false);
  });
});

describe('Novaris account provider recognition', () => {
  it('recognises the real sign-in hosts', () => {
    expect(providerForHost('accounts.google.com')?.id).toBe('google');
    expect(providerForHost('youtube.com')?.id).toBe('google');
    expect(providerForHost('login.live.com')?.id).toBe('microsoft');
    expect(providerForHost('appleid.apple.com')?.id).toBe('apple');
    expect(providerForHost('roblox.com')?.id).toBe('roblox');
  });

  it('does not claim unrelated hosts', () => {
    expect(providerForHost('walltrks.com')).toBeNull();
    expect(providerForHost('example.com')).toBeNull();
  });

  it('strips the www prefix and lowercases the host', () => {
    expect(hostForUrl('https://WWW.Google.com/login')).toBe('google.com');
  });
});

describe('Novaris fake sign-in detection', () => {
  it('flags a Google password page hosted elsewhere', () => {
    const threat = detectImpersonation({
      url: 'https://walltrks.com/verify',
      title: 'Google Account Verification',
      text: 'Sign in with your Google account to continue.',
      hasPasswordField: true,
    });
    expect(threat).toMatchObject({ detected: true, severity: 'high', provider: 'Google', host: 'walltrks.com' });
    expect(threat.reason).toMatch(/asking for a password/i);
  });

  it('flags a YouTube cookie-request scam', () => {
    const threat = detectImpersonation({
      url: 'https://iosa.click/youtube',
      title: 'YouTube verification',
      text: 'Paste your YouTube cookies to unblock the video.',
      hasPasswordField: false,
      hasPasteField: true,
    });
    expect(threat).toMatchObject({ detected: true, severity: 'low', provider: 'Google' });
    expect(threat.reason).toMatch(/session token/i);
  });

  it('does not flag the real provider', () => {
    expect(detectImpersonation({
      url: 'https://accounts.google.com/signin',
      title: 'Sign in - Google Accounts',
      text: 'Google',
      hasPasswordField: true,
    })).toBeNull();
  });

  it('does not flag an ordinary page that mentions a brand name', () => {
    expect(detectImpersonation({
      url: 'https://example.com/news',
      title: 'Google announces something',
      text: 'A short article about YouTube.',
      hasPasswordField: false,
    })).toBeNull();
  });

  it('ignores non-http pages', () => {
    expect(detectImpersonation({ url: 'about:blank', title: 'Google', hasPasswordField: true })).toBeNull();
  });

  it('handles every reported scam host without crashing', () => {
    for (const host of ['jump.offerclk.net', 'creatorspayouts.com', 'v0-iroblox.vercel.app', 'rbxuser.com', 'claimgifts.site', 'verifysafe.click']) {
      const threat = detectImpersonation({ url: `https://${host}/`, title: 'Roblox', text: 'Sign in', hasPasswordField: true });
      expect(threat, host).toMatchObject({ detected: true });
    }
  });

  it('stays silent when a brand name is mentioned but nothing is being captured', () => {
    // A cookie-jar mention alone must not trigger, or the warning becomes noise.
    expect(detectImpersonation({
      url: 'https://example.com/cookies-explained',
      title: 'How cookies work',
      text: 'Google sets cookies for youtube.com.',
      hasPasswordField: false,
      hasPasteField: false,
    })).toBeNull();
  });
});

describe('Novaris host matching rules', () => {
  it('matches exact hosts and subdomains only', () => {
    expect(hostMatches('google.com', 'google.com')).toBe(true);
    expect(hostMatches('accounts.google.com', 'google.com')).toBe(true);
    expect(hostMatches('notgoogle.com', 'google.com')).toBe(false);
    expect(hostMatches('google.com.evil.test', 'google.com')).toBe(false);
  });
});
