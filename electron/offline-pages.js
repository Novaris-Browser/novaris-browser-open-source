// Offline page saving.
//
// A saved page is a copy of a website on disk, which means two things have to be
// decided honestly rather than conveniently:
//
//   1. A page can contain scripts, and a script from a saved page is still a
//      script. Saved pages are therefore served from a quarantined origin that
//      has no access to the profile's cookies, storage, or vault, and the
//      sandboxed attributes are always set.
//   2. A saved page can contain what the page was showing when it was saved,
//      including anything personal that was rendered into it. So the file records
//      the address and the time, and the interface shows both, because a saved
//      copy of a banking page is a saved copy of that account's data.
//
// This stores HTML plus the text of the page. It does not mirror a site's assets
// as a full archive, because that produces a copy that looks real, works badly,
// and quietly breaks on the next visit. What it stores is readable, offline, and
// says plainly that it is a snapshot.

const { isHttpUrl } = require('./security');

const OFFLINE_SCHEME = 'novaris-offline';
const MAX_DOCUMENT_BYTES = 4 * 1024 * 1024;
const MAX_PAGES = 100;
const ALLOWED_SCHEMES = new Set(['http:', 'https:']);

/** Only real web pages can be saved. */
function canSave(url) {
  try {
    const parsed = new URL(String(url));
    return ALLOWED_SCHEMES.has(parsed.protocol) && isHttpUrl(String(url));
  } catch {
    return false;
  }
}

function recordKey(url) {
  return `${OFFLINE_SCHEME}://page/${createHashForUrl(url)}`;
}

function createHashForUrl(url) {
  // A stable, filesystem-safe key for a URL. Not a security boundary; it only
  // has to be collision-resistant enough to keep two saved pages apart.
  const crypto = require('node:crypto');
  return crypto.createHash('sha256').update(String(url)).digest('hex').slice(0, 32);
}

/** A saved page is only ever opened from the quarantined scheme. */
function offlineUrlFor(url) {
  return recordKey(url);
}

function listOfflinePages(pages) {
  // A non-array would make .filter undefined, so the shape is checked rather
  // than assumed.
  if (!Array.isArray(pages)) return [];
  return pages
    .filter((page) => page && typeof page.url === 'string')
    .map((page) => ({
      url: page.url,
      offlineUrl: recordKey(page.url),
      title: String(page.title || '').slice(0, 240),
      host: safeHost(page.url),
      savedAt: Number(page.savedAt) || 0,
      // Derived from the stored document rather than trusted from a field, so the
      // size shown is the size actually held on disk.
      bytes: Number(page.bytes) || (typeof page.html === 'string' ? page.html.length : 0),
      truncated: page.truncated === true,
    }))
    .sort((a, b) => b.savedAt - a.savedAt)
    .slice(0, MAX_PAGES);
}

function safeHost(url) {
  try {
    return new URL(String(url)).hostname;
  } catch {
    return '';
  }
}

/**
 * Builds the offline document.
 *
 * The saved content is placed inside a sandboxed iframe rather than injected into
 * the page, so the original document's scripts cannot reach Novaris's own
 * context, the preload API, or anything in the parent document. The wrapper
 * itself is inert and holds only text.
 */
function buildOfflineDocument({ title, url, savedAt, html, truncated = false }) {
  const host = safeHost(url);
  const when = savedAt ? new Date(savedAt).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : 'unknown time';
  // Built as plain text and escaped once below. Escaping here as well would
  // double-encode every ampersand and mangle any URL with a query string.
  const banner = `Saved copy of ${url}\n${host} · saved ${when}${truncated ? ' · this capture was truncated' : ''}`;
  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<title>${escapeHtml(title || host || 'Saved page')}</title>
<style>
  body { margin: 0; background: #0d1117; color: #e6edf3; font: 14px/1.6 system-ui, sans-serif; }
  header { padding: 10px 14px; background: #161b22; border-bottom: 1px solid #30363d; font-size: 12px; }
  header strong { display: block; font-size: 13px; }
  header span { color: #8b949e; }
  .wrap { padding: 14px; }
  iframe { width: 100%; min-height: 70vh; border: 1px solid #30363d; border-radius: 6px; background: #fff; }
</style>
<header>
  <strong>${escapeHtml(title || host || 'Saved page')}</strong>
  <span>${escapeHtml(banner)}</span>
</header>
<div class="wrap">
  <!-- The saved markup is placed in a sandbox with neither script execution nor
       same-origin access, so nothing captured from the site can read this page,
       call Novaris, or reach a stored credential. -->
  <iframe sandbox srcdoc="${escapeHtml(html || '')}" referrerpolicy="no-referrer"></iframe>
</div>
</html>`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Rejects a capture that is too large to be worth keeping on disk. */
function isAcceptableSize(bytes) {
  const size = Number(bytes) || 0;
  return size > 0 && size <= MAX_DOCUMENT_BYTES;
}

/**
 * Decides whether a capture is honest enough to present as a saved page.
 *
 * A page that logged in, or that is a media player, does not become readable by
 * being snapshotted, and pretending otherwise is worse than saying no.
 */
function assessCapture({ url, text, title, loggedInSignals = [] }) {
  const reasons = [];
  const body = String(text || '');
  if (body.trim().length < 200) reasons.push('The page had almost no text to save.');
  if (/\b(sign in|log in|signin|login)\b/i.test(title || '') && body.length < 800) {
    reasons.push('This looks like a sign-in page, and sign-in pages cannot be saved usefully.');
  }
  for (const signal of loggedInSignals) reasons.push(signal);
  return {
    savable: reasons.length === 0,
    reasons,
    textLength: body.length,
  };
}

module.exports = {
  MAX_DOCUMENT_BYTES,
  MAX_PAGES,
  OFFLINE_SCHEME,
  assessCapture,
  buildOfflineDocument,
  canSave,
  escapeHtml,
  isAcceptableSize,
  listOfflinePages,
  offlineUrlFor,
  recordKey,
};
