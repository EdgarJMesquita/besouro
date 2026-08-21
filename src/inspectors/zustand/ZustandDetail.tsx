/**
 * Zustand detail screens — a store's change timeline, and the state diff for a
 * single change within it.
 */

import { useCallback, useMemo, useState } from 'react';
import { Text, View, type ListRenderItem } from 'react-native';

import type { ZustandEvent } from '../../core/types';
import type { ZustandStoreListItem } from './types-ui';
import { useBesouroUI, useSessionEvents } from '../../shared/context';
import { readLiveState } from '../../core/live-state';
import { useEventWithDetail } from '../../shared/hooks/event-detail';
import { useRowChangeFlash } from '../../shared/hooks/row-change-flash';
import { PagedList } from '../../shared/components/PagedList';
import { BackButton } from '../../shared/components/BackButton';
import { EmptyState } from '../../shared/components/EmptyState';
import { MonoText } from '../../shared/components/MonoText';
import { Pill } from '../../shared/components/Pill';
import { BaselinePill } from '../../shared/components/BaselinePill';
import { SectionHeader } from '../../shared/components/SectionHeader';
import { space, fontSize, fontWeight } from '../../theme/tokens';
import { JsonViewer } from '../../shared/components/JsonViewer';
import { DetailLoading } from '../../shared/components/DetailLoading';
import { DetailTimestamp } from '../../shared/components/DetailTimestamp';

import { DetailOverlay } from '../../shared/components/DetailOverlay';
import { ChangeRow } from './components/ChangeRow';
import { layout } from '../../shared/styles';
import { StyleSheet } from 'react-native';

export function StoreDetail({
  item,
  archived,
}: {
  item: ZustandStoreListItem;
  /** A past session: there is no live store behind this, only its recorded rows. */
  archived: boolean;
}): React.ReactNode {
  const s = useStyles();
  const { theme, strings } = useBesouroUI();
  const [selectedChangeId, setSelectedChangeId] = useState<string | null>(null);

  // Transitions page within this store; a long-lived store can accumulate
  // thousands, and only the visible ones need to be in memory.
  const paged = useSessionEvents('zustand', { group: item.storeId });

  const renderItem = useCallback<ListRenderItem<ZustandEvent>>(
    ({ item }) => <ChangeRow event={item} onSelect={setSelectedChangeId} />,
    [setSelectedChangeId]
  );

  const selectedChange =
    (paged.rows.find((event) => event.id === selectedChangeId) as
      ZustandEvent | undefined) ?? null;

  return (
    <View style={layout.fill}>
      {selectedChange ? (
        <DetailOverlay onClose={() => setSelectedChangeId(null)}>
          <ChangeDetail summary={selectedChange} />
        </DetailOverlay>
      ) : null}
      <View style={s.row2}>
        <BackButton />
        <MonoText style={layout.fill} size={fontSize.base} color={theme.text}>
          {item.storeName}
        </MonoText>
      </View>

      {/* The state pane: the newest row this session recorded, in a live session and
          a past one alike. Every row carries the whole state, so the newest one is
          the store's state — current while the session runs, and the last it was
          seen in once it has ended, which is all the header distinguishes. */}
      <View style={layout.fill}>
        <View style={styles.container3}>
          <SectionHeader
            title={archived ? strings.lastState : strings.currentState}
          />
        </View>
        <NewestState
          newest={paged.rows[0] as ZustandEvent | undefined}
          storeId={item.storeId}
          archived={archived}
        />
      </View>

      {/* History — the recorded transitions, stacked under the state. Both panes
          are sibling FlatLists (not nested), so neither triggers the
          VirtualizedList-nesting warning. */}
      <View style={s.block}>
        <View style={styles.container2}>
          <SectionHeader title={strings.history} />
        </View>
        <PagedList<ZustandEvent>
          paged={paged}
          renderItem={renderItem}
          emptyMessage={strings.noEvents}
        />
      </View>
    </View>
  );
}

/**
 * The newest state this session recorded — its heavy column fetched on open.
 *
 * Split in two so the body can call `useEventWithDetail` unconditionally: there is
 * nothing to fetch until a row exists, and a hook cannot be skipped.
 *
 * **With no row, the store itself answers.** Clearing the tab deletes the rows, and
 * the newest of them was what this pane rendered — but the button empties the log,
 * not the app's store, which is still holding exactly what it held. Reading it here
 * keeps the pane honest without putting a row back in a history the reader just
 * emptied. A store that changes writes a row again, and the row is what shows from
 * then on. Archived sessions never take this path: their state is what their rows
 * recorded, and this launch's stores describe a different run.
 */
