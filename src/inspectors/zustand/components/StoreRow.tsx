/** One store in the list: its label, change count, and latest-state summary. */

import { memo, useCallback } from 'react';
import { Pressable, Text, View } from 'react-native';

import { type ZustandStoreListItem } from '../types-ui';
import { useBesouroUI } from '../../../shared/context';

import { MonoText } from '../../../shared/components/MonoText';

import { space, fontSize } from '../../../theme/tokens';

import { formatTime } from '../../../shared/utils/date-format';
import { useTextStyles } from '../../../shared/hooks/text-styles';
import { StyleSheet } from 'react-native';

export const StoreRow = memo(function StoreRow({
  item,
  onSelect,
}: {
  item: ZustandStoreListItem;
  onSelect: (storeId: string) => void;
}): React.ReactNode {
  const text = useTextStyles();
  const handlePress = useCallback(
    () => onSelect(item.storeId),
    [onSelect, item.storeId]
  );
  const { theme, strings } = useBesouroUI();
  const changeLabel =
    item.changeCount === 1 ? strings.change : strings.changes.toLowerCase();
  return (
    <Pressable onPress={handlePress} style={styles.row}>
      <View style={styles.block}>
        <MonoText color={theme.text} size={fontSize.base}>
          {item.storeName}
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
