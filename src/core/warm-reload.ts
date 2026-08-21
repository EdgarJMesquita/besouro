/**
 * Whether this JS runtime is a reload of one that already ran in this process.
 *
 * The native module answers it (see `native/NativeBesouro`), captured once when
 * it is constructed, so reading it is stable and free of side effects — any number of
 * callers, at any time.
 *
 * **Why no JS answer exists.** A full JS reload tears down the heap: every module's
 * state, every `WeakSet`, every symbol parked on a consumer object dies with it,
 * because the consumer's object dies too. What survives is the database — and, on a
 * warm reload, the previous session is *adopted*, so its rows are still this
 * session's rows. Nothing left in JS can tell that the run before it existed.
 *
 * **Two callers, two different questions.**
 *
 * - The controller asks whether to *adopt* the previous session
 *   (`resumePreviousSession`), rather than leave it orphaned as a phantom crash.
 * - The Zustand, Jotai and Redux inspectors ask what to *call* the baseline row they
 *   write at install. A reload rebuilds every store at its initial state, so the row
 *   is recorded either way — this only decides whether it is the launch's baseline or
 *   a reset the reader needs to see explained (`isReload`, badged as **App Reload**).
 *
 * The inspectors deliberately do *not* use this to suppress that row. They once did,
 * on the reasoning that the adopted session already held one — but the store it
 * described is gone, and the value it recorded is not the value the rebuilt store
 * holds unless nothing ever touched it. Suppressing left the pane showing the last
 * pre-reload value, then a change diffed against the fresh one, with the reset
 * recorded nowhere.
 *
 * Wrapped here rather than imported from the native spec at each call site so an
 * inspector does not have to reach into `native/`, and so the missing-module case
 * (tests, Expo Go, web) has one answer: a runtime with no native module was never
 * reloaded as far as we can tell. Cold is the safe default at both call sites — it
 * starts a fresh session rather than adopting a stranger's, and it costs a baseline
 * row that does not say why it is there rather than one that lies about it.
 */

import NativeBesouro from '../native/NativeBesouro';

export function isWarmReload(): boolean {
  try {
    return NativeBesouro?.isWarmReload() ?? false;
  } catch {
    return false;
  }
}
