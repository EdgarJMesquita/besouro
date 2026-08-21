/**
 * The element inspector holds **one live element at a time** — the currently
 * inspected node, the way Chrome DevTools and RN's own inspector work — not a
 * history log. So it uses a session-only side store (like the notifications
 * device-token and zustand snapshot registries) rather than the persisted event
 * store.
 *
 * Crucially, this keeps the element's **fiber** and its renderer out of any
 * serialized event: they live in module state here, never on disk. That is what
 * makes live prop editing possible — `overrideInspectedProp` drives the same
 * `renderer.overrideProps` React DevTools uses — while staying serialization-safe.
 */

import { useSyncExternalStore } from 'react';
import type { InspectedElement, ElementRenderer } from '../types';

let current: InspectedElement | null = null;
// Live handles for editing — deliberately outside the serializable snapshot.
let currentFiber: unknown = null;
let currentRenderer: ElementRenderer | null = null;
/**
 * Every edit made to the current element — latest value per path, keyed by the
 * path itself, in the order the paths were first touched. Reset on every pick.
 *
 * Kept because a commit re-applies **all** of them, not just the one field that
 * changed (see `overrideInspectedProp`).
 */
const overrides = new Map<string, Override>();
const listeners = new Set<() => void>();

interface Override {
  path: Array<string | number>;
  value: unknown;
  /** Delete the key at `path` rather than set it — see `removeInspectedProp`. */
  remove?: boolean;
}

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

/**
 * Replace the currently inspected element (one at a time). `renderer` is null for
 * elements resolved without the dev renderer, which is what makes the element
 * read-only.
 */
export function setInspectedElement(
  element: InspectedElement,
  fiber: unknown,
  renderer: ElementRenderer | null
): void {
  current = element;
  currentFiber = fiber;
  currentRenderer = renderer;
  // A new element means a new fiber: edits made to the previous one must not be
  // replayed onto it.
  overrides.clear();
  emit();
}

export function getInspectedElement(): InspectedElement | null {
  return current;
}

