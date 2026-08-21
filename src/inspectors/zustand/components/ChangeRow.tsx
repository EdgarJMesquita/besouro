/**
 * One state change in a store's timeline: the changed-keys summary and its time.
 *
 * Memoized, and takes `onSelect(id)` rather than a pre-bound closure, so a row
 * only re-renders when its own event changes.
 */

import { memo, useCallback } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import type { ZustandEvent } from '../../../core/types';
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
  event: ZustandEvent;
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
      <MonoText style={layout.fill} size={fontSize.body} color={theme.text}>
        {changeSummary(event)}
      </MonoText>
      {/* Whether this row is a starting state, and why it is one. */}
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
