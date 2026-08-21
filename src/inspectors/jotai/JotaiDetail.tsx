/**
 * Jotai detail screens — an atom's change timeline, and one change within it.
 *
 * The same two-pane split as `ZustandDetail`: Current Value on top, History
 * beneath. An atom holds one value and changes at human pace, so unlike the Redux
 * tab there is nothing here that needs a full screen of its own.
 */

import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, Text, View, type ListRenderItem } from 'react-native';

import type { JotaiEvent } from '../../core/types';
import type { JotaiAtomListItem } from './types-ui';
import { useBesouroUI, useSessionEvents } from '../../shared/context';
import { readLiveState } from '../../core/live-state';
import { useEventWithDetail } from '../../shared/hooks/event-detail';
import { useRowChangeFlash } from '../../shared/hooks/row-change-flash';
import { PagedList } from '../../shared/components/PagedList';
import { BackButton } from '../../shared/components/BackButton';
import { EmptyState } from '../../shared/components/EmptyState';
import { MonoText } from '../../shared/components/MonoText';
import { BaselinePill } from '../../shared/components/BaselinePill';
import { SectionHeader } from '../../shared/components/SectionHeader';
import { space, fontSize, fontWeight } from '../../theme/tokens';
import { JsonViewer } from '../../shared/components/JsonViewer';
import { DetailLoading } from '../../shared/components/DetailLoading';
import { DetailTimestamp } from '../../shared/components/DetailTimestamp';
import { DetailOverlay } from '../../shared/components/DetailOverlay';
import { ChangeRow } from './components/ChangeRow';
import { layout } from '../../shared/styles';

export function AtomDetail({
  item,
  archived,
}: {
  item: JotaiAtomListItem;
  /** A past session: there is no live atom behind this, only its recorded rows. */
  archived: boolean;
}): React.ReactNode {
  const s = useStyles();
  const { theme, strings } = useBesouroUI();
  const [selectedChangeId, setSelectedChangeId] = useState<string | null>(null);

  // Changes page within this atom; a busy atom accumulates thousands, and only the
  // visible ones need to be in memory.
  const paged = useSessionEvents('jotai', { group: item.atomId });

  const renderItem = useCallback<ListRenderItem<JotaiEvent>>(
    ({ item }) => <ChangeRow event={item} onSelect={setSelectedChangeId} />,
    [setSelectedChangeId]
  );

  const selectedChange =
    (paged.rows.find((event) => event.id === selectedChangeId) as
      JotaiEvent | undefined) ?? null;

  return (
    <View style={layout.fill}>
      {selectedChange ? (
        <DetailOverlay onClose={() => setSelectedChangeId(null)}>
          <ChangeDetail summary={selectedChange} />
        </DetailOverlay>
      ) : null}
      <View style={s.row}>
        <BackButton />
        <MonoText style={layout.fill} size={fontSize.base} color={theme.text}>
          {item.atomName}
        </MonoText>
      </View>

      {/* The value pane: the newest row this session recorded, in a live session and
          a past one alike. Every row carries the whole value, so the newest one is the
          atom's value — current while the session runs, and the last it was seen
          holding once it has ended, which is all the header distinguishes. */}
      <View style={layout.fill}>
        <View style={styles.header}>
          <SectionHeader
            title={archived ? strings.lastValue : strings.currentValue}
          />
        </View>
        <NewestValue
          newest={paged.rows[0] as JotaiEvent | undefined}
          atomId={item.atomId}
          archived={archived}
        />
      </View>

      {/* History — sibling FlatLists rather than nested, so neither trips the
          VirtualizedList-nesting warning. */}
      <View style={s.block}>
        <View style={styles.header}>
          <SectionHeader title={strings.history} />
        </View>
        <PagedList<JotaiEvent>
          paged={paged}
          renderItem={renderItem}
          emptyMessage={strings.noEvents}
        />
      </View>
    </View>
  );
}

