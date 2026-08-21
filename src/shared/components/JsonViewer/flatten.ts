/**
 * Flatten parsed JSON into an ordered array of line descriptors — one row per
 * token line — so the viewer can virtualize with a `FlatList` and never render
 * the whole document at once (§7.1). Each opening line records the index of its
 * matching close, which makes collapse/expand a cheap range-skip.
 */

export type JsonValueType = 'string' | 'number' | 'boolean' | 'null';

export interface JsonLine {
  id: string;
  depth: number;
  /** JSON path, e.g. `data.items[3].name` — for copy and search. */
  path: string;
  kind: 'key-value' | 'key-open' | 'open' | 'close' | 'primitive';
  keyText?: string;
  valueText?: string;
  valueType?: JsonValueType;
  /** Opening bracket for open lines, closing bracket for close lines. */
  bracket?: string;
  collapsible: boolean;
  childCount?: number;
  hasTrailingComma: boolean;
  /** Full-array index of the matching close line (open lines only). */
  endIndex?: number;
}

interface Entry {
  key: string | undefined;
  path: string;
  value: unknown;
}

/** Flatten a parsed JSON value into the full (fully expanded) line list. */
export function flattenJson(root: unknown): JsonLine[] {
  const lines: JsonLine[] = [];
  let counter = 0;
  const nextId = (): string => `line-${(counter += 1)}`;

  const walk = (
    value: unknown,
    depth: number,
    path: string,
    keyText: string | undefined,
    hasTrailingComma: boolean
  ): void => {
    if (Array.isArray(value) || isPlainObject(value)) {
      const entries = toEntries(value, path);
      if (entries.length === 0) {
        lines.push({
          id: nextId(),
          depth,
          path,
          kind: keyText != null ? 'key-value' : 'primitive',
          keyText,
          valueText: Array.isArray(value) ? '[]' : '{}',
          collapsible: false,
          hasTrailingComma,
        });
        return;
      }
      const bracket = Array.isArray(value) ? '[' : '{';
      const openIndex = lines.length;
      lines.push({
        id: nextId(),
        depth,
        path,
        kind: keyText != null ? 'key-open' : 'open',
        keyText,
        bracket,
        collapsible: true,
        childCount: entries.length,
        hasTrailingComma: false,
      });
      entries.forEach((entry, index) => {
        walk(
          entry.value,
          depth + 1,
          entry.path,
          entry.key,
          index < entries.length - 1
        );
      });
      const closeIndex = lines.length;
      lines.push({
        id: nextId(),
        depth,
        path,
        kind: 'close',
        bracket: Array.isArray(value) ? ']' : '}',
        collapsible: false,
        hasTrailingComma,
      });
      const openLine = lines[openIndex];
      if (openLine) {
        openLine.endIndex = closeIndex;
      }
      return;
    }

    const rendered = renderPrimitive(value);
    lines.push({
      id: nextId(),
      depth,
      path,
      kind: keyText != null ? 'key-value' : 'primitive',
      keyText,
      valueText: rendered.text,
      valueType: rendered.type,
      collapsible: false,
      hasTrailingComma,
    });
  };

  walk(root, 0, '', undefined, false);
  return lines;
}

/**
 * The lines a change flash should tint, given the paths that changed.
 *
 * Not simply "the lines whose path changed": a diff reports the *shallowest* path
 * that differs, so replacing an object or array — or changing an array's length —
 * yields the container's path and nothing below it (see
 * `inspectors/redux/utils/changed-paths`). Tinting only that line highlights
 * `"items": [` and leaves every value inside it untouched, which reads as the key
 * having changed rather than the data.
 *
 * So a flashed container takes its whole subtree with it, through the matching
 * close line — `endIndex` makes that a range rather than a search. A flashed leaf
 * is one line, which already carries its key and its value together.
 *
 * Returns ids rather than paths because a subtree is a range of *lines*, and two
 * lines can share a path (an open line and its close). Safe despite ids being
 * positional, unlike a flash keyed by id across re-flattens: these are read from
 * the same array they were produced from.
 */
export function flashedLineIds(
  lines: JsonLine[],
  paths: ReadonlySet<string>
): Set<string> {
  const ids = new Set<string>();
  lines.forEach((line, index) => {
    if (!paths.has(line.path)) {
      return;
    }
    const end = line.endIndex ?? index;
    for (let cursor = index; cursor <= end; cursor += 1) {
      const inside = lines[cursor];
      if (inside) {
        ids.add(inside.id);
      }
    }
  });
  return ids;
}

/**
 * Compute the visible lines given a set of collapsed open-line ids. Collapsed
 * nodes render on their opening line (with a preview) and their descendants —
 * through the matching close — are skipped.
 */
export function computeVisibleLines(
  lines: JsonLine[],
  collapsedIds: ReadonlySet<string>
): JsonLine[] {
  const visible: JsonLine[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line) {
      break;
    }
    visible.push(line);
    if (
      line.collapsible &&
      collapsedIds.has(line.id) &&
      line.endIndex != null
    ) {
      index = line.endIndex + 1;
      continue;
    }
    index += 1;
  }
  return visible;
}

function toEntries(value: unknown, parentPath: string): Entry[] {
  if (Array.isArray(value)) {
    return value.map((item, index) => ({
      key: undefined,
      path: `${parentPath}[${index}]`,
      value: item,
    }));
  }
  return Object.entries(value as Record<string, unknown>).map(
    ([key, item]) => ({
      key,
      path: parentPath ? `${parentPath}.${key}` : key,
      value: item,
    })
  );
}

function renderPrimitive(value: unknown): {
  text: string;
  type: JsonValueType;
} {
  if (value === null || value === undefined) {
    return { text: 'null', type: 'null' };
  }
  switch (typeof value) {
    case 'string':
      return { text: JSON.stringify(value), type: 'string' };
    case 'number':
      return { text: String(value), type: 'number' };
    case 'boolean':
      return { text: String(value), type: 'boolean' };
    default:
      return { text: JSON.stringify(value) ?? 'null', type: 'string' };
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
