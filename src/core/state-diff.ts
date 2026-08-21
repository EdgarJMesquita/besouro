/**
 * Shallow change detection over a state tree, shared by the state-tree inspectors.
 *
 * Both Zustand and Redux answer the same question on every transition — "which
 * top-level keys hold a different value now?" — and both can answer it by
 * reference, because both models require state to be replaced rather than mutated.
 * `Object.is` is therefore the whole comparison: a deep equality walk would cost
 * more than the capture it feeds and would report *no* change for a store that
 * correctly produced a new object with equal contents.
 *
 * Lives in `core/` rather than in either inspector so the two cannot drift into
 * disagreeing about what "changed" means.
 */

/** Whether a value is a plain object — the shape a keyed state tree has. */
export function isPlainRecord(
  value: unknown
): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Own enumerable keys of a plain-object state; empty for primitive/non-object state. */
export function topLevelKeys(state: unknown): string[] {
  return isPlainRecord(state) ? Object.keys(state) : [];
}

/**
 * Top-level keys whose reference changed between two states, additions and
 * removals included.
 *
 * Returns `[]` when either side is not a plain record — which is *not* the same as
 * "nothing changed", and callers that care must handle it. See
 * {@link isKeyedState}.
 */
export function changedTopLevelKeys(
  nextState: unknown,
  prevState: unknown
): string[] {
  if (!isPlainRecord(nextState) || !isPlainRecord(prevState)) {
    return [];
  }
  const keys = new Set([...Object.keys(nextState), ...Object.keys(prevState)]);
  const changed: string[] = [];
  for (const key of keys) {
    if (!Object.is(nextState[key], prevState[key])) {
      changed.push(key);
    }
  }
  return changed;
}

/**
 * Whether both sides of a transition are keyed objects, so
 * {@link changedTopLevelKeys} can describe it.
 *
 * A root reducer may legitimately return an array, a Map or a primitive, in which
 * case there are no slices to name and a caller must fall back to treating the
 * whole value as changed rather than reporting an empty diff.
 */
export function isKeyedState(nextState: unknown, prevState: unknown): boolean {
  return isPlainRecord(nextState) && isPlainRecord(prevState);
}

/** The subset of `state` limited to `keys`, for storing only what a change touched. */
export function pickKeys(
  state: unknown,
  keys: string[]
): Record<string, unknown> {
  if (!isPlainRecord(state)) {
    return {};
  }
  const picked: Record<string, unknown> = {};
  for (const key of keys) {
    if (key in state) {
      picked[key] = state[key];
    }
  }
  return picked;
}
