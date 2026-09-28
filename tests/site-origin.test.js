import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// The site, the sitemap, the feed and the bucket CORS policy all have to name
// the same origin. They live in different files and are edited separately, which
// is exactly the arrangement that let the placeholder domain survive a deploy.
const site = path.join(process.cwd(), 'Official Website');
const read = (file) => fs.readFileSync(path.join(site, file), 'utf8');
const htmlFiles = fs.readdirSync(site).filter((name) => name.endsWith('.html'));

const siteConfig = read(path.join('js', 'config.js'));
const origin = (siteConfig.match(/origin:\s*'([^']+)'/) || [])[1];

describe('the site names one real origin', () => {
  it('has an origin configured, on https, with no trailing slash', () => {
    expect(origin).toBeTruthy();
    expect(origin).toMatch(/^https:\/\//);
    expect(origin).not.toMatch(/\/$/);
  });

  it('is not a placeholder domain', () => {
    // .example and .test are reserved and can never be a real site, so shipping
    // one means the canonical tags point nowhere and the sitemap lists fiction.
    expect(origin).not.toMatch(/\.(example|test|invalid|localhost)$/);
    expect(origin).not.toContain('localhost');
  });

  it('is used by every page canonical', () => {
    const wrong = htmlFiles.filter((name) => {
      const canonical = (read(name).match(/rel="canonical" href="([^"]+)"/) || [])[1] || '';
      return !canonical.startsWith(`${origin}/`);
    });
    expect(wrong).toEqual([]);
  });

  it('has no leftover Novaris URL on a different domain', () => {
    // Outbound links to other people's sites are fine and expected. What must not
    // survive is a Novaris-branded address pointing somewhere else, which is
    // exactly what the placeholder domain looked like after a rename.
    const stray = [];
    for (const name of htmlFiles) {
      const text = read(name);
      for (const match of text.match(/https?:\/\/[^\s"'<)]*novaris[a-z0-9.-]*/gi) || []) {
        if (!match.startsWith(origin)) stray.push(`${name}: ${match}`);
      }
    }
    expect(stray).toEqual([]);
  });

  it('matches the sitemap', () => {
    const sitemap = read('sitemap.xml');
    const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(locs.length).toBeGreaterThan(0);
    const wrong = locs.filter((loc) => !loc.startsWith(origin));
    expect(wrong).toEqual([]);
  });

  it('matches the release feed', () => {
    const feed = read('updates.xml');
    const wrong = [...feed.matchAll(/<link>([^<]+)<\/link>/g)].map((m) => m[1]).filter((l) => !l.startsWith(origin));
    expect(wrong).toEqual([]);
  });

  it('is an origin the bucket CORS policy already allows', () => {
    // Otherwise the site can never read the version, and it silently falls back
    // to built-in numbers that go stale without anyone noticing.
    const publisher = fs.readFileSync(path.join(process.cwd(), 'scripts', 'publish-release.mjs'), 'utf8');
    const origins = (publisher.match(/allowed_origins:\s*\[([^\]]+)\]/) || [])[1] || '';
    expect(origins).toContain(origin);
  });
});

describe('the site offers both platforms', () => {
  const download = read('download.html');

  it('has a download control for each platform', () => {
    expect(download).toContain('data-download-linux');
    expect(download).toMatch(/data-download\s/);
  });

  it('has a separate published hash for each platform', () => {
    // One shared hash element would have whichever feed loaded last overwrite it,
    // so the Linux package would be verified against the Windows hash.
    expect(download).toContain('data-hash-linux');
    expect(download).toContain('data-size-linux');
  });

  it('names both manifests, so each platform is described by its own', () => {
    expect(siteConfig).toContain('feedLinux');
    expect(siteConfig).toMatch(/latest-linux\.yml/);
  });

  it('does not claim to be Windows-only any more', () => {
    for (const name of htmlFiles) {
      expect({ file: name, text: read(name) && /Windows-only/i.test(read(name)) }).toEqual({ file: name, text: false });
    }
  });
});
