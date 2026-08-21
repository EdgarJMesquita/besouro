/**
 * The user's tab order — which inspector sits where in the drawer's strip.
 *
 * {@link INSPECTOR_ORDER} is the default, not the law: the user can long-press a
 * tab and drag it (see `drawer/hooks/tab-strip.ts`), and the result is persisted
 * with the other drawer preferences in `settings-store.ts`. The saved value is
 * only ever a *hint* — this module is what turns it back into a strip, dropping
 * anything that no longer applies, so a file written by another version of the
 * library can never produce a duplicated, ghost, or missing tab.
 *
 * The strip's first entry is also the tab the drawer opens on (see
 * `InspectorTabs`), so reordering picks that too.
 */

import { useMemo } from 'react';
import { INSPECTOR_ORDER, type Inspector } from './types';
import { updateSettings, useSettings } from './settings-store';

/**
 * Apply a saved order to the inspectors that are actually running.
 *
 * Saved entries lead — filtered to `enabled`, de-duplicated, unknown ids dropped —
 * then everything else in {@link INSPECTOR_ORDER}. So `null` reproduces the
 * default strip exactly, and an inspector the user never moved (because it was
 * switched off, or because the library gained it in a later version) appends
 * instead of appearing mid-strip.
 *
 * `saved` is typed loosely because it comes off disk: a hand-edited or
 * older-format settings file lands here as anything at all.
 */
export function orderInspectors(
  enabled: readonly Inspector[],
  saved: unknown
): Inspector[] {
  const remaining = new Set(enabled);
  const ordered: Inspector[] = [];

  if (Array.isArray(saved)) {
    for (const entry of saved) {
      // `remaining` doubles as the seen-set: deleting on first use is what makes
      // a duplicated entry a no-op the second time.
      if (remaining.delete(entry as Inspector)) {
        ordered.push(entry as Inspector);
      }
    }
  }

  for (const inspector of INSPECTOR_ORDER) {
    if (remaining.delete(inspector)) {
      ordered.push(inspector);
    }
  }

  return ordered;
}

/**
 * The list with `from` lifted out and re-inserted at `to`.
 *
 * Returns the list unchanged (a copy) when either index is out of range or the
 * move is a no-op, so a drop that resolves to nowhere doesn't need a caller-side
 * guard.
 */
export function moveInspector(
  list: readonly Inspector[],
  from: number,
  to: number
): Inspector[] {
  const next = [...list];
  if (
    from === to ||
    from < 0 ||
    to < 0 ||
    from >= next.length ||
    to >= next.length
  ) {
    return next;
  }
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  return next;
}

/** The enabled inspectors in the user's order, recomputed when either changes. */
export function useTabOrder(enabled: readonly Inspector[]): Inspector[] {
  const { tabOrder } = useSettings();
  return useMemo(() => orderInspectors(enabled, tabOrder), [enabled, tabOrder]);
}

/** Remember a new tab order (persisted). */
export function setTabOrder(order: readonly Inspector[]): void {
  updateSettings({ tabOrder: [...order] });
}

/** Forget the user's order, restoring {@link INSPECTOR_ORDER}. */
export function resetTabOrder(): void {
  updateSettings({ tabOrder: null });
}
