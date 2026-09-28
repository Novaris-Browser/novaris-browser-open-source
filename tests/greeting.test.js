import { describe, expect, it } from 'vitest';
import { greetingFor, greetingForHour } from '../electron/greeting.js';

describe('greeting by hour', () => {
  it('covers every hour of the day without a gap or an overlap', () => {
    // One hour label per hour, and it has to be a real word every time, because
    // anything else shows up as an empty or nonsensical line on the new tab.
    const seen = new Set();
    for (let hour = 0; hour < 24; hour += 1) {
      const label = greetingForHour(hour);
      expect(typeof label).toBe('string');
      expect(label).toMatch(/^Good (morning|afternoon|evening|night)$/);
      seen.add(label);
    }
    expect(seen.size).toBe(4);
  });

  it('says night in the small hours and the late evening', () => {
    for (const hour of [0, 1, 2, 3, 4, 22, 23]) {
      expect(greetingForHour(hour)).toBe('Good night');
    }
  });

  it('says morning from five until noon', () => {
    for (const hour of [5, 6, 9, 11]) expect(greetingForHour(hour)).toBe('Good morning');
  });

  it('says afternoon from noon until six', () => {
    for (const hour of [12, 13, 15, 17]) expect(greetingForHour(hour)).toBe('Good afternoon');
  });

  it('says evening from six until ten', () => {
    for (const hour of [18, 19, 20, 21]) expect(greetingForHour(hour)).toBe('Good evening');
  });

  it('falls back rather than showing nothing on a bad hour', () => {
    for (const hour of [Number.NaN, undefined, null, 'noon', -1, 99]) {
      expect(greetingForHour(hour)).toMatch(/^Good /);
    }
  });
});

describe('greeting with a name', () => {
  it('addresses the person by name', () => {
    expect(greetingFor({ hour: 9, name: 'Alex' })).toBe('Good morning, Alex');
    expect(greetingFor({ hour: 14, name: 'Alex' })).toBe('Good afternoon, Alex');
    expect(greetingFor({ hour: 19, name: 'Alex' })).toBe('Good evening, Alex');
    expect(greetingFor({ hour: 23, name: 'Alex' })).toBe('Good night, Alex');
  });

  // "Good morning," with nothing after it reads as a bug rather than as minimal.
  it('leaves out the comma when there is no name', () => {
    for (const name of ['', '   ', null, undefined, 0]) {
      const text = greetingFor({ hour: 9, name });
      expect(text).toBe('Good morning');
      expect(text).not.toContain(',');
    }
  });

  it('tidies a name without inventing anything', () => {
    expect(greetingFor({ hour: 9, name: '  Alex   Smith  ' })).toBe('Good morning, Alex Smith');
  });

  it('truncates a name that would push the clock off the page', () => {
    const long = 'x'.repeat(200);
    const text = greetingFor({ hour: 9, name: long });
    expect(text.length).toBeLessThan('Good morning, '.length + 41);
  });

  it('reads the hour from a date when one is given', () => {
    expect(greetingFor({ now: new Date(2026, 0, 1, 9) })).toBe('Good morning');
    expect(greetingFor({ now: new Date(2026, 0, 1, 23) })).toBe('Good night');
  });
});
