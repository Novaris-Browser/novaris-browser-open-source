import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { backgroundKind, classifyExtension, levelLabel, manifestVersionOf } from '../electron/extension-compat.js';
import { readManifest } from '../electron/extension-package.js';

const name = 'Test Extension';

function makeExtension(manifest, extraFiles = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'novaris-extcompat-'));
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  for (const [file, content] of Object.entries(extraFiles)) {
    writeFileSync(path.join(dir, file), content);
  }
  return dir;
}

describe('Novaris extension compatibility', () => {
  it('reports a Manifest V2 background page as fully working', () => {
    const result = classifyExtension({
      manifest: { manifest_version: 2, name, background: { page: 'background.html', persistent: true } },
    });
    expect(result).toMatchObject({ level: 'ok', functional: true, background: 'page' });
    expect(result.reasons).toEqual([]);
  });

  it('reports a Manifest V2 background script page as fully working', () => {
    const result = classifyExtension({
      manifest: { manifest_version: 2, name, background: { scripts: ['bg.js'], persistent: true } },
    });
    expect(result).toMatchObject({ level: 'ok', functional: true, background: 'scripts' });
  });

  // The failure this exists for: the extension installs and then does nothing.
  it('marks a Manifest V3 service worker as unsupported and explains it', () => {
    const result = classifyExtension({
      manifest: { manifest_version: 3, name, background: { service_worker: 'sw.js' } },
    });
    expect(result.level).toBe('unsupported');
    expect(result.functional).toBe(false);
    expect(result.background).toBe('service-worker');
    expect(result.reasons[0].detail).toMatch(/service worker/i);
    expect(result.reasons[0].fix).toMatch(/Manifest V2/i);
  });

  it('treats a service worker with no other background as unsupported', () => {
    const result = classifyExtension({
      manifest: { manifest_version: 3, name, background: { service_worker: 'background.js' } },
    });
    expect(result.level).toBe('unsupported');
  });

  it('allows a Manifest V3 extension that needs no service worker', () => {
    // Content scripts alone do not depend on the background lifecycle.
    const result = classifyExtension({
      manifest: {
        manifest_version: 3,
        name,
        content_scripts: [{ matches: ['<all_urls>'], js: ['content.js'] }],
        permissions: ['activeTab'],
      },
    });
    expect(result).toMatchObject({ level: 'ok', functional: true, background: '' });
  });

  it('flags a Manifest V2 event page as limited', () => {
    const result = classifyExtension({
      manifest: { manifest_version: 2, name, background: { page: 'bg.html', persistent: false } },
    });
    expect(result.level).toBe('limited');
    expect(result.functional).toBe(true);
    expect(result.reasons[0].title).toMatch(/may not work/i);
  });

  it('flags a declarative network ruleset as limited on V3', () => {
    const result = classifyExtension({
      manifest: {
        manifest_version: 3,
        name,
        content_scripts: [{ matches: ['<all_urls>'], js: ['c.js'] }],
        declarative_net_request: { rule_resources: [{ id: 'rules', enabled: true, path: 'rules.json' }] },
      },
    });
    expect(result.level).toBe('limited');
    expect(result.reasons.some((reason) => /declarative network rules/i.test(reason.detail))).toBe(true);
  });

  it('flags APIs the runtime does not provide', () => {
    const result = classifyExtension({
      manifest: { manifest_version: 2, name, permissions: ['nativeMessaging', 'storage'] },
    });
    expect(result.level).toBe('unsupported');
    expect(result.reasons.some((reason) => /native messaging/i.test(reason.title))).toBe(true);
  });

  it('checks optional permissions as well as required ones', () => {
    const result = classifyExtension({
      manifest: { manifest_version: 2, name, optional_permissions: ['offscreen'] },
    });
    expect(result.level).toBe('unsupported');
  });

  it('reports a load failure as unsupported with the reason', () => {
    const result = classifyExtension({
      manifest: { manifest_version: 2, name },
      loadError: 'Manifest file is invalid',
    });
    expect(result.level).toBe('unsupported');
    expect(result.reasons[0].title).toMatch(/failed to load/i);
    expect(result.reasons[0].detail).toMatch(/invalid/i);
  });

  it('never throws on a missing or malformed manifest', () => {
    for (const input of [{}, { manifest: null }, { manifest: 'nonsense' }, { manifest: {} }]) {
      const result = classifyExtension(input);
      expect(typeof result.level).toBe('string');
      expect(Array.isArray(result.reasons)).toBe(true);
    }
  });

  it('names the bundled ad blocker as fully working', () => {
    // Guards against the classifier flagging our own first-party extension.
    const result = classifyExtension({
      manifest: {
        manifest_version: 3,
        name: 'Novaris Ad Blocker',
        content_scripts: [{ matches: ['<all_urls>'], js: ['content.js'], run_at: 'document_start', all_frames: true }],
      },
    });
    expect(result.level).toBe('ok');
  });

  it('has a human-readable label for every level', () => {
    expect(levelLabel('ok')).toBe('Works');
    expect(levelLabel('limited')).toBe('Limited');
    expect(levelLabel('unsupported')).toBe('Not supported');
  });
});

