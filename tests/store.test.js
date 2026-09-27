import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonStore } from '../electron/store.js';

const temporaryDirectories = [];

afterEach(() => {
  while (temporaryDirectories.length) {
    rmSync(temporaryDirectories.pop(), { recursive: true, force: true });
  }
});

function createStore() {
  const directory = mkdtempSync(join(tmpdir(), 'novaris-store-'));
  temporaryDirectories.push(directory);
  const store = new JsonStore(join(directory, 'data.json'));
  store.initSync();
  return store;
}

describe('Novaris metadata store', () => {
  it('persists bookmarks, history, and settings safely', () => {
    const store = createStore();
    store.updateSettings({ theme: 'light', accent: '#65d6c2' });
    store.toggleBookmark({ url: 'https://example.com', title: 'Example' });
    store.recordVisit({ url: 'https://example.com', title: 'Example' });

    const reloaded = new JsonStore(store.filePath);
    reloaded.initSync();
    const snapshot = reloaded.snapshot();
    expect(snapshot.settings.theme).toBe('light');
    expect(snapshot.settings.accent).toBe('#65d6c2');
    expect(snapshot.bookmarks).toHaveLength(1);
    expect(snapshot.history[0].url).toBe('https://example.com/');
  });

  it('recovers from a damaged metadata file using its backup', () => {
    const store = createStore();
    store.updateSettings({ theme: 'dark' });
    store.updateSettings({ transparency: 0.7 });
    const damaged = store.filePath;
    writeFileSync(damaged, '{not-json', 'utf8');
    const recovered = new JsonStore(damaged);
    recovered.initSync();
    expect(recovered.snapshot().settings.theme).toBe('dark');
  });

  it('rejects unsafe bookmark protocols', () => {
    const store = createStore();
    store.toggleBookmark({ url: 'file:///C:/Windows/System32/config', title: 'No' });
    expect(store.snapshot().bookmarks).toHaveLength(0);
  });

  it('persists custom search engines, site policies, groups, and sessions', () => {
    const store = createStore();
    store.updateSettings({
      customSearchEngines: [{ id: 'my-search', name: 'My Search', url: 'https://search.example/?q={query}', keyword: 's' }],
      searchEngine: 'my-search',
    });
    store.setSitePermission('https://example.com', 'camera', 'allow');
    store.setTabGroups([{ id: 'work', name: 'Work', color: '#65d6c2' }]);
    store.setExtensions([{ id: 'store-1', name: 'Store extension', version: '1.0.0', path: 'C:/extensions/store-1', source: 'chrome-web-store-import', storeUrl: 'https://chromewebstore.google.com/detail/example/abcdefghijklmnopabcdefghijklmnop', packageFormat: 'crx3' }]);
    store.updateSettings({ globalHotkey: 'Ctrl + Shift + K' });
    store.saveSession({
      activeTabId: 'tab-1',
      tabs: [{ id: 'tab-1', url: 'https://example.com/', title: 'Example', pinned: true, groupId: 'work', zoom: 1.1 }],
    });

    const reloaded = new JsonStore(store.filePath);
    reloaded.initSync();
    const snapshot = reloaded.snapshot();
    expect(snapshot.settings.searchEngine).toBe('my-search');
    expect(snapshot.settings.customSearchEngines[0].url).toContain('{query}');
    expect(snapshot.settings.globalHotkey).toBe('Control+Shift+K');
    expect(snapshot.extensions[0]).toMatchObject({ source: 'chrome-web-store-import', packageFormat: 'crx3' });
    expect(snapshot.sitePermissions['https://example.com'].camera).toBe('allow');
    expect(snapshot.tabGroups[0].name).toBe('Work');
    expect(snapshot.session.tabs[0]).toMatchObject({ id: 'tab-1', pinned: true, groupId: 'work' });
  });

  it('stores ad blocker settings and built-in extension removal state', () => {
    const store = createStore();
    store.setAdblockSettings({ enabled: false, filters: ['||ads.example.com^'] });
    store.setBuiltinExtensionState('adblock', { removed: true });
    const snapshot = new JsonStore(store.filePath);
    snapshot.initSync();
    expect(snapshot.snapshot().adblock).toMatchObject({ enabled: false, filters: ['||ads.example.com^'] });
    expect(snapshot.snapshot().builtinExtensions.adblock.removed).toBe(true);
  });

  it('imports bookmark HTML records without duplicating existing URLs', () => {
    const store = createStore();
    store.toggleBookmark({ url: 'https://example.com', title: 'Existing' });
    const result = store.addImportedBookmarks([
      { url: 'https://example.com/', title: 'Duplicate' },
      { url: 'https://openai.com/', title: 'OpenAI' },
      { url: 'javascript:alert(1)', title: 'Unsafe' },
    ]);
    expect(result.added).toBe(1);
    expect(store.snapshot().bookmarks).toHaveLength(2);
  });

  it('rejects malformed custom search templates', () => {
    const store = createStore();
    store.updateSettings({ customSearchEngines: [{ id: 'bad', name: 'Bad', url: 'https://search.example/?q={query' }] });
    expect(store.snapshot().settings.customSearchEngines).toHaveLength(0);
  });

  it('falls back when a selected custom search engine is removed', () => {
    const store = createStore();
    store.updateSettings({ customSearchEngines: [{ id: 'temporary', name: 'Temporary', url: 'https://search.example/?q={query}' }], searchEngine: 'temporary' });
    store.updateSettings({ customSearchEngines: [] });
    expect(store.snapshot().settings.searchEngine).toBe('duckduckgo');
  });
});
