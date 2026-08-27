/**
 * Public entry point — see {@link Besouro} for how to use it.
 *
 * Thirteen inspectors ship, split by whether they can work on their own:
 *
 * - **Self-sufficient** — network, console, websocket, element, viewHierarchy,
 *   fileSystem. They patch globals that are already there, or read the platform
 *   on demand, so they run by default and `configure({ inspectors: { … } })` is
 *   how one gets switched off.
 * - **Dependency-required** — asyncStorage, mmkv, zustand, redux, jotai, socketio,
 *   notifications. Each
 *   watches a module or store the consumer owns, and the library never imports one
 *   (so it depends on and bundles none of them). The matching inspector method both
 *   supplies the dependency and enables the inspector; there is no zero-argument
 *   form, because an inspector without its dependency would render a tab that can
 *   never populate.
 *
 * The devtools are one-shot and have no teardown: they are either compiled into the
 * bundle or stripped from it, and an app that loaded them always wants them on.
 */

import type { BesouroOptions } from './core/types';
import { controller } from './core/controller';
import type { AsyncStorageLike } from './inspectors/asyncStorage/types';
import type { MMKVInstances } from './inspectors/mmkv/types';
import type { ZustandStores } from './inspectors/zustand/types';
import type {
  ReduxReducerLike,
  ReduxStoreLike,
} from './inspectors/redux/types';
import type { JotaiAtoms, JotaiStoreLike } from './inspectors/jotai/types';
import type { SocketIOManagerLike } from './inspectors/socketio/types';
import type { NotificationsInspectorPeers } from './inspectors/notifications/types';

/**
 * The root entry exports the builder and the types needed to *call* it — nothing
 * more. Everything else (the event store and its event union, inspector status,
 * clipboard, persistence adapters, per-inspector stores) is internal machinery:
 * the drawer reads it by importing the owning module directly, and a consumer
 * never touches it. The exception is the seven setter argument types, which are
 * re-exported here because they are arguments to methods on this object — so the
 * root stays the integration API and nothing else.
 */
export type {
  Inspector,
  BesouroOptions,
  InspectorToggles,
  ThemePreference,
  LocalePreference,
} from './core/types';
export type { AsyncStorageLike } from './inspectors/asyncStorage/types';
export type { MMKVInstances, MMKVLike } from './inspectors/mmkv/types';
export type { ZustandStores } from './inspectors/zustand/types';
export type {
  ReduxStoreLike,
  ReduxReducerLike,
  ReduxActionLike,
} from './inspectors/redux/types';
export type {
  JotaiStoreLike,
  JotaiAtomLike,
  JotaiAtoms,
} from './inspectors/jotai/types';
export type { SocketIOManagerLike } from './inspectors/socketio/types';
export type { NotificationsInspectorPeers } from './inspectors/notifications/types';

/**
 * What you can call on {@link Besouro}. Every method except {@link
 * BesouroBuilder.init | init} returns the builder, so calls chain in any
 * order.
 */
export interface BesouroBuilder {
  /**
   * Set global options. Optional — every one has a default.
   *
   * Replaces rather than merges: a second call discards the first object.
   *
   * @example
   * ```ts
   * Besouro.configure({
   *   maxSessions: 30,
   *   accent: '#7c3aed',
   *   inspectors: { fileSystem: false },
   * });
   * ```
   */
  configure(options?: BesouroOptions): BesouroBuilder;

  /**
   * Turn on the AsyncStorage inspector — every read, write, removal and clear.
   *
   * @example
   * ```ts
   * import AsyncStorage from '@react-native-async-storage/async-storage';
   *
   * Besouro.asyncStorage(AsyncStorage);
   * ```
   */
  asyncStorage(asyncStorage: AsyncStorageLike): BesouroBuilder;

  /**
   * Turn on the MMKV inspector — every write, removal and clear, plus each
   * instance's current contents.
   *
   * Keys are the tab labels. Only the instances listed here are watched, and
   * reads are deliberately not captured (they are synchronous and often per-render;
   * the Contents view shows every key anyway).
   *
   * @example
   * ```ts
   * import { createMMKV } from 'react-native-mmkv';
   *
   * export const storage = createMMKV();
   *
   * Besouro.mmkv({ default: storage });
   * ```
   */
  mmkv(instances: MMKVInstances): BesouroBuilder;

  /**
   * Turn on the Zustand inspector — initial state and every transition after it.
   *
   * Keys are the tab labels. Only the stores listed here are watched.
   *
   * @example
   * ```ts
   * Besouro.zustand({ cart: useCartStore, auth: useAuthStore });
   * ```
   */
  zustand(stores: ZustandStores): BesouroBuilder;

