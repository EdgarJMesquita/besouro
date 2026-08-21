/**
 * Redux capture mechanism — internal.
 *
 * The seam is the **root reducer**, installed through `store.replaceReducer`. That
 * choice is the whole design, so it is worth stating why the two obvious
 * alternatives were rejected:
 *
 * - **Patching `store.dispatch`** sees only what feature code dispatches.
 *   `applyMiddleware` builds its chain over the *pre-patch* dispatch
 *   (`dispatch = compose(...chain)(store.dispatch)`), so every action a middleware
 *   emits from inside — thunks, `createAsyncThunk`'s pending/fulfilled/rejected,
 *   all of RTK Query — bypasses the patch. Those are precisely the actions a
 *   developer opens this tab to see.
 * - **The DevTools-extension globals** (`__REDUX_DEVTOOLS_EXTENSION_COMPOSE__`)
 *   do work, and are stable across RTK versions, but only if we win a load-order
 *   race against the consumer's store module, and they mean owning a global we
 *   did not define and may have to share.
 *
 * The reducer is called by the base dispatch at the *bottom* of the middleware
 * chain, so wrapping it sees every action that reaches state, whatever emitted it —
 * through public API, with no load-order requirement. It is the same technique the
 * real extension's `instrument()` uses.
 *
 * What it cannot see is an action a middleware swallows before the reducer runs.
 * Those change no state, and the extension has the same blind spot.
 *
 * We never import `redux`: `ReduxStoreLike` is a structural subset (see `./types`).
 */

import { safeCapture } from '../../core/base-interceptor';
import {
  captureEvent,
  captureEventSync,
  createEventId,
  flushCapturedSync,
  patchEvent,
  whenCapturing,
} from '../../core/capture';
import { getCurrentSession, installCrashCapture } from '../../core/session';
import { truncateToBytes } from '../../core/truncate';
import { safeStringify } from '../../core/serialize';
import {
  changedTopLevelKeys,
  isKeyedState,
  pickKeys,
  topLevelKeys,
} from '../../core/state-diff';
import { isWarmReload } from '../../core/warm-reload';
import { publishReduxState, markReduxStoreDetached } from './store/snapshot';
import { MAX_STATE_BYTES } from './budgets';
import { changedPaths } from './utils/changed-paths';
import type { ReduxEvent } from '../../core/types';
import type {
  ReduxActionLike,
  ReduxInspectorPeers,
  ReduxReducerLike,
} from './types';

/**
 * Per-action ceiling for a serialized action payload — 100 KB, deliberately lower
 * than the state budget. The one thing that routinely gets large here is an RTK
 * Query `fulfilled` action carrying a whole API response, and the network
 * inspector has already captured that response at full fidelity (1 MB). Storing a
 * second uncut copy per action buys nothing.
 */
const MAX_PAYLOAD_BYTES = 100_000;

/**
 * How many changed paths a row records for the log's subtitle.
 *
 * A cap this small is also what keeps the diff cheap: it bounds the walk rather
 * than the output, and Redux's immutability means untouched slices are
 * reference-equal and skipped whole, so a typical action visits one slice and
 * stops. It is one line of text — more than this would not fit anyway.
 */
const MAX_ROW_CHANGED_PATHS = 6;

/**
 * How often the session's closing snapshot is refreshed while actions are flowing.
 *
 * The snapshot exists so a past session can show the state it ended on — most
 * usefully, the state at a crash. A JS fatal and a clean background both give us a
 * handler that writes it exactly, so this timer is only about the case with no
 * handler at all: a **native** crash kills JS outright. Refreshing on a cadence
 * bounds how stale that snapshot can be to this interval.
 *
 * Two seconds because the cost is one full-state serialization per interval of
 * *active dispatching* — an idle app pays nothing (see `finalStatePending`), and
 * the row is patched in place rather than appended, so the table does not grow.
 */
const FINAL_STATE_INTERVAL_MS = 2_000;

/**
 * Stores already instrumented. Re-entering install for the same store — Fast
 * Refresh re-running the consumer's devtools module — would otherwise wrap the
 * wrapper and record every action twice.
 */
const instrumented = new WeakSet<object>();

