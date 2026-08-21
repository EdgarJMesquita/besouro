/**
 * Redux tab — a flat action log, and the store itself, as two full-width panes.
 *
 * The pane pair is MMKV's (`Operations | Store`): a log of what happened, beside the
 * thing it happened to. An action's *own* resulting state keeps the name `State`
 * inside `ReduxDetail` — that is one action's data, not the store, exactly as MMKV's
 * operation detail says `Value`.
 *
 * No store-list level, unlike the Zustand tab: the API takes exactly one store
 * (§6.9), so a list would be a single row standing between the user and everything
 * that matters. And no split pane either: a Redux state tree and a log that runs to
 * thousands of entries each need the whole screen, so halving both — as
 * `ZustandDetail` can afford to — would leave neither readable.
 *
 * Actions come from the drawer's active session (`useSessionEvents('redux')`); the
 * store's current state comes from the live registry (`useReduxSnapshot`), which is
 * not part of any session.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { StyleSheet, View, type ListRenderItem } from 'react-native';

import type { ReduxEvent } from '../../core/types';
import {
  useBesouroUI,
  useSessionEvents,
  useViewingSession,
} from '../../shared/context';
import { useEphemeralState } from '../../core/ephemeral-state';
import { useSearchQuery } from '../../shared/hooks/search-query';
import { safeStringify } from '../../core/serialize';
import { truncateToBytes } from '../../core/truncate';

import { DetailOverlay } from '../../shared/components/DetailOverlay';
import { EmptyState } from '../../shared/components/EmptyState';
import { JsonViewer } from '../../shared/components/JsonViewer';
import { DetailLoading } from '../../shared/components/DetailLoading';
import { PagedList } from '../../shared/components/PagedList';
import { SectionHeader } from '../../shared/components/SectionHeader';
import { DetailTabs } from '../../shared/components/DetailTabs';
import { TabHeader } from '../../shared/components/TabHeader';
import { useDetailEntrance } from '../../shared/hooks/detail-slide';
import { useEventWithDetail } from '../../shared/hooks/event-detail';
import { layout } from '../../shared/styles';
import { space } from '../../theme/tokens';

import { ActionRow } from './components/ActionRow';
import { ActionDetail } from './ReduxDetail';
import {
  getReduxFlashPlayed,
  markReduxFlashPlayed,
  useReduxSnapshot,
} from './store/snapshot';
import { MAX_STATE_BYTES } from './budgets';

const PANES = ['actions', 'store'] as const;
type Pane = (typeof PANES)[number];

export function ReduxTab(): React.ReactNode {
  const s = useStyles();
  const { strings } = useBesouroUI();
  const viewing = useViewingSession();
  const [pane, setPane] = useEphemeralState<Pane>('redux.pane', 'actions');
  const [query, setQuery] = useSearchQuery();
  const [selectedActionId, setSelectedActionId] = useEphemeralState<
    string | null
  >('redux.selectedActionId', null);

  // Filtering runs in SQL, so a search reaches the whole session rather than only
  // the pages loaded so far.
  //
  // The closing snapshot is excluded here rather than filtered out of the loaded
  // rows: it is not a dispatched action, the State pane is where it belongs, and
  // in a live session it would otherwise sit pinned to the top of the log —
  // re-timestamped every couple of seconds as it refreshes — under a label saying
  // the session had ended.
  const paged = useSessionEvents('redux', {
    search: query,
    where: { field: 'isFinal', value: '0' },
  });

  const labelFor = useCallback(
    (option: Pane) => (option === 'actions' ? strings.actions : strings.store),
    [strings]
  );

  const renderItem = useCallback<ListRenderItem<ReduxEvent>>(
    ({ item }) => <ActionRow event={item} onSelect={setSelectedActionId} />,
    [setSelectedActionId]
  );

  const selectedAction =
    (paged.rows.find((event) => event.id === selectedActionId) as
      ReduxEvent | undefined) ?? null;
  const closeDetail = useCallback(
    () => setSelectedActionId(null),
    [setSelectedActionId]
  );
  const animateDetail = useDetailEntrance(selectedActionId);

  return (
    <View style={layout.fill}>
      {selectedAction ? (
        <DetailOverlay onClose={closeDetail} animateIn={animateDetail}>
          <ActionDetail summary={selectedAction} />
        </DetailOverlay>
      ) : null}

      <View style={s.switcher}>
        <DetailTabs
          tabs={PANES}
          selected={pane}
          onSelect={setPane}
          labelFor={labelFor}
          fill
        />
      </View>

      {pane === 'actions' ? (
        <>
          <TabHeader kind="redux" query={query} onQueryChange={setQuery} />
          <PagedList<ReduxEvent>
            paged={paged}
            renderItem={renderItem}
            searching={Boolean(query)}
            emptyMessage={strings.noActions}
            noResultsMessage={strings.noResults}
          />
        </>
      ) : (
        <StorePane viewing={viewing !== null} />
      )}
    </View>
  );
}

/**
 * The store, from whichever source the open session has one.
 *
 * A live session reads the registry — the store as it is this instant. A past
 * session has no live store, and showing the *current* one under a header dated
 * last week is the mistake `BROWSER_INSPECTORS` exists to prevent; it reads the
 * session's closing snapshot row instead, which is the state that session actually
 * ended on (see §6.9). Split into two components so neither calls the other's
 * hooks.
 */
