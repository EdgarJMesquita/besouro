/**
 * One notification in the list: origin · provider · phase · time, then the title
 * and a two-line body preview.
 *
 * Memoized, and takes `onSelect(id)` rather than a pre-bound closure, so a row
 * only re-renders when its own event changes.
 */

import { memo, useCallback } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { NotificationEvent } from '../../../core/types';
import { useBesouroUI } from '../../../shared/context';
import { Pill } from '../../../shared/components/Pill';
import { space } from '../../../theme/tokens';
import { formatTime } from '../../../shared/utils/date-format';
import { displayTitle } from '../utils/display-title';
import { layout } from '../../../shared/styles';
import { useTextStyles } from '../../../shared/hooks/text-styles';
import { StyleSheet } from 'react-native';

export const NotificationRow = memo(function NotificationRow({
  event,
  onSelect,
}: {
  event: NotificationEvent;
  onSelect: (id: string) => void;
}): React.ReactNode {
  const text = useTextStyles();
  const { theme, strings } = useBesouroUI();
  const handlePress = useCallback(
    () => onSelect(event.id),
    [onSelect, event.id]
  );
  return (
    <Pressable onPress={handlePress} style={styles.container}>
      <View style={layout.rowGapSm}>
        <Pill label={event.origin} color={theme.textMuted} />
        <Text style={text.caption}>
          {event.provider} · {event.phase}
        </Text>
        <View style={layout.fill} />
        <Text style={text.caption}>{formatTime(event.timestamp)}</Text>
      </View>
      <Text style={text.title}>{displayTitle(event, strings)}</Text>
      {event.body ? (
        <Text style={text.bodyMuted} numberOfLines={2}>
          {event.body}
        </Text>
      ) : null}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  container: {
    paddingVertical: space.xl,
    paddingHorizontal: space.lg,
    gap: space.xs,
  },
});
