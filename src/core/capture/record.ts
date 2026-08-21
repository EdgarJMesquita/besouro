/**
 * The fan-in — where every inspector hands off what it observed.
 *
 * **SQLite is the only source of truth for captured events** (see
 * `../database`). Nothing is held here: {@link captureEvent} passes the event
 * straight to the queue in `./queue`, and the drawer reads everything back
 * through `usePagedEvents`. There is deliberately no buffer and no `getAll()` —
 * keeping events in the JS heap is exactly what this layer exists to avoid.
 *
 * Seven inspectors call in; one queue receives. That fan-in is all this module is.
 * The *other* half of the old store — telling lists that new rows are readable —
 * lives in `../inspector-revisions`.
 *
 * With no queue attached — the database never opened — captured events are
 * dropped. There is deliberately no memory fallback: a devtool whose data can't
 * outlive a reload isn't worth a second code path, and the drawer reports the
 * failure instead of showing empty tabs (`../database/status`).
 */

import type { BesouroEvent, InspectorKind } from '../types';
import type { EventQueue } from './queue';

let idCounter = 0;

/** Monotonic, collision-resistant id without native crypto. */
export function createEventId(): string {
  idCounter += 1;
  return `${Date.now().toString(36)}-${idCounter.toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

/**
 * Where captured events go. Null until persistence starts — and forever when the
 * native module isn't linked — which is what makes capture a no-op rather than a
 * failure. Named for its role, not its class: capture has no business knowing
 * that the far side batches, retries, or writes SQL.
 */
let sink: EventQueue | null = null;

/** Waiting to be told that captured events now have somewhere to go. */
const waiting = new Set<() => void>();

/** Attach (or detach, with null) the queue that captured events are handed to. */
export function setEventSink(queue: EventQueue | null): void {
  sink = queue;
  if (!queue || waiting.size === 0) {
    return;
  }
  // Copied before running: a listener is free to register another.
  const ready = [...waiting];
  waiting.clear();
  for (const listener of ready) {
    listener();
  }
}

/** Whether captured events currently have anywhere to go. */
export function isCapturing(): boolean {
  return sink !== null;
}

/**
 * Run `listener` once captured events have somewhere to go — **now**, if they
 * already do.
 *
 * For an inspector whose first row is produced during install. `init()` installs
 * interception synchronously and only then opens the database, so anything captured
 * in that window is dropped (see the note at the top of this file). An inspector
 * that keeps writing — console, network — loses one row and never notices. One whose
 * first row is the *only* row it will have until the app does something (a Zustand
 * store's initial state, a Jotai atom's initial value) loses that store's entire
 * presence in the tab, silently, for the whole session.
 *
 * The alternative — buffering pre-sink events here — is the memory fallback this
 * module exists to refuse. Handing back the moment instead lets the inspector
 * re-read its own source, which is both cheaper and more honest: the row then
 * describes the state capture actually started from.
 *
 * Returns an unsubscribe, so an inspector torn down inside the window does not fire
 * afterwards. Fires at most once per registration.
 */
export function whenCapturing(listener: () => void): () => void {
  if (sink) {
    listener();
    return () => {};
  }
  waiting.add(listener);
  return () => {
    waiting.delete(listener);
  };
}

/** Hand a newly captured event to the queue, or drop it if there is none. */
export function captureEvent(event: BesouroEvent): void {
  sink?.add(event);
}

/**
 * Capture an event and write it to the database **before returning**.
 *
 * For the crash path only. Everywhere else, the queue's whole job is to keep the
 * JS thread out of a disk write — but a fatal error hands control to RN's
 * exception manager, which stops the app before any promise resolves, so the
 * queued row describing the crash never reaches disk. In release that is silent:
 * the session shows as `crashed` with nothing in the Console tab explaining why.
 *
 * The event still goes through the queue rather than around it, so it is written
 * in order with the logs leading up to the crash — which are sitting in that same
 * queue, equally unwritten, and are most of what makes the crash readable.
 *
 * Returns whether the write landed; false when persistence is off, the database
 * isn't open yet, or the write failed.
 */
export function captureEventSync(event: BesouroEvent): boolean {
  if (!sink) return false;
  sink.add(event);
  return sink.flushSync();
}

/**
 * Drain the queue to disk **before returning**, without capturing anything.
 *
 * The counterpart to {@link captureEventSync} for a caller whose row is already in
 * the queue — a patch, typically — and who is on the crash path, where nothing
 * asynchronous will ever get a turn. Returns whether the write landed.
 */
export function flushCapturedSync(): boolean {
  if (!sink) return false;
  return sink.flushSync();
}

/**
 * Patch an already-captured event — a network request completing, say.
 *
 * The caller passes `kind` rather than this module remembering it: a caller always
 * knows the kind statically, whereas a map here would have to guess how long to
 * hold the mapping. It guessed wrong once already — a map released on the flush
 * cadence silently dropped every patch to a request that outlived one flush, which
 * is most of them.
 */
export function patchEvent(
  id: string,
  kind: InspectorKind,
  patch: Partial<BesouroEvent>
): void {
  sink?.update(id, kind, patch);
}
