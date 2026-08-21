/**
 * Collapse the many ways RN lets a box property be written into one edge set —
 * `padding`, `paddingHorizontal`, `paddingStart`, `paddingLeft`, … all land on
 * the same four sides. Used by the box-model diagram, which has to place a value
 * on each edge regardless of which spelling the app used.
 */

import { I18nManager } from 'react-native';

/** Per-side values. Strings are kept as written (`'50%'`, `'auto'`). */
export interface BoxEdges {
  top: number | string;
  right: number | string;
  bottom: number | string;
  left: number | string;
}

/** Only numbers and strings are layout values; anything else isn't ours to read. */
function edgeValue(
  style: Record<string, unknown>,
  key: string
): number | string | undefined {
  const value = style[key];
  return typeof value === 'number' || typeof value === 'string'
    ? value
    : undefined;
}

/**
 * Resolve `prefix` (`'margin'` or `'padding'`) out of a flattened style into its
 * four edges, or null when the style declares none — which is what tells the
 * diagram to skip that ring entirely rather than draw a row of zeros.
 *
 * Sides are applied least-specific first, so the more specific spelling wins the
 * way it does in layout: the shorthand, then the axis pairs, then `Start`/`End`,
 * then the explicit sides. `Start`/`End` follow the writing direction, so they
 * swap sides in an RTL app.
 */
export function resolveBoxStyle(
  prefix: 'margin' | 'padding',
  style: Record<string, unknown>
): BoxEdges | null {
  const edges: BoxEdges = { top: 0, right: 0, bottom: 0, left: 0 };
  let declared = false;

  const all = edgeValue(style, prefix);
  if (all !== undefined) {
    edges.top = edges.right = edges.bottom = edges.left = all;
    declared = true;
  }

  const horizontal = edgeValue(style, `${prefix}Horizontal`);
  if (horizontal !== undefined) {
    edges.left = edges.right = horizontal;
    declared = true;
  }

  const vertical = edgeValue(style, `${prefix}Vertical`);
  if (vertical !== undefined) {
    edges.top = edges.bottom = vertical;
    declared = true;
  }

  const start = edgeValue(style, `${prefix}Start`);
  if (start !== undefined) {
    edges[I18nManager.isRTL ? 'right' : 'left'] = start;
    declared = true;
  }

  const end = edgeValue(style, `${prefix}End`);
  if (end !== undefined) {
    edges[I18nManager.isRTL ? 'left' : 'right'] = end;
    declared = true;
  }

  for (const side of ['top', 'right', 'bottom', 'left'] as const) {
    const value = edgeValue(
      style,
      `${prefix}${side[0]?.toUpperCase()}${side.slice(1)}`
    );
    if (value !== undefined) {
      edges[side] = value;
      declared = true;
    }
  }

  return declared ? edges : null;
}
