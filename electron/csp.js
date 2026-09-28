// The Content Security Policy for Novaris's own interface.
//
// The renderer is loaded from disk, so a policy is the difference between the
// interface being able to load only what the project shipped, and a script
// anywhere in it being able to pull in code from anywhere else. The interface
// runs with the same privileges as the browser itself, so this is the boundary
// that matters most after process isolation.
//
// Two rules shape it:
//
//   * Nothing loads from a network origin in the built application. Every
//     script, style, font and image is in the bundle. A production policy that
//     permits a remote origin is a policy with a hole in it waiting for an
//     injection.
//
//   * Development origins appear only in development. They were previously in
//     the shipped policy, which meant every installed copy was willing to open a
//     connection to a development server on the local machine.

const DEV_ORIGINS = ['http://127.0.0.1:5173', 'ws://127.0.0.1:5173'];

/**
 * Builds the policy.
 *
 * Trusted Types is enabled because the interface never assigns to innerHTML and
 * never calls eval. That is what makes it affordable: the policy would have to
 * be relaxed otherwise, and then it would only be decoration.
 */
function buildCsp({ development = false, devServerUrl = '' } = {}) {
  const connect = ["'self'"];
  if (development) {
    // Only ever the dev server, and only ever over loopback. A wildcard here
    // would be a hole in a policy that otherwise has none.
    if (devServerUrl) {
      try {
        const url = new URL(devServerUrl);
        if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') {
          connect.push(url.origin);
          if (url.protocol === 'http:') connect.push(url.origin.replace(/^http:/, 'ws:'));
        }
      } catch {
        // A malformed value narrows the policy rather than widening it.
      }
    } else {
      connect.push(...DEV_ORIGINS);
    }
  }

  return [
    "default-src 'none'",
    "script-src 'self'",
    // Inline styles are unavoidable with a component library that sets style
    // attributes. It does not permit script, which is the part that matters.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "media-src 'self' blob:",
    `connect-src ${connect.join(' ')}`,
    // No frames at all. The interface embeds pages through webviews, which are a
    // separate privileged element and are not governed by frame-src.
    "frame-src 'none'",
    "child-src 'none'",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "manifest-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    "require-trusted-types-for 'script'",
    ...(development ? [] : ['upgrade-insecure-requests']),
  ].join('; ');
}

const CSP_META = /<meta\s+http-equiv=["']Content-Security-Policy["'][^>]*>/i;

/** Replaces or inserts the policy in a document, for the dev server case. */
function applyCspToHtml(html, policy) {
  const tag = `<meta http-equiv="Content-Security-Policy" content="${policy}" />`;
  const body = String(html);
  if (CSP_META.test(body)) return body.replace(CSP_META, tag);
  if (/<head[^>]*>/i.test(body)) return body.replace(/<head[^>]*>/i, (m) => `${m}\n    ${tag}`);
  return `${tag}\n${body}`;
}

/**
 * The headers a response must carry. A meta tag is weaker: it arrives after the
 * document starts loading, and a document served by the dev server can be
 * changed without touching the file. Both are applied where each applies.
 */
function cspHeaders(policy) {
  return {
    'Content-Security-Policy': [policy],
    'X-Content-Type-Options': ['nosniff'],
  };
}

module.exports = {
  CSP_META,
  DEV_ORIGINS,
  applyCspToHtml,
  buildCsp,
  cspHeaders,
};