export function installReduxInspector<State>({
  store,
  rootReducer,
}: ReduxInspectorPeers<State>): () => void {
  if (instrumented.has(store)) {
    return () => {};
  }
  instrumented.add(store);

  /**
   * The consumer's current unwrapped reducer. Not a constant: an app using
   * `combineSlices` or lazy reducer injection calls `replaceReducer` itself later,
   * and this must track what it passed so teardown can put it back.
   */
  let baseReducer: ReduxReducerLike<State> = rootReducer;
  let isFirstPass = true;
  /**
   * The action of the first pass, once it has happened — the `@@redux/REPLACE` the
   * install below dispatches. Held rather than captured on the spot, because the
   * baseline row cannot be written yet (see the deferral after `replaceReducer`),
   * and `null` for a store whose `replaceReducer` dispatches nothing at all: then
   * no first pass was observed and there is no baseline to describe.
   */
  let initialAction: ReduxActionLike | null = null;

  const wrap =
    (reducer: ReduxReducerLike<State>): ReduxReducerLike<State> =>
    (state, action) => {
      const nextState = reducer(state, action);
      // Flipped before the capture runs, not inside it: a throw swallowed by
      // `safeCapture` must not leave the next action looking like the initial one.
      const initial = isFirstPass;
      isFirstPass = false;
      // Capture cannot be allowed to break a reducer: `safeCapture` runs after the
      // real work, and `nextState` is returned whatever happens inside it.
      safeCapture(() => {
        if (initial) {
          initialAction = action;
          // The live panes only — the row waits. Publishing does not: it is what
          // the Store pane reads, it depends on no database, and the initial pass
          // is the only thing that fills it before the app dispatches anything.
          publishLive(nextState, undefined);
          return;
        }
        record(state, nextState, action);
      });
      return nextState;
    };

  const originalReplaceReducer = store.replaceReducer.bind(store);

  // Patched *before* the install below, so the install itself routes through it and
  // there is only one wrapping path to reason about. Re-wrapping here is what keeps
  // capture alive when an app injects reducers at runtime — without it, the
  // consumer's own `replaceReducer` would silently drop our wrapper mid-session and
  // the tab would just stop filling with no error to explain it.
  store.replaceReducer = (nextReducer: ReduxReducerLike<State>): void => {
    baseReducer = nextReducer;
    originalReplaceReducer(wrap(nextReducer));
  };

  // Installs the wrapper and, as a side effect, dispatches `@@redux/REPLACE`. That
  // pass through the wrapped reducer is what produces the initial-state row — the
  // same trick `attachZustand` uses when it records `getState()` at attach time.
  store.replaceReducer(rootReducer);

  // The baseline row waits for capture to have somewhere to write. `init()`
  // installs inspectors and only then opens the database, so the row the pass above
  // produced would have been handed to a sink that does not exist yet and dropped —
  // silently, on every launch, and it is the one row the log cannot reconstruct
  // later: an action row carries only its delta.
  //
  // Registered here rather than from inside the reducer because `whenCapturing`
  // fires *immediately* when the sink is already attached (a re-install after
  // startup, and every test), and `store.getState()` inside a reducer still returns
  // the pre-dispatch state. After `replaceReducer` returns, the read is correct in
  // both cases — and re-reading is what makes the row describe the state capture
  // actually started from rather than one from an arbitrarily earlier moment.
  const firstAction: ReduxActionLike | null = initialAction;
  const cancelInitial =
    firstAction === null
      ? noop
      : whenCapturing(() => {
          safeCapture(() => {
            captureRow(undefined, store.getState(), firstAction, {
              isInitial: true,
              isReload: isWarmReload(),
            });
          });
        });

  // The three moments the closing snapshot is written. Each is installed from the
  // inspector rather than from the session lifecycle, so `core/` stays
  // inspector-agnostic and never learns that Redux exists.
  const stopSnapshots = startFinalStateSnapshots();

  return () => {
    cancelInitial();
    stopSnapshots();
    finalStatePending = null;
    finalStateId = null;
    finalStateSessionId = null;
    store.replaceReducer = originalReplaceReducer;
    originalReplaceReducer(baseReducer);
    instrumented.delete(store);
    markReduxStoreDetached();
  };
}

