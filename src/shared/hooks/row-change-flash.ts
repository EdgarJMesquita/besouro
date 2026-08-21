/**
 * The change flash for a pane that renders the newest recorded row.
 *
 * Redux drives its flash from a live registry, because a Redux row carries only
 * the slices one action touched and the current tree exists nowhere else
 * (`inspectors/redux/store/snapshot.ts`). Zustand and Jotai have no registry and
 * need none: every row carries the whole state, so the newest row *is* the current
 * value — and the same row already names what moved, in `changedKeys`. This turns
 * that column into a {@link JsonFlash} the viewer can tint.
 *
 * The granularity differs from Redux's on purpose. Redux diffs two trees at
 * capture time and reports the shallowest differing path, so it can flash
 * `cart.items[2].qty`. `changedKeys` is top-level only, which is as deep as these
 * two interceptors record — so the flash points at the key that moved and, through
 * `flashedLineIds`, takes its subtree with it. Naming the exact leaf would mean
 * diffing against the previous row, whose state is a heavy column this pane never
 * loads.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { JsonFlash } from '../components/JsonViewer';

/** The columns this needs from a row — Zustand's and Jotai's both satisfy it. */
export interface FlashableRow {
  id: string;
  isInitial: boolean;
  changedKeys: string[];
}

/**
 * The newest row id each pane has already flashed, keyed by store/atom id.
 *
 * Module-level because the flash has to outlive the pane that plays it — the same
 * reason Redux keeps a played-revision high-water mark. Leaving the detail for the
 * list and coming back remounts the pane, and a pane that remembered this in a ref
 * would replay the last change on every visit. A flash points at a change the
 * reader just watched happen; replaying it points at nothing.
 *
 * Never cleared. Row ids are unique per row, so a stale entry from an earlier
 * session cannot match a new session's newest row and suppress its flash.
 */
const playedRows = new Map<string, string>();

export function useRowChangeFlash({
  scope,
  row,
  archived,
  rootWhenNoKeys = false,
}: {
  /** Identity of the pane — the store or atom whose rows these are. */
  scope: string;
  /** The newest recorded row, or undefined before the first one exists. */
  row: FlashableRow | undefined;
  /** A past session: nothing is changing behind this, so nothing should flash. */
  archived: boolean;
  /**
   * Flash the whole document when the row names no keys. For Jotai, where a
   * primitive atom (`atom(0)`) reports none and the value *is* what changed —
   * Zustand state is always an object, so an empty list there means nothing
   * nameable moved and the pane stays quiet.
   */
  rootWhenNoKeys?: boolean;
}): JsonFlash | undefined {
  // Read once, at mount: everything recorded before this pane opened has had
  // whatever flash it was going to get.
  const playedBeforeMount = useRef(playedRows.get(scope)).current;

  const paths = useMemo((): ReadonlySet<string> | null => {
    // A baseline is not a change — it is where the timeline starts, and its
    // `changedKeys` are every key the store has. Flashing the whole document the
    // first time a pane opens is noise, and the badge on the row already says it.
    if (!row || archived || row.isInitial) {
      return null;
    }
    if (row.changedKeys.length > 0) {
      return new Set(row.changedKeys);
    }
    // The root path, which `flashedLineIds` expands to the whole document.
    return rootWhenNoKeys ? new Set(['']) : null;
  }, [row, archived, rootWhenNoKeys]);

  // The nonce has to move on every flash, because two consecutive rows can name
  // the identical keys and an unchanged `JsonFlash` would tint only once. Held as
  // state and adjusted during render (rather than in an effect) so the viewer sees
  // the flash on the same render that brought the row in.
  const [flashed, setFlashed] = useState<{ id: string; nonce: number } | null>(
    null
  );
  if (paths && row && row.id !== playedBeforeMount && flashed?.id !== row.id) {
    setFlashed({ id: row.id, nonce: (flashed?.nonce ?? 0) + 1 });
  }

  // After the render that played it, so the next mount starts from here. Skipped
  // for a past session, which plays nothing and must not mark a live pane's rows
  // as already seen.
  useEffect(() => {
    if (row && !archived) {
      playedRows.set(scope, row.id);
    }
  }, [scope, row, archived]);

  if (!paths || !row || flashed?.id !== row.id) {
    return undefined;
  }
  return { paths, nonce: flashed.nonce };
}
