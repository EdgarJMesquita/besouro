/**
 * Jotai tab — the watched atoms, then one atom's current value and history.
 *
 * Shaped like the Zustand tab rather than the Redux one: there genuinely are N
 * atoms, each a named thing with a value, so the list level earns its place (Redux
 * has exactly one store, which is why that tab has no list).
 *
 * Everything rendered here comes from the session's rows: the list, the previews, the
 * values and the history alike. A `jotai` row carries the whole serialized value, so
 * the newest row per atom *is* that atom's current value, and a live session and a
 * past one are read exactly the same way (see `utils/atom-list`).
 *
 * The registry (`useJotaiAtoms`) contributes one thing the rows cannot: an atom that
 * was subscribed but whose capture never landed, which would otherwise be invisible
 * rather than visibly empty.
 */

import { useCallback, useMemo } from 'react';
import { FlatList, View, type ListRenderItem } from 'react-native';

import { useBesouroUI, useViewingSession } from '../../shared/context';
import { useEventGroups } from '../../shared/hooks/event-groups';
import { useJotaiAtoms, type JotaiAtomInfo } from './store/atoms';
import type { JotaiAtomListItem } from './types-ui';
import { atomList } from './utils/atom-list';
import { valuePreview } from './utils/preview';
import { readLiveState } from '../../core/live-state';

import { EmptyState } from '../../shared/components/EmptyState';
import { ListSeparator } from '../../shared/components/ListSeparator';
import { TabHeader } from '../../shared/components/TabHeader';
import { DetailOverlay } from '../../shared/components/DetailOverlay';

import { useListBottomPadding } from '../../shared/hooks/safe-area';
import { useSearchQuery } from '../../shared/hooks/search-query';
import { useSearchFilter } from '../../shared/hooks/search-filter';
import { useDetailEntrance } from '../../shared/hooks/detail-slide';
import { useEphemeralState } from '../../core/ephemeral-state';

import { AtomRow } from './components/AtomRow';
import { AtomDetail } from './JotaiDetail';
import { layout } from '../../shared/styles';

/**
 * Fill in the value of any atom the rows cannot describe, by asking the atom.
 *
 * A row's `preview` is the value as of the newest row, which is where every listed
 * atom normally gets its second line. An atom with no rows has no such line — after
 * a Clear, or when its first `get` threw inside `safeCapture` — and the list would
 * show its name over a blank where every neighbour shows a value.
 *
 * The same source the detail pane falls back to (`core/live-state`), previewed by
 * the same rule the interceptor uses when it writes one, so a live line and a
 * recorded line are clipped identically. Live sessions only, for the reason the
 * detail pane has: a past session's atoms are not these atoms.
 */
function withLiveValues(
  items: JotaiAtomListItem[],
  viewing: boolean
): JotaiAtomListItem[] {
  if (viewing) {
    return items;
  }
  return items.map((item) => {
    if (item.preview) {
      return item;
    }
    const live = readLiveState(item.atomId);
    return live ? { ...item, preview: valuePreview(live.raw) } : item;
  });
}

export function JotaiTab(): React.ReactNode {
  const { strings } = useBesouroUI();
  const viewing = useViewingSession() !== null;
  const attached = useJotaiAtoms();
  const [query, setQuery] = useSearchQuery();
  const [selectedAtomId, setSelectedAtomId] = useEphemeralState<string | null>(
    'jotai.selectedAtomId',
    null
  );
  const listBottomPadding = useListBottomPadding();

  // The list, the counts and the search all come from one grouped query. Filtering in
  // SQL is what lets a search reach the atom's *value* — a heavy column the list never
  // selects — and it reaches the whole session rather than the rows in memory.
  // `countWhere` leaves the baselines out of the per-atom count: the row written
  // when the inspector subscribed (and the one a reload writes) records where the
  // atom stood, not a change to it.
  const { groups } = useEventGroups({
    kind: 'jotai',
    search: query,
    countWhere: { field: 'isInitial', value: '0' },
  });

  // The subscription fallback has no rows for SQL to search, so it matches on the one
  // thing it knows. A past session gets none of it: those atoms belong to this launch,
  // and listing them under a header dated weeks ago is the mistake
  // `BROWSER_INSPECTORS` exists to prevent.
  const atomNameOf = useCallback((info: JotaiAtomInfo) => [info.atomName], []);
  const matchedAttached = useSearchFilter(attached, query, atomNameOf);

  const items = useMemo<JotaiAtomListItem[]>(
    () =>
      withLiveValues(atomList(groups, viewing ? [] : matchedAttached), viewing),
    [groups, viewing, matchedAttached]
  );

  const selected = items.find((item) => item.atomId === selectedAtomId) ?? null;

  const keyExtractor = useCallback(
    (item: JotaiAtomListItem) => item.atomId,
    []
  );
  const renderItem = useCallback<ListRenderItem<JotaiAtomListItem>>(
    ({ item }) => <AtomRow item={item} onSelect={setSelectedAtomId} />,
    [setSelectedAtomId]
  );
  const listContentStyle = useMemo(
    () => ({ paddingBottom: listBottomPadding }),
    [listBottomPadding]
  );
  const closeDetail = useCallback(
    () => setSelectedAtomId(null),
    [setSelectedAtomId]
  );
  const animateDetail = useDetailEntrance(selectedAtomId);

  return (
    <View style={layout.fill}>
      {selected ? (
        <DetailOverlay onClose={closeDetail} animateIn={animateDetail}>
          <AtomDetail item={selected} archived={viewing} />
        </DetailOverlay>
      ) : null}
      <TabHeader kind="jotai" query={query} onQueryChange={setQuery} />
      {items.length === 0 ? (
        <EmptyState message={query ? strings.noResults : strings.noAtoms} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={keyExtractor}
          ItemSeparatorComponent={ListSeparator}
          contentContainerStyle={listContentStyle}
          renderItem={renderItem}
        />
      )}
    </View>
  );
}
