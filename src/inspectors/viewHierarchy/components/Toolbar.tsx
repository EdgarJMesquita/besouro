/**
 * The tab's one button.
 *
 * The capture happens on mount, so this is for after the app has moved on — you
 * navigate, come back to the drawer, and want the tree as it is now.
 *
 * Labelled as taking a new snapshot rather than refreshing, which is what the
 * button actually does: the tab draws one reading of the native tree, taken at
 * a moment and frozen. Depth, spread, focus and the whole camera work over that
 * reading without going back to the app, so the one control that *does* go back
 * should not read like the others.
 */

import { StyleSheet, View } from 'react-native';
import { useBesouroUI } from '../../../shared/context';
import { TextButton } from '../../../shared/components/TextButton';
import { layout } from '../../../shared/styles';
import { space } from '../../../theme/tokens';

/** Re-reads the tree. The capture happens on mount; this is for after the app moves. */
export function Toolbar({
  onRefresh,
}: {
  onRefresh: () => void;
}): React.ReactNode {
  const { strings } = useBesouroUI();
  return (
    <View style={styles.toolbar}>
      <TextButton
        label={strings.viewHierarchyRefresh}
        tone="accent"
        onPress={onRefresh}
        style={layout.fill}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.gutter,
    paddingVertical: space.md,
  },
});
