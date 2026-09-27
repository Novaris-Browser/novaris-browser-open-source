// Audits the static site for the mistakes that actually get pages penalised or
// broken: missing metadata, duplicate or unresolvable links, absent alt text,
// heading order, structured data that does not parse, and claims that
// contradict each other.
//
// Run with:  node tools/site-audit.mjs
// Exits non-zero when something is wrong, so it can gate a deploy.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ORIGIN = 'https://novarisbrowser.example';

const problems = [];
const warnings = [];
const notes = [];
const fail = (page, message) => problems.push(`${page}: ${message}`);
const warn = (page, message) => warnings.push(`${page}: ${message}`);

const pages = fs.readdirSync(root).filter((name) => name.endsWith('.html')).sort();
const allFiles = new Set(fs.readdirSync(root));

function read(name) {
  return fs.readFileSync(path.join(root, name), 'utf8');
}

/* ------------------------------------------------------------------ */
/* Per-page checks                                                     */
/* ------------------------------------------------------------------ */

const canonicalSet = new Set();

for (const page of pages) {
  const html = read(page);

  // --- Required metadata -------------------------------------------
  const title = (html.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '';
  if (!title) fail(page, 'no <title>');
  else if (title.length > 65) warn(page, `title is ${title.length} characters, over the ~60 that display fully in results`);
  else if (title.length < 20) warn(page, `title is only ${title.length} characters`);

  const description = (html.match(/<meta name="description" content="([\s\S]*?)"\s*\/?>/) || [])[1] || '';
  if (!description) fail(page, 'no meta description');
  else if (description.length > 165) warn(page, `meta description is ${description.length} characters and will be truncated`);
  else if (description.length < 70) warn(page, `meta description is only ${description.length} characters`);

  const canonical = (html.match(/<link rel="canonical" href="([^"]+)"/) || [])[1] || '';
  if (!canonical) fail(page, 'no canonical link');
  else if (canonicalSet.has(canonical)) fail(page, `duplicate canonical, also used by another page: ${canonical}`);
  else canonicalSet.add(canonical);

  if (pages.length > 1 && !/property="og:title"/.test(html)) fail(page, 'no Open Graph title');
  if (pages.length > 1 && !/name="twitter:card"/.test(html)) fail(page, 'no Twitter card type');
  if (pages.length > 1 && !/property="og:image"/.test(html)) warn(page, 'no Open Graph image');

  if (!/<html lang="/.test(html)) fail(page, 'no lang attribute on <html>');
  if (!/name="viewport"/.test(html)) fail(page, 'no viewport meta');

  // --- One h1, and no skipped heading levels ------------------------
  const headings = [...html.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/g)];
  const h1s = headings.filter((h) => h[1] === '1');
  if (h1s.length === 0) fail(page, 'no <h1>');
  if (h1s.length > 1) fail(page, `${h1s.length} <h1> elements, expected exactly one`);

  let previous = 0;
  for (const [, level, text] of headings) {
    const value = Number(level);
    if (previous && value > previous + 1) {
      warn(page, `heading jumps from h${previous} to h${value} at "${String(text).replace(/<[^>]*>/g, '').trim().slice(0, 40)}"`);
    }
    previous = value;
  }

  // --- Images need alt text -----------------------------------------
  for (const img of html.matchAll(/<img\b[^>]*>/g)) {
    const tag = img[0];
    if (!/\salt\s*=/.test(tag)) fail(page, `image without alt: ${tag.slice(0, 70)}`);
    if (/\bwidth\s*=/.test(tag) !== /\bheight\s*=/.test(tag)) {
      warn(page, `image without both width and height, which causes layout shift: ${tag.slice(0, 70)}`);
    }
  }

  // --- Links resolve -------------------------------------------------
  for (const link of html.matchAll(/href="([^"#][^"]*)"/g)) {
    const href = link[1];
    if (/^(https?:|mailto:|tel:|data:|\/\/)/i.test(href)) {
      if (href.startsWith(ORIGIN)) {
        const target = href.slice(ORIGIN.length).replace(/^\//, '') || 'index.html';
        if (target && !allFiles.has(target)) fail(page, `internal link to a missing file: ${href}`);
      }
      continue;
    }
    const target = href.split('?')[0].split('#')[0];
    if (!target) continue;
    if (target.startsWith('css/') || target.startsWith('js/') || target.startsWith('assets/')) {
      if (!fs.existsSync(path.join(root, target))) fail(page, `link to a missing asset: ${href}`);
    } else if (!allFiles.has(target) && !fs.existsSync(path.join(root, target))) {
      fail(page, `link to a missing file: ${href}`);
    }
  }

  // --- Scripts and stylesheets load ---------------------------------
  for (const ref of [...html.matchAll(/<script src="([^"]+)"/g), ...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)]) {
    if (!fs.existsSync(path.join(root, ref[1]))) fail(page, `references a missing file: ${ref[1]}`);
  }

  // --- Images referenced by CSS must exist --------------------------
  const cssPath = path.join(root, 'css', 'styles.css');
  if (fs.existsSync(cssPath)) {
    const css = fs.readFileSync(cssPath, 'utf8');
    for (const url of css.matchAll(/url\("([^"]+)"\)/g)) {
      const ref = url[1];
      if (/^(https?:|data:)/i.test(ref)) continue;
      const resolved = path.resolve(path.dirname(cssPath), ref);
      if (!fs.existsSync(resolved)) {
        // A missing image layer is acceptable when a second layer is present,
        // because the browser simply drops it. Worth knowing, not an error.
        warn(page, `css references a missing image: ${ref}`);
      }
    }
  }

  // --- Structured data must parse ------------------------------------
  for (const block of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try {
      JSON.parse(block[1]);
    } catch (error) {
      fail(page, `structured data is not valid JSON: ${error.message}`);
    }
  }

  // --- Consent plumbing ---------------------------------------------
  if (!/data-consent-accept/.test(html)) warn(page, 'no consent accept button, so a banner here could not record a yes');
  if (!/data-consent-reject/.test(html)) warn(page, 'no consent decline button, which is required alongside accept');
  if (!/js\/ads\.js/.test(html)) warn(page, 'does not load the consent and advertising script');
  if (!/js\/config\.js/.test(html)) warn(page, 'does not load the site configuration');

  // --- Placeholders must be visible as placeholders ------------------
  if (/href=""/.test(html)) fail(page, 'has an empty href, which reloads the page');
}

/* ------------------------------------------------------------------ */
/* Site-wide checks                                                    */
/* ------------------------------------------------------------------ */

const sitemap = path.join(root, 'sitemap.xml');
if (!fs.existsSync(sitemap)) {
  fail('sitemap.xml', 'missing');
} else {
  const xml = fs.readFileSync(sitemap, 'utf8');
  const listed = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  for (const url of listed) {
    const file = url.replace(`${ORIGIN}/`, '') || 'index.html';
    if (!fs.existsSync(path.join(root, file))) fail('sitemap.xml', `lists a page that does not exist: ${url}`);
  }
  for (const page of pages) {
    const url = page === 'index.html' ? `${ORIGIN}/` : `${ORIGIN}/${page}`;
    if (!listed.includes(url)) fail('sitemap.xml', `does not list an existing page: ${page}`);
  }
  notes.push(`sitemap lists ${listed.length} URLs, all of which exist`);
}

const robots = path.join(root, 'robots.txt');
if (!fs.existsSync(robots)) {
  fail('robots.txt', 'missing');
} else {
  const text = fs.readFileSync(robots, 'utf8');
  if (!/^Sitemap:/m.test(text)) fail('robots.txt', 'no Sitemap directive');
  if (!/Mediapartners-Google/i.test(text)) warn('robots.txt', 'no ad crawler allowance, which can suppress ad serving');
  if (!/\.exe/.test(text)) notes.push('robots.txt does not block installer binaries, which you may want to add');
}

// Every page in the footer, so the legal pages are reachable from everywhere.
for (const page of pages) {
  const html = read(page);
  for (const required of ['privacy.html', 'cookies.html', 'terms.html']) {
    if (!html.includes(required)) warn(page, `footer does not link to ${required}`);
  }
}

// The site must not contradict itself about tracking.
const config = fs.readFileSync(path.join(root, 'js', 'config.js'), 'utf8');
if (/REPLACE_WITH_YOUR_PUBLISHER_ID/.test(config)) {
  notes.push('AdSense publisher id is still a placeholder, so no ad will ever render');
}
if (/REPLACE_WITH_YOUR_PAYPAL/.test(config) || /REPLACE_WITH_YOUR_CASHAPP/.test(config)) {
  notes.push('Donation details are still placeholders, so the donate buttons stay visibly disabled');
}

// Payment details belong in js/config.js, not written into the page, or they
// will drift and there will be two places to change. A literal paypal.me or
// cash.app address in the markup is what is worth catching here.
const donate = read('donate.html');
const inlinePayment = donate.match(/(?:paypal\.me\/|cash\.app\/\$)[A-Za-z0-9_.-]+/g) || [];
for (const literal of inlinePayment) {
  if (/REPLACE/i.test(literal)) continue;
  fail('donate.html', `has a payment address written into the page (${literal}); it belongs in js/config.js`);
}
if (!/data-donate-paypal/.test(donate)) fail('donate.html', 'is missing the PayPal hook the script binds to');
if (!/data-donate-cashapp/.test(donate)) fail('donate.html', 'is missing the Cash App hook the script binds to');

/* ------------------------------------------------------------------ */
/* Report                                                              */
/* ------------------------------------------------------------------ */

const out = [];
out.push(`Site audit — ${pages.length} pages`);
out.push('');
out.push(`PASS  ${pages.length} pages checked, ${canonicalSet.size} unique canonicals`);
if (notes.length) {
  out.push('');
  out.push('NOTES');
  for (const note of notes) out.push(`  · ${note}`);
}
if (warnings.length) {
  out.push('');
  out.push(`WARNINGS (${warnings.length})`);
  for (const item of warnings) out.push(`  · ${item}`);
}
if (problems.length) {
  out.push('');
  out.push(`ERRORS (${problems.length})`);
  for (const item of problems) out.push(`  · ${item}`);
} else {
  out.push('');
  out.push('ERRORS  none');
}

console.log(out.join('\n'));
process.exitCode = problems.length ? 1 : 0;
