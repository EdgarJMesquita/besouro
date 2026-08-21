/**
 * The instance list, built from the session's own rows — one source, live session
 * and past session alike, in the order the app declared its instances.
 *
 * This is what the database-as-source-of-truth decision buys. The Zustand and Jotai
 * tabs need two builders, because a store that has never changed has no rows and can
 * only be found in the live registry, which a past session must never be described
 * by. An MMKV instance always has at least one row: attach writes its snapshot
 * (see `interceptor.ts`), so an instance that is only ever *read* still appears —
 * and appears the same way weeks later.
 *
 * **Ordered by attachment, not by activity**, along with the Zustand and Jotai lists
 * — see `shared/utils/attach-order`, which this list's requirements shaped and now
 * serves all three.
 */

import type { EventGroup } from '../../../core/database/types';
import type { MMKVEvent } from '../../../core/types';
import type { MMKVInstanceInfo } from '../store/instances';
import type { MMKVInstanceListItem } from '../types-ui';
import { byAttachOrder } from '../../../shared/utils/attach-order';

/**
 * @param groups  Per-instance aggregates for the open session.
 * @param attached What the inspector attached to *this* launch — empty when a past
 *   session is open, since those instances describe a different run. Used only to
 *   list an attached instance that has no rows yet; it contributes no data beyond
 *   its name.
 */
export function instanceList(
  groups: EventGroup[],
  attached: readonly MMKVInstanceInfo[] = []
): MMKVInstanceListItem[] {
  const items = groups.map((group) => {
    const newest = group.newest as MMKVEvent | null;
    return {
      instanceId: group.key,
      // The group key is the instance id — a usable last resort if a row somehow
      // arrived without its name.
      instanceName: newest?.instanceName ?? group.key,
      // The instance's operations, snapshot row excluded — the tab asks SQL for that
      // count directly (`EventGroupQuery.countWhere`), which is also what keeps a
      // cleared instance reading "0 changes" rather than counting the contents row
      // that survives the clear.
      changeCount: group.changeCount,
      updatedAt: group.lastAt,
    };
  });

  // An attached instance should never be invisible. It normally has a row the
  // moment it attaches — the snapshot — but a sweep that fails does so inside
  // `safeCapture`, silently, and rows-only would then hide the instance entirely
  // rather than show it as empty. Listing it from the attachment costs one entry
  // and turns a disappearance into a visibly empty tab.
  const listed = new Set(items.map((item) => item.instanceId));
  for (const info of attached) {
    if (!listed.has(info.instanceId)) {
      items.push({
        instanceId: info.instanceId,
        instanceName: info.instanceName,
        changeCount: 0,
        // Not 0: the row renders this as a time, and the epoch reads as 1970.
        updatedAt: info.registeredAt,
      });
    }
  }
  return items.sort(
    byAttachOrder(
      (item) => item.instanceId,
      (item) => item.instanceName
    )
  );
}
