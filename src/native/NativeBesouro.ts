import { TurboModuleRegistry, type TurboModule } from 'react-native';

/**
 * One native view on the path from the app root down to the touched view, as
 * reported by {@link Spec.startElementInspection}. All primitives, so it crosses
 * the bridge (and codegen) without ceremony.
 */
export type NativeNode = {
  /**
   * The React tag — the Android view id (`ViewManager.createView` assigns the tag
   * as the id) or the iOS `reactTag`/component-view `tag`. 0 for a view React
   * doesn't own; also the handle {@link Spec.setNativeViewProp} writes through.
   */
  tag: number;
  /** Native class name: `ReactViewGroup`, `RCTParagraphComponentView`, … */
  className: string;
  /** `testID`, when the view carries one — the best human-readable identity we
   *  get without React. Empty string when absent. */
  testID: string;
  /** Bounds in dp/points, relative to the app root. */
  left: number;
  top: number;
  width: number;
  height: number;
};

export interface Spec extends TurboModule {
  /**
   * Mount a native draggable bubble on the DecorView (Android) / UIWindow (iOS).
   * Tapping the bubble creates the drawer's ReactSurface on demand. Idempotent.
   *
   * Takes both theme resolutions rather than one pair of colors because the
   * bubble must be painted before its entrance animation runs, and at that point
   * JS has not read the persisted settings yet (the read is async, the mount is
   * not). So native does the last step itself: it reads the stored theme/accent
   * out of the settings file and picks between these two pairs. Each color is
   * `#rrggbb`, already resolved from the configured options — the palette stays
   * in JS.
   *
   * `configuredTheme` is what to wear when nothing is stored — the host app's
   * configured preference, or `'system'` to follow the device.
   *
   * NOTE: must not be named `initialize` (or `invalidate`) — those are reserved
   * TurboModule lifecycle hooks that React Native's Native Module infrastructure
   * calls automatically when the module is created/destroyed. A spec method named
   * `initialize` overrides that hook, so the overlay would mount at module setup —
   * before JS `mountBubble()` runs, and regardless of the production guard.
   * See https://reactnative.dev/docs/the-new-architecture/native-modules-lifecycle
   */
  mountBubble(
    configuredTheme: string,
    lightBackground: string,
    lightIcon: string,
    darkBackground: string,
    darkIcon: string
  ): void;

  /**
   * Tear down the drawer's ReactSurface. Called from JS when the user closes the
   * drawer.
   */
  closeDrawer(): void;

  /**
   * True when this JS context is a **warm** restart — a reload within a native
   * process that was already running — and false on a **cold** process start.
   * Captured once when the native module is first created in the process, so it's
   * stable and side-effect-free to read.
   *
   * Used to tell a reload (resume the previous session) apart from a fresh launch
   * after a native crash (which killed the process → cold). Both leave the prior
   * session `open` on disk, so this native signal is the only way to distinguish
   * them from JS.
   *
   * Not a dev-only concern: a release build reloads too, when an OTA update is
   * applied in place (`Updates.reloadAsync`, `HotUpdater.reload`) or the app calls
   * `RNRestart`. Treating those as cold would report a crash that never happened.
   */
  isWarmReload(): boolean;

  /**
   * (Re)mount the drawer's ReactSurface — the same action a bubble tap triggers,
   * exposed to JS so the element inspector can reopen the drawer after a pick.
   * Idempotent: no-op when it is already open.
   */
  openDrawer(): void;

  /**
   * Enter element-pick mode: dismiss the drawer and mount a transparent
   * full-screen capture overlay above the app. The next tap resolves to a point
   * in the app root's coordinate space, then the overlay removes itself and
   * invokes `onResult(x, y, rootTag, path)` exactly once. Coordinates are in
   * device-independent pixels relative to the app's React root; `rootTag`
   * identifies that root (0 when unknown). Only one pick runs at a time — a
   * second call before the first taps replaces the pending overlay.
   *
   * `path` is the native view chain under the tap, app root **first** and the
   * touched view **last**, hit-tested natively once the overlay is gone. It's the
   * only element data that survives a release build (the renderer's own hit-test
   * is a throwing stub there — see `../inspectors/element/picker.ts`), and it
   * carries the React tags JS needs to find the matching fibers. Empty when the
   * native side couldn't hit-test, in which case JS falls back to the renderer.
   *
   * Note the argument is appended, so an older native build that invokes the
   * callback with three arguments still works — `path` simply arrives undefined.
   */
  startElementInspection(
    onResult: (
      x: number,
      y: number,
      rootTag: number,
      path?: NativeNode[]
    ) => void
  ): void;

