/**
 * Zustand tab — lists the stores, then a store detail with two stacked sections:
 * "Current State" (the newest state recorded for it, via the §7.1 viewer) on top, and
 * "History" (the recorded transitions) beneath it. Tapping a history entry shows that
 * transition's changed keys and resulting state.
 *
 * Everything rendered here comes from the session's rows: the list, the counts, the
 * state and the history alike. A `zustand` row carries the whole serialized state, so
 * the newest row per store *is* that store's current state, and a live session and a
 * past one are read exactly the same way (see `utils/store-list`).
 *
 * The registry (`useZustandStores`) contributes one thing the rows cannot: a store
 * that attached but whose capture never landed, which would otherwise be invisible
 * rather than visibly empty.
 */

import { useCallback, useMemo } from 'react';
import { FlatList, View, type ListRenderItem } from 'react-native';
import { useBesouroUI, useViewingSession } from '../../shared/context';
import { useEventGroups } from '../../shared/hooks/event-groups';
import { useZustandStores, type ZustandStoreInfo } from './store/stores';
import type { ZustandStoreListItem } from './types-ui';
import { storeList } from './utils/store-list';

import { EmptyState } from '../../shared/components/EmptyState';
import { ListSeparator } from '../../shared/components/ListSeparator';

import { useListBottomPadding } from '../../shared/hooks/safe-area';

import { TabHeader } from '../../shared/components/TabHeader';
import { useSearchQuery } from '../../shared/hooks/search-query';
import { useSearchFilter } from '../../shared/hooks/search-filter';
import { useDetailEntrance } from '../../shared/hooks/detail-slide';

import { DetailOverlay } from '../../shared/components/DetailOverlay';
import { useEphemeralState } from '../../core/ephemeral-state';
import { StoreRow } from './components/StoreRow';
import { StoreDetail } from './ZustandDetail';
import { layout } from '../../shared/styles';

export function ZustandTab(): React.ReactNode {
  const { strings } = useBesouroUI();
  const viewing = useViewingSession() !== null;
  const attached = useZustandStores();
  const [query, setQuery] = useSearchQuery();
  const [selectedStoreId, setSelectedStoreId] = useEphemeralState<
    string | null
  >('zustand.selectedStoreId', null);
  const listBottomPadding = useListBottomPadding();

  // The list, the counts and the search all come from one grouped query. Filtering
  // in SQL is what lets a search reach the store's *state* — a heavy column the list
  // never selects — and it reaches the whole session rather than the rows in memory.
  // `countWhere` leaves the baselines out of the per-store count: the row written
  // when the inspector subscribed (and the one a reload writes) records where the
  // store stood, not a change to it.
  const { groups } = useEventGroups({
    kind: 'zustand',
    search: query,
    countWhere: { field: 'isInitial', value: '0' },
  });

  // The attachment fallback has no rows for SQL to search, so it matches on the one
  // thing it knows. A past session gets none of it: those stores belong to this
  // launch, and listing them under a header dated weeks ago is the mistake
  // `BROWSER_INSPECTORS` exists to prevent.
  const storeNameOf = useCallback(
    (info: ZustandStoreInfo) => [info.storeName],
    []
  );
  const matchedAttached = useSearchFilter(attached, query, storeNameOf);

  const items = useMemo<ZustandStoreListItem[]>(
    () => storeList(groups, viewing ? [] : matchedAttached),
    [groups, viewing, matchedAttached]
  );

  const selected =
    items.find((item) => item.storeId === selectedStoreId) ?? null;

  const keyExtractor = useCallback(
    (item: ZustandStoreListItem) => item.storeId,
    []
  );
  const renderItem = useCallback<ListRenderItem<ZustandStoreListItem>>(
    ({ item }) => <StoreRow item={item} onSelect={setSelectedStoreId} />,
    [setSelectedStoreId]
  );
  const listContentStyle = useMemo(
    () => ({ paddingBottom: listBottomPadding }),
    [listBottomPadding]
  );
  const closeDetail = useCallback(
    () => setSelectedStoreId(null),
    [setSelectedStoreId]
  );
  const animateDetail = useDetailEntrance(selectedStoreId);

  return (
    <View style={layout.fill}>
      {selected ? (
        <DetailOverlay onClose={closeDetail} animateIn={animateDetail}>
          <StoreDetail item={selected} archived={viewing} />
        </DetailOverlay>
      ) : null}
      <TabHeader kind="zustand" query={query} onQueryChange={setQuery} />
      {items.length === 0 ? (
        <EmptyState message={query ? strings.noResults : strings.noStores} />
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
