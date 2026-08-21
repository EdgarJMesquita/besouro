/**
 * The capture layer: everything between an inspector observing something and the
 * row reaching disk.
 *
 * Three parts, and the split is by *who decides what*:
 *
 * - `./record` — the fan-in. Seven inspectors hand events here; it holds nothing
 *   and knows nothing about batching or SQL.
 * - `./queue` — **when** and **in what shape** writes happen: batching,
 *   coalescing, retrying, giving up.
 * - {@link startCapture} — the wiring, so nobody outside has to know the other
 *   two exist.
 *
 * The layer's only dependency on storage is {@link EventWrites}, the write half
 * of one repository. It cannot read a row or reach a session.
 */

import { setEventSink } from './record';
import { EventQueue } from './queue';
import { markWritten } from '../inspector-revisions';
import { setDatabaseStatus } from '../database/status';
import type { EventWrites } from '../database/types';

export {
  captureEvent,
  captureEventSync,
  flushCapturedSync,
  patchEvent,
  isCapturing,
  whenCapturing,
  createEventId,
} from './record';

/** How many flush passes {@link CaptureHandle.drain} will make before giving up. */
const MAX_DRAIN_PASSES = 3;

/**
 * A running capture pipeline. Deliberately not the queue itself: a caller may
 * drain it, and may stop it, and has no business doing anything else with it.
 */
export interface CaptureHandle {
  /** Write everything pending now — the session lifecycle's only use for this. */
  flush(): Promise<void>;
  /**
   * Write until nothing is pending, for a caller that is about to *touch* the
   * rows it captured rather than just persist them — the warm-reload re-key,
   * which rewrites the session id of everything already on disk.
   *
   * `flush()` is not enough there: it joins a write already in flight rather
   * than starting one, so rows captured after that write began stay in the queue
   * and would land under the id the re-key has just retired.
   */
  drain(): Promise<void>;
  /**
   * Stop capturing and release what is queued. For the one case where the
   * database never opened: without it the queue would fill forever with rows
   * that can never land.
   */
  stop(): void;
}

/**
 * Point capture at a database and start writing.
 *
 * Called before the database has finished opening, on purpose: interception is
 * installed synchronously during `init()`, so startup logs and API calls are
 * already being captured and need somewhere to go. The queue holds them and the
 * repository's `ready()` gate delays the write until the schema is up.
 *
 * Also wires the two things a write has to report: which kinds now have readable
 * rows (so lists re-query), and that persistence gave up (so the drawer can say
 * so instead of silently dropping events).
 */
export function startCapture(eventRepository: EventWrites): CaptureHandle {
  const queue = new EventQueue({
    eventRepository,
    // Rows are readable now — this is what tells the drawer to re-query.
    onFlushed: markWritten,
    // Writes failed until the queue gave up. What was captured before that is
    // still on disk, so the drawer keeps showing it — with a warning.
    onDisabled: () => setDatabaseStatus({ state: 'write-failed' }),
  });
  setEventSink(queue);

  return {
    flush: () => queue.flush(),

    drain: async () => {
      // Bounded rather than "until empty": a failing write puts its rows back,
      // so an unbounded loop would spin until the queue disabled itself. Each
      // pass writes everything captured up to that point, so the second pass
      // covers what the first was already in flight for — which is the case
      // this exists for. Anything still pending after that is a queue that is
      // failing to write at all, and the caller's fallback is the same as
      // everywhere else: proceed without it.
      for (let pass = 0; pass < MAX_DRAIN_PASSES; pass += 1) {
        await queue.flush();
        if (queue.pendingCount() === 0) return;
      }
    },

    stop: () => {
      queue.disable();
      setEventSink(null);
    },
  };
}
