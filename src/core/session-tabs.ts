/**
 * Which inspectors a past session's panel offers.
 *
 * Not the same question as "what is enabled now". A session records the set that
 * was running while it captured (`SessionMeta.inspectors`), and that set can
 * differ from the current one by the time anyone opens it — the config changed,
 * the app relaunched. Deriving the strip from the live set alone would
 * make rows that are still on disk, and still counted in the panel's event total,
 * unreachable.
 *
 * So the strip is the union, and this is where that rule lives. Ordering it is
 * `tab-order.ts`'s job; dropping the browser-class tabs is `recordingInspectors`'.
 */

import { INSPECTOR_ORDER, type Inspector } from './types';

/**
 * The inspectors a session's tabs should cover: everything enabled now, plus
 * everything that was recording when the session ran.
 *
 * The union rather than `recorded` alone: an inspector that is enabled now but
 * captured nothing back then keeps its (empty) tab, and that emptiness is often
 * the finding — a session that died four seconds in *should* show a silent
 * Network tab. Only a tab that is both switched off now and has nothing recorded
 * disappears, and there is nothing to say about that one.
 *
 * `recorded` is filtered to real inspector ids and de-duplicated here rather than
 * at the point it was read off disk: it can name an inspector this version of the
 * library has never heard of, and a strip is the last place that should surface.
 */
export function sessionTabs(
  enabled: readonly Inspector[],
  recorded: readonly Inspector[] | undefined
): Inspector[] {
  if (!recorded || recorded.length === 0) {
    return [...enabled];
  }

  const tabs = [...enabled];
  for (const inspector of recorded) {
    if (INSPECTOR_ORDER.includes(inspector) && !tabs.includes(inspector)) {
      tabs.push(inspector);
    }
  }
  return tabs;
}
