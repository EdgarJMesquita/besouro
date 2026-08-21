/** One-line summary of what a change touched, for the store timeline. */

import type { ZustandEvent } from '../../../core/types';

/**
 * One-line label for a change row: the keys this transition touched.
 *
 * A baseline row is not a special case here — its `changedKeys` are the store's
 * top-level keys, which is what "everything changed" means for the row that starts
 * the timeline. That it is a baseline is the badge's job
 * (`shared/components/BaselinePill`), so this column says the same kind of thing on
 * every row instead of substituting the row's own name on one of them.
 */
export function changeSummary(event: ZustandEvent): string {
  return event.changedKeys.length > 0 ? event.changedKeys.join(', ') : '—';
}
