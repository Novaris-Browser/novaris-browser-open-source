import { describe, expect, it } from 'vitest';
import { CSP_META, applyCspToHtml, buildCsp, cspHeaders } from '../electron/csp.js';

const directives = (policy) => policy.split(';').map((part) => part.trim()).filter(Boolean);
const directive = (policy, name) => directives(policy).find((d) => d.startsWith(`${name} `) || d === name);

describe('the production policy', () => {
  const policy = buildCsp();

  it('starts from nothing rather than from self', () => {
    // default-src 'self' is the most common mistake: it permits anything the
    // page can reach, and only narrows the categories someone remembered.
    expect(directive(policy, 'default-src')).toBe("default-src 'none'");
  });

  // A network origin in the shipped policy is a hole waiting for an injection.
  it('loads no script, style, font or image from a network origin', () => {
    for (const name of ['script-src', 'style-src', 'img-src', 'font-src', 'media-src', 'connect-src']) {
      const value = directive(policy, name) || '';
      expect(value).not.toMatch(/https?:/);
      expect(value).not.toMatch(/http:\/\/127/);
    }
  });

  // These were in the shipped policy, which meant every installed copy was
  // willing to open a connection to a development server on the local machine.
  it('contains no development origin', () => {
    expect(policy).not.toContain('5173');
    expect(policy).not.toContain('localhost');
  });

  it('permits no framing, objects, or base rewriting', () => {
    expect(directive(policy, 'frame-src')).toBe("frame-src 'none'");
    expect(directive(policy, 'object-src')).toBe("object-src 'none'");
    expect(directive(policy, 'base-uri')).toBe("base-uri 'none'");
    expect(directive(policy, 'form-action')).toBe("form-action 'none'");
  });

  // The interface never assigns innerHTML and never evals, which is the only
  // reason this is affordable.
  it('requires trusted types', () => {
    expect(directive(policy, 'require-trusted-types-for')).toBe("require-trusted-types-for 'script'");
  });

  it('upgrades insecure requests', () => {
    expect(directive(policy, 'upgrade-insecure-requests')).toBe('upgrade-insecure-requests');
  });

  it('names every directive exactly once', () => {
    const names = directives(policy).map((d) => d.split(' ')[0]);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('the development policy', () => {
  it('permits the dev server and nothing else', () => {
    const policy = buildCsp({ development: true, devServerUrl: 'http://127.0.0.1:5173' });
    const connect = directive(policy, 'connect-src');
    expect(connect).toContain("'self'");
    expect(connect).toContain('http://127.0.0.1:5173');
    expect(connect).toContain('ws://127.0.0.1:5173');
    expect(connect).not.toMatch(/https:\/\/(?!127)/);
  });

  it('refuses a dev server that is not on loopback', () => {
    const policy = buildCsp({ development: true, devServerUrl: 'https://evil.example:5173' });
    expect(directive(policy, 'connect-src')).toBe("connect-src 'self'");
  });

  it('narrower than no configuration rather than wider', () => {
    const policy = buildCsp({ development: true, devServerUrl: 'not a url' });
    expect(directive(policy, 'connect-src')).toBe("connect-src 'self'");
  });

  it('still forbids framing and objects in development', () => {
    const policy = buildCsp({ development: true });
    expect(directive(policy, 'frame-src')).toBe("frame-src 'none'");
    expect(directive(policy, 'object-src')).toBe("object-src 'none'");
  });
});

describe('applying the policy to a document', () => {
  it('inserts the tag into the head', () => {
    const html = applyCspToHtml('<html><head><title>x</title></head><body></body></html>', "default-src 'none'");
    expect(html).toContain('Content-Security-Policy');
    expect(html.indexOf('Content-Security-Policy')).toBeLessThan(html.indexOf('<body>'));
  });

  it('replaces an existing policy rather than adding a second one', () => {
    const html = applyCspToHtml(
      '<html><head><meta http-equiv="Content-Security-Policy" content="default-src *" /><title>x</title></head></html>',
      "default-src 'none'",
    );
    expect(html.match(new RegExp(CSP_META.source, 'gi'))).toHaveLength(1);
    expect(html).not.toContain('default-src *');
    expect(html).toContain("default-src 'none'");
  });

  it('handles a document with no head', () => {
    const html = applyCspToHtml('<p>bare</p>', "default-src 'none'");
    expect(html).toContain('Content-Security-Policy');
  });
});

describe('the response headers', () => {
  it('carries the policy and forbids content sniffing', () => {
    const headers = cspHeaders(buildCsp());
    expect(headers['Content-Security-Policy'][0]).toMatch(/default-src 'none'/);
    expect(headers['X-Content-Type-Options'][0]).toBe('nosniff');
  });
});
