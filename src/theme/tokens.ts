/**
 * Design tokens — the drawer's single source of truth for spacing, radius, and
 * typography. Components reference these instead of ad-hoc magic numbers so the
 * whole UI reads as one consistent system.
 *
 * Scales are intentionally small: pick the nearest step rather than inventing a
 * new value. Font sizes are *base* sizes — pass them through `font()` (from the
 * UI context) so the user's text-size preference still scales them.
 */

import type { TextStyle } from 'react-native';

/** Spacing scale (padding, margin, gap). `gutter` is the horizontal page edge. */
export const space = {
  /** 2 — hairline gaps between stacked lines. */
  tight: 2,
  /** 4 — tight inner gaps. */
  xs: 4,
  /** 6 — default inline gap between small elements. */
  sm: 6,
  /** 8 — comfortable inline gap / compact block padding. */
  md: 8,
  /** 10 — vertical padding for headers and toolbars. */
  lg: 10,
  /** 12 — vertical padding for list rows and detail blocks. */
  xl: 12,
  /** 14 — standard horizontal page gutter. */
  gutter: 14,
} as const;

/** Corner radii: pills, then inputs/buttons, then cards. */
export const radius = {
  sm: 4,
  md: 6,
  lg: 8,
} as const;

/** Type scale — base font sizes (feed through `font()` for user scaling). */
export const fontSize = {
  /** 10 — pill/badge text, smallest metadata. */
  micro: 10,
  /** 11 — timestamps, sub-labels, section headers, meta values. */
  caption: 11,
  /** 12 — mono values, secondary body text. */
  body: 12,
  /** 13 — row titles, tab labels, primary body. */
  base: 13,
  /** 15 — detail titles. */
  lg: 15,
  /** 16 — screen headings (Settings). */
  xl: 16,
} as const;

/** Weight scale. */
export const fontWeight = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
} as const satisfies Record<string, TextStyle['fontWeight']>;
