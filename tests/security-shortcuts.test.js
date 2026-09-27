import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ BrowserWindow: {}, Menu: {}, app: {}, clipboard: {}, shell: {} }));

const { shortcutFor } = await import('../electron/security.js');

describe('Novaris shortcut normalization', () => {
  it('maps Windows raw key events for core shortcuts', () => {
    expect(shortcutFor({ type: 'rawKeyDown', key: 'T', code: 'KeyT', control: true })).toBe('new-tab');
    expect(shortcutFor({ type: 'keyDown', key: 't', control: true, shift: true })).toBe('reopen-tab');
    expect(shortcutFor({ type: 'rawKeyDown', key: 'W', control: true })).toBe('close-tab');
    expect(shortcutFor({ type: 'rawKeyDown', key: 'K', control: true, shift: true })).toBe('command-palette');
  });

  it('does not hijack unmodified or unsafe combinations', () => {
    expect(shortcutFor({ type: 'rawKeyDown', key: 't' })).toBeNull();
    expect(shortcutFor({ type: 'rawKeyDown', key: 't', control: true, alt: true })).toBeNull();
  });
});