function StorePane({ viewing }: { viewing: boolean }): React.ReactNode {
  return viewing ? <ArchivedStorePane /> : <LiveStorePane />;
}

/**
 * The closing snapshot of a past session — most usefully, the state it crashed on.
 *
 * One row per session carries `isFinal`, so this is an equality filter rather than
 * a replay: reconstructing state at an *arbitrary* past action would mean folding
 * every row in order, which is a different feature.
 */
function ArchivedStorePane(): React.ReactNode {
  const { strings } = useBesouroUI();
  const paged = useSessionEvents('redux', {
    where: { field: 'isFinal', value: '1' },
  });
  const row = paged.rows[0] as ReduxEvent | undefined;
  if (!row) {
    return <EmptyState message={strings.noState} />;
  }
  return <ArchivedState summary={row} />;
}

function ArchivedState({ summary }: { summary: ReduxEvent }): React.ReactNode {
  const { strings } = useBesouroUI();
  // `changedState` is a heavy column, absent from the list row that found it.
  const { event, loadingDetail } = useEventWithDetail<ReduxEvent>(
    'redux',
    summary
  );
  if (loadingDetail) {
    return <DetailLoading />;
  }
  if (!event.changedState) {
    return <EmptyState message={strings.noState} />;
  }
  return (
    <View style={layout.fill}>
      {/* Says what this is: state frozen at session end, not the live store. */}
      <View style={styles.archivedHeader}>
        <SectionHeader title={strings.finalState} />
      </View>
      <JsonViewer
        raw={event.changedState}
        truncated={event.changedStateTruncated}
      />
    </View>
  );
}

/**
 * The store's current state, with the values that just changed flashing briefly.
 *
 * The registry hands over the state *object*; serializing it is deferred to here so
 * it happens once per change actually rendered rather than once per dispatch (see
 * `store/snapshot.ts`).
 */
function LiveStorePane(): React.ReactNode {
  const { strings } = useBesouroUI();
  const snapshot = useReduxSnapshot();

  const serialized = useMemo(() => {
    if (!snapshot) {
      return null;
    }
    return truncateToBytes(safeStringify(snapshot.state), MAX_STATE_BYTES);
  }, [snapshot]);

  // Read once, at mount: everything published before this pane opened has had
  // whatever flash it was going to get. Without this the pane replays the last
  // change every time the reader comes back from the Actions pane, which unmounts
  // it — see `markReduxFlashPlayed`.
  const playedBeforeMount = useRef(getReduxFlashPlayed()).current;

  const flash = useMemo(
    () =>
      snapshot &&
      snapshot.changedPaths.length > 0 &&
      snapshot.revision > playedBeforeMount
        ? {
            paths: new Set(snapshot.changedPaths),
            // The revision, not the path set: the same value changing twice in a
            // row must flash twice, and an unchanged set would look identical.
            nonce: snapshot.revision,
          }
        : undefined,
    [snapshot, playedBeforeMount]
  );

  // After the render that played it, so the next mount starts from here. Every
  // revision counts, not just the flashed ones: one that changed nothing has
  // nothing to replay either.
  useEffect(() => {
    if (snapshot) {
      markReduxFlashPlayed(snapshot.revision);
    }
  }, [snapshot]);

  if (!serialized) {
    return <EmptyState message={strings.noState} />;
  }
  return (
    <JsonViewer
      raw={serialized.text}
      truncated={serialized.truncated}
      flash={flash}
    />
  );
}

const styles = StyleSheet.create({
  archivedHeader: {
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
  },
});

/** Theme-derived styles for this module, memoized per theme. */
function useStyles() {
  const { theme } = useBesouroUI();
  return useMemo(
    () =>
      StyleSheet.create({
        switcher: {
          backgroundColor: theme.surface,
          borderBottomWidth: 1,
          borderBottomColor: theme.border,
        },
      }),
    [theme]
  );
}
