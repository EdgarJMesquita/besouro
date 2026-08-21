/** Parsing and display helpers for edited prop values. */

/** Coerce edited text back to the prop's original primitive type. */
export function coerce(
  original: string | number,
  text: string
): string | number {
  if (typeof original === 'number') {
    const next = Number(text);
    return Number.isFinite(next) ? next : text;
  }
  return text;
}

/** Infer a primitive type for a newly added value (no original to match). */
export function coerceInput(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (trimmed !== '' && Number.isFinite(Number(trimmed))) {
    return Number(trimmed);
  }
  return text;
}

export function round(value: number): number {
  return Math.round(value * 10) / 10;
}

export function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}
