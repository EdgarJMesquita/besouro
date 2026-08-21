/** Header row shared by every tab: live search box + per-tab Clear (§7). */

import { type ReactNode, useCallback } from 'react';
import { View } from 'react-native';
import { markCleared } from '../../core/inspector-revisions';
import type { InspectorKind } from '../../core/types';
import { getCurrentSession } from '../../core/session';
import {
  useBesouroUI,
  useEventRepository,
  useViewingSession,
} from '../context';
import { SearchBox } from './SearchBox';
import { TextButton } from './TextButton';
import { space } from '../../theme/tokens';
import { StyleSheet } from 'react-native';
import { useMemo } from 'react';

export function TabHeader({
  kind,
  query,
  onQueryChange,
  extra,
}: {
  kind: InspectorKind;
  query: string;
  onQueryChange: (query: string) => void;
  extra?: ReactNode;
}): ReactNode {
  const s = useStyles();
  const { strings } = useBesouroUI();
  const eventRepository = useEventRepository();
  const viewing = useViewingSession();

  // Delete the rows, then say so. `events.clear` is the actual deletion;
  // `markCleared` is what makes the list re-query and drop back to one page —
  // without it the list would keep showing rows that are no longer on disk.
  //
  // Clearing empties the **log**, and never the app's own state: an MMKV store, a
  // Redux tree, a Zustand store all hold exactly what they held before the press.
  // Two kinds of tab keep saying so afterwards. MMKV and Redux keep their state row
  // through the delete (`TableSpec.stateColumn`); Zustand and Jotai have no such row
  // — their newest log row *is* the state — so their panes read the live store
  // instead, for as long as they have no row to read (see `readLiveState`).
  const handleClear = useCallback(() => {
    const sessionId = getCurrentSession()?.id;
    markCleared(kind);
    if (eventRepository && sessionId) {
      void eventRepository.clear(sessionId, kind).catch(() => {
        // Best-effort; the list refreshes from whatever survived.
      });
    }
  }, [kind, eventRepository]);

  return (
    <View style={s.row}>
      <SearchBox value={query} onChangeText={onQueryChange} />
      {extra}
      {/* A past session is a record, not a workspace: clearing one kind out of
          it is meaningless, and the button used to clear the *live* store from
          under the user instead. Delete the whole session from history. */}
      {viewing ? null : (
        <TextButton label={strings.clear} plain onPress={handleClear} />
      )}
    </View>
  );
}

/** Theme-derived styles for this module, memoized per theme/font. */
function useStyles() {
  const { theme } = useBesouroUI();
  return useMemo(
    () =>
      StyleSheet.create({
        row: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.md,
          paddingVertical: space.md,
          paddingHorizontal: space.lg,
          backgroundColor: theme.surface,
          borderBottomWidth: 1,
          borderBottomColor: theme.border,
        },
      }),
    [theme]
  );
}
