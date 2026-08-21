/**
 * The minimized panel's resize handle.
 *
 * A corner target sized for a thumb (28pt) rather than for the glyph inside it —
 * the panel it resizes is small by definition, so the handle has to be findable
 * without a magnifier. The glyph is centered in that target, so the padding reads
 * the same on every side; the surface behind it stays, because this sits above
 * everything the panel can stack (zIndex 50) and a bare glyph over a busy list
 * would be unreadable.
 *
 * It carries the pan handlers from {@link useMiniWindowGestures} and nothing else:
 * the drag is the whole interaction, so there is no press state and no label to
 * read out.
 */

import { StyleSheet, View } from 'react-native';
import { Icon } from '../shared/components/Icon';
import { useBesouroUI } from '../shared/context';

/** Thumb-sized — the glyph inside is centered in it, not tucked into its corner. */
const GRIP_SIZE = 28;

export function ResizeGrip({
  handlers,
}: {
  handlers: React.ComponentProps<typeof View>;
}): React.ReactNode {
  const { theme } = useBesouroUI();
  return (
    <View
      {...handlers}
      style={[styles.grip, { backgroundColor: theme.surface }]}
      accessibilityRole="adjustable"
    >
      <Icon name="resize-grip" size={GRIP_SIZE} color={theme.textMuted} />
    </View>
  );
}

const styles = StyleSheet.create({
  grip: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    // Above every layer the panel can stack over itself — detail views (10) and
    // the stacked panels (30-40). Resizing is most useful exactly when something
    // is open on top: that is when the panel is too small to read.
    zIndex: 50,
    width: GRIP_SIZE,
    height: GRIP_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
    borderTopLeftRadius: 8,
  },
});
