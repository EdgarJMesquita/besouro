/**
 * The Besouro controller — internal.
 *
 * Holds the whole builder implementation. `../index` is the public facade: a
 * separate object that forwards one method at a time, so `getOptions`,
 * `getInspectors` and `getDatabase` stay reachable for the drawer without ever
 * appearing on the object a consumer holds. Annotating the instance as
 * `BesouroBuilder` instead would only hide them from TypeScript — they would
 * still be there to call.
 *
 * Living here rather than in `../index` is what makes that possible: internal
 * callers reach the controller directly, so the public entry never has to widen to
 * serve them.
 */

import type { BesouroOptions, Inspector } from './types';
import { INSPECTOR_ORDER } from './types';
import type { InspectorToggles } from './types';
import { installNetworkInspector } from '../inspectors/network/interceptor';
import { installConsoleInspector } from '../inspectors/console/interceptor';
import { installWebSocketInspector } from '../inspectors/websocket/interceptor';
import { installElementInspector } from '../inspectors/element/interceptor';
import { installSocketIOInspector } from '../inspectors/socketio/interceptor';
import { installNotificationsInspector } from '../inspectors/notifications/interceptor';
import { installAsyncStorageInspector } from '../inspectors/asyncStorage/interceptor';
import { installMMKVInspector } from '../inspectors/mmkv/interceptor';
import { installZustandInspector } from '../inspectors/zustand/interceptor';
import { installReduxInspector } from '../inspectors/redux/interceptor';
import { installJotaiInspector } from '../inspectors/jotai/interceptor';
import type { AsyncStorageLike } from '../inspectors/asyncStorage/types';
import type { MMKVInstances } from '../inspectors/mmkv/types';
import type { ZustandStores } from '../inspectors/zustand/types';
import type {
  ReduxReducerLike,
  ReduxStoreLike,
} from '../inspectors/redux/types';
import type { JotaiAtoms, JotaiStoreLike } from '../inspectors/jotai/types';
import type { SocketIOManagerLike } from '../inspectors/socketio/types';
import type { NotificationsInspectorPeers } from '../inspectors/notifications/types';
import type { Database, SessionRepository } from './database/types';
import { startCapture, type CaptureHandle } from './capture';
import { guardInstall } from './base-interceptor';
import { startSession, getCurrentSession, adoptSession } from './session';
import { createNativeSqlConnection, openDatabase } from './database';
import { setDatabaseStatus } from './database/status';
import { startSessionLifecycle } from './session-lifecycle';
import { ingestPendingCrashes } from './crash-ingest';
import { hydrateSettings } from './settings-store';
import { hydratePersistedState } from './persisted-state';
import { hydrateMiniWindow } from '../drawer/mini-window';
import {
  resolveBubbleColorPairs,
  startBubbleAppearanceSync,
} from './bubble-appearance';
import { BESOURO_REGISTRY_KEY } from './besouro-registry-key';
import NativeBesouro from '../native/NativeBesouro';
import { isWarmReload } from './warm-reload';

/** What an inspector's `install()` returns: its own uninstall. */
type Installer = () => () => void;

/**
 * The inspectors that need nothing from the consumer, and so run unless
 * {@link InspectorToggles} switches one off. Keyed by `InspectorToggles` rather
 * than `Inspector` so the toggle type and this table cannot drift apart.
 */
const SELF_SUFFICIENT: Record<keyof InspectorToggles, Installer> = {
  network: installNetworkInspector,
  console: installConsoleInspector,
  websocket: installWebSocketInspector,
  element: installElementInspector,
  // Nothing to patch or tear down — the browser is pulled from native lazily by
  // the tab. A noop keeps the install lifecycle uniform.
  fileSystem: () => () => {},
};

function isSelfSufficient(
  inspector: Inspector
): inspector is keyof InspectorToggles {
  return inspector in SELF_SUFFICIENT;
}

