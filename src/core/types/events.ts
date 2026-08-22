/**
 * The captured-event model: one interface per inspector, joined into the
 * {@link BesouroEvent} discriminated union (on `kind`) that flows through the
 * capture and the database.
 *
 * These live in `core` rather than beside each inspector because `core/store.ts`,
 * `core/session.ts`, and `core/database` are all typed on the union — colocating
 * them would invert the dependency graph.
 */

import type { BaseEvent, SocketDirection } from './base';

export type NetworkPhase = 'pending' | 'success' | 'error';

export interface NetworkEvent extends BaseEvent {
  kind: 'network';
  method: string;
  url: string;
  requestHeaders: Record<string, string>;
  requestBody?: string;
  requestBodyTruncated: boolean;
  status?: number;
  responseHeaders?: Record<string, string>;
  responseBody?: string;
  responseBodyTruncated: boolean;
  /**
   * Image responses, captured as a `data:` uri so the detail view renders the
   * bytes that actually arrived — no re-fetch, so it works the same for every
   * method, and the preview survives into a persisted session.
   *
   * Unset when the response is not an image, arrived in a form that can't be
   * encoded, or exceeded the per-image capture cap (see `MAX_IMAGE_BYTES` in
   * `inspectors/network/content-type.ts`). Stored as a heavy column, so it is
   * written once and never loaded into a list.
   */
  responseImageUri?: string;
  /** Request start -> response end, in milliseconds. */
  durationMs?: number;
  requestSizeBytes?: number;
  responseSizeBytes?: number;
  phase: NetworkPhase;
  error?: string;
}

export interface WebSocketEvent extends BaseEvent {
  kind: 'websocket';
  connectionId: string;
  url: string;
  direction: SocketDirection;
  /** 'open' | 'message' | 'close' | 'error' | 'connecting'. */
  type: string;
  payload?: string;
  payloadTruncated: boolean;
  closeCode?: number;
  closeReason?: string;
  error?: string;
}

export interface SocketIOEvent extends BaseEvent {
  kind: 'socketio';
  clientId: string;
  namespace: string;
  /** Manager URI the socket connects to (`socket.io.uri`), when available. */
  url?: string;
  direction: SocketDirection;
  /** Event name for send/receive; lifecycle name (connect/disconnect/…) otherwise. */
  event: string;
  args?: string;
  argsTruncated: boolean;
  hasAck: boolean;
}

/** The `console` methods the inspector patches. */
export type ConsoleMethod = 'log' | 'info' | 'warn' | 'debug' | 'error';

/**
 * Display levels. A superset of {@link ConsoleMethod} by two, neither of which
 * has a console method behind it:
 *
 * - `uncaught` — the JS global error handler (§9).
 * - `crash` — a *native* crash, recovered from the previous launch's spool file
 *   (`core/crash-ingest.ts`). Kept distinct from `uncaught` because the two say
 *   different things about what died: an `uncaught` row was written by a running
 *   app, a `crash` row is the only trace of one that stopped existing.
 *
 * The distinction among all three is provenance, not severity (see
 * `ConsoleEvent.fatal`).
 */
export type ConsoleLevel = ConsoleMethod | 'uncaught' | 'crash';

export interface ConsoleEvent extends BaseEvent {
  kind: 'console';
  level: ConsoleLevel;
  message: string;
  /** Shallow stack for warn/error/uncaught, or the native backtrace for crash. */
  stack?: string;
  /**
   * Whether capture cut `message` — and, for a crash, the trace that shares it.
   * Recorded rather than inferred because a stack that ends early reads as a short
   * stack: the bottom frame looks like the origin when it is only where we stopped.
   */
  messageTruncated: boolean;
  /**
   * Whether the error was fatal — meaningful only for `uncaught`, where it is
   * what RN reported (its global handler also fires for non-fatal errors).
   *
   * Deliberately unset for `crash`, even though a native crash is as fatal as it
   * gets: the level already says so, and setting it would badge the row twice.
   */
  fatal?: boolean;
}

/** Which JS provider module surfaced the notification. */
export type NotificationProvider = 'expo' | 'firebase' | 'notifee';

export type NotificationPhase =
  | 'received'
  | 'responded'
  | 'opened'
  | 'dismissed'
  | 'scheduled'
  | 'token-refresh'
  | 'background';

