import { describe, it, expect } from '@jest/globals';
import {
  formatCompactCount,
  formatDateTime,
  formatSessionDuration,
  relativeAge,
} from '../date-format';

// Constructed from local-time components so the expectations hold regardless of
// the machine's timezone (the formatters read local getters).
const at = (
  year: number,
  month: number,
  day: number,
  hours: number,
  minutes: number,
  seconds: number
): number => new Date(year, month - 1, day, hours, minutes, seconds).getTime();

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

describe('formatDateTime', () => {
  it('renders the full local date and time', () => {
    expect(formatDateTime(at(2026, 7, 30, 22, 12, 20))).toBe(
      '2026-07-30 22:12:20'
    );
  });

  it('zero-pads single-digit components', () => {
    expect(formatDateTime(at(2026, 1, 5, 9, 3, 7))).toBe('2026-01-05 09:03:07');
  });
});

describe('relativeAge', () => {
  const now = at(2026, 7, 30, 14, 30, 0);

  it('reports sub-minute ages as just now', () => {
    expect(relativeAge(now - 30 * SECOND, now)).toEqual({ kind: 'justNow' });
  });

  it('reports minutes below the hour, rounded down', () => {
    expect(relativeAge(now - 5.9 * MINUTE, now)).toEqual({
      kind: 'minutes',
      value: 5,
    });
  });

  it('reports hours within the same day', () => {
    expect(relativeAge(now - 2 * HOUR, now)).toEqual({
      kind: 'hours',
      value: 2,
    });
  });

  it('prefers yesterday over an hour count across midnight', () => {
    // 20 minutes earlier in clock terms, but a different calendar day — "0h ago"
    // would be actively misleading here.
    const justBeforeMidnight = at(2026, 7, 29, 23, 50, 0);
    const justAfterMidnight = at(2026, 7, 30, 0, 10, 0);
    expect(relativeAge(justBeforeMidnight, justAfterMidnight)).toEqual({
      kind: 'yesterday',
    });
  });

  it('falls back to a date beyond yesterday', () => {
    const twoDaysAgo = at(2026, 7, 28, 22, 12, 20);
    expect(relativeAge(twoDaysAgo, now)).toEqual({
      kind: 'date',
      timestamp: twoDaysAgo,
    });
  });

  it('crosses a month boundary without claiming a same-day age', () => {
    const lastMonth = at(2026, 6, 30, 23, 0, 0);
    const firstOfMonth = at(2026, 7, 1, 1, 0, 0);
    expect(relativeAge(lastMonth, firstOfMonth)).toEqual({ kind: 'yesterday' });
  });
});

describe('formatSessionDuration', () => {
  it('uses seconds below a minute', () => {
    expect(formatSessionDuration(45 * SECOND)).toBe('45s');
  });

  it('uses whole minutes below an hour', () => {
    expect(formatSessionDuration(12 * MINUTE + 40 * SECOND)).toBe('12m');
  });

  it('splits hours and zero-padded minutes beyond an hour', () => {
    expect(formatSessionDuration(HOUR + 4 * MINUTE)).toBe('1h 04m');
  });

  it('does not report a negative duration from clock skew', () => {
    expect(formatSessionDuration(-5000)).toBe('0s');
  });
});

describe('formatCompactCount', () => {
  it('shows counts below a thousand exactly', () => {
    expect(formatCompactCount(340)).toBe('340');
    expect(formatCompactCount(999)).toBe('999');
  });

  it('abbreviates thousands to one decimal', () => {
    expect(formatCompactCount(1200)).toBe('1.2k');
  });

  it('trims a trailing zero decimal', () => {
    expect(formatCompactCount(2000)).toBe('2k');
  });

  it('drops the decimal past ten thousand', () => {
    expect(formatCompactCount(12400)).toBe('12k');
  });
});
