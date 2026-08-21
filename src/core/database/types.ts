/**
 * The storage layer's contracts: what can be asked of the database, and in what
 * shapes.
 *
 * Two repositories, reached through {@link Database} — {@link EventRepository}
 * for captured events, {@link SessionRepository} for the sessions they belong to.
 * `openDatabase()` in `./sqlite-database` is the only implementation; the queries
 * and pages below are the vocabulary they speak in.
 *
 * The contract is deliberately row-oriented rather than session-oriented: there is
 * no "load the session" call, because loading a session whole is the thing this
 * layer exists to avoid. Writes are deltas, reads are pages.
 *
 * These live here rather than in `core/types` because they only mean anything in
 * terms of a database. `core/types` holds the domain model every layer shares —
 * what an event is, what a session is — and this file consumes it.
 */

import type { BesouroEvent, InspectorKind, SessionMeta } from '../types';

/**
 * Position in a kind's newest-first ordering. Pagination is keyset, not offset:
 * rows arrive constantly while the user reads, and an offset would skip and repeat
 * rows as the table shifts underneath it. `id` breaks timestamp ties and matches
 * the ORDER BY exactly, which is all keyset requires.
 */
export interface EventCursor {
  timestamp: number;
  id: string;
}

export interface EventQuery {
  sessionId: string;
  kind: InspectorKind;
  /** Rows per page. */
  limit: number;
  /** Fetch rows strictly older than this position. Omit for the first page. */
  before?: EventCursor;
  /** Case-insensitive substring match over the kind's searchable columns. */
  search?: string;
  /**
   * Restrict to one group — a WebSocket/Socket.IO connection or a Zustand store.
   * Only meaningful for kinds whose manifest declares a `groupColumn`.
   */
  group?: string;
  /**
   * Equality filter on one of the kind's own columns, by event field name — the
   * notifications tab's local/remote origin filter, for example.
   *
   * It belongs in SQL rather than in the tab: filtering a loaded page in JS would
   * mean a page of 50 rows could render as 0, and "load more" would have to guess
   * how many pages to pull to fill a screen.
   */
  where?: { field: string; value: string };
}

export interface EventPage {
  /**
   * Summary rows, newest first. Heavy fields (bodies, headers, payloads, image
   * previews) are absent — fetch them per row with {@link EventRepository.load}.
   */
  rows: BesouroEvent[];
  hasMore: boolean;
  /** Position to pass as `before` for the next page; null at the end. */
  cursor: EventCursor | null;
}

/**
 * One connection / store, aggregated across the whole session — what the
 * WebSocket, Socket.IO and Zustand tabs list before drilling into frames.
 *
 * Computed in SQL rather than by grouping loaded events in JS, which is what keeps
 * those tabs bounded: a chatty socket can produce more frames than any other
 * inspector, and the connection list must not require holding them all.
 */
export interface EventGroup {
  /** Value of the kind's group column. */
  key: string;
  /** Rows in the group — matching {@link EventGroupQuery.search} when given. */
  count: number;
  /**
   * Rows in the group that count as a **change** — the number a list row shows.
   *
   * Not every row is one. A Zustand or Jotai baseline records where a store stood
   * when the inspector attached, or where a reload put it back; an MMKV snapshot is
   * the instance's contents rather than an event at all. Counting those means a list
   * reading "1 change" over a store nobody has touched. Equal to {@link count}
   * unless the query says which rows count, via {@link EventGroupQuery.countWhere}.
   */
  changeCount: number;
  firstAt: number;
  lastAt: number;
  /**
   * Newest row in the group, whatever its kind of frame. Carries the identifying
   * fields a connection row shows (url, label). Summary columns only.
   */
  newest: BesouroEvent | null;
  /**
   * Newest row restricted to {@link EventGroupQuery.latestWhere} — how the socket
   * tabs get the last *lifecycle* frame, which is what their
   * connected/disconnected status reads. Null when the group has no such row, or
   * when no `latestWhere` was given.
   */
  latest: BesouroEvent | null;
}

