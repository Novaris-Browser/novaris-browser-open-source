// The greeting on the new tab page.
//
// Kept as a pure function because "good evening" versus "good night" is the kind
// of thing that gets changed at 2am and should be checkable without a browser.

const DAY_START = 5;   // 05:00
const MORNING_END = 12; // 12:00
const AFTERNOON_END = 18; // 18:00
const EVENING_END = 22; // 22:00

/**
 * The four parts of a day, by the hour. A browser is used at all hours, so
 * "good evening" alone would be wrong for most of the evening, and saying
 * "good night" at 21:00 is just as wrong.
 */
function greetingForHour(hour) {
  const h = Number(hour);
  if (!Number.isFinite(h)) return 'Good evening';
  if (h < DAY_START || h >= EVENING_END) return 'Good night';
  if (h < MORNING_END) return 'Good morning';
  if (h < AFTERNOON_END) return 'Good afternoon';
  return 'Good evening';
}

/**
 * A greeting addressed to the person, or to nobody. "Good morning," with nothing
 * after it looks broken, so the comma is only there when there is a name.
 */
function greetingFor({ hour, name, now } = {}) {
  const part = greetingForHour(hour ?? (now instanceof Date ? now.getHours() : new Date().getHours()));
  const clean = typeof name === 'string' ? name.replace(/\s+/g, ' ').trim().slice(0, 40) : '';
  if (!clean) return part;
  return `${part}, ${clean}`;
}

module.exports = {
  AFTERNOON_END,
  DAY_START,
  EVENING_END,
  MORNING_END,
  greetingFor,
  greetingForHour,
};