// The classifier has to agree with the manifest shape readManifest actually
// returns. It originally read manifest_version and background, which that
// function dropped, so every extension came back as fully working.
describe('Novaris classifier against real parsed manifests', () => {
  it('marks a real MV2 extension as working', () => {
    const dir = makeExtension({
      manifest_version: 2,
      name,
      version: '1.0.0',
      permissions: ['activeTab'],
      background: { scripts: ['bg.js'], persistent: true },
    }, { 'bg.js': '' });
    const result = classifyExtension({ manifest: readManifest(dir) });
    expect(result).toMatchObject({ level: 'ok', manifestVersion: 2, background: 'scripts', functional: true });
  });

  it('marks a real MV3 service worker extension as unsupported', () => {
    const dir = makeExtension({
      manifest_version: 3,
      name,
      version: '1.0.0',
      permissions: ['activeTab'],
      background: { service_worker: 'sw.js' },
    }, { 'sw.js': '' });
    const result = classifyExtension({ manifest: readManifest(dir) });
    expect(result).toMatchObject({ level: 'unsupported', manifestVersion: 3, background: 'service-worker', functional: false });
    expect(result.reasons[0].detail).toMatch(/service worker/i);
  });

  it('tells an absent persistent flag apart from an explicit false', () => {
    const persistent = makeExtension({
      manifest_version: 2, name, version: '1.0.0', background: { page: 'bg.html' },
    });
    const eventPage = makeExtension({
      manifest_version: 2, name, version: '1.0.0', background: { page: 'bg.html', persistent: false },
    });
    expect(classifyExtension({ manifest: readManifest(persistent) }).level).toBe('ok');
    expect(classifyExtension({ manifest: readManifest(eventPage) }).level).toBe('limited');
  });

  it('sees a nativeMessaging permission through the merged permission list', () => {
    const dir = makeExtension({
      manifest_version: 2, name, version: '1.0.0', permissions: ['storage'], optional_permissions: ['nativeMessaging'],
    });
    const result = classifyExtension({ manifest: readManifest(dir) });
    expect(result.level).toBe('unsupported');
    expect(result.reasons.some((reason) => /native messaging/i.test(reason.title))).toBe(true);
  });

  it('reads the manifest version from either spelling', () => {
    expect(manifestVersionOf({ manifest_version: 3 })).toBe(3);
    expect(manifestVersionOf({ manifestVersion: 2 })).toBe(2);
    expect(manifestVersionOf({})).toBe(0);
  });
});

describe('Novaris background detection', () => {
  it('identifies each background style', () => {
    expect(backgroundKind({ background: { service_worker: 'sw.js' } })).toBe('service-worker');
    expect(backgroundKind({ background: { scripts: ['a.js'] } })).toBe('scripts');
    expect(backgroundKind({ background: { page: 'a.html' } })).toBe('page');
    expect(backgroundKind({})).toBe('');
    expect(backgroundKind({ background: null })).toBe('');
  });
});