class BesouroController {
  private options: BesouroOptions = {};
  /**
   * Installers for the dependency-required inspectors, keyed by inspector so a
   * repeat inspector call replaces rather than appends. That matters under Fast
   * Refresh, where the module calling these re-executes against this persisted
   * singleton — appending would accumulate duplicate installs.
   */
  private injected = new Map<Inspector, Installer>();
  /** Resolved at {@link init}; empty before it. */
  private enabled: Inspector[] = [];
  /**
   * The open capture database, or null when it never opened — no native module,
   * or an open that failed. Null *is* the "nothing to inspect" state, which is
   * why the drawer can gate on it.
   */
  private database: Database | null = null;
  private initialized = false;

  configure(options?: BesouroOptions): this {
    if (options) {
      this.options = options;
    }
    return this;
  }

  /**
   * Enable the AsyncStorage inspector over the consumer's AsyncStorage module.
   *
   * The module is injected rather than imported so this library never depends on
   * `@react-native-async-storage/async-storage` (§4.1) — and because there is only
   * ever one instance worth patching: the one the app itself writes through.
   */
  asyncStorage(asyncStorage: AsyncStorageLike): this {
    this.injected.set('asyncStorage', () =>
      installAsyncStorageInspector(asyncStorage)
    );
    return this;
  }

  /**
   * Enable the MMKV inspector over the given instances, keyed by the name each
   * appears under in the drawer.
   *
   * Takes a map where {@link asyncStorage} takes a single module, and that is the
   * real difference between the two: AsyncStorage is one module the whole app writes
   * through, while MMKV instances are created by the app — a default one, an
   * encrypted one, one per signed-in user — and an inspector that could only watch
   * "the" instance would watch the wrong one as often as not.
   *
   * Declared here rather than exported as a per-instance `attach()` for the same
   * reason as Zustand: it keeps the whole devtools graph behind the consumer's
   * dev-only `require` (§11).
   */
  mmkv(instances: MMKVInstances): this {
    this.injected.set('mmkv', () => installMMKVInspector(instances));
    return this;
  }

  /**
   * Enable the Zustand inspector over the given stores, keyed by the name each
   * appears under in the drawer.
   *
   * A Zustand store is an instance you subscribe to, not a global to patch, so
   * there is nothing to find by inspection — these are the only stores that can be
   * watched. Declaring them here rather than exporting a per-store `attach()` keeps
   * the whole devtools graph behind the consumer's dev-only `require` (§11).
   */
  zustand(stores: ZustandStores): this {
    this.injected.set('zustand', () => installZustandInspector(stores));
    return this;
  }

  /**
   * Enable the Redux inspector over the app's store, capturing every action that
   * reaches state.
   *
   * The root reducer is required, not a convenience: capture works by wrapping it
   * through `store.replaceReducer`, and Redux exposes no way to read the reducer
   * back off a store. That route is what makes the actions a middleware emits
   * internally — thunks, `createAsyncThunk`, all of RTK Query — visible at all;
   * patching `store.dispatch` would see none of them (§6.9).
   *
   * Singular by design. Redux's own style guide makes one store per application a
   * Priority A rule, and the multi-store cases (SSR, micro-frontends) are web and
   * server patterns. Calling this twice therefore *replaces* rather than adds —
   * which is also what keeps Fast Refresh from installing capture twice over.
   */
  redux<State>(
    store: ReduxStoreLike<State>,
    rootReducer: ReduxReducerLike<State>
  ): this {
    this.injected.set('redux', () =>
      installReduxInspector({ store, rootReducer })
    );
    return this;
  }

  /**
   * Enable the Jotai inspector over the given atoms, keyed by the name each appears
   * under in the drawer.
   *
   * An atom is a *value*, not a store, and jotai exposes no way to enumerate the
   * atoms a store has touched — so, as with Zustand, these are the only ones that
   * can be watched, and declaring them here keeps the whole devtools graph behind
   * the consumer's dev-only `require` (§11).
   *
   * The store comes too because that is what actually holds the values:
   * `getDefaultStore()` for an app with no `Provider`, or the store passed to one.
   */
  jotai(store: JotaiStoreLike, atoms: JotaiAtoms): this {
    this.injected.set('jotai', () => installJotaiInspector({ store, atoms }));
    return this;
  }

