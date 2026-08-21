/** The notification title shown in a list row, falling back when none was sent. */

import type { NotificationEvent } from '../../../core/types';

import type { StringTable } from '../../../i18n';

/**
 * List-row title. Real notifications carry a `title`; events that don't
 * (e.g. `token-refresh`, which is a device push-token rotation, not a message)
 * get a phase-derived label instead of a bare em dash.
 */
export function displayTitle(
  event: NotificationEvent,
  strings: StringTable
): string {
  if (event.title) {
    return event.title;
  }
  if (event.phase === 'token-refresh') {
    return strings.tokenRefreshed;
  }
  return '—';
}
