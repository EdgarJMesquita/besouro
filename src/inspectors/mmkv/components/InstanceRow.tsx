/** One MMKV instance in the list: its label, change count, and last change. */

import { memo, useCallback } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { MMKVInstanceListItem } from '../types-ui';
import { useBesouroUI } from '../../../shared/context';

import { MonoText } from '../../../shared/components/MonoText';

import { space, fontSize } from '../../../theme/tokens';

import { formatTime } from '../../../shared/utils/date-format';
import { useTextStyles } from '../../../shared/hooks/text-styles';

export const InstanceRow = memo(function InstanceRow({
  item,
  onSelect,
}: {
  item: MMKVInstanceListItem;
  onSelect: (instanceId: string) => void;
}): React.ReactNode {
  const text = useTextStyles();
  const { theme, strings } = useBesouroUI();
  const handlePress = useCallback(
    () => onSelect(item.instanceId),
    [onSelect, item.instanceId]
  );
  // No key count: it lives in the snapshot row's heavy `value` column, which a list
  // query never selects — pulling one per instance to fill a caption is exactly the
  // summary/heavy split this database is built around.
  const changeLabel =
    item.changeCount === 1 ? strings.change : strings.changes.toLowerCase();
  const parts = [
    `${item.changeCount} ${changeLabel}`,
    formatTime(item.updatedAt),
  ];
  return (
    <Pressable onPress={handlePress} style={styles.row}>
      <View style={styles.block}>
        <MonoText color={theme.text} size={fontSize.base}>
          {item.instanceName}
        </MonoText>
        <Text style={text.caption}>{parts.join(' · ')}</Text>
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
