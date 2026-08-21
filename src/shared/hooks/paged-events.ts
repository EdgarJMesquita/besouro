/**
 * Paginated reads for the inspector tabs.
 *
 * A tab asks for one page at a time and loads more as the user scrolls, so the JS
 * heap holds what has been looked at rather than everything captured. Rows are
 * *summary* rows — bodies, headers, payloads and image previews stay in the
 * events until a detail view asks for one (`useEventDetail`).
 *
 * The events is the only source of truth, and this hook holds exactly one
 * statement of it: **every render's rows come from a single query, assigned whole.**
 * Nothing is concatenated, merged or reconciled in JS.
 *
 * That is why "load more" grows a window rather than fetching a page to append.
 * Appending would mean stitching two queries taken at different instants, and any
 * row the two disagree about is duplicated or dropped — the list is showing a
 * state the events was never in. Re-reading the whole window costs one indexed
 * query over summary columns, which is what `useInfiniteQuery` does on refetch and
 * is the price of having the events be the only thing that decides what the list
 * contains.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { BesouroEvent, InspectorKind } from '../../core/types';
import type { EventReader } from '../context/database';
import {
  useClearGeneration,
  useWriteRevision,
} from '../../core/inspector-revisions';

/** Rows per page. */
export const PAGE_SIZE = 50;

/** Debounce for the search box, so typing doesn't issue a query per keystroke. */
const SEARCH_DEBOUNCE_MS = 200;

export interface PagedEvents {
  /** Loaded rows, newest first. */
  rows: BesouroEvent[];
  /** True while the first page for the current query is in flight. */
  loading: boolean;
  /** True while an additional page is in flight. */
  loadingMore: boolean;
  hasMore: boolean;
  loadMore: () => void;
}

export interface PagedEventsOptions {
  eventRepository: EventReader | null;
  sessionId: string | null;
  kind: InspectorKind;
  search?: string;
  /** Restrict to one socket connection / zustand store. */
  group?: string;
  /** Equality filter on one of the kind's columns, by event field name. */
  where?: { field: string; value: string };
  /**
   * Whether this is the live session. A past session's rows never change, so it
   * ignores the capture signal and queries once.
   */
  live?: boolean;
}

export function usePagedEvents({
  eventRepository,
  sessionId,
  kind,
  search,
  group,
  where,
  live = true,
}: PagedEventsOptions): PagedEvents {
  const [rows, setRows] = useState<BesouroEvent[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const debouncedSearch = useDebounced(search ?? '', SEARCH_DEBOUNCE_MS);
  // `where` is an object literal at most call sites, so depending on it directly
  // would re-run the query every render. Carry its parts as primitives.
  const whereField = where?.field;
  const whereValue = where?.value;

  // Changes when a flush lands rows for this kind — see ./inspector-revisions. It is
  // already paced by the writer's flush cadence, so no throttle is needed here.
  const revision = useWriteRevision(kind);
  const clearGeneration = useClearGeneration(kind);
  const liveRevision = live ? revision : 0;

  /**
   * How many rows the list shows. `loadMore` grows it and the query re-runs, so
   * this is state rather than a ref — it is a query input like any other.
   */
  const [windowSize, setWindowSize] = useState(PAGE_SIZE);

  /** Guards against a slow query for a stale filter overwriting a newer one. */
  const requestRef = useRef(0);
  const loadingMoreRef = useRef(false);

  // A cleared kind, or a different query, invalidates the loaded window.
  const resetKey = [
    sessionId,
    kind,
    debouncedSearch,
    group ?? '',
    whereField ?? '',
    whereValue ?? '',
    clearGeneration,
  ].join('|');

  // Shrink back to one page when the query changes. Adjusting state during render
  // rather than in an effect so the query below never runs once with the previous
  // window — that would fetch, and briefly show, the wrong number of rows.
  const [lastResetKey, setLastResetKey] = useState(resetKey);
  if (lastResetKey !== resetKey) {
    setLastResetKey(resetKey);
    setWindowSize(PAGE_SIZE);
    loadingMoreRef.current = false;
  }

  useEffect(() => {
    if (!eventRepository || !sessionId) {
      setRows([]);
      setHasMore(false);
      return;
    }

    const request = ++requestRef.current;
    let cancelled = false;
    // Only spin when there is nothing on screen; a refresh driven by live capture
    // must not blank a list the user is reading.
    setLoading((current) => current || isEmptyRef.current);

    void eventRepository
      .query({
        sessionId,
        kind,
        limit: windowSize,
        search: debouncedSearch || undefined,
        group,
        where:
          whereField != null && whereValue != null
            ? { field: whereField, value: whereValue }
            : undefined,
      })
      .then((page) => {
        if (cancelled || request !== requestRef.current) return;
        // The whole visible list, from one query — never merged with the previous
        // one. This assignment is the reason a duplicate or missing row is not
        // expressible here.
        setRows(page.rows);
        setHasMore(page.hasMore);
        setLoading(false);
        loadingMoreRef.current = false;
        setLoadingMore(false);
      })
      .catch(() => {
        if (cancelled || request !== requestRef.current) return;
        setLoading(false);
        loadingMoreRef.current = false;
        setLoadingMore(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    eventRepository,
    sessionId,
    kind,
    debouncedSearch,
    group,
    whereField,
    whereValue,
    windowSize,
    resetKey,
    liveRevision,
  ]);

  // Tracks emptiness without putting `rows` in the effect's dependencies, which
  // would re-run the query every time its own result lands.
  const isEmptyRef = useRef(true);
  isEmptyRef.current = rows.length === 0;

  /**
   * Show one more page. This only widens the query — the effect above re-reads
   * the window and replaces the rows, so there is no second query to reconcile
   * and no cursor to keep in step with what is on screen.
   *
   * `onEndReached` fires repeatedly while scrolling; the ref makes the extra
   * calls no-ops until the widened query lands.
   */
  const loadMore = useCallback(() => {
    if (!hasMore || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    setWindowSize((size) => size + PAGE_SIZE);
  }, [hasMore]);

  return { rows, loading, loadingMore, hasMore, loadMore };
}

/** Value that only updates after it has stopped changing for `delayMs`. */
function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    if (value === debounced) return;
    const timers = globalThis as unknown as {
      setTimeout(handler: () => void, timeout: number): number;
      clearTimeout(handle: number): void;
    };
    const handle = timers.setTimeout(() => setDebounced(value), delayMs);
    return () => timers.clearTimeout(handle);
  }, [value, debounced, delayMs]);
  return debounced;
}