function NewestState({
  newest,
  storeId,
  archived,
}: {
  newest: ZustandEvent | undefined;
  storeId: string;
  archived: boolean;
}): React.ReactNode {
  const { strings } = useBesouroUI();
  if (!newest) {
    const live = archived ? null : readLiveState(storeId);
    return live ? (
      <JsonViewer
        raw={live.raw}
        truncated={live.truncated}
        insetBottom={false}
      />
    ) : (
      <EmptyState message={strings.noValue} />
    );
  }
  return (
    <NewestStateBody summary={newest} storeId={storeId} archived={archived} />
  );
}

function NewestStateBody({
  summary,
  storeId,
  archived,
}: {
  summary: ZustandEvent;
  storeId: string;
  archived: boolean;
}): React.ReactNode {
  const { strings } = useBesouroUI();
  // `keepPrevious`: every state change is a new row, so this pane's id moves on
  // its own rather than because the reader picked something. Clearing between
  // rows would tear the viewer down and rebuild it on every change.
  const { event, loadingDetail } = useEventWithDetail<ZustandEvent>(
    'zustand',
    summary,
    { keepPrevious: true }
  );
  // Keyed off the loaded row, not the summary: the summary moves as soon as the
  // change is recorded, but the document the flash tints is the one being read.
  // Keying it here fires the tint on the render that swaps the state in.
  const flash = useRowChangeFlash({
    scope: storeId,
    row: event,
    archived,
  });
  if (loadingDetail) {
    return <DetailLoading />;
  }
  // Top pane of a split view — no bottom inset (the History list below carries it).
  return event.state ? (
    <JsonViewer
      raw={event.state}
      truncated={event.stateTruncated}
      insetBottom={false}
      flash={flash}
    />
  ) : (
    <EmptyState message={strings.noValue} />
  );
}

/**
 * `summary` is the history row: changed keys and timing, but not the resulting
 * state — a heavy column fetched only when this view opens.
 */
function ChangeDetail({ summary }: { summary: ZustandEvent }): React.ReactNode {
  const s = useStyles();
  const { theme, strings } = useBesouroUI();
  const { event, loadingDetail } = useEventWithDetail<ZustandEvent>(
    'zustand',
    summary
  );
  return (
    <View style={layout.fill}>
      <View style={s.row}>
        <BackButton />
        {event.isInitial ? (
          <BaselinePill isInitial isReload={event.isReload} />
        ) : (
          <Pill label={strings.changes} color={theme.textMuted} />
        )}
        <View style={layout.fill} />
        <DetailTimestamp timestamp={event.timestamp} />
      </View>
      {event.changedKeys.length > 0 ? (
        <View style={styles.row}>
          <Text style={s.label2}>{strings.changedKeys.toUpperCase()}</Text>
          {event.changedKeys.map((changedKey) => (
            <MonoText key={changedKey} size={fontSize.body} color={theme.text}>
              {changedKey}
            </MonoText>
          ))}
        </View>
      ) : null}
      {loadingDetail ? (
        // The resulting state is still being read; "no value" would be wrong.
        <DetailLoading />
      ) : event.state ? (
        <JsonViewer
          raw={event.state}
          truncated={event.stateTruncated}
          ListHeaderComponent={
            <View style={styles.container}>
              <Text style={s.label}>{strings.snapshot.toUpperCase()}</Text>
            </View>
          }
        />
      ) : (
        <EmptyState message={strings.noValue} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
  },
  container2: {
    paddingHorizontal: space.lg,
  },
  container3: {
    paddingHorizontal: space.lg,
  },
});

/** Theme-derived styles for this module, memoized per theme/font. */
function useStyles() {
  const { theme, font } = useBesouroUI();
  return useMemo(
    () =>
      StyleSheet.create({
        label: {
          color: theme.textMuted,
          fontSize: font(fontSize.caption),
          fontWeight: fontWeight.bold,
        },
        label2: {
          color: theme.textMuted,
          fontSize: font(fontSize.caption),
          fontWeight: fontWeight.bold,
          width: '100%',
          marginBottom: 2,
        },
        row: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.md,
          padding: space.lg,
          backgroundColor: theme.surface,
          borderBottomWidth: 1,
          borderBottomColor: theme.border,
        },
        block: {
          flex: 1,
          borderTopWidth: 1,
          borderTopColor: theme.border,
        },
        row2: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.md,
          padding: space.lg,
          backgroundColor: theme.surface,
          borderBottomWidth: 1,
          borderBottomColor: theme.border,
        },
      }),
    [theme, font]
  );
}
