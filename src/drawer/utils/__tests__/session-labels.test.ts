import { describe, it, expect } from '@jest/globals';
import type { SessionMeta } from '../../../core/types';
import { resolveStrings } from '../../../i18n';
import {
  sessionDuration,
  sessionEventCount,
  sessionStartLabel,
} from '../session-labels';

const strings = resolveStrings('en');

// Local-time components so expectations hold in any timezone (the formatters
// read local getters).
const at = (
  year: number,
  month: number,
  day: number,
  hours: number,
  minutes: number
): number => new Date(year, month - 1, day, hours, minutes, 0).getTime();

const MINUTE = 60_000;

const meta = (overrides: Partial<SessionMeta>): SessionMeta => ({
  id: 'session-1',
  startedAt: Date.now(),
  status: 'closed',
  ...overrides,
});

describe('sessionStartLabel', () => {
  it('states the wall-clock start as one comma-joined field', () => {
    expect(
      sessionStartLabel(meta({ startedAt: at(2026, 7, 28, 9, 5) }), 'en')
    ).toBe('Jul 28, 09:05');
  });

  it('stays absolute for a session that started minutes ago', () => {
    const startedAt = Date.now() - 24 * MINUTE;
    expect(sessionStartLabel(meta({ startedAt }), 'en')).not.toContain('ago');
  });
});

describe('sessionDuration', () => {
  const startedAt = at(2026, 7, 30, 14, 0);

  it('spans start to end when the session closed cleanly', () => {
    expect(
      sessionDuration(meta({ startedAt, endedAt: startedAt + 12 * MINUTE }))
    ).toBe('12m');
  });

  it('falls back to the last captured event when there is no end', () => {
    expect(
      sessionDuration(
        meta({
          startedAt,
          lastEventAt: startedAt + 45 * MINUTE,
          status: 'crashed',
        })
      )
    ).toBe('45m');
  });

  it('is unknown when the session never flushed an event', () => {
    expect(sessionDuration(meta({ startedAt, status: 'crashed' }))).toBeNull();
  });
});

describe('sessionEventCount', () => {
  it('singularizes a lone event', () => {
    expect(sessionEventCount(meta({ eventCount: 1 }), strings)).toBe('1 event');
  });

  it('compacts a large count', () => {
    expect(sessionEventCount(meta({ eventCount: 1240 }), strings)).toBe(
      '1.2k events'
    );
  });

  it('is unknown when the count was never recorded', () => {
    expect(sessionEventCount(meta({}), strings)).toBeNull();
  });
});
