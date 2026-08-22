/**
 * Bounded one-line previews for prop values the inspector can't edit inline.
 *
 * The element inspector is the one place whose values are React's own internals
 * rather than app data, and that changes what serializing costs. `children` is a
 * React element; in a dev build an element carries `_owner`, which is a *fiber*,
 * and a fiber links to `return`, `child`, `sibling`, `alternate` and `stateNode`.
 * So a full `safeStringify` of a single `children` walks a large part of the app's
 * tree — building megabytes of JSON — to fill a row that shows 140 characters. Every
 * edit re-renders these rows, so that walk is paid per commit, not once.
 *
 * Hence a renderer with a depth cap and an entry cap that never descends into a
 * React element at all: an element shows as its tag, which is what the row wanted
 * from it in the first place. `safeStringify` is left alone for the inspectors that
 * capture app data, where serializing the whole value is the point.
 */

/** Longest preview a row shows. */
const MAX_CHARS = 140;
/** Levels of an object/array descended before the rest is elided. */
const MAX_DEPTH = 2;
/** Keys/items shown per level before the rest is elided. */
const MAX_ENTRIES = 6;

/** A one-line, bounded rendering of `value`. */
export function propPreview(value: unknown): string {
  const text = render(value, 0);
  return text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS)}…` : text;
}

function render(value: unknown, depth: number): string {
  if (typeof value === 'function') {
    return 'ƒ';
  }
  if (value === null) {
    return 'null';
  }
  if (typeof value !== 'object') {
    // A top-level string is the value itself (an unquoted `hello`); nested, it
    // needs its quotes to read as one entry among others.
    return typeof value === 'string' && depth === 0 ? value : literal(value);
  }

  const tag = reactElementName(value);
  if (tag != null) {
    return `<${tag} />`;
  }
  // Types JSON renders as a useless `{}`, cheap to describe and never worth
  // descending into.
  if (value instanceof Error) {
    return value.message ? `${value.name}: ${value.message}` : value.name;
  }
  if (value instanceof Map) return `Map(${value.size})`;
  if (value instanceof Set) return `Set(${value.size})`;
  if (value instanceof RegExp || value instanceof Date) return String(value);

  if (depth >= MAX_DEPTH) {
    return Array.isArray(value) ? '[…]' : '{…}';
  }
  return Array.isArray(value)
    ? `[${join(
        value.map((item) => render(item, depth + 1)),
        value.length
      )}]`
    : renderObject(value as Record<string, unknown>, depth);
}

function renderObject(value: Record<string, unknown>, depth: number): string {
  const keys = Object.keys(value);
  const shown = keys
    .slice(0, MAX_ENTRIES)
    .map((key) => `${key}: ${render(value[key], depth + 1)}`);
  return `{${join(shown, keys.length)}}`;
}

/** Join the entries kept, noting how many were left out. */
function join(shown: string[], total: number): string {
  const parts = shown.slice(0, MAX_ENTRIES);
  if (total > MAX_ENTRIES) {
    parts.push(`…+${total - MAX_ENTRIES}`);
  }
  return parts.join(', ');
}

function literal(value: unknown): string {
  return typeof value === 'string' ? JSON.stringify(value) : String(value);
}

/**
 * The tag name of a React element, or null for anything else.
 *
 * `$$typeof` is the marker React itself uses to tell an element from a plain
 * object. React 19 renamed the symbol (`react.transitional.element`) while older
 * versions still mint `react.element`, and this library supports both, so match
 * either. Host elements carry their type as a string (`'RCTView'`); composites
 * resolve through `displayName`/`name`, which release minification mangles — the
 * same caveat the hierarchy in `../fiber` carries.
 */
function reactElementName(value: object): string | null {
  const element = value as { $$typeof?: unknown; type?: unknown };
  if (
    element.$$typeof !== Symbol.for('react.transitional.element') &&
    element.$$typeof !== Symbol.for('react.element')
  ) {
    return null;
  }
  const type = element.type;
  if (typeof type === 'string') {
    return type;
  }
  if (type === Symbol.for('react.fragment')) {
    return 'Fragment';
  }
  if (
    typeof type === 'function' ||
    (typeof type === 'object' && type !== null)
  ) {
    const named = type as { displayName?: unknown; name?: unknown };
    if (typeof named.displayName === 'string' && named.displayName) {
      return named.displayName;
    }
    if (typeof named.name === 'string' && named.name) {
      return named.name;
    }
  }
  return 'Anonymous';
}
