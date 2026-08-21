/**
 * One value change in an atom's timeline: what it became, and when.
 *
 * Where the Zustand equivalent shows only the changed keys, this leads with the
 * preview — a Zustand store is always an object, but `atom(0)` has no keys to list.
 * The changed keys follow when there are any.
 */

import { memo, useCallback } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import type { JotaiEvent } from '../../../core/types';
import { useBesouroUI } from '../../../shared/context';
import { MonoText } from '../../../shared/components/MonoText';
import { BaselinePill } from '../../../shared/components/BaselinePill';
import { space, fontSize } from '../../../theme/tokens';
import { formatTime } from '../../../shared/utils/date-format';
import { changeSummary } from '../utils/change-summary';
import { layout } from '../../../shared/styles';
import { useTextStyles } from '../../../shared/hooks/text-styles';

export const ChangeRow = memo(function ChangeRow({
  event,
  onSelect,
}: {
  event: JotaiEvent;
  onSelect: (id: string) => void;
}): React.ReactNode {
  const { theme } = useBesouroUI();
  const text = useTextStyles();
  const handlePress = useCallback(
    () => onSelect(event.id),
    [onSelect, event.id]
  );
  return (
    <Pressable onPress={handlePress} style={styles.container}>
      {/* One line: a serialized value is arbitrarily long, and a row that grows to
          three lines breaks the timeline's scannability. */}
      <MonoText
        style={layout.fill}
        size={fontSize.body}
        color={theme.text}
        numberOfLines={1}
      >
        {changeSummary(event)}
      </MonoText>
      {/* Whether this row is a starting value, and why it is one. */}
      <BaselinePill isInitial={event.isInitial} isReload={event.isReload} />
      <Text style={text.caption}>{formatTime(event.timestamp)}</Text>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.xl,
    paddingHorizontal: space.lg,
  },
});
