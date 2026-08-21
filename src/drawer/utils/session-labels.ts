/**
 * Wording for a session's identity, shared by the history list and the overlay
 * header so a session reads the same in both places — you pick "2h ago · 14:32"
 * off the list and the header you land on says the same thing.
 *
 * Pure and RN-free: the formatting primitives live in `utils/date-format`; what
 * this adds is the localized wording and the "which timestamps does a session
 * actually have" decisions.
 */

import type { SessionMeta } from '../../core/types';
import {
  formatCompactCount,
  formatMonthDay,
  formatSessionDuration,
  type RelativeAge,
} from '../../shared/utils/date-format';
import type { LanguageCode, StringTable } from '../../i18n';

/**
 * Render a bucketed age with the active language's wording. `timeAgo` carries
 * the word order ("{0} ago" / "há {0}"), so the span is substituted rather than
 * concatenated.
 */
export function ageLabel(
  age: RelativeAge,
  strings: StringTable,
  language: LanguageCode
): string {
  switch (age.kind) {
    case 'justNow':
      return strings.justNow;
    case 'yesterday':
      return strings.yesterday;
    case 'minutes':
      return strings.timeAgo.replace('{0}', `${age.value}m`);
    case 'hours':
      return strings.timeAgo.replace('{0}', `${age.value}h`);
    case 'date':
      return formatMonthDay(age.timestamp, language);
  }
}

/** `HH:MM` — seconds are noise at this altitude. */
export function clockTime(timestamp: number): string {
  const date = new Date(timestamp);
  return `${String(date.getHours()).padStart(2, '0')}:${String(
    date.getMinutes()
  ).padStart(2, '0')}`;
}

/**
 * When a session started, absolute: "Jul 28, 14:32". Deliberately not the
 * relative age — that belongs to the list, where it's the row's name and there's
 * nothing to confuse it with. Beside a duration ("24m ago · 14:32 · 14m") the
 * two elapsed-time readings compete, so the header states a wall-clock start and
 * lets the duration be the only span on the line.
 *
 * The comma matters: joined with the `·` that separates the header's fields, the
 * date and time read as two peers of the duration and count rather than as the
 * single "when" they are.
 */
export function sessionStartLabel(
  meta: SessionMeta,
  language: LanguageCode
): string {
  return `${formatMonthDay(meta.startedAt, language)}, ${clockTime(meta.startedAt)}`;
}

/**
 * How long a session ran, or `null` when that can't be known. A crashed session
 * never got to record `endedAt`, so its last captured event is the closest thing
 * to an end; with neither (never flushed) there's no span to show rather than an
 * invented one.
 */
export function sessionDuration(meta: SessionMeta): string | null {
  const endedAt = meta.endedAt ?? meta.lastEventAt;
  return endedAt == null
    ? null
    : formatSessionDuration(endedAt - meta.startedAt);
}

/**
 * How much a session captured ("1 event" / "1.2k events"), or `null` for a
 * session persisted before the count was recorded — unknown, not zero.
 */
export function sessionEventCount(
  meta: SessionMeta,
  strings: StringTable
): string | null {
  const { eventCount } = meta;
  return eventCount == null
    ? null
    : `${formatCompactCount(eventCount)} ${
        eventCount === 1 ? strings.event : strings.events
      }`;
}
