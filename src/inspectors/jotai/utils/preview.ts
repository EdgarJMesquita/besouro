/**
 * A one-line rendering of an atom's value, for a list or history row.
 *
 * Stored as its own summary column rather than clipped from the serialized value at
 * render time, because that value is a *heavy* column: a list query never selects
 * it, which is the whole reason scrolling a long history stays cheap.
 */

/** Longest preview kept — a row shows one line, and clips it further to fit. */
const MAX_PREVIEW_CHARS = 120;

/**
 * The head of the serialized value, whatever its type.
 *
 * `safeStringify` emits compact JSON, so an object is already a single line and its
 * first 120 characters are its first few fields — `{"items":["SKU-1"],"total":10}`
 * says what the value *is*, where a rendering of its shape (`{…} 2`) only repeats
 * that it is an object with two keys, which the changed keys beside it already
 * cover. Primitives, `Map(2) {…}` and `[Function foo]` all fall out of the same
 * rule, so there are no per-type cases to keep in step.
 */
export function valuePreview(serialized: string): string {
  // A string value can carry newlines of its own; a row is one line either way, so
  // collapse them rather than letting the row grow or clip mid-escape.
  const oneLine = serialized.replace(/\s+/g, ' ').trim();
  return oneLine.length > MAX_PREVIEW_CHARS
    ? `${oneLine.slice(0, MAX_PREVIEW_CHARS)}…`
    : oneLine;
}
