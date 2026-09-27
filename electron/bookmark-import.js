const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
const MAX_IMPORT_BOOKMARKS = 2000;

function decodeEntities(value) {
  return String(value || '')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function cleanTitle(value) {
  return decodeEntities(String(value || '').replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim().slice(0, 240);
}

function isHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function parseBookmarkHtml(input) {
  const html = Buffer.isBuffer(input) ? input.toString('utf8') : String(input || '');
  if (html.length > MAX_IMPORT_BYTES) throw new Error('That bookmark file is too large.');
  const records = [];
  const seen = new Set();
  const anchorPattern = /<a\s+[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(anchorPattern)) {
    if (records.length >= MAX_IMPORT_BOOKMARKS) break;
    let url;
    try { url = new URL(decodeEntities(match[1])).toString(); } catch { continue; }
    if (!isHttpUrl(url) || seen.has(url)) continue;
    seen.add(url);
    records.push({ url, title: cleanTitle(match[2]) || new URL(url).hostname });
  }
  return records;
}

module.exports = { MAX_IMPORT_BOOKMARKS, parseBookmarkHtml };
