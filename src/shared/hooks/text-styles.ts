/**
 * The recurring text styles, resolved against the active theme and font scale.
 *
 * Almost every `<Text>` in the drawer was carrying an inline
 * `{ color: theme.x, fontSize: font(fontSize.y) }` object, which allocated on
 * every render and defeated `memo` on the components receiving it. These are
 * memoized per theme/font instead, so the reference stays stable across renders.
 */

import { useMemo } from 'react';
import { StyleSheet } from 'react-native';
import { useBesouroUI } from '../context';
import { fontSize, fontWeight } from '../../theme/tokens';

export function useTextStyles() {
  const { theme, font } = useBesouroUI();
  return useMemo(
    () =>
      StyleSheet.create({
        caption: { color: theme.textMuted, fontSize: font(fontSize.caption) },
        captionFaint: {
          color: theme.textFaint,
          fontSize: font(fontSize.caption),
        },
        captionAccent: {
          color: theme.accent,
          fontSize: font(fontSize.caption),
          fontWeight: fontWeight.semibold,
        },
        body: { color: theme.text, fontSize: font(fontSize.body) },
        bodyMuted: { color: theme.textMuted, fontSize: font(fontSize.body) },
        base: { color: theme.text, fontSize: font(fontSize.base) },
        baseMuted: { color: theme.textMuted, fontSize: font(fontSize.base) },
        title: {
          color: theme.text,
          fontSize: font(fontSize.base),
          fontWeight: fontWeight.semibold,
        },
        mono: {
          fontFamily: 'Courier',
          color: theme.text,
          fontSize: font(fontSize.body),
        },
        /** `mono` that fills its row — avoids a `[fill, mono]` array per render. */
        monoFill: {
          flex: 1,
          fontFamily: 'Courier',
          color: theme.text,
          fontSize: font(fontSize.body),
        },
      }),
    [theme, font]
  );
}
