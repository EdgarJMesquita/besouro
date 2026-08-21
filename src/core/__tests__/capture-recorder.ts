/**
 * Test double standing in for the event queue.
 *
 * Capture tests ask "did the interceptor produce the right event?", which is now a
 * question about what reaches the queue — nothing is held in JS, and reads come
 * from SQLite. Going through a real database here would test persistence a third
 * time (`sqlite-database.test.ts` and `event-queue.test.ts` already do) and make
 * every capture assertion async for no benefit.
 */

import { setEventSink } from '../capture/record';
import type { EventQueue } from '../capture/queue';
import type { BesouroEvent, InspectorKind } from '../types';

export interface CaptureRecorder {
  /** Captured events for a kind, oldest first — the order they were produced. */
  eventsOf<Event extends BesouroEvent>(kind: InspectorKind): Event[];
  /** Every captured event, oldest first. */
  all(): BesouroEvent[];
  reset(): void;
  /** (Re)install this recorder as the capture sink. Idempotent. */
  attach(): void;
  /**
   * Drop the sink, so captured events go nowhere — the state capture is in before
   * the database opens (see `core/capture/record`). The controller installs
   * inspectors inside that window, so an inspector whose first row is produced at
   * install has to survive it; this is how a test puts it there.
   */
  detach(): void;
}

/**
 * Attach a recorder as the capture sink for the duration of a test. Patches are
 * applied to the recorded event, so a completed network request reads as one event
 * in its final state — exactly what a row in the database would look like.
 */
export function recordCaptures(): CaptureRecorder {
  const events: BesouroEvent[] = [];
  const byId = new Map<string, BesouroEvent>();

  const queue = {
    add(event: BesouroEvent) {
      // Copy: interceptors reuse and mutate the object they handed over.
      const recorded = { ...event } as BesouroEvent;
      events.push(recorded);
      byId.set(event.id, recorded);
    },
    update(id: string, _kind: InspectorKind, patch: Partial<BesouroEvent>) {
      const existing = byId.get(id);
      if (existing) Object.assign(existing, patch);
    },
    flush: async () => {},
    // The recorder writes on `add`, so there is nothing left to drain — the sync
    // crash path succeeds here exactly as it does against a real database.
    flushSync: () => true,
    disable() {},
    isEnabled: () => true,
    pendingCount: () => 0,
  };

  const attach = () => setEventSink(queue as unknown as EventQueue);
  attach();

  return {
    attach,
    detach: () => setEventSink(null),
    eventsOf<Event extends BesouroEvent>(kind: InspectorKind): Event[] {
      return events.filter((event) => event.kind === kind) as Event[];
    },
    all: () => events,
    reset() {
      events.length = 0;
      byId.clear();
    },
  };
}
