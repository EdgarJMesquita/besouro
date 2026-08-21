/**
 * Autocomplete matching: which keys a query offers, and the closed value list a
 * given key accepts.
 */

import {
  BOOL_PROP_KEYS,
  BOOL_VALUES,
  COLOR_NAMES,
  ENUM_VALUES,
} from '../data/prop-keys';

/**
 * Autocomplete. `enumMode` (used for the closed value lists) shows the whole list
 * on an empty query and filters strictly by **prefix** — so typing narrows it like
 * a select. Otherwise (the large key lists) an empty query shows nothing and both
 * prefix and substring matches count, so `color` can find `borderColor`.
 */
export function matchKeys(
  all: string[],
  query: string,
  enumMode = false
): string[] {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return enumMode ? all.slice(0, MAX_SUGGESTIONS) : [];
  }
  const prefix: string[] = [];
  const contains: string[] = [];
  for (const key of all) {
    const lower = key.toLowerCase();
    if (lower.startsWith(needle)) prefix.push(key);
    else if (!enumMode && lower.includes(needle)) contains.push(key);
  }
  const result = [...prefix, ...contains];
  // Close the dropdown only when the value already *is* the sole option (a
  // complete match). If other keys also match (e.g. `color` alongside
  // `backgroundColor`), keep the exact one in the list rather than hiding it.
  if (result.length === 1 && result[0]?.toLowerCase() === needle) {
    return [];
  }
  return result.slice(0, MAX_SUGGESTIONS);
}

/** Cap on how many suggestions the dropdown shows at once. */
export const MAX_SUGGESTIONS = 6;

/** Suggested values for a prop/style key with a known enum, color, or boolean. */
export function valuesFor(key: string): string[] {
  if (key in ENUM_VALUES) {
    return ENUM_VALUES[key] as string[];
  }
  if (key.toLowerCase().includes('color')) {
    return COLOR_NAMES;
  }
  if (BOOL_PROP_KEYS.has(key)) {
    return BOOL_VALUES;
  }
  return [];
}