/**
 * Keep the session's closing snapshot current: on a throttle while actions flow, on
 * background, and on a JS fatal.
 *
 * `installCrashCapture` chains handlers, so this does not displace the session
 * lifecycle's own. Order between the two does not matter: whichever runs second
 * still drains what the first left queued, because both write synchronously.
 */
function startFinalStateSnapshots(): () => void {
  const timer = setInterval(() => {
    // No-op unless a dispatch marked the state dirty, so an idle app costs nothing.
    safeCapture(() => writeFinalState(false));
  }, FINAL_STATE_INTERVAL_MS);
  // Never hold the process open for a devtool (Node/Jest; a no-op on Hermes).
  (timer as unknown as { unref?: () => void }).unref?.();

  const restoreCrashCapture = installCrashCapture(() => {
    safeCapture(() => writeFinalState(true));
  });

  const stopAppState = observeBackground(() => {
    safeCapture(() => writeFinalState(false));
  });

  return () => {
    clearInterval(timer);
    restoreCrashCapture();
    stopAppState();
  };
}

/** Call `onBackground` when the app leaves the foreground. */
function observeBackground(onBackground: () => void): () => void {
  try {
    const { AppState } =
      require('react-native') as typeof import('react-native');
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'background') {
        onBackground();
      }
    });
    return () => subscription?.remove();
  } catch {
    // No react-native (tests, web) — the throttle and crash handler still run.
    return () => {};
  }
}

function noop(): void {}

/**
 * Refresh what the live panes read: the State pane's registry, and the pointer the
 * closing snapshot serializes from.
 *
 * Deliberately not part of writing a row. Neither depends on a session or a
 * database, so both run unconditionally — before a session exists, after rows are
 * cleared, and (see `installReduxInspector`) on the initial pass whose row is
 * still waiting for a sink.
 */
function publishLive(nextState: unknown, prevState: unknown): void {
  publishReduxState(nextState, prevState);
  // A pointer assignment, not a serialization — see `finalStatePending`.
  markFinalStateDirty(nextState);
}

/** One dispatched action: refresh the live panes, then write its row. */
function record(
  prevState: unknown,
  nextState: unknown,
  action: ReduxActionLike
): void {
  publishLive(nextState, prevState);
  captureRow(prevState, nextState, action, {
    isInitial: false,
    isReload: false,
  });
}

/**
 * Write one row. Split from {@link record} because the baseline row is published
 * and captured at different moments — see the deferral in `installReduxInspector`,
 * and note that every reducer pass has published by then.
 */
function captureRow(
  prevState: unknown,
  nextState: unknown,
  action: ReduxActionLike,
  /** `isReload` is only ever true alongside `isInitial` — see {@link ReduxEvent}. */
  { isInitial, isReload }: { isInitial: boolean; isReload: boolean }
): void {
  const session = getCurrentSession();
  if (!session) {
    return;
  }

  // A root reducer may legitimately return an array, a Map or a primitive. There are
  // no slices to name then, so "what changed" is the whole value — which is small in
  // exactly the cases where this happens.
  const keyed = isKeyedState(nextState, prevState);
  const changedKeys = isInitial
    ? topLevelKeys(nextState)
    : keyed
      ? changedTopLevelKeys(nextState, prevState)
      : [];

  // Only the slices this action touched, never the whole tree: at Redux dispatch
  // rates a full-state row would write the same unchanged data hundreds of times a
  // session, and the current state is a registry read away. The initial row is the
  // exception — it is the session's one baseline, and every key is "changed".
  const changedSlice = keyed ? pickKeys(nextState, changedKeys) : nextState;
  // The initial row has no previous state to diff, and "everything changed" is
  // what `changedKeys` already says.
  const paths = isInitial
    ? []
    : changedPaths(prevState, nextState, MAX_ROW_CHANGED_PATHS);
  const { text: changedState, truncated: changedStateTruncated } =
    truncateToBytes(safeStringify(changedSlice), MAX_STATE_BYTES);

  const payloadValue = actionPayload(action);
  const cutPayload =
    payloadValue === undefined
      ? null
      : truncateToBytes(safeStringify(payloadValue), MAX_PAYLOAD_BYTES);

  const reduxEvent: ReduxEvent = {
    id: createEventId(),
    sessionId: session.id,
    timestamp: Date.now(),
    kind: 'redux',
    actionType: actionType(action),
    isInitial,
    isReload,
    isFinal: false,
    changedKeys,
    changedPaths: paths,
    payload: cutPayload?.text,
    payloadTruncated: cutPayload?.truncated ?? false,
    changedState,
    changedStateTruncated,
    // The initial row is a baseline, not a delta: `keyed` made `changedKeys` every
    // key, so `changedSlice` is already the whole tree.
    stateIsFull: isInitial || !keyed,
  };
  captureEvent(reduxEvent);
}