export interface NotificationEvent extends BaseEvent {
  kind: 'notification';
  /** The JS module that observed this event (expo-notifications / firebase / notifee). */
  provider: NotificationProvider;
  phase: NotificationPhase;
  /** Whether the notification originated on-device (local) or from a server (remote). */
  origin: 'local' | 'remote';
  title?: string;
  body?: string;
  data?: string;
  /** Whether capture cut `data`. */
  dataTruncated: boolean;
  foreground: boolean;
  /**
   * The id the provider gave this notification, when present. Each provider names
   * it differently — expo `request.identifier`, firebase `messageId`, notifee `id` —
   * so it is displayed back under that provider's own key, never a normalized one.
   */
  notificationId?: string;
}

export type StorageOperation =
  | 'getItem'
  | 'setItem'
  | 'removeItem'
  | 'mergeItem'
  | 'clear'
  | 'getAllKeys'
  | 'multiGet'
  | 'multiSet'
  | 'multiRemove'
  | 'multiMerge';

export type StorageDirection = 'read' | 'write' | 'delete';

export interface AsyncStorageEvent extends BaseEvent {
  kind: 'asyncStorage';
  operation: StorageOperation;
  keys: string[];
  value?: string;
  valueTruncated: boolean;
  direction: StorageDirection;
  /** Time the underlying async call took, in milliseconds. */
  durationMs?: number;
  error?: string;
}

/**
 * What an MMKV instance was asked to do. Not {@link StorageOperation}: MMKV has one
 * polymorphic `set` where AsyncStorage has `setItem`/`mergeItem`/`multiSet`, and no
 * batch operations at all. Sharing the union would mean both inspectors carrying
 * members the other can never emit.
 *
 * Writes only. Reads are deliberately not captured (§6.11): MMKV's getters are
 * synchronous JSI calls that apps put in render paths precisely because they are
 * cheap, so wrapping them taxes the path that was chosen for being untaxed, and a
 * screen re-rendering in a loop would bury the writes under thousands of reads.
 *
 * `remove` covers both spellings — v2/v3 call it `delete`, v4 renamed it — because
 * the operation is the same and the row should not record which version of the
 * library the app happened to be on.
 *
 * `snapshot` is the exception: not something the app did, but the row this inspector
 * writes to hold the instance's whole contents (see {@link MMKVEvent.isFinal}).
 */
export type MMKVOperation = 'set' | 'remove' | 'clearAll' | 'snapshot';

/** The MMKV type a captured value was read back as. */
export type MMKVValueType = 'string' | 'number' | 'boolean' | 'buffer';

/**
 * One operation against a watched MMKV instance.
 *
 * Shaped like {@link AsyncStorageEvent} but deliberately not merged with it, and
 * the differences are the reason (§6.11). There is no `durationMs`: MMKV is
 * synchronous JSI, so every call would round to zero and a duration column would
 * report precision the number does not have. There is a single `key` rather than a
 * `keys` array, because MMKV has no multi-key operations. And there is an instance
 * id, because an app routinely holds several instances where it holds one
 * AsyncStorage.
 */
export interface MMKVEvent extends BaseEvent {
  kind: 'mmkv';
  /** Stable id assigned to an instance at attach time. */
  instanceId: string;
  /** The name the consumer registered the instance under. */
  instanceName: string;
  operation: MMKVOperation;
  /** Absent for `clearAll` and `snapshot`, which name no single key. */
  key?: string;
  /**
   * The instance's whole contents rather than one change — written at attach and
   * refreshed on a throttle, on background, and on a JS fatal, exactly as the Redux
   * inspector keeps its closing state (§6.9).
   *
   * One row per instance per session carries this, patched in place rather than
   * appended, so it never grows the table however long the session runs. It is what
   * the State pane reads, in a live session and a past one alike: with the contents
   * in the database there is no second, in-memory copy to drift out of step.
   */
  isFinal: boolean;
  /** How the value came back; absent when the operation carries no value. */
  valueType?: MMKVValueType;
  direction: StorageDirection;
  /** Serialized value, truncated to the byte budget. */
  value?: string;
  valueTruncated: boolean;
  /** Why the call failed — `set` throws on an empty key or an unwritable store. */
  error?: string;
}

export interface ZustandEvent extends BaseEvent {
  kind: 'zustand';
  /** Stable id assigned to a store instance by `attachZustand`. */
  storeId: string;
  /** Human-readable store label (consumer-provided or auto-numbered). */
  storeName: string;
  /**
   * True for the synthetic event recorded at attach time capturing the store's
   * initial state; false for events driven by an actual state change.
   */
  isInitial: boolean;
  /** See {@link ReduxEvent.isReload} — the same flag, for a store's baseline. */
  isReload: boolean;
  /** Top-level state keys whose reference changed in this transition. */
  changedKeys: string[];
  /** Serialized next state, truncated to the byte budget. */
  state?: string;
  stateTruncated: boolean;
}