  /**
   * Enable the Socket.IO inspector by patching `Manager.prototype.socket` — the
   * factory every `io()` call routes through — so sockets are captured as the app
   * creates them.
   *
   * Only reaches sockets created from *this* socket.io-client instance, and only
   * those created after install, so call `init()` from a devtools module that is
   * required before feature code.
   */
  socketIO(Manager: SocketIOManagerLike): this {
    this.injected.set('socketio', () => installSocketIOInspector({ Manager }));
    return this;
  }

  /**
   * Enable the notifications inspector over whichever push modules the app uses
   * (`expo-notifications`, `@react-native-firebase/messaging`, `@notifee/react-native`).
   *
   * All three are optional — the consumer passes whichever they want inspected.
   * Several at once is not double-counting: on the common FCM stack firebase
   * reports "a message arrived" and notifee "it was displayed", so the rows are
   * complementary.
   */
  notifications(handlers: NotificationsInspectorPeers): this {
    this.injected.set('notifications', () =>
      installNotificationsInspector(handlers)
    );
    return this;
  }

  getOptions(): Readonly<BesouroOptions> {
    return this.options;
  }

  /**
   * The inspectors that will be — or are — running, in tab order.
   *
   * Empty until {@link init}, which is what resolves it: the drawer only mounts
   * from there, so it never observes the empty state.
   */
  getInspectors(): Inspector[] {
    return this.enabled;
  }

  /**
   * Every enabled inspector paired with its installer, in {@link INSPECTOR_ORDER}.
   *
   * An inspector is enabled when it is self-sufficient and not switched off, or
   * when an inspector method supplied its dependency. The two cannot both apply — the
   * tables are disjoint — so there is no precedence rule to remember.
   */
  private resolveInspectors(): Array<[Inspector, Installer]> {
    const toggles = this.options.inspectors ?? {};
    const resolved: Array<[Inspector, Installer]> = [];

    for (const inspector of INSPECTOR_ORDER) {
      if (isSelfSufficient(inspector)) {
        if (toggles[inspector] !== false) {
          resolved.push([inspector, SELF_SUFFICIENT[inspector]]);
        }
        continue;
      }
      const injected = this.injected.get(inspector);
      if (injected) {
        resolved.push([inspector, injected]);
      }
    }

    return resolved;
  }

  /**
   * Install the enabled inspectors and bring up the drawer. One-shot: repeat calls
   * are ignored, and there is no teardown (see the note at the top of this file).
   * The real Fast-Refresh guard lives in each patch (see base-interceptor) — this
   * flag only stops a second `init()` from re-running the setup below.
   *
   * Each installer still returns a teardown: that contract keeps every
   * patch reversible and symmetric (SPEC §5) and is what the inspector tests use to
   * isolate cases. Nothing calls those teardowns at runtime.
   */
  init(): void {
    if (this.initialized) {
      return;
    }
    this.initialized = true;

    // Resolved before the session starts, not after: the session records which
    // inspectors it ran with, and that is what lets a past session still show its
    // network rows once network has been switched off. Resolving reads options
    // only — nothing is installed until the loop below, which still runs with a
    // session in place.
    const resolved = this.resolveInspectors();
    this.enabled = resolved.map(([inspector]) => inspector);

    startSession(this.enabled);

    for (const [inspector, install] of resolved) {
      guardInstall(inspector, install);
    }

    void this.connectDatabase();
    this.mountUI();

    // Restore persisted UI settings (theme/accent/font scale), then keep the
    // native bubble's colors in sync as they change. Hydrating notifies the sync,
    // which is what gives the bubble its persisted colors — but not its first
    // paint: the mount above already handed native what it needs for that.
    hydrateSettings();
    // Restore persisted per-inspector view-mode preferences (network URL mode,
    // file-system list/grid). Async like settings — the drawer usually mounts long
    // after this resolves, and a live UI re-reads when hydration notifies.
    hydratePersistedState();
    // The floating panel's frame, which keeps its own file (see `mini-window.ts`).
    hydrateMiniWindow();
    startBubbleAppearanceSync(this.options);
  }

