/** One watched atom in the list: its name, change count, and current value. */

import { memo, useCallback } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { type JotaiAtomListItem } from '../types-ui';
import { useBesouroUI } from '../../../shared/context';
import { MonoText } from '../../../shared/components/MonoText';
import { space, fontSize } from '../../../theme/tokens';
import { formatTime } from '../../../shared/utils/date-format';
import { useTextStyles } from '../../../shared/hooks/text-styles';

export const AtomRow = memo(function AtomRow({
  item,
  onSelect,
}: {
  item: JotaiAtomListItem;
  onSelect: (atomId: string) => void;
}): React.ReactNode {
  const text = useTextStyles();
  const { theme, strings } = useBesouroUI();
  const handlePress = useCallback(
    () => onSelect(item.atomId),
    [onSelect, item.atomId]
  );
  const changeLabel =
    item.changeCount === 1 ? strings.change : strings.changes.toLowerCase();
  return (
    <Pressable onPress={handlePress} style={styles.row}>
      <View style={styles.block}>
        <MonoText color={theme.text} size={fontSize.base}>
          {item.atomName}
        </MonoText>
        {/* The value itself, not just a change count: most atoms hold a primitive,
            and for those the value is the whole story. */}
        <MonoText
          color={theme.textMuted}
          size={fontSize.body}
          numberOfLines={1}
        >
          {item.preview}
        </MonoText>
        <Text style={text.caption}>
          {`${item.changeCount} ${changeLabel} · ${formatTime(item.updatedAt)}`}
        </Text>
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  block: {
    flex: 1,
    gap: space.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.lg,
    paddingVertical: space.xl,
    paddingHorizontal: space.lg,
  },
});
