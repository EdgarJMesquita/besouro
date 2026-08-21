/**
 * Deep diff of two state trees, expressed as JSON paths — the input to the
 * viewer's change flash (§7.1).
 *
 * The paths must match the ones `JsonViewer` puts on its lines
 * (`shared/components/JsonViewer/flatten.ts`, `toEntries`), because that is what
 * they are compared against: the root is `''`, an object child is
 * `parent ? parent + '.' + key : key`, and an array child is `parent + '[i]'`.
 *
 * The walk descends only while both sides are the same kind of container. The
 * moment a value is added, removed, replaced by a different type, or is a changed
 * primitive, that path is recorded and the walk stops there. That is what keeps
 * the output proportional to the *change* rather than to the tree: replacing a
 * 5,000-element array flashes the array, not 5,000 rows.
 *
 * We diff the live objects, not the serialized text, so a value `JSON.stringify`
 * drops (`undefined`, a function) can produce a path with no matching line. That
 * is harmless — an unmatched path simply never flashes.
 */

/**
 * Ceiling on reported paths. A flash is a glance-level cue; past a screenful it
 * conveys nothing extra, and the walk should not become the expensive part of a
 * dispatch.
 */
export const MAX_CHANGED_PATHS = 200;

/**
 * JSON paths whose value differs between `prev` and `next`.
 *
 * `limit` bounds the walk, not just the result: it stops descending once it has
 * enough, which is what makes a small limit genuinely cheap. The action log passes
 * a handful (it has one line to fill); the flash passes the default.
 */
export function changedPaths(
  prev: unknown,
  next: unknown,
  limit: number = MAX_CHANGED_PATHS
): string[] {
  const paths: string[] = [];
  walk(prev, next, '', paths, limit);
  return paths;
}

function walk(
  prev: unknown,
  next: unknown,
  path: string,
  out: string[],
  limit: number
): void {
  if (out.length >= limit) {
    return;
  }
  // Reference equality is the fast exit that makes this affordable: Redux state is
  // immutable, so an untouched slice is the same object and its whole subtree can
  // be skipped without being visited.
  if (Object.is(prev, next)) {
    return;
  }

  if (isPlainObject(prev) && isPlainObject(next)) {
    for (const key of unionKeys(prev, next)) {
      if (out.length >= limit) {
        return;
      }
      walk(prev[key], next[key], path ? `${path}.${key}` : key, out, limit);
    }
    return;
  }

  if (Array.isArray(prev) && Array.isArray(next)) {
    // A length change reshuffles every index below it, so index-wise diffing would
    // report the whole tail as changed and mean nothing. Flash the array itself.
    if (prev.length !== next.length) {
      out.push(path);
      return;
    }
    for (let index = 0; index < next.length; index += 1) {
      if (out.length >= limit) {
        return;
      }
      walk(prev[index], next[index], `${path}[${index}]`, out, limit);
    }
    return;
  }

  // Different kinds, or two differing primitives — the leaf of this comparison.
  out.push(path);
}

function unionKeys(
  prev: Record<string, unknown>,
  next: Record<string, unknown>
): string[] {
  const keys = Object.keys(next);
  for (const key of Object.keys(prev)) {
    if (!(key in next)) {
      keys.push(key);
    }
  }
  return keys;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