  /**
   * Recolor the floating bubble to match the drawer's theme/accent. `background`
   * fills the bubble circle; `iconColor` tints the bug glyph. Both are `#rrggbb`.
   * Safe to call before the bubble mounts — the colors are cached natively and
   * applied when it appears — and any time after, to update live.
   */
  setBubbleAppearance(background: string, iconColor: string): void;

  /**
   * SPIKE — shrink the drawer's native surface to a floating rect, so the app
   * underneath keeps its touches.
   *
   * The drawer is hosted full-screen (an Android DecorView child at
   * `MATCH_PARENT`, an iOS `UIWindow` framed to the scene), which is what makes
   * a minimized card impossible to fake in JS alone: the React root would still
   * cover — and swallow — the whole screen. Resizing the host instead means
   * everything outside `x/y/width/height` is not ours to begin with, and needs
   * no hit-test games on either platform.
   *
   * Units are device-independent pixels, origin at the top-left of the screen
   * (Android includes the status bar area; iOS uses the scene's coordinate
   * space). React relayouts to the new size: Android's surface view reports its
   * measure specs back to the surface, iOS pushes the size to the Fabric
   * surface.
   *
   * No-op when the drawer is closed. Cheap enough to call per drag frame on
   * Android (a translation, no relayout); a resize costs a layout pass on both.
   */
  setSurfaceFrame(x: number, y: number, width: number, height: number): void;

  /** SPIKE — put the surface back to full-screen. No-op when closed. */
  resetSurfaceFrame(): void;

  // ── Native filesystem persistence ────────────────────────────────────────
  // Files live in the app's internal storage (no permissions needed).
  // Android: <filesDir>/rn-inapp-devtools/
  // iOS:     Library/Application Support/RNBesouro/

  readFile(filename: string): Promise<string | null>;
  writeFile(filename: string, content: string): Promise<void>;
  deleteFile(filename: string): Promise<void>;

  // ── Native crash capture ─────────────────────────────────────────────────

  /**
   * Tell the native side which session is live, and — as a side effect of the
   * first call — install the platform crash handlers.
   *
   * A native crash (an uncaught Kotlin/Java exception, a Swift `fatalError`, a
   * memory fault) kills the process outright. Nothing JS-side can observe it: the
   * JS thread is already gone or going, so there is no bridge call to make and no
   * flush to run — not even the blocking one the JS crash path uses. The handlers
   * instead append a record to a spool file that the *next* launch ingests into
   * the console table under this session's id, which is why they need the id up
   * front (see `core/crash-ingest.ts`).
   *
   * Installing on first call rather than at module construction means an app that
   * never initializes the library gets no handlers, and a crash before the
   * library is up produces no orphan record. Called once per session; safe to
   * call again (later calls only update the id).
   *
   * Both platforms chain to whatever handler was already installed and let the
   * crash proceed, so a redbox, Crashlytics/Sentry and the OS crash report are
   * all unaffected.
   */
  setCrashContext(sessionId: string): void;

  /**
   * The current safe-area insets of the app window, in device-independent
   * pixels (the same units React layout uses). Read on the native main thread
   * from the window's `safeAreaInsets` (iOS) / `rootWindowInsets` covering the
   * system bars and display cutout (Android). The drawer is hosted in a native
   * surface outside the app's React tree, so it has no `SafeAreaProvider` to
   * read from — this is how it keeps content clear of the status bar, home
   * indicator and nav bar. Values reflect the moment of the call, so re-read on
   * (re)open to pick up rotation changes.
   */
  getSafeAreaInsets(): Promise<{
    top: number;
    bottom: number;
    left: number;
    right: number;
  }>;

