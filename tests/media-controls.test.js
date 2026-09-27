import { describe, expect, it } from 'vitest';
import { clampSeek, formatTime, isAllowedMediaAction, mediaControlState } from '../electron/media-controls.js';

describe('Novaris media controls', () => {
  it('only accepts commands from a fixed list', () => {
    for (const action of ['play', 'pause', 'toggle', 'seek', 'forward', 'back', 'mute', 'volume', 'pip']) {
      expect(isAllowedMediaAction(action)).toBe(true);
    }
    // A page must not be able to turn this bridge into a script runner.
    for (const action of ['eval', 'fetch', 'require', '__proto__', 'constructor', '', null, undefined, 42]) {
      expect(isAllowedMediaAction(action)).toBe(false);
    }
  });

  it('refuses a seek outside the media duration', () => {
    expect(clampSeek(30, 120)).toBe(30);
    expect(clampSeek(500, 120)).toBe(120);
    expect(clampSeek(-5, 120)).toBeNull();
    expect(clampSeek('nonsense', 120)).toBeNull();
    // An unknown duration cannot be used to clamp, so the value stands.
    expect(clampSeek(999, 0)).toBe(999);
  });

  it('formats times the way a media control should', () => {
    expect(formatTime(0)).toBe('0:00');
    expect(formatTime(65)).toBe('1:05');
    expect(formatTime(600)).toBe('10:00');
    expect(formatTime(3725)).toBe('1:02:05');
    expect(formatTime(-10)).toBe('0:00');
    expect(formatTime('junk')).toBe('0:00');
  });

  it('reports nothing to show when a page has no media', () => {
    expect(mediaControlState(null).available).toBe(false);
  });

  it('shows a position control only when a duration is known', () => {
    expect(mediaControlState({ duration: 0, volume: 1 }).showPosition).toBe(false);
    expect(mediaControlState({ duration: 120, volume: 1 }).showPosition).toBe(true);
  });

  it('falls back to the host when a page gives no title', () => {
    expect(mediaControlState({ title: '', source: 'example.test' }).label).toBe('example.test');
    expect(mediaControlState({ title: 'A Song', source: 'x.test' }).label).toBe('A Song');
  });
});
