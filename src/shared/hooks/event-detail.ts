/**
 * Fetch one event in full, for a detail view.
 *
 * List rows carry only summary columns — bodies, headers, payloads and base64
 * image previews are left in the events precisely so that scrolling a thousand
 * requests costs nothing. A detail view is the one place those are wanted, and it
 * shows exactly one row at a time, so fetching on open is both cheap and the whole
 * reason the lists are cheap.
 *
 * The summary the caller already has renders immediately; only the heavy sections
 * wait on this.
 */

import { useEffect, useState } from 'react';
import type { BesouroEvent, InspectorKind } from '../../core/types';
import { useEventRepository } from '../context/database';

export interface EventDetail<Event extends BesouroEvent> {
  /** The full row, or null until it arrives (or if it could not be read). */
  event: Event | null;
  loading: boolean;
}

/** How a detail fetch should behave; both are opt-in and rarely needed. */
export interface EventDetailOptions {
  /**
   * A cue to re-read the same id on. For the few rows that are *patched in place*
   * rather than appended to — an MMKV instance's snapshot row is one row per
   * session, rewritten as writes land, so its id never changes and nothing else
   * here would ever ask for it again. Pass a value that moves with the row (its
   * timestamp, or a count of the patches that have landed).
   */
  revision?: number;
  /**
   * Keep the loaded row on screen when the *id* changes, replacing it only once
   * the new one has been read.
   *
   * For a pane that follows a moving target rather than showing one row the
   * reader picked: the Zustand and Jotai state panes render whichever row is
   * newest, so every state change is a new id, and clearing between them tears
   * the document down and rebuilds it — a blank frame and a spinner on every
   * change, with the viewer's collapse state and scroll position going with it.
   *
   * Only safe where the view renders the heavy columns *alone*. The default
   * exists because a detail view also renders summary fields, and showing one
   * row's body under another's headline is worse than showing a spinner. A failed
   * read leaves the previous row up rather than blanking, which is the same
   * trade.
   */
  keepPrevious?: boolean;
}

/**
 * The full row for `id`, including heavy columns.
 *
 * Falls back to `null` with `loading: false` when persistence is inactive — the
 * caller still has the summary, so a detail view degrades to showing what a list
 * row knows rather than breaking.
 */
export function useEventDetail<Event extends BesouroEvent>(
  kind: InspectorKind,
  id: string | null,
  { revision, keepPrevious = false }: EventDetailOptions = {}
): EventDetail<Event> {
  const eventRepository = useEventRepository();
  const [event, setEvent] = useState<Event | null>(null);
  const [loading, setLoading] = useState(false);

  // Discarding the loaded row is tied to the *id* changing, not to the fetch below.
  // A `revision` refetch is the same row read again, so what is on screen stays
  // until the newer copy lands and the refresh is invisible; a different id must
  // clear first, or a detail view paints one event's heavy columns under another's
  // summary. Adjusted during render, so that never happens for even one frame.
  // `keepPrevious` opts out — see the option.
  const [lastId, setLastId] = useState(id);
  if (lastId !== id) {
    setLastId(id);
    if (!keepPrevious) {
      setEvent(null);
    }
  }

  useEffect(() => {
    if (!eventRepository || !id) {
      setEvent(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    void eventRepository
      .load(kind, id)
      .then((loaded) => {
        if (cancelled) return;
        setEvent((loaded as Event | null) ?? null);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [eventRepository, kind, id, revision]);

  return { event, loading };
}

/**
 * The full row when it has loaded, otherwise the summary the list already had.
 *
 * Detail views read every field through this, so each one renders as soon as it
 * can: identity and status fields come from the summary immediately, and the
 * heavy ones fill in when the fetch resolves. Without it, every detail view would
 * need its own two-source branch on every field.
 *
 * `options` is passed through to {@link useEventDetail}.
 */
export function useEventWithDetail<Event extends BesouroEvent>(
  kind: InspectorKind,
  summary: Event,
  options?: EventDetailOptions
): { event: Event; loadingDetail: boolean } {
  const { event, loading } = useEventDetail<Event>(kind, summary.id, options);
  return {
    event: event ?? summary,
    // Only "loading" while there is genuinely more to come.
    loadingDetail: loading && event === null,
  };
}