export interface EventGroupQuery {
  sessionId: string;
  kind: InspectorKind;
  /**
   * Restricts which row `latest` reports — *not* which rows are counted. Used by
   * the socket tabs to pick the newest `direction = 'lifecycle'` frame per
   * connection.
   */
  latestWhere?: { field: string; value: string };
  /**
   * Narrows which rows are counted, so searching shows the connections that
   * carried a matching frame (and how many) — deliberately not applied to
   * `latest`, since a connection's status is a fact about the connection, not
   * about the search.
   */
  search?: string;
  /**
   * Which rows are a change, for {@link EventGroup.changeCount} — an equality
   * filter on one of the kind's columns, by event field name. The store tabs pass
   * `isInitial: '0'` to leave their baselines out; MMKV passes `isFinal: '0'` to
   * leave its snapshot row out. Absent, every row counts.
   *
   * Narrows the *count* only. `count`, `firstAt`, `lastAt` and `newest` still see
   * the whole group — a baseline is when the store was last written to, even if it
   * is not a change to it.
   */
  countWhere?: { field: string; value: string };
}

export interface EventPatch {
  id: string;
  kind: InspectorKind;
  patch: Partial<BesouroEvent>;
}

/**
 * One transaction's worth of work. Inserts and updates travel together so a flush
 * is a single transaction and a single bridge crossing — that is what makes
 * persistence O(delta) instead of O(session).
 */
export interface EventBatch {
  inserts: BesouroEvent[];
  updates: EventPatch[];
}

/**
 * Sessions on disk. Everything the session lifecycle needs and nothing else — it
 * never touches an event.
 *
 * Methods carry no `Session` suffix: they are only ever reached through
 * {@link Database.sessions}, so the noun is already in the call —
 * `database.sessions.list()`.
 */
export interface SessionRepository {
  list(): Promise<SessionMeta[]>;
  /**
   * Write a session's metadata, creating the row if it is not there yet.
   *
   * Creating it **adopts the counters of any rows already on disk** for that id.
   * The writer maintains `event_count` by incrementing the session's row
   * ({@link EventRepository.commit}), and capture starts before the lifecycle has
   * written that row — so at startup the first flushes increment nothing. Their
   * rows are readable, and without this the session would under-report them
   * forever.
   */
  save(meta: SessionMeta): Promise<void>;
  delete(sessionId: string): Promise<void>;
  /**
   * Remove several sessions at once, rows and metadata, in one transaction — so a
   * bulk clear can't race itself the way concurrent single deletes would.
   */
  deleteMany(sessionIds: string[]): Promise<void>;
  /**
   * Move every captured row from one session id to another, and bring the
   * destination's counters back in line with what it then holds.
   *
   * For the warm-reload resume, which is the only thing that can change a
   * session's id after rows have been written under it: the app starts a fresh
   * session, captures its startup rows, and only then learns it should have
   * continued the previous one. Without this those rows keep an id no session row
   * carries, and nothing can read them again.
   */
  reassignEvents(fromSessionId: string, toSessionId: string): Promise<void>;
  /**
   * Delete captured rows that belong to no session in the table, except those of
   * `keepSessionId`.
   *
   * Nothing else can collect them: retention prunes whole sessions
   * (`core/session-lifecycle`) and deletes their rows by id, so rows whose session
   * row never existed are unreachable *and* permanent. `keepSessionId` is the live
   * session, whose rows legitimately precede its own metadata write.
   */
  deleteOrphanedEvents(keepSessionId: string): Promise<void>;
}

