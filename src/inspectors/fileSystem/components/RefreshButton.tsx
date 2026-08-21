/**
 * Re-reads the directory currently on screen.
 *
 * Lives at the right end of the path row rather than in the search row below:
 * that row is already the tab's "where am I" strip and only renders inside a
 * directory, which is exactly where a refresh means anything — the root list
 * comes from native and is fixed for the session. It also keeps the button
 * beside the path it re-reads, and leaves the search row to search.
 *
 * Borderless, like the back button it shares the row with, and inset on the right
 * so its glyph lines up in a column with the view-mode toggle's grid glyph in the
 * row below (see {@link GLYPH_INSET}).
 *
 * The rows stay on screen during the read — the spinner replaces the glyph in the
 * button rather than the listing, so a refresh that finds nothing changed doesn't
 * blank the view on the way.
 */

import { ActivityIndicator, Pressable, StyleSheet } from 'react-native';
import { Icon } from '../../../shared/components/Icon';
import { useBesouroUI } from '../../../shared/context';
import { space } from '../../../theme/tokens';

const GLYPH_SIZE = 18;

/**
 * How far the glyph sits in from this button's right edge, chosen so it lands in
 * a column with the grid glyph in the view-mode toggle one row below.
 *
 * That glyph is `space.md` (the search row's padding) + 1 (the toggle's border)
 * + `space.lg` (the segment's own padding) in from the tab's right edge, while
 * this row is padded by only `space.sm` — so the button makes up the difference
 * itself. Written as the subtraction rather than the number it evaluates to, so
 * a change to any of those four values keeps the two columns aligned.
 */
const GLYPH_INSET = space.md + 1 + space.lg - space.sm;

export function RefreshButton({
  onPress,
  busy,
}: {
  onPress: () => void;
  busy: boolean;
}): React.ReactNode {
  const { theme, strings } = useBesouroUI();
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={strings.refresh}
      accessibilityState={{ busy }}
      style={styles.box}
    >
      {busy ? (
        <ActivityIndicator size="small" color={theme.textMuted} />
      ) : (
        <Icon name="refresh" size={GLYPH_SIZE} color={theme.textMuted} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  box: {
    // Fixed width, with the content pinned right: the busy spinner is a couple
    // of points wider than the glyph, and a box that sized to its content would
    // reflow the path text every time a refresh started.
    width: space.sm + GLYPH_SIZE + GLYPH_INSET,
    height: 30,
    paddingRight: GLYPH_INSET,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
});