/** Forget the inspected element (Clear button / inspector teardown). */
export function clearInspectedElement(): void {
  if (!current && !currentFiber) {
    return;
  }
  current = null;
  currentFiber = null;
  currentRenderer = null;
  overrides.clear();
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Subscribe a component to the currently inspected element. */
export function useInspectedElement(): InspectedElement | null {
  return useSyncExternalStore(subscribe, getInspectedElement);
}

/**
 * Live-edit a prop on the inspected element via the renderer's `overrideProps`
 * (the mechanism DevTools' prop editor uses), then mirror the new value into the
 * snapshot so the tab reflects it immediately. Returns false when there is no
 * element, no fiber, or the renderer can't override (e.g. production). Paths are
 * relative to the element's props (`['children']`, `['style', 'color']`).
 *
 * Every commit re-applies **all** edits made to this element, not just the field
 * that changed, because a single-path write loses the earlier ones. React derives
 * the new props as `copyWithSet(fiber.memoizedProps, path, value)` — off *that*
 * fiber's `memoizedProps`. Fibers are double-buffered: after the override renders,
 * the freshly-edited props live on the alternate, and the fiber we captured at
 * pick time is left holding the props from a commit ago. So the next single-path
 * write starts from a base that is missing the previous edit and silently reverts
 * it — edit `color`, then `fontSize`, and `color` snaps back.
 *
 * Merging locally sidesteps the stale base entirely: build the full props object
 * from every recorded override and write it in one call, so which buffer we hold
 * stops mattering. It also restores edits the app itself re-rendered away.
 */
export function overrideInspectedProp(
  path: Array<string | number>,
  value: unknown
): boolean {
  if (
    !current ||
    currentFiber == null ||
    !currentRenderer?.overrideProps ||
    path.length === 0
  ) {
    return false;
  }
  try {
    currentRenderer.overrideProps(
      currentFiber,
      WHOLE_PROPS,
      mergeOverrides([...overrides.values(), { path, value }])
    );
  } catch {
    // The write didn't land, so don't record it — a later commit would replay a
    // value the element never took.
    return false;
  }
  overrides.set(key(path), { path, value });
  current = { ...current, props: setAtPath(current.props, path, value) };
  emit();
  return true;
}

/**
 * The path that addresses the props object itself. React's `copyWithSet` walks the
 * path and returns the value once it runs out of keys, so an empty path replaces
 * the whole of `memoizedProps` rather than a field inside it — which is exactly
 * how a merged write is delivered in a single call.
 */
const WHOLE_PROPS: Array<string | number> = [];

/** Apply `edits` in order over the element's live props. */
function mergeOverrides(edits: Override[]): Record<string, unknown> {
  let props = liveProps();
  for (const edit of edits) {
    props = edit.remove
      ? deleteAtPath(props, edit.path)
      : setAtPath(props, edit.path, edit.value);
  }
  return props;
}

const key = (path: Array<string | number>): string => JSON.stringify(path);

/**
 * Remove a top-level prop, deleting the key outright rather than setting it to
 * `undefined` — so the element renders exactly as it would have had the prop never
 * been passed, including for code that tests `'prop' in props`.
 *
 * Any prop can go, not just ones added here: removing a prop the app set is a
 * legitimate experiment ("what does this look like without `numberOfLines`?"), and
 * it is as ephemeral as every other edit — the app's next render restores it.
 *
 * The removal is recorded as an override of its own, because every later commit
 * re-merges onto the fiber's live props (see `overrideInspectedProp`) and those
 * still carry the added key. Without a standing "delete this" entry, the next
 * unrelated edit would bring it straight back.
 *
 * Style entries do not come through here: they are removed by overriding `style`
 * with the flattened object minus the key.
 */
export function removeInspectedProp(path: Array<string | number>): boolean {
  if (
    !current ||
    currentFiber == null ||
    !currentRenderer?.overrideProps ||
    path.length === 0
  ) {
    return false;
  }
  const removal: Override = { path, value: undefined, remove: true };
  try {
    currentRenderer.overrideProps(
      currentFiber,
      WHOLE_PROPS,
      mergeOverrides([...overrides.values(), removal])
    );
  } catch {
    return false;
  }
  overrides.set(key(path), removal);
  current = { ...current, props: deleteAtPath(current.props, path) };
  emit();
  return true;
}

/** Immutably delete the key at `path` within `root`, shallow-cloning each level. */
function deleteAtPath(
  root: Record<string, unknown>,
  path: Array<string | number>
): Record<string, unknown> {
  const [head, ...tail] = path;
  if (head == null) {
    return root;
  }
  const clone: Record<string, unknown> = { ...root };
  if (tail.length === 0) {
    delete clone[head];
    return clone;
  }
  const child = clone[head];
  if (typeof child !== 'object' || child == null) {
    return root;
  }
  clone[head] = deleteAtPath(child as Record<string, unknown>, tail);
  return clone;
}

/**
 * The props to merge edits onto: the fiber's own, so props the element inspector
 * never displayed (children, handlers) survive a whole-props write, and so an
 * app-driven change to an untouched prop isn't rolled back. Falls back to the
 * snapshot for a fiber that doesn't carry them.
 */
function liveProps(): Record<string, unknown> {
  const fiber = currentFiber as { memoizedProps?: unknown } | null;
  const live = fiber?.memoizedProps;
  return typeof live === 'object' && live !== null
    ? (live as Record<string, unknown>)
    : (current?.props ?? {});
}

/** Immutably set `value` at `path` within `root`, shallow-cloning each level. */
function setAtPath(
  root: Record<string, unknown>,
  path: Array<string | number>,
  value: unknown
): Record<string, unknown> {
  const [head, ...tail] = path;
  if (head == null) {
    return root;
  }
  const clone: Record<string, unknown> = { ...root };
  if (tail.length === 0) {
    clone[head] = value;
    return clone;
  }
  const child = clone[head];
  clone[head] = setAtPath(
    typeof child === 'object' && child != null
      ? (child as Record<string, unknown>)
      : {},
    tail,
    value
  );
  return clone;
}
