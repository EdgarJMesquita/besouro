/**
 * Safe-area insets for the drawer, sourced from the native module.
 *
 * The drawer is rendered inside a native-injected ReactSurface that lives outside
 * the host app's React tree (see drawer/BesouroRoot), so there is no
 * `SafeAreaProvider` above it to read insets from. Instead the native module
 * reports the window's insets (status bar / notch, home indicator, nav bar,
 * display cutout) and we cache them here — a module-level store that outlives the
 * surface, so the value is ready the next time the drawer opens.
 *
 * The read is async (a main-thread hop natively), but insets are fetched eagerly
 * at install time and re-fetched whenever the drawer subscribes, so by the time
 * the drawer mounts the cached value is already correct — no layout jump.
 */

import { useSyncExternalStore } from 'react';
import NativeBesouro from '../../native/NativeBesouro';

export interface SafeAreaInsets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

const ZERO: SafeAreaInsets = { top: 0, bottom: 0, left: 0, right: 0 };

/**
 * Floor for the top inset (dp). The drawer is hosted in a surface attached to the
 * Android DecorView, which sits behind the status bar; some non-edge-to-edge
 * setups report a 0 top inset there, which would leave the header tucked under
 * the status bar. 24dp is the standard Android status-bar height and is below a
 * typical iOS notch inset, so it clears the bar without over-padding devices
 * that report a real (larger) value.
 */
const MIN_TOP_INSET = 24;

let insets: SafeAreaInsets = ZERO;
const listeners = new Set<() => void>();

export function getSafeAreaInsetsSnapshot(): SafeAreaInsets {
  return insets;
}

/**
 * Ask the native module for the current insets and update the cache. Safe to
 * call repeatedly (e.g. on every drawer open) so rotation changes are picked up.
 * No-ops silently when the native module isn't linked.
 */
export function refreshSafeAreaInsets(): void {
  if (!NativeBesouro) return;
  NativeBesouro.getSafeAreaInsets()
    .then((next) => {
      // Validate the resolved value (a Promise result, not method presence).
      if (!next || typeof next.top !== 'number') return;
      // Skip the notify when nothing changed to avoid needless re-renders.
      if (
        next.top === insets.top &&
        next.bottom === insets.bottom &&
        next.left === insets.left &&
        next.right === insets.right
      ) {
        return;
      }
      insets = {
        top: next.top,
        bottom: next.bottom,
        left: next.left,
        right: next.right,
      };
      for (const listener of listeners) {
        listener();
      }
    })
    .catch(() => {
      // Native read failed — keep the last known (or zero) insets.
    });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // Re-read on subscribe so each drawer open reflects the current insets
  // (handles rotation between opens).
  refreshSafeAreaInsets();
  return () => {
    listeners.delete(listener);
  };
}

/** Current safe-area insets (points/dp), kept in sync with the native window. */
export function useSafeAreaInsets(): SafeAreaInsets {
  return useSyncExternalStore(subscribe, getSafeAreaInsetsSnapshot);
}

/**
 * The top inset, floored like {@link useTopInset}, read imperatively — for code
 * that clamps geometry outside of render (the floating panel's drag bounds),
 * where a hook is not available and a stale value would let the panel park
 * itself under the status bar.
 */
export function getTopInsetSnapshot(): number {
  return Math.max(insets.top, MIN_TOP_INSET);
}

/**
 * The top inset, floored at {@link MIN_TOP_INSET} so the header always clears
 * the status bar even when the platform reports 0 (see the constant's note).
 */
export function useTopInset(): number {
  return Math.max(
    useSyncExternalStore(subscribe, getSafeAreaInsetsSnapshot).top,
    MIN_TOP_INSET
  );
}

/**
 * The bottom inset only. Add it to a scrollable's `contentContainerStyle`
 * paddingBottom so the last row can scroll clear of the home indicator / nav
 * bar while the list itself still fills to the screen edge — a natural end of
 * scroll, rather than a hard cutoff above the inset.
 */
export function useBottomInset(): number {
  return useSyncExternalStore(subscribe, getSafeAreaInsetsSnapshot).bottom;
}

/**
 * Blank space (dp) left below the last row of a scrollable list, on top of the
 * safe-area inset. The inset alone only clears the home indicator / nav bar, so
 * a full list stops with its last row still hard against the screen edge and
 * reads as "there is more, it just won't scroll". A slab of empty space is the
 * unambiguous signal that the list has ended — roughly one row's worth, enough
 * to be obviously deliberate without stranding the content mid-screen.
 */
const LIST_END_SPACE = 48;

/**
 * Bottom padding for a scrollable's `contentContainerStyle`: the safe-area
 * inset plus {@link LIST_END_SPACE}. Use this for list surfaces (the tab-level
 * FlatLists); use {@link useBottomInset} directly when the scrollable already
 * ends in something visually terminal.
 */
export function useListBottomPadding(): number {
  return (
    useSyncExternalStore(subscribe, getSafeAreaInsetsSnapshot).bottom +
    LIST_END_SPACE
  );
}
