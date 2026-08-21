/**
 * Local date/time formatting for captured entries. Pure and dependency-free —
 * kept out of the UI layer (which pulls in React Native) so it stays unit
 * testable, and imported directly by the tabs that render timestamps.
 * Same arrangement as `duration-format`.
 */

const pad2 = (value: number): string => String(value).padStart(2, '0');

/** Clock component only, `HH:MM:SS`. */
export function clockOf(date: Date): string {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

/** Date component only, `YYYY-MM-DD`. */
export function dateOf(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * Local time (`HH:MM:SS`) for entries captured today; for entries from any other
 * day the date is prepended (`YYYY-MM-DD HH:MM:SS`) so cross-day logs are
 * unambiguous at a glance.
 */
export function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const clock = clockOf(date);
  return isSameDay(date, new Date()) ? clock : `${dateOf(date)} ${clock}`;
}

/** Full local date + time, e.g. `2026-07-30 22:12:20`. */
export function formatDateTime(timestamp: number): string {
  const date = new Date(timestamp);
  return `${dateOf(date)} ${clockOf(date)}`;
}

/**
 * How long ago something happened, as a shape the UI turns into text. Returned
 * structured rather than formatted because the wording is localized and the word
 * order differs per language ("2h ago" / "há 2h"), which a string-returning
 * formatter here couldn't express.
 */
export type RelativeAge =
  | { kind: 'justNow' }
  | { kind: 'minutes'; value: number }
  | { kind: 'hours'; value: number }
  | { kind: 'yesterday' }
  | { kind: 'date'; timestamp: number };

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;

/**
 * Bucket a past timestamp for display: sub-minute reads as "just now", then
 * minutes, then hours — but only within the same calendar day, so an event at
 * 23:50 seen at 00:10 reads as "yesterday" rather than "0h ago". Older than that
 * falls back to a date.
 */
export function relativeAge(
  timestamp: number,
  now: number = Date.now()
): RelativeAge {
  const elapsed = now - timestamp;
  const then = new Date(timestamp);
  const today = new Date(now);

  if (isSameDay(then, today)) {
    if (elapsed < MINUTE_MS) {
      return { kind: 'justNow' };
    }
    if (elapsed < HOUR_MS) {
      return { kind: 'minutes', value: Math.floor(elapsed / MINUTE_MS) };
    }
    return { kind: 'hours', value: Math.floor(elapsed / HOUR_MS) };
  }

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (isSameDay(then, yesterday)) {
    return { kind: 'yesterday' };
  }
  return { kind: 'date', timestamp };
}

/**
 * Short month + day for an older entry, e.g. `Jul 28` (localized by `language`).
 * Falls back to a numeric `MM-DD` where `Intl` is unavailable or throws, which
 * keeps the same column width and needs no month-name translations.
 */
export function formatMonthDay(timestamp: number, language?: string): string {
  const date = new Date(timestamp);
  try {
    return new Intl.DateTimeFormat(language, {
      month: 'short',
      day: 'numeric',
    }).format(date);
  } catch {
    return dateOf(date).slice(5);
  }
}

/**
 * How long a session ran: `45s` under a minute, `12m` under an hour, `1h 04m`
 * beyond. Distinct from `formatDuration`, which is tuned for request latencies
 * and would render an hour-long session as `73.2min`.
 */
export function formatSessionDuration(durationMs: number): string {
  if (durationMs < MINUTE_MS) {
    return `${Math.max(0, Math.round(durationMs / 1000))}s`;
  }
  if (durationMs < HOUR_MS) {
    return `${Math.floor(durationMs / MINUTE_MS)}m`;
  }
  const hours = Math.floor(durationMs / HOUR_MS);
  const minutes = Math.floor((durationMs % HOUR_MS) / MINUTE_MS);
  return `${hours}h ${pad2(minutes)}m`;
}

/**
 * Compact magnitude for a count that shares a line with other metadata: exact
 * below 1000, then `1.2k` / `12k`. The point is a stable width while scanning,
 * not precision — the exact figure is in the session itself.
 */
export function formatCompactCount(count: number): string {
  if (count < 1000) {
    return String(count);
  }
  const thousands = count / 1000;
  return thousands < 10
    ? `${Number(thousands.toFixed(1))}k`
    : `${Math.round(thousands)}k`;
}
