/**
 * The list every event tab renders: a paged `FlatList` wired to
 * {@link PagedEvents}, with the empty and loading states each tab would otherwise
 * repeat.
 *
 * Two details matter and are easy to get wrong per-tab, which is why they live
 * here once:
 *
 * - **`maintainVisibleContentPosition`.** These lists are newest-first and *not*
 *   inverted, so live capture prepends at index 0. Without this, a burst of events
 *   shoves whatever the user is reading down the screen. A reader parked at the
 *   very top is the one case that wants the opposite — to follow the newest row
 *   as it arrives — which is what `autoscrollToTopThreshold` covers.
 * - **`onEndReached` guarding.** Fast scrolling fires it repeatedly; `loadMore`
 *   is idempotent while a page is in flight, and the footer spinner only shows
 *   when there is genuinely more to fetch.
 */

import { useMemo } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  View,
  type ListRenderItem,
} from 'react-native';
import type { BesouroEvent } from '../../core/types';
import type { PagedEvents } from '../hooks/paged-events';
import { EmptyState } from './EmptyState';
import { ListSeparator } from './ListSeparator';
import { useListBottomPadding } from '../hooks/safe-area';
import { useBesouroUI } from '../context';
import { space } from '../../theme/tokens';
import { layout } from '../styles';

export interface PagedListProps<Event extends BesouroEvent> {
  paged: PagedEvents;
  renderItem: ListRenderItem<Event>;
  /** Shown when the list is empty and no search is active. */
  emptyMessage: string;
  /** Shown when a search returned nothing. */
  noResultsMessage?: string;
  /** Whether a search is currently narrowing the list. */
  searching?: boolean;
  ItemSeparatorComponent?: React.ComponentType | null;
}

export function PagedList<Event extends BesouroEvent>({
  paged,
  renderItem,
  emptyMessage,
  noResultsMessage,
  searching = false,
  ItemSeparatorComponent = ListSeparator,
}: PagedListProps<Event>): React.ReactNode {
  const { theme } = useBesouroUI();
  const listBottomPadding = useListBottomPadding();
  const contentStyle = useMemo(
    () => ({ paddingBottom: listBottomPadding }),
    [listBottomPadding]
  );

  if (paged.rows.length === 0) {
    // The first load and a genuinely empty list look the same to the user
    // otherwise — a spinner is the honest answer until the query resolves.
    if (paged.loading) {
      return (
        <View style={[layout.fill, styles.centered]}>
          <ActivityIndicator color={theme.textFaint} />
        </View>
      );
    }
    return (
      <EmptyState
        message={searching ? (noResultsMessage ?? emptyMessage) : emptyMessage}
      />
    );
  }

  return (
    <FlatList
      data={paged.rows as Event[]}
      keyExtractor={keyExtractor}
      ItemSeparatorComponent={ItemSeparatorComponent ?? undefined}
      contentContainerStyle={contentStyle}
      renderItem={renderItem}
      onEndReached={paged.loadMore}
      onEndReachedThreshold={0.5}
      // Live rows prepend at index 0; keep the reader's position anchored.
      maintainVisibleContentPosition={MAINTAIN_POSITION}
      ListFooterComponent={
        paged.loadingMore ? (
          <View style={styles.footer}>
            <ActivityIndicator color={theme.textFaint} />
          </View>
        ) : undefined
      }
    />
  );
}

/**
 * How close to the top counts as "parked at the top", in points. Effectively zero
 * — just tolerant of subpixel offsets — so the list follows live capture only for
 * a reader who has not scrolled away, and never yanks one who has.
 *
 * Native compares the offset from *before* the prepend adjustment, which is the
 * reason this is a scroll-view prop rather than an `onScroll` handler here:
 * `minIndexForVisible` shifts the offset off zero as part of the same update, so
 * by the time a scroll event reached JS, "was I at the top" would already be lost.
 */
const AUTOSCROLL_THRESHOLD = 1;

const MAINTAIN_POSITION = {
  minIndexForVisible: 1,
  autoscrollToTopThreshold: AUTOSCROLL_THRESHOLD,
} as const;

function keyExtractor(event: BesouroEvent): string {
  return event.id;
}

const styles = StyleSheet.create({
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  footer: {
    paddingVertical: space.lg,
  },
});