  /**
   * The device's current UI language as a BCP-47 tag (`pt-BR`, `es`, `en-US`).
   * Read synchronously — the drawer's i18n needs it while resolving its string
   * table during render, and both platforms answer from in-memory state.
   *
   * Android reports the app's configuration locale, so it honours a per-app
   * language override and stays current after a locale change; iOS reports the
   * head of the user's preferred-language list (the list the UI should follow),
   * falling back to the region/format locale.
   *
   * This is the only locale source — the library reads no React Native
   * internals (`SettingsManager`, `I18nManager.localeIdentifier`) for it.
   */
  getDeviceLocale(): string;

  /**
   * Write plain text to the system clipboard. Write-only — there is no
   * programmatic read (both platforms surface a user-facing paste notification
   * on read, which copy affordances don't need). Runs on the main thread
   * natively. Sole backing for the clipboard util in core/clipboard.ts, so no
   * clipboard peer dependency is required.
   */
  setClipboardString(text: string): void;

  /**
   * Play one short haptic tap — the drawer's feedback for a gesture that changed
   * state under the finger without moving anything yet (a tab lifting for a
   * reorder).
   *
   * Native rather than RN's `Vibration`: that API buzzes the whole device for
   * ~0.4s on iOS (the duration argument is ignored) and needs the `VIBRATE`
   * permission on Android, which this library will not add to a host app's
   * manifest. Here it is `UIImpactFeedbackGenerator` (light) and
   * `View.performHapticFeedback`, neither of which needs a permission and both
   * of which respect the user's system haptics setting.
   *
   * Fire-and-forget: a device with no haptics engine, or a user who turned them
   * off, is a silent no-op.
   */
  haptic(): void;

  /**
   * Present the OS share sheet for a single sandbox file, so a file browsed in
   * the File System inspector can be sent to another app (AirDrop, Files, mail,
   * chat …). Fire-and-forget like [setClipboardString] — no promise; a missing
   * file or a share the user cancels is a silent no-op.
   *
   * The file is shared in place (no copy is made), so nothing new appears in the
   * inspector's tree. `mimeType` labels the payload for the receiving app
   * (derived from the extension in JS); pass an empty string for "unknown", which
   * the native side maps to a generic binary type.
   *
   * Android: the file is exposed through a private `FileProvider` declared in
   * this library's manifest (authority `${applicationId}.besouro.fileprovider`,
   * merged into the host app automatically — no app-level config). The receiver
   * gets a one-shot read grant for that single file's URI, not the directory.
   * iOS: presented via `UIActivityViewController` on the top-most view controller.
   */
  shareFile(path: string, mimeType: string): void;

  /**
   * Present the OS share sheet for bytes held in JS rather than a sandbox file.
   * The Network inspector captures response images as base64 in the event row,
   * so there is no file for [shareFile] to point at; the payload is decoded
   * natively and written to a short-lived copy the platform then shares.
   *
   * That copy is cleaned up differently per platform, because only one of them
   * can say when the receiving app is done with it:
   * - iOS deletes it in the share sheet's completion handler — the activity has
   *   consumed the item by then, so nothing is left behind.
   * - Android cannot: the receiver reads the `content://` URI after the chooser
   *   returns, so deleting on return would share an empty file. The copy goes to
   *   a dedicated directory under `cacheDir` that is swept on the next call, so
   *   at most one stale file exists, in storage the OS may reclaim anyway.
   *
   * `filename` names the payload in the sheet (include an extension — iOS infers
   * the UTI from it); `mimeType` labels it for the receiving app, as in
   * [shareFile]. Fire-and-forget like the other share affordance: undecodable
   * base64, a failed write, or a missing Activity is a silent no-op.
   */
  shareBase64File(base64: string, filename: string, mimeType: string): void;
}

/**
 * `get` (not `getEnforcing`) so the export is `Spec | null` instead of throwing
 * when the native module isn't registered (Jest / web / Expo Go). Consumers
 * null-check `Native` once; codegen guarantees every `Spec` method is present on
 * a non-null module (Android: abstract-class override at compile time; iOS:
 * protocol conformance), so no per-method existence checks are needed.
 */
export default TurboModuleRegistry.get<Spec>('Besouro');
