/**
 * The queue between capture and the database.
 *
 * Interceptors capture on the JS thread and must never wait for a disk write, so
 * events land in a pending queue here and are drained on a short timer as **one
 * transaction and one bridge crossing**. That is what makes persistence O(delta)
 * instead of O(session): a flush writes what changed since the last one, not the
 * whole session.
 *
 * It sits in `core/` rather than `core/database/` because it is not storage: it
 * writes nothing itself — `eventRepository.commit` does, and *where* that lands is
 * the database's business. What this owns is **when**, and **in what shape**:
 * batching, coalescing patches by id, retrying, and giving up. It depends on the
 * database only through {@link EventWrites}, the write half of one repository.
 *
 * Three failure modes shape the design, all of them about not losing data the live
 * drawer is already showing:
 *
 * 1. **Capture starts before the database is open.** Interception is installed
 *    synchronously inside `init()`, while opening the database is a bridge round
 *    trip — so the first startup logs and API calls are captured with nowhere to
 *    put them yet. The database's `ready()` gate makes a write issued in that window
 *    queue rather than fail, and the backlog drains once it resolves.
 * 2. **A flush fails.** Rows go back to the *front* of the queue and are retried on
 *    the next tick, so a transient error costs latency rather than data.
 * 3. **Persistence is permanently broken** (disk full, corrupt file). After
 *    {@link MAX_CONSECUTIVE_FAILURES} failed flushes the queue disables itself and
 *    releases what it holds. Events captured from then on are dropped, exactly as
 *    when the database never opened. This is what bounds the queue: events are
 *    deliberately never capped, so an ever-growing backlog would otherwise be the
 *    one way this layer could consume memory without limit.
 */

import type { BesouroEvent, InspectorKind } from '../types';
import type { EventPatch, EventWrites } from '../database/types';

/**
 * Flush cadence. Long enough to batch a burst of captures into one transaction,
 * short enough that a crash loses at most this much.
 */
const DEFAULT_FLUSH_INTERVAL_MS = 250;

/** Flush immediately once this many rows are pending, regardless of the timer. */
const DEFAULT_MAX_PENDING = 200;

/** Consecutive failed flushes before persistence disables itself. */
export const MAX_CONSECUTIVE_FAILURES = 5;

/**
 * Timers via `globalThis`, avoiding a hard dependency on DOM/Node lib types that
 * the declaration build doesn't load. React Native's `setTimeout` returns a
 * numeric handle.
 */
const timers = globalThis as unknown as {
  setTimeout(handler: () => void, timeout: number): number;
  clearTimeout(handle: number): void;
};

/**
 * Merge two patches for the same event, newest last.
 *
 * Both describe the same row — they are keyed by event id — so they are the same
 * kind by construction. TypeScript can't see that: `Partial<BesouroEvent>`
 * is a union of per-kind partials, and spreading two members produces a
 * cross-kind mix it rightly rejects. The cast asserts what the shared id already
 * guarantees.
 */
function mergePatches(
  base: Partial<BesouroEvent>,
  next: Partial<BesouroEvent>
): Partial<BesouroEvent> {
  return {
    ...(base as Record<string, unknown>),
    ...(next as Record<string, unknown>),
  } as Partial<BesouroEvent>;
}

export interface EventQueueOptions {
  /**
   * The event repository, narrowed to its write half: the queue cannot read a
   * row, and cannot reach a session, even by accident.
   */
  eventRepository: EventWrites;
  flushIntervalMs?: number;
  maxPending?: number;
  /** Called once if the queue gives up, so callers can report degraded state. */
  onDisabled?: () => void;
  /**
   * Called after rows for these kinds have landed in the database.
   *
   * This is the drawer's cue to re-query — deliberately *after* the write rather
   * than at capture time, so a list can never be told to refresh for a row that
   * isn't readable yet. It also means the flush cadence is the refresh cadence,
   * so no separate throttle is needed on the read side.
   */
  onFlushed?: (kinds: Set<InspectorKind>) => void;
}

export class EventQueue {
  private readonly eventRepository: EventWrites;
  private readonly flushIntervalMs: number;
  private readonly maxPending: number;
  private readonly onDisabled?: () => void;
  private readonly onFlushed?: (kinds: Set<InspectorKind>) => void;

  private pendingInserts: BesouroEvent[] = [];
  /**
   * Pending updates keyed by event id so repeated patches to the same row collapse
   * into one UPDATE. A network request is patched three or four times as it
   * completes (status, then sizes, then the image preview); without this, each
   * would be its own statement.
   */
  private pendingUpdates = new Map<string, EventPatch>();

  private flushTimer: number | null = null;
  private inFlightFlush: Promise<void> | null = null;
  private consecutiveFailures = 0;
  private disabled = false;

  constructor(options: EventQueueOptions) {
    this.eventRepository = options.eventRepository;
    this.flushIntervalMs = options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
    this.maxPending = options.maxPending ?? DEFAULT_MAX_PENDING;
    this.onDisabled = options.onDisabled;
    this.onFlushed = options.onFlushed;
  }

  /** Whether the queue is still accepting events. */
  isEnabled(): boolean {
    return !this.disabled;
  }

  /** Rows waiting to be written — what `drain()` watches, plus tests. */
  pendingCount(): number {
    return this.pendingInserts.length + this.pendingUpdates.size;
  }

  /** Queue a newly captured event. */
  add(event: BesouroEvent): void {
    if (this.disabled) return;
    this.pendingInserts.push(event);
    this.schedule();
  }

