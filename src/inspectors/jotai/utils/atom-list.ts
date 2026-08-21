/**
 * The atom list, built from the session's own rows — one source, live session and
 * past session alike.
 *
 * There used to be two builders here, one reading the registry and one reading rows,
 * because the registry held the value a live tab rendered. It no longer does: every
 * `jotai` row carries the whole serialized value *and* its one-line preview, so the
 * newest row per atom is the atom's current value, and the same query answers "what
 * does this atom hold" whether the session is running or a month old.
 *
 * The `attached` list is a fallback, not a second source — see `storeList`, which
 * this mirrors.
 *
 * **Ordered by subscription, not by activity.** The atoms are declared once in the
 * config, so the order the consumer wrote them in is fixed and known; sorting by
 * last change would move a row every time some *other* atom changed. See
 * `shared/utils/attach-order`.
 */

import type { EventGroup } from '../../../core/database/types';
import type { JotaiEvent } from '../../../core/types';
import type { JotaiAtomInfo } from '../store/atoms';
import type { JotaiAtomListItem } from '../types-ui';
import { byAttachOrder } from '../../../shared/utils/attach-order';

/**
 * @param groups Per-atom aggregates for the open session.
 * @param attached What the inspector subscribed to *this* launch — empty when a past
 *   session is open, since those atoms describe a different run. Used only to list an
 *   atom that has no rows yet; it contributes no data beyond its name.
 */
export function atomList(
  groups: EventGroup[],
  attached: readonly JotaiAtomInfo[] = []
): JotaiAtomListItem[] {
  const items = groups.map((group) => {
    const newest = group.newest as JotaiEvent | null;
    return {
      atomId: group.key,
      // The group key is the atom id — a usable last resort if a row somehow arrived
      // without its name.
      atomName: newest?.atomName ?? group.key,
      preview: newest?.preview ?? '',
      // The group's rows minus its baselines: an atom sitting at the value it was
      // subscribed with has not changed, and a list saying "1 change" over it is
      // counting the row that recorded *no* change. Excluded in SQL — see
      // `EventGroupQuery.countWhere` for why the caller cannot just subtract one.
      changeCount: group.changeCount,
      updatedAt: group.lastAt,
    };
  });

  // A watched atom should never be invisible. It normally has its initial row
  // already, but that capture runs inside `safeCapture` and a throw there is silent
  // — rows-only would then hide the atom entirely rather than show it as empty.
  const listed = new Set(items.map((item) => item.atomId));
  for (const info of attached) {
    if (!listed.has(info.atomId)) {
      items.push({
        atomId: info.atomId,
        atomName: info.atomName,
        preview: '',
        changeCount: 0,
        // Not 0: the list renders this as a time, and the epoch reads as 1969.
        updatedAt: info.registeredAt,
      });
    }
  }
  return items.sort(
    byAttachOrder(
      (item) => item.atomId,
      (item) => item.atomName
    )
  );
}