  /**
   * Turn on the Redux inspector — every action that reaches state, and the store's
   * current state.
   *
   * The root reducer is required because capture wraps it (through
   * `store.replaceReducer`) and Redux offers no way to read it back off a store.
   * Wrapping the reducer rather than `store.dispatch` is what makes thunk-emitted
   * actions visible: `createAsyncThunk`'s pending/fulfilled/rejected and all of RTK
   * Query are dispatched from *inside* middleware, and never pass through the
   * `dispatch` a patch could reach.
   *
   * One store only — Redux's style guide makes that a Priority A rule. A second
   * call replaces the first.
   *
   * @example
   * ```ts
   * // app/store.ts
   * export const rootReducer = combineReducers({ cart, auth });
   * export const store = configureStore({ reducer: rootReducer });
   *
   * // devtools.dev.ts
   * Besouro.redux(store, rootReducer);
   * ```
   */
  redux<State>(
    store: ReduxStoreLike<State>,
    rootReducer: ReduxReducerLike<State>
  ): BesouroBuilder;

  /**
   * Turn on the Jotai inspector — each named atom's current value and its change
   * history.
   *
   * Atoms are values, not stores, and jotai cannot enumerate the ones a store has
   * touched, so you name the ones worth watching. An atom created later, or a
   * derived atom nobody named, is not captured.
   *
   * @example
   * ```ts
   * import { getDefaultStore } from 'jotai';
   * import { cartAtom, userAtom } from '../state/atoms';
   *
   * Besouro.jotai(getDefaultStore(), {
   *   cart: cartAtom,
   *   user: userAtom,
   * });
   * ```
   */
  jotai(store: JotaiStoreLike, atoms: JotaiAtoms): BesouroBuilder;

  /**
   * Turn on the Socket.IO inspector — every frame, on every socket, no per-socket
   * wiring.
   *
   * Pass the `Manager` **class**, not `io` and not a manager instance. Only sockets
   * opened after `init()` are captured.
   *
   * @example
   * ```ts
   * import { Manager } from 'socket.io-client';
   *
   * Besouro.socketIO(Manager);
   * ```
   */
  socketIO(Manager: SocketIOManagerLike): BesouroBuilder;

  /**
   * Turn on the notifications inspector.
   *
   * Pass whichever modules you want inspected; passing several is fine — on an FCM
   * stack each reports a different part of the same push, so the rows complement
   * rather than duplicate. Only notifications arriving while the app runs are
   * visible to JS.
   *
   * @example
   * ```ts
   * import * as Notifications from 'expo-notifications';
   * import messaging from '@react-native-firebase/messaging';
   * import notifee from '@notifee/react-native';
   *
   * Besouro.notifications({
   *   expoNotifications: Notifications,
   *   firebaseMessaging: messaging,
   *   notifee,
   * });
   * ```
   */
  notifications(handlers: NotificationsInspectorPeers): BesouroBuilder;

  /**
   * Start the devtools and mount the floating bubble. Call it last.
   *
   * **No JSX step** — nothing to render, no provider to wrap your app. Capture
   * starts here, so call it before the code you want to see.
   *
   * Does not check `__DEV__` itself: require this module behind your own check and
   * release builds drop the library entirely.
   */
  init(): void;
}

/**
 * Your app's devtools. Set it up once, as early as your app starts, from a module
 * you require behind `if (__DEV__)`.
 *
 * Network, console, websocket, element, viewHierarchy and fileSystem are already on —
 * `init()` alone is a working setup. The other seven turn on with the call that
 * feeds them.
 *
 * @example
 * ```ts
 * import { Besouro } from 'besouro';
 *
 * Besouro.configure()
 *   .socketIO(Manager)
 *   .asyncStorage(AsyncStorage)
 *   .notifications({
 *     expoNotifications: Notifications,
 *     firebaseMessaging: messaging,
 *     notifee,
 *   })
 *   .mmkv({ default: storage })
 *   .zustand({ counter: useCounterStore })
 *   .redux(store, rootReducer)
 *   .jotai(getDefaultStore(), { cart: cartAtom })
 *   .init();
 * ```
 */
// Implementation note: deliberately a separate object forwarding to the controller,
// not the controller under a narrower type. A type annotation is erased at build, so
// `getOptions`/`getInspectors`/`getDatabase` would stay callable at runtime. Kept as
// a line comment so it does not show up in a consumer's IDE — see
// `core/controller.ts` and `__tests__/public-surface`.
export const Besouro: BesouroBuilder = {
  configure(options) {
    controller.configure(options);
    return this;
  },
  asyncStorage(asyncStorage) {
    controller.asyncStorage(asyncStorage);
    return this;
  },
  mmkv(instances) {
    controller.mmkv(instances);
    return this;
  },

  zustand(stores) {
    controller.zustand(stores);
    return this;
  },
  redux(store, rootReducer) {
    controller.redux(store, rootReducer);
    return this;
  },
  jotai(store, atoms) {
    controller.jotai(store, atoms);
    return this;
  },
  socketIO(Manager) {
    controller.socketIO(Manager);
    return this;
  },
  notifications(handlers) {
    controller.notifications(handlers);
    return this;
  },
  init() {
    controller.init();
  },
};
