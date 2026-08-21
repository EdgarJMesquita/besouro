/**
 * Layout atoms shared across the drawer.
 *
 * Theme-independent, so they're created once at module load. Anything that reads
 * `theme` or `font` belongs in {@link useTextStyles} instead, which memoizes per
 * theme rather than per render.
 */

import { StyleSheet } from 'react-native';
import { space } from '../theme/tokens';

export const layout = StyleSheet.create({
  /** `flex: 1` — the single most common style in the codebase. */
  fill: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center' },
  rowGapSm: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  rowGapMd: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  rowGapLg: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  /** Standard list-row padding. */
  rowPadding: { paddingVertical: space.xl, paddingHorizontal: space.lg },
});