// ── Closing snapshot ─────────────────────────────────────────────────────────

/**
 * The newest state, and whether it has been written since it last changed.
 *
 * Held by reference and left unserialized until something actually needs it —
 * marking it dirty on a dispatch is a pointer assignment, which is what makes it
 * affordable to do on every action.
 */
let finalStatePending: { state: unknown } | null = null;
/** Id of this session's closing-snapshot row, once one has been written. */
let finalStateId: string | null = null;
let finalStateSessionId: string | null = null;

function markFinalStateDirty(nextState: unknown): void {
  finalStatePending = { state: nextState };
}

/**
 * Write — or refresh — the session's closing snapshot.
 *
 * One row per session, created on first need and patched in place after, so this
 * never grows the table however long the session runs. `sync` is for the crash
 * path, where nothing asynchronous will get a turn before the process dies.
 */
function writeFinalState(sync: boolean): void {
  const pending = finalStatePending;
  const session = getCurrentSession();
  if (!pending || !session) {
    return;
  }
  finalStatePending = null;

  const { text, truncated } = truncateToBytes(
    safeStringify(pending.state),
    MAX_STATE_BYTES
  );

  // A new session gets its own snapshot row; the previous session's stays where it
  // is, which is the whole point of keeping it.
  if (finalStateSessionId !== session.id) {
    finalStateId = null;
    finalStateSessionId = session.id;
  }

  if (finalStateId) {
    patchEvent(finalStateId, 'redux', {
      timestamp: Date.now(),
      changedState: text,
      changedStateTruncated: truncated,
    } as Partial<ReduxEvent>);
    if (sync) {
      // The patch is sitting in the queue and only a drain will land it. The
      // lifecycle's own crash handler may already have flushed before this ran.
      flushCapturedSync();
    }
    return;
  }

  finalStateId = createEventId();
  const finalEvent: ReduxEvent = {
    id: finalStateId,
    sessionId: session.id,
    timestamp: Date.now(),
    kind: 'redux',
    actionType: FINAL_STATE_ACTION_TYPE,
    isInitial: false,
    isReload: false,
    isFinal: true,
    changedKeys: topLevelKeys(pending.state),
    changedPaths: [],
    payloadTruncated: false,
    changedState: text,
    changedStateTruncated: truncated,
    stateIsFull: true,
  };
  if (sync) {
    captureEventSync(finalEvent);
  } else {
    captureEvent(finalEvent);
  }
}

/**
 * The `actionType` on the closing-snapshot row. Not a real dispatched action, and
 * deliberately in Redux's own reserved `@@` namespace so it cannot collide with one.
 */
export const FINAL_STATE_ACTION_TYPE = '@@besouro/FINAL_STATE';

/**
 * The action's `type` as a string. Redux requires one, but a reducer can be called
 * with anything, and an unlabeled row is more useful than a crashed capture.
 */
function actionType(action: ReduxActionLike): string {
  const type = (action as { type?: unknown } | undefined)?.type;
  return typeof type === 'string' && type.length > 0
    ? type
    : String(type ?? 'unknown');
}

/**
 * Everything on the action except `type`, or `undefined` when that is nothing.
 *
 * Not just `action.payload`: RTK puts the request arguments of a thunk under `meta`
 * (`meta.arg`, `meta.requestStatus`) and the failure under `error`, so a row that
 * kept only `payload` would lose what a `rejected` action was actually about.
 */
function actionPayload(action: ReduxActionLike): unknown {
  if (typeof action !== 'object' || action === null) {
    return undefined;
  }
  const rest: Record<string, unknown> = {};
  let has = false;
  for (const key of Object.keys(action)) {
    if (key === 'type') {
      continue;
    }
    rest[key] = (action as Record<string, unknown>)[key];
    has = true;
  }
  return has ? rest : undefined;
}
