/**
 * One dispatched action in the log: its type, the slices it changed, and its time.
 *
 * Memoized, and takes `onSelect(id)` rather than a pre-bound closure, so a row only
 * re-renders when its own event changes — the same discipline as the Zustand
 * `ChangeRow`, and it matters more here: a Redux log is routinely hundreds of rows
 * that grow while the user is reading them.
 */

import { memo, useCallback } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { ReduxEvent } from '../../../core/types';
import { useBesouroUI } from '../../../shared/context';
import { MonoText } from '../../../shared/components/MonoText';
import { BaselinePill } from '../../../shared/components/BaselinePill';
import { space, fontSize } from '../../../theme/tokens';
import { formatTime } from '../../../shared/utils/date-format';
import { actionSummary } from '../utils/action-summary';
import { useTextStyles } from '../../../shared/hooks/text-styles';

export const ActionRow = memo(function ActionRow({
  event,
  onSelect,
}: {
  event: ReduxEvent;
  onSelect: (id: string) => void;
}): React.ReactNode {
  const { theme, strings } = useBesouroUI();
  const text = useTextStyles();
  const handlePress = useCallback(
    () => onSelect(event.id),
    [onSelect, event.id]
  );
  const summary = actionSummary(event, strings.noChanges);
  return (
    <Pressable onPress={handlePress} style={styles.container}>
      <View style={styles.block}>
        <MonoText color={theme.text} size={fontSize.base}>
          {event.actionType}
        </MonoText>
        {/* Empty when the changed slice is just the action type's prefix — see
            `actionSummary`. Rendering it anyway would leave a blank line. */}
        {summary ? <Text style={text.caption}>{summary}</Text> : null}
      </View>
      {/* Whether this row is a starting state, and why it is one. */}
      <BaselinePill isInitial={event.isInitial} isReload={event.isReload} />
      <Text style={text.caption}>{formatTime(event.timestamp)}</Text>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  block: {
    flex: 1,
    gap: space.xs,
  },
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.xl,
    paddingHorizontal: space.lg,
  },
});