  /**
   * Queue a patch to an already-captured event.
   *
   * When the row is still an unflushed insert, the patch is merged into it
   * directly — the row has never reached disk, so inserting its final shape is
   * both correct and cheaper than INSERT-then-UPDATE.
   */
  update(id: string, kind: InspectorKind, patch: Partial<BesouroEvent>): void {
    if (this.disabled) return;

    const pendingInsert = this.pendingInserts.find((event) => event.id === id);
    if (pendingInsert) {
      Object.assign(pendingInsert, patch);
      this.schedule();
      return;
    }

    const existing = this.pendingUpdates.get(id);
    if (existing) {
      existing.patch = mergePatches(existing.patch, patch);
    } else {
      this.pendingUpdates.set(id, { id, kind, patch: { ...patch } });
    }
    this.schedule();
  }

  /**
   * Write everything pending now. Safe to call at any time, including before the
   * database is open — the database's `ready()` gate holds the write until it is.
   *
   * Concurrent calls share the in-flight flush rather than racing it, so an
   * AppState change landing mid-flush can't interleave two transactions.
   */
  async flush(): Promise<void> {
    if (this.disabled) return;
    if (this.inFlightFlush) return this.inFlightFlush;
    if (this.pendingCount() === 0) return;

    this.clearTimer();

    const inserts = this.pendingInserts;
    const updates = [...this.pendingUpdates.values()];
    this.pendingInserts = [];
    this.pendingUpdates = new Map();

    this.inFlightFlush = this.write(inserts, updates).finally(() => {
      this.inFlightFlush = null;
      // Anything captured while that write was in flight — including rows a failed
      // write put back — needs a timer of its own. A concurrent `flush()` call
      // joins the in-flight promise instead of queueing another pass, and the
      // timer that would have covered it has already fired, so without this the
      // queue can sit unwritten until the next capture happens to reschedule it.
      // Deliberately after `inFlightFlush = null`, so `schedule` sees an idle queue.
      if (this.pendingCount() > 0) this.schedule();
    });
    return this.inFlightFlush;
  }

  /**
   * Write everything pending **before returning** — the crash path's flush.
   *
   * `flush()` is unusable there: a fatal error hands control to RN's exception
   * manager, which stops the app before the promise chain gets another turn, so
   * the row describing the crash (and every log leading up to it, still sitting in
   * this queue) is lost. Blocking the JS thread on a SQLite commit is affordable
   * exactly once, when the app is about to stop running anyway.
   *
   * Rows go back to the front of the queue on failure, as in {@link write}, so a
   * caller can still fall back to `flush()` on the chance the process survives —
   * `isFatal` is false more often than the name suggests. Failures do **not**
   * count toward {@link MAX_CONSECUTIVE_FAILURES}: this path fails for reasons the
   * async one doesn't share (the database not being open yet, the sync bridge
   * being unavailable), and disabling persistence over them would be wrong.
   *
   * Returns whether everything pending was written.
   */
  flushSync(): boolean {
    if (this.disabled) return false;
    if (this.pendingCount() === 0) return true;

    // An in-flight async flush already owns its rows and cannot be joined from
    // here; they are lost if the process dies first. Nothing can be done about
    // that, and it is a strictly smaller window than losing everything.
    this.clearTimer();

    const inserts = this.pendingInserts;
    const updates = [...this.pendingUpdates.values()];
    this.pendingInserts = [];
    this.pendingUpdates = new Map();

    let written = false;
    try {
      written = this.eventRepository.commitSync({ inserts, updates });
    } catch {
      // The port is documented not to throw; treat a throw as a failed write
      // rather than letting it escape into the crash handler.
      written = false;
    }

    if (!written) {
      this.restore(inserts, updates);
      return false;
    }

    this.notifyFlushed(inserts, updates);
    return true;
  }

  /** Stop accepting events and release the queue. Idempotent. */
  disable(): void {
    if (this.disabled) return;
    this.disabled = true;
    this.clearTimer();
    this.pendingInserts = [];
    this.pendingUpdates = new Map();
    this.onDisabled?.();
  }

  private async write(
    inserts: BesouroEvent[],
    updates: EventPatch[]
  ): Promise<void> {
    try {
      await this.eventRepository.commit({ inserts, updates });
      this.consecutiveFailures = 0;
      this.notifyFlushed(inserts, updates);
    } catch {
      this.consecutiveFailures += 1;
      if (this.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        // Give up rather than grow the queue forever; capture keeps working.
        this.disable();
        return;
      }
      this.restore(inserts, updates);
      this.schedule();
    }
  }

  /**
   * Put rows a failed write never applied back at the *front* of the queue —
   * dropping them would silently lose data the drawer is already displaying.
   * Patches queued while that write was in flight are newer, so they win the
   * merge.
   */
  private restore(inserts: BesouroEvent[], updates: EventPatch[]): void {
    this.pendingInserts = [...inserts, ...this.pendingInserts];
    for (const update of updates) {
      const newer = this.pendingUpdates.get(update.id);
      this.pendingUpdates.set(
        update.id,
        newer
          ? { ...update, patch: mergePatches(update.patch, newer.patch) }
          : update
      );
    }
  }

  /** Tell the drawer which tabs have rows that are now readable. */
  private notifyFlushed(inserts: BesouroEvent[], updates: EventPatch[]): void {
    if (!this.onFlushed) return;
    const kinds = new Set<InspectorKind>();
    for (const event of inserts) kinds.add(event.kind);
    for (const update of updates) kinds.add(update.kind);
    this.onFlushed(kinds);
  }

  private schedule(): void {
    if (this.disabled) return;
    if (this.pendingCount() >= this.maxPending) {
      void this.flush();
      return;
    }
    if (this.flushTimer !== null) return;
    this.flushTimer = timers.setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, this.flushIntervalMs);
  }

  private clearTimer(): void {
    if (this.flushTimer !== null) {
      timers.clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }
}