  /**
   * Register the drawer JS component and ask the native module to mount a
   * draggable bubble on the DecorView (Android) / UIWindow (iOS). Tapping the
   * bubble creates a `RNBesouro` ReactSurface on demand, so the whole
   * Besouro UI is native-injected — no user JSX required. Silently skips
   * when the native module is not linked (no bubble in that case).
   */
  private mountUI(): void {
    if (!NativeBesouro) {
      // Not linked — nothing to mount (native module required).
      return;
    }
    try {
      const { AppRegistry } =
        require('react-native') as typeof import('react-native');

      // Deferred requires: keep the drawer/RN surface out of the bundle until
      // the UI actually mounts.
      const registry = require('../drawer/BesouroRoot') as any;
      // Registering a component is also what gives the drawer its own LogBox:
      // `renderApplication` mounts one per React root, and ours is a root of its
      // own. Docked it sits harmlessly at the bottom edge; over the minimized
      // panel it covers rows. RN's opt-out (`internal_excludeLogBox`) is keyed to
      // the app key being literally 'LogBox', so the only way to claim it is to
      // register a *runnable* and call the internal `renderApplication` in place
      // of this line. Not worth reaching into RN internals for a dev-only toast —
      // and suppressing it globally is out of the question, since that would eat
      // the host app's own warnings.
      AppRegistry.registerComponent(
        BESOURO_REGISTRY_KEY,
        () => registry.BesouroRoot
      );
      // Both theme resolutions, for native to pick from once it has read the
      // stored theme/accent — see `mountBubble` in the spec. JS cannot resolve
      // this itself here: that read is async and the mount is not.
      const colors = resolveBubbleColorPairs(this.options);
      NativeBesouro.mountBubble(
        this.options.theme ?? 'system',
        colors.light.background,
        colors.light.icon,
        colors.dark.background,
        colors.dark.icon
      );

      // Warm the safe-area inset cache so it's ready before the drawer first
      // opens (the drawer has no SafeAreaProvider of its own to read from).
      const safeArea = require('../shared/hooks/safe-area') as {
        refreshSafeAreaInsets?: () => void;
      };
      safeArea.refreshSafeAreaInsets?.();
    } catch {
      // Guard against any unexpected error during linking/require.
    }
  }

  /**
   * The open capture database, for the drawer to read through. Non-null only once
   * it is open, so its presence doubles as the "there is data" gate — the drawer
   * narrows it to one repository per call site (`shared/context/database`).
   */
  getDatabase(): Database | null {
    return this.database;
  }

