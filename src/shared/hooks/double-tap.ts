/**
 * One tap does one thing, two do another — the pairing behind select vs. focus.
 *
 * Shared by the two surfaces that offer both, the exploded stack and the tree
 * list, so a view answers a double tap the same way wherever you find it.
 *
 * Each surface gets its **own** instance rather than one pairing lifted into the
 * tab. The index is the identity here, and the stack and the list use the same
 * indices deliberately — so a single shared pairing would let a tap on a box and
 * a tap on that view's row a moment later add up to a double tap, which is not
 * something anyone did on purpose.
 */

import { useCallback, useRef } from 'react';

/**
 * Longest gap between two taps on one thing that still reads as a double tap.
 *
 * Affordable only because a second tap no longer means anything else. Tapping a
 * selected view used to clear the selection, which made a double tap literally
 * "select, then deselect" — the second tap was spoken for before any double tap
 * could be recognised, and the ways out were to delay every selection waiting for
 * a partner or to hang focus on some other gesture. Moving deselect onto a tap on
 * empty space freed the second tap outright, so selection stays instant and the
 * pair costs nothing to detect.
 */
const DOUBLE_TAP_MS = 280;

/**
 * A tap handler that fires `onSingle` immediately and `onDouble` on the second
 * tap of a pair.
 *
 * `onSingle` runs on the first tap of a pair too. That is the point rather than a
 * compromise: selecting is idempotent and instant, so the double tap upgrades a
 * selection you already have instead of being bought with a delay on every tap.
 */
export function useDoubleTap(
  onSingle: (index: number) => void,
  onDouble: (index: number) => void
): (index: number) => void {
  // The whole state. A second tap on a *different* index is simply that index's
  // first, which falls out of comparing both fields.
  const last = useRef({ index: -1, at: 0 });
  return useCallback(
    (index: number): void => {
      const now = Date.now();
      const paired =
        last.current.index === index && now - last.current.at < DOUBLE_TAP_MS;
      last.current = paired ? { index: -1, at: 0 } : { index, at: now };
      if (paired) onDouble(index);
      else onSingle(index);
    },
    [onDouble, onSingle]
  );
}
