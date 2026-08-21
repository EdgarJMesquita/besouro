/**
 * The store list, built from the session's own rows — one source, live session and
 * past session alike.
 *
 * This is what the database-as-source-of-truth decision buys. There used to be two
 * builders here, one reading the registry and one reading rows, because the registry
 * held the state a live tab rendered. It no longer does: every `zustand` row carries
 * the whole serialized state, so the newest row per store *is* the current state, and
 * the same query answers "what does this store hold" whether the session is running
 * or a month old.
 *
 * The `attached` list is a fallback, not a second source. A store gets a row the
 * moment it attaches — `attachZustand` records `getState()` — so it normally appears
 * from the rows alone.
 *
 * **Ordered by attachment, not by activity.** The stores are declared once in the
 * config, so the order the consumer wrote them in is fixed and known; sorting by
 * last change would move a row every time some *other* store changed. See
 * `shared/utils/attach-order`.
 */

import type { EventGroup } from '../../../core/database/types';
import type { ZustandEvent } from '../../../core/types';
import type { ZustandStoreInfo } from '../store/stores';
import type { ZustandStoreListItem } from '../types-ui';
import { byAttachOrder } from '../../../shared/utils/attach-order';

/**
 * @param groups Per-store aggregates for the open session.
 * @param attached What the inspector subscribed to *this* launch — empty when a past
 *   session is open, since those stores describe a different run. Used only to list
 *   a store that has no rows yet; it contributes no data beyond its name.
 */
export function storeList(
  groups: EventGroup[],
  attached: readonly ZustandStoreInfo[] = []
): ZustandStoreListItem[] {
  const items = groups.map((group) => {
    const newest = group.newest as ZustandEvent | null;
    return {
      storeId: group.key,
      // The group key is the store id — a usable last resort if a row somehow
      // arrived without its name.
      storeName: newest?.storeName ?? group.key,
      // The group's rows minus its baselines: a store sitting at the state it was
      // subscribed with has not changed, and a list saying "1 change" over it is
      // counting the row that recorded *no* change. Excluded in SQL — see
      // `EventGroupQuery.countWhere` for why the caller cannot just subtract one.
      changeCount: group.changeCount,
      updatedAt: group.lastAt,
    };
  });

  // An attached store should never be invisible. It normally has its initial row
  // already, but that capture runs inside `safeCapture` and a throw there is silent
  // — rows-only would then hide the store entirely rather than show it as empty.
  const listed = new Set(items.map((item) => item.storeId));
  for (const info of attached) {
    if (!listed.has(info.storeId)) {
      items.push({
        storeId: info.storeId,
        storeName: info.storeName,
        changeCount: 0,
        // Not 0: the list renders this as a time, and the epoch reads as 1969.
        updatedAt: info.registeredAt,
      });
    }
  }
  return items.sort(
    byAttachOrder(
      (item) => item.storeId,
      (item) => item.storeName
    )
  );
}