/**
 * Captured events on disk: the seven event tables behind one contract.
 *
 * Seven tables, one repository — because they share a row shape (`id`,
 * `session_id`, `timestamp`, plus the kind's own columns) and a single
 * manifest-driven code path (`database/rows.ts`). What varies between them is
 * data, not behavior, so splitting this per table would produce seven objects
 * that differ by one field and would fragment the batch below into seven
 * transactions.
 *
 * Both halves live here, and each consumer narrows to the half it needs at its
 * own call site: the drawer through `useEventRepository`, which hands back the
 * read half alone, and the event queue through {@link EventWrites}. A UI
 * component still cannot record an event — the hook is what enforces that.
 *
 * Methods carry no `Event` suffix, for the reason given on
 * {@link SessionRepository}: the noun is in the property —
 * `database.events.query(...)`.
 */
export interface EventRepository {
  /** One page of summary rows. */
  query(query: EventQuery): Promise<EventPage>;
  /** Per-connection / per-store aggregates for the grouped tabs. */
  groups(query: EventGroupQuery): Promise<EventGroup[]>;
  /** One event with its heavy columns, for a detail view. */
  load(kind: InspectorKind, id: string): Promise<BesouroEvent | null>;
  count(sessionId: string, kind: InspectorKind): Promise<number>;
  /**
   * Backs the per-tab Clear button. Decrements the session counter with it.
   *
   * Empties the kind's **log**. A kind that also keeps a state row — the MMKV
   * Store contents, the Redux state tree — keeps it: that row says what the app
   * holds now, not what it did, and clearing a log is not a claim on the app's
   * own storage. See `TableSpec.stateColumn`.
   */
  clear(sessionId: string, kind: InspectorKind): Promise<void>;

  /**
   * Apply one transaction of inserts and updates. The event queue is the only
   * caller.
   *
   * **Also updates the sessions table**, maintaining `event_count` and
   * `last_event_at` for the affected session. That reaches across the two
   * repositories on purpose: the counters have to move in the same transaction as
   * the rows they count, or a crash between them leaves a session claiming a total
   * it doesn't have. Both repositories close over the same {@link Database}
   * connection, so the reach costs nothing — it is one `batch`.
   *
   * A bump for a session with no row yet — every flush before the lifecycle's
   * first save — updates nothing and is silently dropped. That is deliberate:
   * inventing the row here would resurrect sessions the resume path is about to
   * discard. {@link SessionRepository.save} adopts those rows' count instead.
   */
  commit(batch: EventBatch): Promise<void>;

  /**
   * {@link EventRepository.commit}, blocking until the transaction commits, and
   * returning whether it did instead of rejecting.
   *
   * Reserved for the crash path. A fatal error hands control to RN's exception
   * manager, which stops the app before any promise gets a turn — so the async
   * write of the very row the crash produced never runs. Returns false when the
   * database isn't open yet or the write failed, leaving the caller to fall back
   * to the async path.
   */
  commitSync(batch: EventBatch): boolean;
}

/**
 * The write half of {@link EventRepository} — the only slice the event queue is
 * handed, so it cannot read a row or reach a session even by accident.
 */
export type EventWrites = Pick<EventRepository, 'commit' | 'commitSync'>;

/**
 * Both repositories over one database — which is what makes a write that spans
 * them a single transaction. One implementation: `openDatabase()`.
 *
 * They hang off this object rather than being flattened into it, so a call site
 * reaches for the half it needs (`database.events`, `database.sessions`) instead
 * of being handed all eleven methods and trusted to use five. That is also what
 * lets the methods drop their noun suffixes — `sessions.list()` cannot be
 * confused with `events.query()` when neither shares an object.
 */
export interface Database {
  /** Reading, clearing and committing captured events. */
  events: EventRepository;
  /** Session metadata: the lifecycle writes it, the history list reads it. */
  sessions: SessionRepository;

  /**
   * Resolves once the database is open and its schema is current. Every other
   * method awaits it internally, so callers only need it when ordering matters —
   * the warm-reload resume reads sessions before the lifecycle starts, and must
   * not race the open.
   */
  ready(): Promise<void>;
}