/**
 * One action that reached the root reducer, with what it changed.
 *
 * Deliberately not a mirror of {@link ZustandEvent}: a Zustand row carries the whole
 * serialized state, which is affordable because a Zustand store is small and its
 * transitions are user-paced. Redux is dispatched from middleware, timers and RTK
 * Query polling, so a full-state row per action would write the same tree hundreds
 * of times a session. The current state lives in the live registry
 * (`inspectors/redux/store/snapshot.ts`) instead, and a row keeps only the delta.
 *
 * There is no store id or name: the API takes exactly one store (§6.9), so there is
 * nothing to disambiguate and a label would be invented, not observed.
 */
export interface ReduxEvent extends BaseEvent {
  kind: 'redux';
  /** The dispatched action's `type`, e.g. `cart/addItem`. */
  actionType: string;
  /**
   * True for the synthetic row recorded when the wrapped reducer is installed,
   * capturing the store's state at that moment; false for real dispatches.
   */
  isInitial: boolean;
  /**
   * Why this baseline exists: a full JS reload rebuilt the store, rather than the
   * app launching. Only ever true on a row that is also {@link isInitial}.
   *
   * A reload tears down the heap but the session is *adopted* (`core/controller`),
   * so one session's timeline can hold several baselines — and without this the
   * second one is indistinguishable from the first while describing a genuine
   * reset back to the initial state. The UI badges it; see
   * `shared/components/BaselinePill`.
   */
  isReload: boolean;
  /**
   * The session's closing snapshot rather than a dispatched action — written when
   * the app backgrounds or crashes, and refreshed on a throttle so a *native*
   * crash (which kills JS before any handler runs) still leaves a recent one.
   *
   * Exactly one row per session carries this, so it is what the archived State
   * view looks up. Distinct from {@link stateIsFull}: this says *which* row to
   * find, that says *how to render* it.
   */
  isFinal: boolean;
  /** Top-level state slices whose reference changed under this action. */
  changedKeys: string[];
  /**
   * The *nested* paths that changed (`counter.value`), capped to a handful.
   *
   * Distinct from `changedKeys` because the slice name is usually already in the
   * action type — `counter/increment` changing `counter` says nothing — whereas
   * the path inside it is what the reader does not already know.
   */
  changedPaths: string[];
  /**
   * Serialized action minus its `type`, truncated to its own byte budget — RTK
   * Query puts an entire API response here, so it is capped independently of state.
   */
  payload?: string;
  payloadTruncated: boolean;
  /**
   * Serialized state carried by this row, truncated. Usually only the slices in
   * `changedKeys`; the whole tree when {@link stateIsFull}.
   */
  changedState?: string;
  changedStateTruncated: boolean;
  /**
   * `changedState` holds the entire state tree, not a delta — true for the initial
   * and final rows, which are the session's two baselines, and false for the
   * per-action rows in between.
   */
  stateIsFull: boolean;
}

/**
 * One value change in a watched Jotai atom.
 *
 * Closer to {@link ZustandEvent} than to {@link ReduxEvent}: an atom, like a
 * Zustand store, changes anonymously — there is no named action to attribute it to
 * — so the row is the value, not an event that produced it.
 *
 * It carries a `preview` that Zustand has no need for. A Zustand store's state is
 * always an object, so listing its changed keys describes the change; an atom is as
 * often `atom(0)` or `atom('idle')`, where the keys are empty and the *value* is
 * the entire story — and a list row cannot reach the heavy column holding it.
 */
export interface JotaiEvent extends BaseEvent {
  kind: 'jotai';
  /** Stable id assigned to a watched atom at attach time. */
  atomId: string;
  /** The name the consumer registered the atom under. */
  atomName: string;
  /** True for the row recording the atom's value at attach time. */
  isInitial: boolean;
  /** See {@link ReduxEvent.isReload} — the same flag, for an atom's baseline. */
  isReload: boolean;
  /** Top-level keys whose reference changed; empty when the value is a primitive. */
  changedKeys: string[];
  /** Short, clipped rendering of the new value — a summary column, for list rows. */
  preview: string;
  /** Serialized new value, truncated to the byte budget. */
  value?: string;
  valueTruncated: boolean;
}

export type BesouroEvent =
  | NetworkEvent
  | WebSocketEvent
  | SocketIOEvent
  | ConsoleEvent
  | NotificationEvent
  | AsyncStorageEvent
  | MMKVEvent
  | ZustandEvent
  | ReduxEvent
  | JotaiEvent;
