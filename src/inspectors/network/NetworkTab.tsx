/**
 * Network tab — single-line request rows (status badge · method · URL · duration)
 * with a list-level URL ellipsis-mode toggle, and a detail view with four sub-tabs
 * (Response, Response Headers, Request, Request Headers) and copy-as-cURL (§6.1).
 */

import { useCallback, useMemo } from 'react';
import { usePersistedState } from '../../core/persisted-state';
import { useEphemeralState } from '../../core/ephemeral-state';
import { View, type ListRenderItem } from 'react-native';
import { useSessionEvents, useBesouroUI } from '../../shared/context';
import type { NetworkEvent } from '../../core/types';

import { space } from '../../theme/tokens';

import { TabHeader } from '../../shared/components/TabHeader';
import { PagedList } from '../../shared/components/PagedList';
import { useSearchQuery } from '../../shared/hooks/search-query';
import { useDetailEntrance } from '../../shared/hooks/detail-slide';

import { type UrlMode } from './format';
import { DetailOverlay } from '../../shared/components/DetailOverlay';

import { UrlModeToggle } from './components/UrlModeToggle';
import { NetworkDetail } from './NetworkDetail';
import { NetworkRow } from './components/NetworkRow';
import { layout } from '../../shared/styles';
import { StyleSheet } from 'react-native';

export function NetworkTab(): React.ReactNode {
  const s = useStyles();
  const { strings } = useBesouroUI();
  const [query, setQuery] = useSearchQuery();
  // Filtering runs in SQL, so results span the whole session rather than only
  // the pages loaded so far.
  const paged = useSessionEvents('network', { search: query });
  const [urlMode, setUrlMode] = usePersistedState<UrlMode>(
    'network.urlMode',
    'path'
  );
  const [selectedId, setSelectedId] = useEphemeralState<string | null>(
    'network.selectedId',
    null
  );

  const selected = useMemo(
    () =>
      (paged.rows as NetworkEvent[]).find((event) => event.id === selectedId) ??
      null,
    [paged.rows, selectedId]
  );

  const renderItem = useCallback<ListRenderItem<NetworkEvent>>(
    ({ item }) => (
      <NetworkRow event={item} urlMode={urlMode} onSelect={setSelectedId} />
    ),
    [urlMode, setSelectedId]
  );
  const closeDetail = useCallback(() => setSelectedId(null), [setSelectedId]);
  const animateDetail = useDetailEntrance(selectedId);

  return (
    <View style={layout.fill}>
      {selected ? (
        <DetailOverlay onClose={closeDetail} animateIn={animateDetail}>
          <NetworkDetail summary={selected} />
        </DetailOverlay>
      ) : null}
      <TabHeader kind="network" query={query} onQueryChange={setQuery} />
      <View style={s.row}>
        <UrlModeToggle value={urlMode} onChange={setUrlMode} />
      </View>
      <PagedList<NetworkEvent>
        paged={paged}
        renderItem={renderItem}
        searching={Boolean(query)}
        emptyMessage={strings.noRequests}
        noResultsMessage={strings.noResults}
      />
    </View>
  );
}

/** Bottom-border tabs matching the main inspector tab bar. */

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
          paddingHorizontal: space.lg,
          paddingVertical: space.sm,
          backgroundColor: theme.surface,
        },
      }),
    [theme]
  );
}
