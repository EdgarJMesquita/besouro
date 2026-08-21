/**
 * Order for the tabs that list a **fixed, declared set**: Zustand stores, Jotai
 * atoms, MMKV instances. Each is configured once —
 * `setZustandStores({ counter, cart })` — so the set does not grow while the app
 * runs, and the order the consumer wrote it in is one they already know.
 *
 * **Why not newest-activity-first**, which is what `useEventGroups` hands these
 * builders and what the socket tabs keep. A connection list is a feed: connections
 * arrive and close, there can be any number of them, and the one that just did
 * something is the one worth surfacing. A store list is an inventory. Sorting it by
 * activity means the row a reader is looking for slides somewhere else every time
 * some *other* store changes — and the fact that ordering was carrying, "this one
 * changed recently", is already on the row as a change count and a timestamp. So the
 * ordering carries nothing and costs the reader their place.
 *
 * MMKV reached this rule first and was *forced* to: its snapshot row is patched on
 * every sweep, so `lastAt` there orders by which instance the sweep loop happened to
 * reach last and comes back different on each mount. Zustand and Jotai have honest
 * timestamps — for them this is a choice, made because their lists are the same kind
 * of list.
 *
 * The order is read off the id (`zustand-1`, `jotai-2`, `mmkv-3`), which each
 * interceptor hands out from a counter as it walks the configured map. That is what
 * keeps an **archived** session ordered the way its own launch was: the ids are in
 * its rows, so a session read weeks later needs nothing from this launch's registry.
 */

/**
 * Compare two list items by the order their inspector attached to them, falling back
 * to name for anything that cannot be placed.
 */
export function byAttachOrder<Item>(
  idOf: (item: Item) => string,
  nameOf: (item: Item) => string
): (a: Item, b: Item) => number {
  return (a, b) => {
    const orderA = attachOrderOf(idOf(a));
    const orderB = attachOrderOf(idOf(b));
    if (orderA !== orderB) {
      return orderA - orderB;
    }
    return nameOf(a).localeCompare(nameOf(b));
  };
}

/**
 * The counter out of an interceptor-minted id.
 *
 * Compared numerically, so the tenth store does not sort between the first and the
 * second. An id whose tail is not a number is not one we minted — those sort last,
 * by name, rather than being allowed to shuffle.
 */
function attachOrderOf(id: string): number {
  const separator = id.lastIndexOf('-');
  const tail = separator === -1 ? '' : id.slice(separator + 1);
  // Tested for emptiness first: `Number('')` is 0, which would sort an id ending in
  // a bare `-` ahead of the genuine first store rather than last with the others we
  // cannot place.
  if (!tail) {
    return Number.MAX_SAFE_INTEGER;
  }
  const order = Number(tail);
  return Number.isFinite(order) ? order : Number.MAX_SAFE_INTEGER;
}
