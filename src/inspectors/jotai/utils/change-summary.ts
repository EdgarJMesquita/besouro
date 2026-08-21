/** One-line summary of a value change, for an atom's timeline. */

import type { JotaiEvent } from '../../../core/types';

/**
 * What moved — the changed keys — falling back to the value when there are none.
 *
 * The two rows in this inspector answer different questions, so they show
 * different things:
 *
 * - The **atom list** row answers "what does this atom hold?", across atoms that
 *   have nothing to do with each other. The preview is the only useful answer.
 * - A **history** row answers "what did this change do?", within one atom whose
 *   whole current value is already on screen in the pane above. Successive
 *   previews of a growing object are nearly identical — a column of
 *   `{"items":["SKU-1"],"total":10}`, `{"items":["SKU-1","SKU-2"],"total":20}` —
 *   so the value is exactly the thing that cannot distinguish one row from the
 *   next. The keys can.
 *
 * The fallback is what makes this work for atoms Zustand never produces: `atom(0)`
 * has no keys, so a keys-only row would be blank, and there the value *is* the
 * change.
 */
export function changeSummary(event: JotaiEvent): string {
  if (event.isInitial) {
    // The starting value, and no keys: the only place in the timeline where the
    // value an atom began with appears. That it *is* the start is the badge's job
    // (`shared/components/BaselinePill`) — naming it here left this column reading
    // `Initial state · 0` in a list of bare `0`, `1`, `2`.
    return event.preview;
  }
  return event.changedKeys.length > 0
    ? event.changedKeys.join(', ')
    : event.preview;
}