  /**
   * Wire capture to a database: open one over the native connection, point
   * capture at it, and hand the session over to its lifecycle. Once this resolves,
   * captured events reach disk; before it — and forever, if there is no
   * connection — they are dropped.
   *
   * There is no opt-out: the database *is* where captured events live, so failing
   * to get one is a failure the drawer reports, not a mode.
   *
   * Not awaited by `init()`: opening the database is a bridge round trip, and
   * blocking startup on it would delay the host app for a devtool.
   */
  private async connectDatabase(): Promise<void> {
    const connection = createNativeSqlConnection();
    if (!connection) {
      // No native module (Expo Go, web, tests) — there is nothing to open a
      // database over. Nothing to retry at runtime either, so the drawer says so
      // and tells the developer how to fix the build.
      setDatabaseStatus({ state: 'unavailable' });
      return;
    }

    const database = openDatabase(connection);
    this.database = database;

    // Started before the first await: interception is already installed and
    // capturing, so anything logged during startup must have somewhere to go.
    // The queue holds it and the database's `ready()` gate delays the write until
    // the schema is up, so nothing captured in this window is lost.
    const capture = startCapture(database.events);

    try {
      await database.ready();
    } catch (error) {
      // The database could not be opened at all. Stop capture so it becomes a
      // no-op rather than filling a queue that will never drain.
      capture.stop();
      this.database = null;
      setDatabaseStatus({
        state: 'unopened',
        detail: error instanceof Error ? error.message : undefined,
      });
      return;
    }

    setDatabaseStatus({ state: 'ready' });

    // Continue the previous session across a full JS reload. A reload never
    // backgrounds the app, so the pre-reload session is still `open` on disk;
    // adopt it (reusing its id, so its rows are still this session's) rather
    // than starting fresh and orphaning the old one as a phantom "crashed"
    // session. Runs before the controller so its reconcile keeps the adopted
    // session — and after `ready()`, since it reads from the database.
    //
    // Warm vs. cold is the whole gate, and it is *not* dev-only: a native crash
    // leaves the session `open` too, but kills the process, so its relaunch is a
    // cold start — which we must NOT resume, so the crashed session reconciles to
    // `crashed` and shows in history. Production has warm reloads of its own —
    // an in-place OTA relaunch (`Updates.reloadAsync`, `HotUpdater.reload`) or
    // `RNRestart` — and skipping them there would invent a crash that never was.
    if (isWarmReload()) {
      await this.resumePreviousSession(database.sessions, capture);
    }

    // Hand the settled session id to the native crash handlers — and, on the
    // first call, install them. After the resume above, so a warm reload arms
    // them with the id the rows are actually being written under.
    NativeBesouro?.setCrashContext(getCurrentSession()?.id ?? '');

    // Recover a native crash from the previous launch, which no JS handler could
    // have seen. Between `ready()` (the rows need a sink) and the lifecycle below
    // (whose prune could otherwise evict the session the row belongs to).
    await ingestPendingCrashes();

    // The AppState listener that closes the session on background, crash capture,
    // and session pruning. It runs for the life of the process, so the stop
    // function it returns is deliberately discarded — there is no teardown (see
    // the note at the top of this file).
    startSessionLifecycle({
      sessionRepository: database.sessions,
      capture,
      getSession: getCurrentSession,
      maxSessions: this.options.maxSessions,
    });
  }

  /**
   * Adopt the most recent still-`open` session (a prior dev run that never
   * closed) as the current one, so a full reload resumes the same session. Its
   * events need no rehydration — they are already rows in the database, and the
   * drawer queries them by session id. Best-effort: any failure just leaves the
   * freshly started session in place.
   *
   * The rows captured *since this launch started* are the ones that need work.
   * Interception is installed in `init()`, so the reload's own startup logs were
   * already stamped with the fresh session id this method is about to discard —
   * an id no session row will ever carry. They are drained and re-keyed onto the
   * adopted session, which is where they belong: it is the same run continuing.
   */
  private async resumePreviousSession(
    sessionRepository: SessionRepository,
    capture: CaptureHandle
  ): Promise<void> {
    try {
      const currentId = getCurrentSession()?.id;
      const previous = (await sessionRepository.list()).find(
        (session) => session.status === 'open' && session.id !== currentId
      );
      if (!previous) {
        return;
      }
      adoptSession(previous);
      if (!currentId) {
        return;
      }
      // Adoption first, so nothing new can be stamped with the discarded id
      // while this runs; then drain, so every row carrying it is on disk to be
      // found. A failure here costs the reload's first few rows, not the resume.
      await capture.drain();
      await sessionRepository.reassignEvents(currentId, previous.id);
    } catch {
      // Before the adopt: keep the fresh session on any read failure. After it:
      // the resume stands and only the re-key was lost, leaving those rows where
      // the orphan sweep will collect them.
    }
  }
}

/**
 * The one controller instance. Exported at full width for the drawer, which needs
 * the accessors below `init()`; the builder in `../index` forwards to it and
 * carries only the methods a consumer may call.
 */
export const controller = new BesouroController();