/**
 * The newest value this session recorded — its heavy column fetched on open.
 *
 * Split in two so the body can call `useEventWithDetail` unconditionally: there is
 * nothing to fetch until a row exists, and a hook cannot be skipped.
 *
 * **With no row, the atom itself answers.** Clearing the tab deletes the rows, and
 * the newest of them was what this pane rendered — but the button empties the log,
 * not the app's state, and the atom still holds what it held. Reading it here keeps
 * the pane honest without putting a row back in a history the reader just emptied.
 * Archived sessions never take this path; see `ZustandDetail` for the whole
 * argument, which is the same one.
 */
function NewestValue({
  newest,
  atomId,
  archived,
}: {
  newest: JotaiEvent | undefined;
  atomId: string;
  archived: boolean;
}): React.ReactNode {
  const { strings } = useBesouroUI();
  if (!newest) {
    const live = archived ? null : readLiveState(atomId);
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
    <NewestValueBody summary={newest} atomId={atomId} archived={archived} />
  );
}

function NewestValueBody({
  summary,
  atomId,
  archived,
}: {
  summary: JotaiEvent;
  atomId: string;
  archived: boolean;
}): React.ReactNode {
  const { strings } = useBesouroUI();
  // `keepPrevious`: every value change is a new row, so this pane's id moves on
  // its own rather than because the reader picked something. Clearing between
  // rows would tear the viewer down and rebuild it on every change.
  const { event, loadingDetail } = useEventWithDetail<JotaiEvent>(
    'jotai',
    summary,
    { keepPrevious: true }
  );
  // Keyed off the loaded row, not the summary: the summary moves as soon as the
  // change is recorded, but the document the flash tints is the one being read.
  // Keying it here fires the tint on the render that swaps the value in.
  //
  // `rootWhenNoKeys` is what makes this work for the atoms Zustand never
  // produces. `atom(0)` reports no changed keys — there are none to report — and
  // a keys-only flash would leave the one thing that did change untinted, which
  // is the whole document here.
  const flash = useRowChangeFlash({
    scope: atomId,
    row: event,
    archived,
    rootWhenNoKeys: true,
  });
  if (loadingDetail) {
    return <DetailLoading />;
  }
  // Top pane of a split view — no bottom inset; the History list below carries it.
  return event.value ? (
    <JsonViewer
      raw={event.value}
      truncated={event.valueTruncated}
      insetBottom={false}
      flash={flash}
    />
  ) : (
    <EmptyState message={strings.noValue} />
  );
}

/**
 * `summary` is the history row: preview and changed keys, but not the value —
 * a heavy column fetched only when this view opens.
 */
function ChangeDetail({ summary }: { summary: JotaiEvent }): React.ReactNode {
  const s = useStyles();
  const { theme, strings } = useBesouroUI();
  const { event, loadingDetail } = useEventWithDetail<JotaiEvent>(
    'jotai',
    summary
  );
  return (
    <View style={layout.fill}>
      <View style={s.row}>
        <BackButton />
        <MonoText style={layout.fill} size={fontSize.base} color={theme.text}>
          {event.atomName}
        </MonoText>
        <BaselinePill isInitial={event.isInitial} isReload={event.isReload} />
        <DetailTimestamp timestamp={event.timestamp} />
      </View>
      {event.changedKeys.length > 0 ? (
        <View style={styles.keys}>
          <Text style={s.label}>{strings.changedKeys.toUpperCase()}</Text>
          {event.changedKeys.map((changedKey) => (
            <MonoText key={changedKey} size={fontSize.body} color={theme.text}>
              {changedKey}
            </MonoText>
          ))}
        </View>
      ) : null}
      {loadingDetail ? (
        <DetailLoading />
      ) : event.value ? (
        <JsonViewer raw={event.value} truncated={event.valueTruncated} />
      ) : (
        <EmptyState message={strings.noValue} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: space.lg,
  },
  keys: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
  },
});

/** Theme-derived styles for this module, memoized per theme/font. */
function useStyles() {
  const { theme, font } = useBesouroUI();
  return useMemo(
    () =>
      StyleSheet.create({
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
        label: {
          color: theme.textMuted,
          fontSize: font(fontSize.caption),
          fontWeight: fontWeight.bold,
          width: '100%',
          marginBottom: 2,
        },
      }),
    [theme, font]
  );
}
