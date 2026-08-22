# besouro — Specification

> An in-app developer tools suite for React Native / Expo. Runs in a Dev Client
> and bare React Native.

Status: **Living spec, tracks v0.1.0** · Last updated: 2026-08-21

---

## 1. Overview & Goals

`besouro` is a library that developers drop into their RN/Expo
app during development to inspect runtime behavior **from inside the app itself** —
no desktop tooling, no Flipper, no remote debugger required.

It surfaces a draggable floating bubble; tapping it opens a full-screen drawer with
one tab per enabled inspector.

### Design goals

1. **Runs in a Dev Client and bare RN** (not Expo Go — the library ships a native
   TurboModule), on the New Architecture (Fabric). The old architecture is not a
   supported target (§2).
2. **Strippable from release builds.** The consumer loads the whole devtools graph
   behind their own condition (`if (__DEV__) require('./tools/devtools')`), so the
   bundler eliminates it entirely. No runtime production switch — a flag can't strip
   a bundle (§11).
3. **Modular.** Import only the inspectors you use; unused inspectors add no cost.
4. **Minimal dependencies.** Core has only `react` / `react-native` peers. Storage,
   notification, and socket integrations are **optional peers the consumer provides**
   through the builder's inspector methods (Metro can't safely auto-require them — §4.1).
5. **Crash-resilient.** Captured logs persist so a crashed session can be reopened
   and reviewed on the next launch.
6. **Utility over polish.** A dense, functional, unobtrusive UI optimized for reading
   data fast — not for visual flair. Light/dark theming and localized UI (English,
   Portuguese, Spanish) are first-class.
7. **Never break the host app.** Instrumentation is defensive: install and capture are
   wrapped in try/catch, tabs are error-boundaried, and a missing optional library or
   a failed inspector degrades to a warning message — never a crash. (See §5.)

### Non-goals (v1)

- Intercepting **native-originated** traffic (native SDK HTTP, image loaders). JS
  interception only. (See Roadmap → Phase 2.)
- A desktop/web companion viewer.
- Performance profiling (FPS, memory, render timings).
- Automatic discovery of state a consumer did not declare — Zustand stores (§6.8)
  and Jotai atoms (§6.10) are watched only when named.

### Prior art & positioning

**One-liner:** an on-device debug drawer for RN/Expo that needs no laptop tether and
covers breadth (sockets, notifications, storage) the official tooling doesn't.

**The RN gap.** Flipper was deprecated in RN 0.73, dropped from templates in 0.74, and
is effectively dead by 2026. Its official replacement,
[React Native DevTools](https://github.com/react-native-community/discussions-and-proposals/discussions/819)
(default since 0.76), is a **desktop/Chrome-based** debugger requiring a connected
session, with a network inspector that only landed ~RN 0.83.
[Reactotron](https://www.fullstack.com/labs/resources/blog/flipper-vs-react-native-debugger-vs-reactotron)
survives but is also **desktop-tethered** and state/storage-focused.

**Closest in-app tool — validates our architecture, but network-only.**
[react-native-network-logger](https://github.com/alexbrazier/react-native-network-logger)
is on-device, no native code, ships in production behind a flag, and uses a ~500-entry
ring buffer with ignored-hosts config — the same core decisions as this spec — but
covers **only** network.

**Differentiators.**

- **On-device, zero desktop/connection** — works on physical devices and QA/beta
  builds, where connected debuggers can't reach (§11).
- **All-in-one** — network + WebSocket + **Socket.IO (decoded)** + console +
  notifications + element + AsyncStorage. In-app **Socket.IO and notifications**
  inspection are things essentially nothing else offers.
- **Localized** (en/pt/es) — uncommon among in-app tools.

**Positioning risks (be honest).** The official RN DevTools is the default and
improving — don't try to beat it at connected, dev-time debugging; lead with
on-device / no-desktop / physical-device / QA / production / sockets + notifications.
And react-native-network-logger already owns in-app network, so our network tab must
clearly exceed it (HAR + cURL export, 4-tab detail, URL ellipsis modes — see §6.1).

---

## 2. Target Environments

| Environment       | Supported | Notes                                          |
| ----------------- | --------- | ---------------------------------------------- |
| Expo Go           | ❌        | Ships a native TurboModule; use a Dev Client   |
| Expo Dev Client   | ✅        | SDK 53+                                        |
| Bare React Native | ✅        |                                                |
| New arch (Fabric) | ✅        | The only supported renderer                    |
| Old architecture  | ❌        | Untested; see the note below                   |
| React             | 19        |                                                |
| React Native      | ≥ 0.77    | Developed against 0.83                         |
| iOS               | ≥ 15.1    |                                                |
| Android           | ≥ 7 (24)  |                                                |

**On the old architecture.** Several inspectors still carry Paper code paths —
`getNativeTag()` reads `_nativeTag` when `canonical.nativeTag` is absent
(`src/inspectors/element/fiber.ts`), and the HTML response preview gates on
`isFabricRenderer()` and degrades to a message (`src/shared/fabric.ts`, §6.1).
Those are **defensive fallbacks, not a support claim**: they keep the library from
crashing a host app that ends up on the legacy renderer, and they are not tested
or maintained as a target. Do not read them as old-architecture support.

---

## 3. Package Architecture

Single npm package with a **single entry point**. The builder, its config types, and
the argument types for the four dependency setters all come from `besouro`;
the bubble is native (§7), so there is nothing to render and nothing else to import.

```
besouro  → Besouro builder, config types, setter argument types
```

Inspectors are not separately importable. They are reached through the builder, which
is what lets the self-sufficient ones default on (§4) — a consumer cannot forget to
register the network inspector, because there is no registration step to forget.

**Why not subpath exports.** Earlier drafts gave each inspector its own subpath
(`besouro/network`, …) so it could be imported and tree-shaken independently.
That never paid off. Metro does no cross-module dead-code elimination, and
`drawer/InspectorTabs.tsx` statically imports all nine tabs — so importing the root
already pulled every inspector's UI, and the subpaths only ever excluded the unused
`interceptor.ts` files. They cost an import line each and bought a fraction of what
the `__DEV__` require in §11 already does, which is drop the entire library.

### `package.json` (shape)

```jsonc
{
  "name": "besouro",
  "main": "./lib/module/index.js",
  "types": "./lib/typescript/src/index.d.ts",
  "exports": {
    // Each entry also carries an "besouro-source" condition pointing at
    // src/, so the example app consumes the library without a build step.
    ".": {
      "types": "./lib/typescript/src/index.d.ts",
      "default": "./lib/module/index.js",
    },
    "./network": {
      "types": "./lib/typescript/src/inspectors/network/index.d.ts",
      "default": "./lib/module/inspectors/network/index.js",
    },
    "./websocket": { "...": "..." },
    "./socketio": { "...": "..." },
    "./console": { "...": "..." },
    "./notifications": { "...": "..." },
    "./element": { "...": "..." },
    "./async-storage": { "...": "..." },
    "./zustand": { "...": "..." },
    "./file-system": { "...": "..." },
  },
  "peerDependencies": { "react": "*", "react-native": "*" },
  "peerDependenciesMeta": {
    "@react-native-async-storage/async-storage": { "optional": true },
    "expo-notifications": { "optional": true },
    "@react-native-firebase/messaging": { "optional": true },
    "@notifee/react-native": { "optional": true },
    "socket.io-client": { "optional": true },
    "zustand": { "optional": true },
  },
}
```

Note the optional-peer list is short: persistence and the File System inspector use
the library's **own** TurboModules, so there is no `react-native-mmkv` /
`expo-file-system` peer, and the bubble is native, so no `expo-sensors` either.

Built with **react-native-builder-bob** (targets: `module`, `typescript`), plus native
TurboModules generated via New Architecture codegen from the specs in `src/native/`.

---

## 4. Public API

A **fluent builder**. Inspectors split into two kinds, and which kind an inspector is
decides how it is turned on:

- **Self-sufficient** — network, console, websocket, element, fileSystem. They need
  nothing from the consumer, so they are **on by default**.
- **Dependency-required** — asyncStorage, zustand, socketio, notifications. They
  cannot observe anything without a module or a store map from the consumer (§4.1),
  so supplying it via the matching inspector method **is** how they are enabled.

```ts
import { Besouro } from 'besouro';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Configure once, as early as possible (dev-only at the call site, §11).
Besouro.configure({
  maxSessions: 10, // retained sessions — the only retention control (§9)
  inspectors: { element: false }, // the five default-on ones; omit to keep all five
})
  .asyncStorage(AsyncStorage) // optional peer: consumer hands us the module
  .init();
```

There is no way to register a dependency-required inspector _without_ its dependency,
and that is the point: `installSocketIOInspector` with no `Manager` returns a no-op,
and `installZustandInspector({})` subscribes to nothing. Both would have added a tab
that can never populate, so the signature makes the state unrepresentable rather than
letting it render empty.

**That is the whole integration — there is no JSX step.** `.init()` mounts the
floating bubble natively and registers the drawer under an `AppRegistry` key, so the
consumer renders nothing and the library needs no place in their provider tree. Keep
the call in a module you `require()` behind your own dev check (as `example/` does),
so the whole graph stays out of release bundles.

- `Besouro` — the process-wide builder. `.configure(options?)` sets options,
  the inspector methods supply dependencies, `.init()` installs whatever resolved to
  enabled. It is one-shot and returns nothing — there is deliberately no teardown
  (see below). It does **not** self-gate on `__DEV__` —
  deciding when to load is the call site's job (§11). Idempotent — Fast Refresh
  re-running it does not double-patch (guarded at the patch level, §5), and a repeat
  inspector call replaces rather than appends.
- **Inspector methods** — `.asyncStorage(AsyncStorage)`, `.mmkv(instances)`,
  `.zustand(stores)`, `.redux(store, rootReducer)`,
  `.jotai(store, atoms)`, `.socketIO(Manager)`,
  `.notifications({ expoNotifications, firebaseMessaging, notifee })`.
  Each is named for the inspector it turns on, and calling it is what enables that
  inspector.
- **Two mechanisms, one rule.** `configure()` owns _whether and how_ an inspector
  runs; the inspector methods own _the dependency it cannot run without_. The two sets are disjoint
  — `InspectorToggles` covers only the self-sufficient five — so there is no
  precedence question about which wins.

Each inspector folder is internal: capture lives in `interceptor.ts` / `picker.ts` /
`browser.ts`, peer and UI types in `types.ts`. Only the setter argument types
(`AsyncStorageLike`, `ZustandStores`, `ReduxStoreLike`, `ReduxReducerLike`,
`ReduxActionLike`, `JotaiStoreLike`, `JotaiAtomLike`, `JotaiAtoms`,
`SocketIOManagerLike`, `NotificationsInspectorPeers`) are re-exported from the root, because they are arguments to root methods.

### Builder vs. controller

`Besouro` is a **facade**, not the controller. The controller
(`core/controller.ts`) also carries `getOptions()`, `getInspectors()` and
`getDatabase()`, which the drawer reads through and a consumer has no business
touching; the facade forwards the six public methods and nothing else.

It has to be a separate object rather than the instance under a narrower type,
because a type annotation is erased at build: exporting the instance as
`BesouroBuilder` typechecks, hides the accessors from the `.d.ts`, and still
leaves them callable at runtime from JS or behind a cast. `__tests__/public-surface`
asserts the runtime shape for that reason — it fails on the narrowed re-export even
though `tsc` does not.

Keeping the controller out of `index.tsx` is also what lets the drawer import it
directly. Reaching it through the public entry instead would mean exporting it, which
puts it right back in the consumer's hands — and it previously made the entry require
the drawer while the drawer imported the entry back.

Install order — and the default tab order — is `INSPECTOR_ORDER` in
`core/types/base.ts`, a library constant. With most of the list never named at the call
site there is no registration order to honour, and deriving half the strip from a
constant and half from call sequence would make the layout depend on something
invisible.

The strip itself belongs to the **user**, not the consumer: holding a tab lifts it —
with a short haptic tap, since at that instant nothing else has said the gesture took
(`core/haptics.ts`, backed by the library's own TurboModule rather than RN's
`Vibration`, which buzzes the whole device on iOS and needs the `VIBRATE` permission on
Android) — and it can be dragged to a new position (`drawer/hooks/tab-strip.ts`),
persisted with the other drawer preferences. `core/tab-order.ts` reconciles that saved order with the
inspectors actually running — saved entries first, then the rest in `INSPECTOR_ORDER` —
so an unknown, duplicated, or disabled entry degrades to the default instead of
producing a ghost or missing tab. The first entry of the resolved strip is what the
drawer opens on, which makes that the user's choice too.

### 4.1 Why optional peers are injected, not imported

Metro resolves every `require('literal')` at **bundle time**; a `try/catch` around a
missing module doesn't help because the failure happens during bundling, not at
runtime. If the main entry imported the inspectors and those statically required their
optional peers (AsyncStorage, expo-notifications, firebase, MMKV, expo-file-system),
then **every** consumer would need **all** of those peers installed or their bundle
would break.

Injection avoids this entirely: the library imports no optional peer, it receives
each one from the consumer through its inspector method. Nothing in `src` statically
imports socket.io-client, zustand, notifee, expo-notifications, firebase or
AsyncStorage, so a peer is only ever referenced by a consumer who already has it
installed — and an inspector whose peer is never supplied is simply never enabled.

This is also why **everything is declared in the config and nothing is attached from
feature code**. The dependency arrow points one way — the dev-only config file imports
your stores, sockets and peer modules, never the reverse — so the entire devtools
graph sits behind the consumer's single `require` and the bundler can drop all of it
(§11).

---

## 5. Core: Event Store & Types

### Event model

All inspectors write a `BesouroEvent` (discriminated union on `kind`) to a shared,
dependency-free store.

```ts
interface BaseEvent {
  id: string; // uuid-ish, generated without native crypto
  sessionId: string;
  timestamp: number; // Date.now()
  kind:
    | 'network'
    | 'websocket'
    | 'socketio'
    | 'console'
    | 'notification'
    | 'element'
    | 'asyncStorage'
    | 'zustand';
}

type BesouroEvent =
  | NetworkEvent
  | WebSocketEvent
  | SocketIOEvent
  | ConsoleEvent
  | NotificationEvent
  | AsyncStorageEvent
  | ZustandEvent
  | ReduxEvent
  | JotaiEvent;
```

There are **nine** event kinds. The element inspector contributes none: like the
File System inspector it is a "browser"-class tool that inspects one thing on
demand, holding the currently-inspected element in a session-only side store
(`inspectors/element/store/inspection.ts`). That also keeps its fiber and renderer —
neither serializable — out of anything that reaches disk.

### Capture & change signals

**SQLite is the only source of truth** for captured events (§9). Nothing holds them
in JS. Two small modules sit between the inspectors and the database:

```ts
// core/capture.ts — where seven inspectors hand off, and one queue receives
function captureEvent(event: BesouroEvent): void;
function patchEvent(
  id: string,
  kind: InspectorKind,
  patch: Partial<BesouroEvent>
): void;
function setEventSink(queue: WriteQueue | null): void;

// core/inspector-revisions.ts — what tells a list its rows changed
function markWritten(kinds: Set<InspectorKind>): void; // "there are more rows"
function markCleared(kind?: InspectorKind): void; // "rows were deleted"
function useWriteRevision(kind: InspectorKind): number;
function useClearGeneration(kind: InspectorKind): number;
```

- `captureEvent` hands the event straight to the `WriteQueue`. Nothing is buffered:
  there is no buffer and deliberately **no `getAll()`** — holding events in the JS
  heap is what this whole layer exists to avoid.
- `patchEvent` takes `kind` from the caller rather than remembering it. A caller
  always knows the kind statically; a map here would have to guess how long to hold
  the mapping, and it guessed wrong once already.
- SQLite can't tell us when rows change (no change feed across the bridge), so the
  queue reports which kinds each flush touched and `markWritten` turns that into a
  new revision. Lists re-query on it.
- **Two signals, not one.** A write means "refresh in place"; a clear means
  "refresh _and_ shrink the paging window back to one page". One counter can't
  express both — it would snap a scrolled list back to 50 rows on every log line.
  Neither is read as a number: they exist to differ from their previous value, which
  is what `useSyncExternalStore` and an effect dependency both need.
- The signal fires **after the write, never at capture time**, so a list is only
  ever told to refresh for rows that are already readable. It also means the
  queue's flush cadence _is_ the refresh cadence — the read side needs no throttle,
  and reads never have to reconcile against anything in memory.
- React binding via `useSyncExternalStore` — no external state library.
- With no persistence available (native module unlinked) captured events are
  dropped and the tabs stay empty. Intended: a devtool whose data can't outlive a
  reload isn't worth a second, memory-only code path — and the library requires a
  Dev Client anyway (§2).

### Resilience & graceful degradation

Instrumentation must **never break the host app.** This is a hard requirement across
every inspector:

- **Safe install.** `Besouro.init()` and each inspector's `install()` run inside
  try/catch. A failure to patch (`fetch`, `WebSocket`, `console`, AsyncStorage, …) is
  logged as an internal warning and that inspector is marked **degraded** — the app
  and the other inspectors keep working. `Besouro.init()` itself never throws.
- **Safe capture.** Every intercepted call delegates to the **original first**, then
  records the event in a try/catch. If capture/serialization throws, host behavior is
  unaffected and the error is swallowed (counted + surfaced as a warning).
- **Missing optional peer.** If an inspector's library isn't installed (e.g. the
  AsyncStorage inspector without `@react-native-async-storage/async-storage`, or
  Notifications without `expo-notifications` / firebase messaging), the inspector
  no-ops and its tab renders a clear **"<library> is not installed"** message with the
  install command — never a crash.
- **Render isolation.** Each inspector tab (and the JSON viewer) is wrapped in an
  **error boundary.** A tab that fails to render shows an inline **warning panel**
  ("This inspector hit an error" + Retry) instead of taking down the DevTools drawer or
  the host app.
- **Per-inspector status.** The drawer reflects each inspector's state — `active`,
  `not-installed`, or `degraded/error` — so failures are visible, not silent.

### Interception & monkey-patch discipline

Most inspectors work by hooking runtime globals. Prefer **public, stable surfaces**:
the standard globals (`XMLHttpRequest`, `global.WebSocket`, `console`) and libraries'
own official hooks (`Manager.prototype.socket` for Socket.IO, the AsyncStorage
singleton). RN's private interceptor modules (`XHRInterceptor`,
`WebSocketInterceptor`) are deliberately **not** used: they are deprecated deep
imports whose paths move between RN versions, and patching the global directly
captures the same traffic. Every patch obeys the shared base interceptor's rules:

- **Save the original, restore on uninstall.** Each interceptor captures the original
  reference and provides an `uninstall()` that restores it exactly, so every patch is
  reversible and symmetric. Nothing calls those teardowns at runtime — they exist to
  keep patching honest and are what the inspector tests use to isolate cases.
  `Besouro.init()` deliberately exposes **no** aggregate teardown: the devtools
  are either compiled into the bundle or stripped from it (§11), so an app that loaded
  them always wants them on, and unpatching mid-session would only leave a
  half-instrumented app.
- **Delegate to the original first, capture after.** The patched function calls through
  to the original and returns its result **before** recording the event (inside the §5
  safe-capture try/catch). Instrumentation never changes observable behavior, timing
  semantics, or return values, and a capture error can't break the host call.
- **Idempotent install (Fast Refresh guard).** Install tags each patched function with
  a marker and **no-ops if already patched**. This is mandatory: Fast Refresh re-runs
  `Besouro.init()` on every save, and without the guard globals would be double-wrapped
  and every event logged multiple times. Re-install detects the existing patch instead
  of stacking another layer.
- **Preserve identity & properties.** Wrappers keep the original's static properties,
  prototype, name/arity where they matter (e.g. `WebSocket.CONNECTING`, `fetch`'s
  properties), so feature-detection and instanceof checks in app/library code still pass.
- **Feature-detect what you patch.** Globals and injected classes vary across RN
  versions, bridgeless/New Arch, and release builds. Probe before patching and fail
  soft (mark the inspector `degraded`) rather than assuming a surface exists. The same
  applies to renderer internals read off the React DevTools hook (element inspector).

### 5.1 Capture limits

Every captured payload is truncated to a **UTF-8 byte budget** before it is queued
for the database (`core/truncate.ts`, which counts bytes without `TextEncoder` so it
runs anywhere Hermes does). The limits are per _event_, not a session-wide budget —
`maxSessions` (§9) remains the only retention control.

| what                          | limit  | where                                     |
| ----------------------------- | ------ | ----------------------------------------- |
| Network request/response body | 1 MB   | `network/interceptor.ts`                  |
| Network image preview         | 10 MB  | `network/content-type.ts`                 |
| Console message               | 100 KB | `console/interceptor.ts`                  |
| WebSocket frame payload       | 500 KB | `websocket/interceptor.ts`                |
| Socket.IO argument list       | 500 KB | `socketio/interceptor.ts`                 |
| Notification data payload     | 500 KB | `notifications/interceptor.ts`            |
| AsyncStorage value            | 500 KB | `asyncStorage/interceptor.ts`             |
| Zustand serialized state      | 500 KB | `zustand/interceptor.ts`                  |
| Redux action payload          | 100 KB | `redux/interceptor.ts`                    |
| Redux changed slices          | 500 KB | `redux/interceptor.ts`                    |
| Jotai atom value              | 500 KB | `jotai/interceptor.ts`                    |
| Error message + stack         | 50 KB  | `core/session.ts`, `core/crash-ingest.ts` |

Every capped payload carries a companion boolean that persists with it
(`requestBodyTruncated`, `responseBodyTruncated`, `payloadTruncated`, `argsTruncated`,
`valueTruncated`, `stateTruncated`, `messageTruncated`, `dataTruncated`), and the
drawer renders a **"payload too large"** banner from it. The flag is stored rather
than derived because a cut payload is indistinguishable from one that happened to
end there — and it has to survive to disk, or a session reopened tomorrow would show
the same cut body as if it were whole. An oversized image is the one case with no
flag: nothing is captured to cut, so the tab compares the recorded size against the
cap and says the preview cannot be shown.

**Not configurable, by design.** These were once a `maxBodyBytes` option, which no
inspector ever read — the constants above were always what applied. One global number
is also the wrong shape: a 500 KB console line is pathological where a 500 KB response
body is ordinary, so the budgets differ per inspector and are tuned here rather than
delegated to the consumer.

The image cap is the one that is not about storage. A preview is held as a base64
data uri (4/3 of the image) and crosses the bridge as a JSON string, so the transient
JS heap is a multiple of the number above; it is checked against the response size
**before** any decoding, so an oversized image is never read into JS at all — the
event still records its size and only the preview is skipped. Raising it much further
wants a different mechanism (spill the blob to a file, store the path), not a bigger
string.

---

## 6. Inspectors

### 6.1 Network Inspector

**Interception strategy — XHR + expo/fetch:**

- Primary: patch **`XMLHttpRequest`** via RN's internal `XHRInterceptor`
  (`react-native/Libraries/Network/XHRInterceptor`). Because RN's own `fetch` is
  implemented on top of XHR, this single hook catches **`fetch`, `axios`, and any
  XHR-based client** in one place.
- `expo/fetch` (the streaming fetch) does **not** go through XHR and is a native
  implementation that cannot be globally patched, so it is **not captured**.
  (Documented limitation.)

**Captured (`NetworkEvent`):** method, url, request headers, request body, status,
response headers, response body (truncated to 1 MB), **duration in
milliseconds** (request start → response end), request/response sizes, error,
timestamps.

**Dev-server traffic is never recorded.** Metro/Expo run their own HTTP through the
app's XHR — `/symbolicate` on every LogBox stack, source-map and bundle fetches,
`/logs`, the inspector/CDP endpoints — and in a debug build it drowns out the app's
own requests. The packager's origin is read from `NativeModules.SourceCode.scriptURL`
(the url the running bundle was loaded from, and what RN's own `getDevServer()` is
built on — a deep require of that private path would resolve at bundle time, §4.1),
and any request to that `host:port` is dropped before it reaches the store. An app API
on another port of the same host is unaffected, and a release build — bundle loaded
from disk, no origin — filters nothing.

**Timing:** each row shows the request **duration in ms**; the detail view repeats it
prominently. Duration is measured from send to response completion; while a request is
in flight the row shows a pending state and the timer resolves on completion.

**Drawer features:** list with method/status/url/duration; **copy as cURL**; filter by
method/status/url; clear.

**URL ellipsis toggle:** because request URLs are often long and won't fit a list row,
the list header has a toggle controlling **where each row's URL is truncated** —
**start**, **middle**, or **end** ellipsis:

- `start` → `…/v1/users/42?tab=profile` (keeps the tail — path/query)
- `middle` → `https://api.example.com/…/users/42` (keeps host + tail)
- `end` → `https://api.example.com/v1/users/4…` (keeps the head)

Applies to the row display only (never mutates captured data); the choice persists
across sessions. `middle` is the default.

**Detail view — 4 tabs:**

1. **Response** — response body via the shared JSON/Payload viewer (§7.1); non-JSON
   bodies use its text/binary fallback. Shows the truncation banner when the body
   exceeded the 1 MB cap. An **image** body is rendered as a picture instead of
   text; an **HTML** body (`text/html`, `application/xhtml+xml`) gets a
   **Preview / Raw** segmented control — preview by default, Raw for the markup.
2. **Response Headers** — status line + response header key/value list.
3. **Request** — request body via the same §7.1 viewer.
4. **Request Headers** — method + URL + request header key/value list.

**HTML preview — the library's own web view.** The preview renders in
`BesouroWebView`, a Fabric component shipped by this library (spec in
`src/native/BesouroWebViewNativeComponent.ts`, `WKWebView` on iOS,
`android.webkit.WebView` on Android) — there is no `react-native-webview`
dependency, in keeping with §12. Two props, `source` and `onError`, and nothing
else: no navigation, no JS injection, no message bridge.

What it renders is an untrusted response body, so it is loaded with **JavaScript
disabled**, no file/content access, no shared cookie jar (iOS uses a non-persistent
data store), and **no base url** — relative subresources cannot resolve, so a
preview can never issue requests of its own that the inspector wouldn't record.
The bytes come from the captured body, so a preview also works for a session
restored from disk, and a body cut at the capture cap is labelled as truncated
beside the toggle (a document cut mid-tag renders as a torn page).

It is the one **New-Architecture-only** part of the library: no `RCTViewManager`
counterpart exists, so on the legacy renderer `isFabricRenderer()`
(`src/shared/fabric.ts`) is false, the toggle is not offered, and the tab shows
raw markup exactly as before.

### 6.2 WebSocket Inspector

**Interception:** the global `WebSocket` constructor is wrapped with a subclass that
records connect / send / receive (message) / close / error. Receive and lifecycle
frames come from `addEventListener` on the instance (so the app's own `onmessage`
and listeners are untouched); only `send` is overridden, and it always forwards.
Sockets constructed before install aren't captured.

**Captured (`WebSocketEvent`):** connection id, url, direction (send/receive),
opcode/type, payload (truncated), close code/reason, error, timestamp. Frames are
grouped by connection.

**Drawer features — clients → detail:** the tab lists **connections** (one row per
`WebSocket`), each showing url, status (connecting / open / closing / closed), frame
count, and last-activity time. Tapping a connection opens a **detail view** with the
full chronological event stream for _that connection only_ — open / send / receive /
close / error frames, payloads via the §7.1 viewer — with direction badges, a filter
(sent / received / lifecycle), and text search. Live connections update in place;
closed ones stay listed until cleared.

### 6.3 Socket.IO Inspector

> **Why a separate inspector (not the WebSocket one)?** Socket.IO rides on Engine.IO,
> which (a) starts on HTTP **polling** before upgrading to WebSocket — so the pre-upgrade
> phase never reaches a WS inspector — and (b) encodes events on the wire (`42["evt",…]`)
> plus ping/pong heartbeats. Wire-level capture would show protocol soup and miss the
> polling phase, acks, and lifecycle. Attaching at the client API level gives decoded,
> transport-agnostic capture. The two inspectors are complementary: WebSocket = wire-level
> (any raw-WS library), Socket.IO = app-level decoded.

Socket.IO frames ride over engine.io (WebSocket/polling) in an **encoded** form, so
raw WS interception isn't useful. Instead we instrument at the **client API level**.
Preferred setup — inject the `Manager` class so every socket is captured automatically:

```ts
import { Manager } from 'socket.io-client';

// One-time, in your devtools config — patches Manager.prototype.socket so every
// io() socket anywhere in the app is captured with no per-socket wiring:
Besouro.configure().socketIO(Manager).init();
```

The `Manager` class is **injected, not imported** by the library, so the package
never depends on or bundles `socket.io-client`. `Manager.prototype.socket` is the
factory every `io()` call routes through; patching it (idempotently) instruments
each socket the moment it's created. Caveats: capture reaches only sockets from the
_same_ `socket.io-client` instance, created _after_ install (running from the config
file, which imports before feature code, satisfies this), and the prototype patch is
feature-detected — an unexpected shape on a future version degrades to a no-op tab.

Sockets the prototype patch can't reach (created pre-install, or from a duplicate
copy of socket.io-client) are **not captured**. There is deliberately no per-socket
attach export: instrumenting one instance means calling into this library from feature
code, and that plants a static `besouro` import in a module that
ships in release — defeating the single dev-only `require` that makes the whole graph
strippable (§11). Injecting `Manager` in the config keeps every socket created after
install covered without that cost.

**Instrumentation:** socket.io's official hooks only — `onAnyOutgoing` (outgoing),
`onAny` (incoming), and `on(...)` for `connect` / `disconnect` / `connect_error` /
`reconnect_*` lifecycle. No `emit`/`off` reassignment. Decoded event name + args are
captured directly (no manual decoding).

**Captured (`SocketIOEvent`):** socket id, namespace, URL (`socket.io.uri`), direction, event name, args
(truncated), ack info (inbound acks — socket.io strips the outbound ack callback
before `onAnyOutgoing`), lifecycle transitions, timestamp.

**Complements the WebSocket tab:** because socket.io rides the global `WebSocket`,
its connection would otherwise appear in the WebSocket tab as encoded engine.io
frames. The WebSocket inspector filters those out (URLs carrying `EIO=` / `/socket.io/`),
so each connection shows in exactly one tab — decoded here, raw there.

**Drawer features — clients → detail:** the tab lists **captured socket clients** (one
row per instrumented socket), each showing namespace, socket id, connection status,
and event count. Tapping a client opens a **detail view** with all events for _that
client only_ — outgoing emits, incoming events, acks, and lifecycle transitions
(connect / disconnect / reconnect / errors) — args rendered via the §7.1 viewer, with
direction and event-name badges, filter, and search.

### 6.4 Console Inspector

**Interception:** monkey-patch `console.log/info/warn/debug/error`, preserving and
delegating to the original methods (so Metro/terminal output is unaffected).

**Captured (`ConsoleEvent`):** level, arguments (best-effort serialized, circular-
safe), timestamp. Optionally captures a shallow stack for `warn`/`error`.

**The drawer's own mount log is not recorded.** `AppRegistry.runApplication` logs
`Running "<key>" with <json>` whenever a surface mounts, so every tap of the bubble
would write a line into the tab the developer just opened to read. The line is
identified by its prefix alone — `Running "RNBesouro"`, built from the shared
`BESOURO_REGISTRY_KEY` (`src/core/besouro-registry-key.ts`) that
also registers the component — because the payload
(`{"rootTag":61,"initialProps":{},"fabric":true}`)
carries a fresh `rootTag` per mount and follows RN's shape, so a filter anchored on
it would silently stop matching. Filtering happens **after** the original `console`
method has run: the line still reaches the Metro terminal, since the inspector must
never alter what the host app prints.

**Native crashes (`crash` level).** An uncaught Kotlin/Java exception, a Swift
`fatalError`, a force-unwrap trap or a memory fault kills the process with the JS
thread inside it — there is no handler to run, no bridge call to make, and not even
the blocking flush the JS crash path uses (§9, _Write strategy_). Native handlers
therefore write the crash to a **spool file** and the _next_ launch ingests it:

- **Android** (`CrashCapture.kt`) — `Thread.setDefaultUncaughtExceptionHandler`,
  appending the exception and its stack trace. The JVM is alive, so this is a plain
  file write. NDK/C++ signal crashes are not covered.
- **iOS** (`BesouroCrashCapture.mm`) — `NSSetUncaughtExceptionHandler` for ObjC
  exceptions, plus `sigaction` for `SIGSEGV`/`SIGABRT`/`SIGBUS`/`SIGILL`/`SIGFPE`/
  `SIGTRAP`, which is where Swift traps and memory faults land. The signal path is
  **strictly async-signal-safe**: the file path and the `session=` line are
  pre-rendered at install, the timestamp comes from `clock_gettime`, integers are
  formatted by hand, and frames go out through `backtrace_symbols_fd` — which is why
  the spool format is line-oriented text rather than JSON.

Both are installed by the first `setCrashContext(sessionId)` call — issued from
`init()` once the session id is settled — so an app that never initializes the
library keeps its handler chain untouched, and both chain
to whatever was installed before them and let the crash proceed — the dev redbox,
Crashlytics/Sentry and the OS crash report are unaffected.

`core/crash-ingest.ts` reads the file during `init()`, turns each record into a
`crash` console row **under the session that died** (so it appears in that session's
Console tab in Session History, next to its `crashed` badge), and deletes it.
Parsing is forgiving by design: the writer can be killed mid-record, so a truncated
trailing block still yields whatever it managed to say. Not covered by any handler:
ANRs, OOM kills and `SIGKILL` — those sessions still show only as `crashed`.

**Drawer features:** level filter, text search, clear, auto-scroll.

### 6.5 Notifications Inspector

Enabled via `notificationsInspector({ expoNotifications, firebaseMessaging })` — the consumer passes
whichever provider module(s) they use (§4.1); both can be passed simultaneously.

- **expo-notifications:** `addNotificationReceivedListener`,
  `addNotificationResponseReceivedListener`; optionally wrap
  `scheduleNotificationAsync` / `presentNotificationAsync` to log _outgoing/local_
  notifications.
- **@react-native-firebase/messaging:** `onMessage` (foreground),
  `setBackgroundMessageHandler` (passthrough wrap), `onNotificationOpenedApp`,
  `getInitialNotification`, `onTokenRefresh`.

**Captured (`NotificationEvent`):** provider, phase (received / responded / opened /
scheduled / token-refresh / background), title/body/data payload, foreground flag,
timestamp.

**Device-token box:** the Notifications tab pins a **Device Token** drawer at the top
that shows the current push token with a **copy** button (via the clipboard util,
§12). Resolved from whichever provider is present —
`getDevicePushTokenAsync()` / `getExpoPushTokenAsync()` (expo-notifications) or
`messaging().getToken()` (firebase) — and updated live on `onTokenRefresh` / expo
token-change. Long tokens are shown truncated with a tap-to-expand.

> Note: pure-JS observation is limited to what the JS listeners deliver. Reliable
> capture of killed-state / OS-level delivery would require native hooks (Phase 2).

### 6.6 Element Inspector

Pure-JS UI inspector modeled on RN's built-in inspector.

**Mechanism:** on activation, overlay a transparent capture layer. On tap, the
element is resolved by one of three paths, in order.

_Renderer path (debug builds)._ The **renderer API**
`getInspectorDataForViewAtPoint` returns hierarchy, props, box model, source
`file:line`, and the element's fiber (what live prop editing drives through
`overrideProps`). It is read off the renderer's `rendererConfig` on
`__REACT_DEVTOOLS_GLOBAL_HOOK__` — the same object RN's own inspector module calls
into — rather than deep-imported from `react-native`, whose path for that module
moved in RN 0.83. The hook also supplies the root host instance to hit-test from.

Release builds link React's **prod renderer bundle**, whose `rendererConfig`
inspector entries are stubs that throw `"not available in production"` — present,
so a truthiness check is not enough to detect them. The picker discriminates on
`getInspectorDataForInstance`, the one entry the prod bundle leaves `undefined`
rather than stubbing. `overrideProps` is absent there too, so editing goes with it.

_Native path (any build)._ The same tap is hit-tested natively — a geometric
descent through the platform view tree, deliberately not via touch dispatch, which
skips the non-interactive views most worth inspecting — and reports the chain from
app root to touched view: React tag, native class, `testID`, and on-screen bounds.
Built only from public platform getters (`View.getId`/`getTag`, UIKit geometry,
`accessibilityIdentifier`), so nothing about it can be stripped or stubbed by a
release build. The React tag is the join between the two worlds: React assigns it
as the view's id/tag, so it can be searched for in a fiber tree.

_Fiber path (release builds)._ The touched view's tag is resolved to its host
fiber, and the element read off it — `memoizedProps` for props, the `return` chain
for the hierarchy. The tag comes off `stateNode.canonical.nativeTag` on Fabric and
`stateNode._nativeTag` on Paper. Notably **not** via
`canonical.publicInstance.__nativeTag`: React creates that public instance lazily
and nothing in a release build ever asks for it, so it reads `null` on every host
fiber. Those are plain fiber fields present in prod bundles; what a
release build lacks is a hook for renderers to register with, which
`element/devtools-hook.ts` supplies. It is the smallest hook React accepts:
`inject`, `supportsFiber`, and an `onCommitFiberRoot` that records roots.
`onCommitFiberUnmount` is deliberately **left undefined** — React calls it once per
deleted fiber, so leaving it out keeps us off that hot path; roots are instead
dropped when they commit with a null element. React wraps every hook callback in
its own `try/catch`, so a fault can't reach the app's commit. An existing hook
(React DevTools, RN's dev setup) always wins.

This path **views, it does not edit** — style included, since style is a prop like
any other and every edit route runs through `overrideProps`, which the prod bundle
doesn't ship. The hierarchy is best-effort: host components keep their names
(they're strings), but composites are minified in release unless the app sets
Metro's `keep_fnames`, and unnamed fibers (fragments, providers) are skipped.

Ordering is renderer → fiber → native, each falling through only when the one
above comes up empty. `ElementDetail` renders the corresponding mode: editable,
read-only, or native-only with the props and style sections dropped rather than
rendered empty.

**Editing writes the whole props object, every time.** Each commit merges _all_
edits made to the current element over the fiber's live `memoizedProps` and
delivers them in one `overrideProps` call with an empty path — which React's
`copyWithSet` resolves to the props object itself. Editing one field at a time
does not work: React derives the new props from the `memoizedProps` of the fiber
handed to it, and fibers are double-buffered, so the fiber captured at pick time
holds the props from a commit ago and each single-path write reverts the edit
before it. Merging locally makes which buffer we hold irrelevant, and re-applies
edits the app has since re-rendered away. Overrides are keyed by path (latest value
wins), discarded on the next pick, and never recorded when the write throws.
Style is committed as the whole flattened `style` prop rather than by path, since a
path into RN's style array (registered IDs, nested arrays) has no stable meaning.

**Displayed:** component name, component hierarchy breadcrumb, flattened
style/props, box-model diagram, source `file:line` (requires the JSX-source Babel
transform, on by default in Metro dev builds).

**Box model:** drawn with nested views the way RN's own inspector draws it — the
frame's `width × height` at the centre, wrapped in a padding ring and a margin
ring carrying their four edge values, with the on-screen position on a row below.
The rings come from the **declared style**, not measured layout: neither pick path
reports resolved padding, so each ring is drawn only when the style declares that
property (`padding`, `paddingHorizontal`, `paddingStart`, … all collapse onto the
same four edges) and an element with none shows the frame alone rather than a box
of zeros. A native pick has no style, so it shows the frame alone too.

This inspector **captures no events** and contributes no member to
`BesouroEvent` (§5). It holds exactly one live element at a time — the way
Chrome DevTools and RN's own inspector work — in a session-only side store, which
is also what keeps its fiber and renderer (needed for live prop editing, and not
serializable) off disk. Nothing here is persisted or appears in session history.

**Drawer features:** Chrome-DevTools-style highlight overlay, tap-through hierarchy,
props/style viewer. **In-scope for v1:** in-app display only. **Phase 2:** jump-to-
IDE via a dev-server endpoint.

### 6.7 AsyncStorage Inspector

Inspects reads/writes to `@react-native-async-storage/async-storage`. Enabled via
`asyncStorageInspector(AsyncStorage)` — the consumer passes the module (§4.1).

**Interception:** monkey-patch the AsyncStorage singleton's methods — `getItem`,
`setItem`, `removeItem`, `mergeItem`, `clear`, `getAllKeys`, `multiGet`, `multiSet`,
`multiRemove`, `multiMerge` — preserving and delegating to the originals.

**Captured (`AsyncStorageEvent`):** operation, key(s), value(s) (truncated to
500 KB), direction (read / write / delete), **duration in milliseconds** (time
the underlying async call took), error, timestamp.

**Drawer features:**

- **Operations log** — chronological list of ops with key + operation badge + the
  operation's **duration in ms**; tap a row to inspect the value via the §7.1 viewer.
- **Snapshot tab** — current storage contents (`getAllKeys` + `multiGet`), each value
  inspectable via §7.1; per-key **copy**, and optional dev-only **delete key** /
  **clear all** (behind a confirm).
- Filter by key/operation; clear log.

### 6.8 Zustand Inspector

> **Why a separate inspector (not the AsyncStorage one)?** AsyncStorage is persistent
> string KV with async op durations and delete/clear actions; Zustand is live,
> in-memory reactive state with prev→next transitions across potentially many stores.
> They share nothing but the JSON viewer, so each gets its own tab.

A Zustand store is an instance you subscribe to, not a global to patch — so the
inspector subscribes per instance (Socket.IO auto-patches its `Manager` factory
instead; there's no equivalent for zustand's `create`). The stores to watch are
declared **in the config**, keyed by the name shown in the tab:

```ts
import { create } from 'zustand';

export const useBearStore = create((set) => ({
  bears: 0,
  add: () => set((s) => ({ bears: s.bears + 1 })),
}));

// In your dev-only devtools config — import the stores and hand them over:
Besouro.configure().zustand({ bears: useBearStore }).init();
```

Stores created _after_ install are **not captured**. There is deliberately no
per-store attach export: calling one means importing this library from feature code,
and that plants a static `besouro` import in a module that ships in
release — defeating the single dev-only `require` that makes the whole graph
strippable (§11). The config file imports feature modules, never the reverse.

We **never import `zustand`** — the inspector accepts a structural
`{ getState, subscribe }`, so both `create(...)` (the hook carries the store API) and
`createStore(...)` (the vanilla store) satisfy it, and the peer never enters the
bundle (§4.1).

**Instrumentation:** record the store's initial state at attach time, then subscribe
via `store.subscribe((nextState, prevState) => …)` and record one event per
transition. `subscribe` already returns an unsubscribe, which the inspector keeps as
that store's detach — part of the inspector teardown contract (§5), not something the
app calls.

**Captured (`ZustandEvent`):** store id, store name, whether it's the initial
snapshot and whether that baseline was written because the app reloaded, the
**changed top-level keys** (reference-compared next vs. prev), the
serialized next state (truncated to 500 KB), timestamp.

**A reload writes a new baseline, badged as one.** A full JS reload tears down the
heap, so `create` runs again and the store really is back at its initial state —
while the session it belongs to is _adopted_ (§9), leaving the pre-reload rows above
the new baseline in one timeline. The row is therefore recorded again and carries
`isReload`, which the UI badges **App Reload** where an ordinary baseline reads
**Initial state** — one badge, the more specific label winning, since a reload's
baseline is both. Suppressing it (which this once did,
reading it as a duplicate of the row the adopted session already held) is what made
the pane lie: it showed the last pre-reload value, then a change diffed against the
fresh one, with the reset itself recorded nowhere.

The flag is native (`core/warm-reload`) because nothing in JS survives a reload to
report one. The other kind of repeat — a re-install inside one live runtime, from
Fast Refresh re-running the consumer's devtools module — _is_ a duplicate and is
still skipped: there the store object survives holding its current value, and the
mark it carries is what says so. The same applies to Jotai atoms (§6.10) and to the
Redux store (§6.9).

**Current state comes from the rows.** Every `ZustandEvent` carries the whole
serialized state, so the **newest row per store is that store's current state** —
there is no second copy to keep, and the tab reads one source in a live session and
a past one alike. The list is the grouped aggregate the change counts already come
from (`EventGroup.newest` brings each store's name); the detail's top pane fetches
that row's heavy `state` column; and the header is all that distinguishes the two
sessions — **Current State** while the session runs, **Last Recorded State** once it
has ended.

This is the MMKV decision (§6.7) applied to Zustand. An in-core registry holding the
serialized state would hold the same string the row already carries, with the tab
choosing between them by session — one fact in two places, free to drift. It was
also exactly what `BROWSER_INSPECTORS` guards against: right after a reload every
store is back at its initial state, so a registry-fed list under a header dated last
week looks entirely plausible while describing a different run.

**What the registry still holds** is what no row can say: the store's declared name,
and whether this launch is still subscribed to it. Its one job for the list is the
store whose initial capture threw inside `safeCapture` — it has no rows, and
rows-only would hide it outright rather than show it as empty. See
`store/stores.ts` and `utils/store-list.ts`. The Jotai tab does the same (§6.10);
the Redux State pane, whose rows carry deltas rather than whole states, cannot, and
keeps its registry (§6.9).

**Drawer features — stores → detail:** the tab lists **attached stores** (one row per
configured store), each showing name, attached/detached status, change count,
and last-update time.

The count is **changes**, which is not the same as rows: a baseline records where the
store stood, not a change to it, so it is excluded in SQL
(`EventGroupQuery.countWhere`) rather than subtracted afterwards — "rows minus one
baseline" stops being true the moment a reload writes a second one. A store nobody
has touched therefore reads 0 changes while still carrying the row its state is read
from. The list is ordered by **attachment**, not by activity: the stores are declared
once in the config, so this is an inventory rather than a feed, and re-sorting it
whenever some _other_ store changed would move the row a reader was reaching for
(`shared/utils/attach-order`, shared with §6.10 and §6.11).

Tapping a store opens a **detail view** with a segmented toggle:

- **Current State** — the newest recorded state via the §7.1 viewer, re-rendering as
  rows land (read from the store's newest row).
- **Changes** — the chronological transition history; each row shows the changed
  keys — a baseline row's are the store's top-level keys, so the column says the
  same kind of thing on every row — plus a badge on the baselines: **Initial state**,
  or **App Reload** when a reload wrote it. Tapping one shows that transition's
  changed keys plus resulting state via the §7.1 viewer.

Filter/search matches store name and serialized state, and runs **in SQL** over the
grouped query — so it reaches the whole session, and a past session too, rather than
only what the list holds in memory.

**Clear empties the change log and nothing else.** The attached stores stay listed,
and Current State goes on showing what each store holds — which needs saying, because
this tab keeps no state row to survive the delete the way §6.9 and §6.11 do: the
newest change row _is_ the state, and that row is exactly what Clear removes. So with
no rows to read, the pane reads the live store instead (`core/live-state`), and goes
back to reading rows the moment one is written. A past session never takes that path:
its state is what its rows recorded, and this launch's stores describe a different
run. Nothing is written back into the emptied history to achieve it.

### 6.9 Redux Inspector

> **Why a separate inspector (not the Zustand one)?** They look alike and are not.
> A Zustand transition is anonymous — you learn _what changed_. A Redux transition is
> named: the action is the unit of interest, and the state change is its consequence.
> That inverts the whole tab (a log of actions, not a list of stores), and it inverts
> what a row stores. Folding them together would mean one of the two rendering
> badly.

**One store.** `redux(store, rootReducer)` is singular because Redux is:
"Only One Redux Store Per Application" is a _Priority A: Essential_ rule in Redux's
own style guide, and the genuine multi-store cases — SSR building a store per
request, micro-frontends composing independent apps — are web and server patterns
with no React Native analogue. A second call **replaces** the first, which is what
the name says and what keeps Fast Refresh from installing capture twice.
An overload taking a map of stores remains available as a purely additive future
move if a real case appears.

**Instrumentation: wrap the root reducer.** This is the part worth defending,
because two more obvious seams both fail:

- **Patching `store.dispatch`** sees only what feature code dispatches.
  `applyMiddleware` composes its chain over the _pre-patch_ dispatch
  (`dispatch = compose(...chain)(store.dispatch)`), so everything a middleware emits
  from inside — thunks, `createAsyncThunk`'s pending/fulfilled/rejected, all of RTK
  Query — never passes through the patched property. Those are exactly the actions a
  developer opens this tab to find.
- **The DevTools-extension globals** (`__REDUX_DEVTOOLS_EXTENSION_COMPOSE__`) do
  work, and are stable across RTK versions, but only if the library wins a load-order
  race against the consumer's store module — and they mean owning a global we did not
  define and may have to share with a real extension.

The reducer is called by the base dispatch at the **bottom** of the middleware
chain, so wrapping it observes every action that reaches state, whatever emitted it —
through public API, with no load-order requirement. It is the technique the real
extension's own `instrument()` uses. `store.replaceReducer` is the installer, and it
dispatches `@@redux/REPLACE` as a side effect, which is the pass that becomes the
initial-state row.

The inspector also **patches `store.replaceReducer` itself** and re-wraps whatever is
passed later. An app using `combineSlices` or lazy reducer injection calls it at
runtime, and without the re-wrap our wrapper would be silently dropped mid-session —
capture would just stop, with nothing to explain it.

What this cannot see is an action a middleware swallows before the reducer runs.
Those change no state, and the extension has the same blind spot.

**The root reducer is required, not a convenience.** Redux exposes no way to read a
store's current reducer back, so the only way to wrap it is to be handed it. That is
the entire call-site cost:

```ts
// app/store.ts
export const rootReducer = combineReducers({ cart, auth });
export const store = configureStore({ reducer: rootReducer });

// In your dev-only devtools config:
Besouro.configure().redux(store, rootReducer).init();
```

We **never import `redux`** — `ReduxStoreLike` is a structural
`{ getState, dispatch, replaceReducer }`, satisfied by `createStore`,
`configureStore`, and anything `applyMiddleware` returns (it spreads the base store,
so `replaceReducer` survives and still closes over the same reducer slot). The peer
never enters the bundle (§4.1).

**Captured (`ReduxEvent`):** action type, whether it's the initial or the closing
row, whether an initial row was written because the app reloaded (§6.8), whether the state it carries is the whole tree or a delta, the
**changed nested paths** (capped at six — see below), the
**changed top-level slices** (reference-compared next vs. prev, sharing
`core/state-diff.ts` with the Zustand inspector), the serialized action minus its
`type` (truncated to 100 KB), the serialized value of **only the changed slices**
(truncated to 500 KB), timestamp.

**Why a row holds no full state.** Zustand can afford a whole serialized state per
transition because a Zustand store is small and its transitions are user-paced.
Redux is dispatched by middleware, timers and RTK Query polling: a 200 KB tree over
500 actions is ~100 MB in one table, and retention prunes whole _sessions_, never
rows, so nothing throttles it mid-session. A row keeps the delta; the whole tree is a
registry read away. The initial row is the one exception — it is the session's single
baseline, and every key is "changed".

The payload gets its own budget rather than sharing the state one because the thing
that routinely grows here is an RTK Query `fulfilled` action carrying a whole API
response — which the network inspector has already captured at full fidelity (1 MB).
A second uncut copy per action buys nothing.

**The closing snapshot.** One row per session carries `isFinal` and the **whole**
state tree — the state that session ended on, which after a crash is usually the
thing a developer most wants. It is written when the app backgrounds and from the
`ErrorUtils` fatal handler (via `captureEventSync`, so it lands before RN stops the
app), and refreshed on a 2 s throttle while actions are flowing so that a **native**
crash — which kills JS before any handler can run — still leaves a recent one. The
row is created once and patched in place thereafter, so it never grows the table,
and the throttle serializes nothing while the app is idle.

This is what the archived State view reads: an equality filter on `is_final`, not a
replay. Reconstructing state at an _arbitrary_ past action would mean folding every
row of the session in order, which is a different feature — but the per-row
`changed_state` deltas are what would make it possible, which is why they are kept.

The inspector installs its own AppState listener and crash hook rather than being
called by the session lifecycle, so `core/` stays inspector-agnostic and never
learns that Redux exists. `installCrashCapture` chains handlers, so this does not
displace the lifecycle's own.

**Live current state:** the one inspector that still mirrors state into an in-core
registry (a live view, not persisted with the session), and it holds it **by
reference, serialized only when read**. Zustand and Jotai dropped theirs because
their rows carry whole states; a Redux row carries only the slices one action
touched, so the newest row is a delta and not the tree. Rebuilding the tree would
mean folding the whole log, and writing it per dispatch — let alone serializing it
eagerly — would be the single heaviest thing this library imposes on the host app.
Redux state is immutable, so holding the newest reference is free.

**Drawer features — two panes, no list level:** with one store there is nothing to
list, so the tab opens directly on a `DetailTabs` strip — the same underlined
switcher the Network and Notifications detail views use, here with its opt-in
`fill`, which divides the width between the two rather than packing them left (the
scrolling default is for many-sectioned strips like Network's five) — between:

- **Actions** — the flat, chronological action log. Each row shows the action type,
  what it changed (or a _no state change_ marker) and the time, with a badge on the
  baselines: **Initial state**, or **App Reload** when a reload wrote it.

  The subtitle lists the **nested paths** (`counter.value`), not the slices, and is
  **omitted entirely** when the single path is just the action type's prefix. RTK
  names actions `slice/action`, so `counter/increment` changing `counter` tells the
  reader what they have already read — and a line that is noise on most rows trains
  them to ignore it on the rows where it matters: an action that changed _nothing_
  when it should have, one that changed _more_ than its own slice, or one that
  changed a _different_ slice than its name suggests. Suppressing the redundant
  case is what leaves the caption meaning something.

  Recording those paths reuses the flash's diff (`utils/changed-paths.ts`) with a
  cap of six. The cap bounds the _walk_, not just the output, and Redux's
  immutability means an untouched slice is reference-equal and skipped whole — so a
  typical action visits one slice and stops. Tapping one opens a detail with the changed slices as pills and
  `Payload` / `Changed slices` behind `DetailTabs` — each a full-screen §7.1 viewer,
  because a serialized RTK Query response and a changed slice are both full-screen
  objects.

- **State** — for a live session, the whole current state through the §7.1 viewer,
  with **changed values flashing** briefly as actions arrive (see §7.1). For a past
  session it reads that session's closing snapshot instead, under a header naming
  it as such, so the pane is still offered: what it must never do is show the
  _current_ store under a header dated last week, which is the mistake
  `BROWSER_INSPECTORS` exists to prevent.

The panes are side-by-side rather than stacked (as `ZustandDetail` stacks Current
State over History) because a Redux state tree and a log running to thousands of
entries each need the full screen; halving both would leave neither readable.

Filter/search matches action type, payload and changed slices. **Clear empties the
action log and leaves the State pane intact** — the closing-state row is excluded
from the delete (`TableSpec.stateColumn`), because it records what the store is
_holding_ rather than an action it performed.

### 6.10 Jotai Inspector

> **Why not the Zustand inspector?** They end up looking alike — a named thing, a
> current value, a change history — but they are reached differently. A Zustand
> store is an instance you subscribe to; a Jotai atom is a _value_ with no state of
> its own, and the state lives in a store you must also be given. That difference is
> the whole API, and merging the tabs would mean one of the two lying about what it
> is watching.

**Declared atoms.** `jotai(store, { cart: cartAtom })`. Jotai exposes no way
to enumerate the atoms a store has touched, so there is nothing to find by
inspection — these are the only atoms that can be watched. The store comes too
because that is what holds the values: `getDefaultStore()` for an app with no
`Provider`, or the store passed to one.

**Why not auto-discovery.** `INTERNAL_getBuildingBlocksRev3` and the experimental
`storeHooks` would surface every atom a store touches, labelled by `debugLabel`,
with no declaration at all — including derived atoms nobody named. They are also
unversioned internals that jotai documents as experimental: a minor release can
change them with no type error, and capture would fail silently. Declaring atoms
uses `get` and `sub` and nothing else, which is the same bet §4.1 makes everywhere
else. The cost is real and worth stating plainly: **an atom you did not name is
invisible**, and so is one created after `init()`.

As with Zustand, there is deliberately no per-atom `attach()` export — calling one
would plant a static `besouro` import in feature code that ships in release,
defeating the single dev-only `require` (§11).

We **never import `jotai`**: `JotaiAtomLike` is a structural
`{ read, debugLabel?, toString }` and `JotaiStoreLike` is `{ get, sub }`. Both
declare their methods with _method_ syntax rather than property syntax, which makes
the parameters bivariant — that is what lets a real `Store`, whose `get` is
`<Value>(atom: Atom<Value>) => Value`, satisfy the looser shape.

**Instrumentation:** read each atom's value at attach time, then `store.sub(atom, …)`
and read again on every notification. Jotai's `sub` hands its listener **nothing** —
no next, no previous — so the new value comes from a `get` and the previous one is
remembered by the inspector. `sub` returns its own unsubscribe, which becomes that
atom's detach (§5).

**Captured (`JotaiEvent`):** atom id, atom name, whether it's the initial row and
whether it was written because the app reloaded (§6.8), the changed top-level keys, a **preview**, the serialized value (truncated to 500 KB),
timestamp.

**Why a preview column, which Zustand has no need for.** A Zustand store's state is
always an object, so its changed keys describe the change. An atom is as often
`atom(0)` or `atom('idle')` — no keys at all, and the _value_ is the entire story.
The value itself is a heavy column that a list query must not select, so the preview
is stored separately as a summary column: the head of the serialized value, clipped
to 120 characters with newlines collapsed. `safeStringify` emits compact JSON, so an
object is already one line and its first 120 characters are its first few fields —
`{"items":["SKU-1"],"total":10}` says what the value _is_, where a rendering of its
shape (`{…} 2`) would only repeat that it is an object with two keys, which the
changed keys beside it already cover. One rule covers primitives, objects,
`Map(2) {…}` and `[Function foo]` alike, so there are no per-type cases to keep in
step.

**Current value comes from the rows**, exactly as Zustand's state does (§6.8). Every
`JotaiEvent` carries the whole serialized value _and_ its preview, so the **newest
row per atom is that atom's current value**, and one query serves a live session and
a past one. The list is the grouped aggregate the change counts already come from
(`EventGroup.newest` brings each atom's name and preview in summary columns); the
detail's top pane fetches that row's heavy `value` column; and the header is all
that distinguishes the two — **Current Value** while the session runs, **Last
Recorded Value** once it has ended.

Keeping the value in an in-core registry as well would be the drift
`BROWSER_INSPECTORS` guards against: right after a reload every atom is back at its
initial value, so a registry-fed list under a header dated last week looks entirely
plausible while describing a different run.

**What the registry still holds** is the atom's declared name and whether this launch
is still subscribed — facts no row carries. Its one job for the list is the atom
whose first `get` threw inside `safeCapture`: no rows, and rows-only would hide it
rather than show it as empty. See `store/atoms.ts` and `utils/atom-list.ts`.

**Drawer features — atoms → detail:** the tab lists the watched atoms (name, current
preview, change count, last-update time), counted and ordered exactly as §6.8
describes — baselines out of the count, subscription order rather than activity.
Tapping one opens the same two-pane split `ZustandDetail` uses — **Current Value**
over **History** — since an atom holds one value and changes at human pace, with
nothing needing a full screen of its own.

The tab's two rows answer different questions and so show different things. The
**atom list** row shows the preview: across unrelated atoms, "what does this hold?"
is the useful answer. A **history** row shows the **changed keys** instead, because
it sits under a pane already displaying the atom's whole current value, and
successive previews of a growing object are nearly indistinguishable — a column of
`{"items":["SKU-1"],"total":10}` then `{"items":["SKU-1","SKU-2"],"total":20}` tells
you almost nothing about which row is which. It falls back to the preview when there
are no keys, which is what keeps `atom(0)` from rendering a blank row — the case
Zustand never has to handle — and a **baseline** row shows the preview outright,
since it is the only place the atom's starting value appears. That the row _is_ a
baseline is the badge's job, not the column's: naming it there left a Jotai history
column reading `Initial state · 0` between bare `0` and `1`.

Both rows clamp to one line (`MonoText` takes `numberOfLines`), since a serialized
value is arbitrarily long and a row that grows to three lines destroys the
timeline's scannability.

Filter/search matches atom name and serialized value. **Clear empties the change log
and nothing else**: the atoms stay listed and each keeps showing its value, read from
the live atom for as long as it has no row to read — the same fallback §6.8 describes,
for the same reason, and it fills the list row's value line as well as the detail
pane's.

### 6.11 MMKV Inspector

> **Why a separate inspector (not the AsyncStorage one)?** Both are persistent
> key/value storage, and there the resemblance stops. AsyncStorage is one async,
> string-only module singleton with batch operations and op durations worth showing.
> MMKV is _many_ synchronous, typed instances with no batch operations and no
> duration worth reporting — a shared tab would need an instance column AsyncStorage
> never fills, a duration column MMKV can only fill with zero, and an operation union
> where half the members are unreachable from either side.

Inspects writes to `react-native-mmkv`. Enabled via
`mmkv({ default: storage })` — the consumer passes the instances (§4.1),
keyed by the name each appears under in the drawer.

Plural where §6.7 is singular, and that is the substantive difference: MMKV instances
are created by the app (`createMMKV()` in v4, `new MMKV()` before it), and an app
routinely holds several — a default one, an encrypted one, one per signed-in user.
An inspector that could watch only "the" instance would watch the wrong one as often
as not.

**Version span.** `MMKVLike` is structural across v2 through v4, which disagree on
both construction and removal: v2/v3 export an `MMKV` class with `delete(key)`, v4
exports `createMMKV(config)` returning a Nitro **C++ HybridObject** with
`remove(key)`. v3 and v4 are together the overwhelming majority of installs, so
neither can be dropped, and the row records the operation as `remove` either way —
which spelling the app's library version used is not a fact about the app.

**Interception — two paths.** The preferred one wraps the instance's own `set`,
`remove`/`delete` and `clearAll`, which names each operation exactly. That works on
v2 and v3, where the instance is an ordinary JS object. A v4 HybridObject's methods
are native-backed, and assigning over one either throws or silently does not take, so
each patch is verified by comparing the slot before and after; if any of the three
does not take, all are rolled back and the instance falls back to its own
`addOnValueChangedListener`. The fallback still sees every write, but it is handed
only a key: `set` versus `remove` is inferred from `contains(key)`, and a `clearAll`
arrives as one removal per key rather than a single row. Which path an instance is on
is recorded on its snapshot, and the tab says so — an inferred log that looks like an
exact one is worse than either.

**Typing a value means probing for it.** MMKV exposes no "what type is this key",
so the sweep tries `getString`, `getNumber`, `getBoolean`, `getBuffer` in turn. That
assumes a mismatch _returns_ undefined, which is what the v2/v3 JS classes and the
library's own mock do — but a v4 instance is reached through Nitro's type
marshalling, where a mismatch can instead throw, or answer `''`. So the probe defends
against both: each getter is tried defensively, and a _non-empty_ string is required
to claim the key. An empty one is held back until every other getter has declined,
then reported as the value if none did — otherwise every number and boolean would be
typed as an empty string and lose its value. An unreadable key is skipped rather than
allowed to abort the sweep: because the sweep runs inside `safeCapture`, one raising key
would otherwise take the entire snapshot silently, leaving the Store pane
permanently empty. For the same reason an _attached_ instance is listed even when it
has no rows at all — a disappearance is a worse failure than an empty tab.

**Reads are not captured, and that is a design decision, not a gap.** MMKV's getters
are synchronous JSI calls that apps put in render paths _precisely because_ they are
cheap. Wrapping them taxes the path that was chosen for being untaxed, and a screen
re-rendering in a loop would bury the writes — which is what a storage log is read
for — under thousands of reads. The Contents view shows every key regardless, which
is what a reader actually wants from a key/value store.

**Captured (`MMKVEvent`):** instance id and name, operation (`set` / `remove` /
`clearAll`), key, value type (`string` / `number` / `boolean` / `buffer`), value
(truncated to 500 KB), direction (write / delete), error, timestamp. No
`durationMs`: the calls are synchronous, so every value would round to zero and the
column would report precision the number does not have. Buffers are _described_
(`<binary, N bytes>`) rather than captured — the bytes are opaque to every viewer we
have, and a blob would spend the session's storage budget rendering as mojibake.

**Current contents live in the database, not in memory.** The inspector writes one
**snapshot row** per instance per session — `operation: 'snapshot'`, `isFinal: true`
— carrying the instance's whole contents as a flat `key → value` object. It is
created at attach and _patched in place_ thereafter: refreshed on a throttle while
writes flow, on background, and on a JS fatal, exactly as the Redux inspector keeps
its closing state (§6.9). One row per instance per session, so the table does not
grow with a row per sweep however long the session runs.

Reading is deliberately lazy. Unlike Redux — which is handed its whole state on every
dispatch and can keep the reference for free — reading MMKV's contents means sweeping
`getAllKeys()` and a getter per key, so the sweep is throttled to at most one per
interval. The throttle is **leading-edge**: the first write of an interval sweeps at
once, and only a burst is made to wait for the timer. Trailing-only would have left
the Store pane stale after every ordinary write, which is the common case, for no
saving the ceiling does not already give.

Three things follow from putting contents in the database rather than an in-memory
mirror:

1. **The State pane is the same query live and archived.** There is no registry
   describing "this launch" that a past session must be prevented from reading, so no
   asymmetry to special-case in the UI.
2. **Every attached instance appears in the list**, because attach gives it a row.
   Zustand and Jotai reach the same place by a different route (§6.8): their attach
   records the store's initial state, which _is_ an ordinary row, so they too list
   from rows and keep a registry only as the fallback for a capture that threw.
3. **No incremental mirror to drift.** An earlier design patched an in-memory entry
   map per captured change, which was cheaper per write but could disagree with the
   store — and had no answer at all for a write from another process sharing the
   file. A snapshot re-reads.

The remaining cost is a burst's tail: writes after the first in an interval are
visible at the next sweep rather than instantly, and an out-of-process write is not
seen until something else marks the instance dirty.

**Drawer features — instances → detail:** the tab lists the **attached instances**,
each with its operation count and last change. Built from rows like every other list
in §6, since attach writes each instance's snapshot row — an instance that is only
ever _read_ still appears, which for a key/value store is the normal case rather than
an edge one. Ordered by **attachment**, not by activity: `mmkv(...)`
declares a fixed handful, so the order the consumer wrote them in is the one they
expect, and a snapshot row patched forward on every sweep would otherwise reorder the
list by whichever instance the sweep loop reached last (`shared/utils/attach-order`,
shared with §6.8 and §6.10).

The instance detail is **two full-width panes behind a tab strip**, following the
Redux tab rather than the stacked panes of Zustand and Jotai: an instance's contents
and its write log each deserve a whole screen, and the tab strip is also what removes
the live/archived branch from the layout. **Operations** leads and **Store** trails,
the same order Redux puts its actions before its state.

- **Operations** — every non-snapshot row: one per captured write or removal, paged;
  tap for the value, a heavy column fetched only when the detail opens. The detail
  hands the value to the §7.1 viewer only when `valueType` is `string`, since that is
  the only type that can be holding JSON; a number, boolean or buffer descriptor is
  one short scalar and renders as a plain field, with nothing for a collapsible tree
  to act on.
- **Store** — the snapshot row's contents, as label/value rows. Deliberately _not_
  the §7.1 JSON viewer: an MMKV instance is not a document but a flat set of
  independently-typed keys, and folding them into one object would invent a structure
  the store does not have. The network tab's header list is the right precedent, and
  it shares the same `KeyValueRow`.

Filter/search matches instance name, operation and key. **Clear empties the operation
log and leaves the Store pane intact** — the snapshot row is excluded from the delete
(`TableSpec.stateColumn`), because it records what the app is _holding_, not what it
did, and a devtool's Clear has never reached into the app's own storage. The instance
stays listed, reading 0 changes.

---

## 7. UI

- **The floating bubble** — drawn **natively** (Android DecorView / iOS UIWindow), not
  in React, so it needs no user JSX and cannot be unmounted by the app's own tree.
  - **Draggable** on the native side; it can be dragged anywhere and snaps to the
    nearest edge, with its last position kept natively.
  - **Tap to open** the drawer: native creates the `RNBesouro` ReactSurface
    on demand, sharing the same JS context and store as the app.
  - It takes **no configuration**. Its only JS-driven property is color, pushed by
    `core/bubble-appearance.ts` to track the resolved theme and accent (§13).
- **Icons — no icon library.** Icons are composed from **React Native primitives**
  (`View` shapes via `borderRadius` / borders / `transform`), with **no icon font or
  icon library** (`react-native-vector-icons`, `@expo/vector-icons`, etc.) and no SVG
  dependency. The icon set is: **Copy, Close, Search, Gear** (settings), plus the bubble
  **Bug** — the bug is best-effort (body + legs + antennae from a few Views); if that
  shape proves too fiddly with plain Views, fall back to a simple debug glyph/monogram.
  All icons live in one internal `Icon` set, are theme-aware (light/dark), and take
  size + color props.
- **Clear is a text button, not an icon** — localized via i18n ("Clear" / "Limpar" /
  "Borrar"). Other affordances outside the icon set (export/share, the URL
  ellipsis-mode toggle) use text labels or segmented controls rather than glyphs.
- **Drawer** — full-screen modal overlay with a top tab bar (one tab per enabled
  inspector) + a **session switcher** (current + previous/crashed sessions) + global
  actions (export/share — **no global clear**; clearing is per-tab, see below).
  **Export formats: HAR** for the network tab (opens in browser devtools), **JSON**
  for any inspector's events.
- **Per-tab status & failure UX:** each tab reflects its state — `active`, **"not
  installed"** (missing optional peer, with install hint), or **"error"** (an inline
  warning + Retry from its error boundary). See §5 → Resilience.
- Rendered inside the app's React tree, so the element inspector and overlays work.
- **Design principle — utility over polish.** Dense, legible, unobtrusive. No
  decorative styling and no animation beyond the bubble drag. The UI is optimized for
  scanning data fast, not for visual flair.
- **Copy everywhere.** Every meaningful value exposes a copy affordance (copy icon /
  long-press): URLs, individual headers and header values, request/response bodies,
  console lines, WebSocket & Socket.IO frames/args, AsyncStorage keys and values, the
  device push token, element props/style and source `file:line`, plus JSON subtrees
  and paths from the §7.1 viewer, and whole-session / HAR / JSON export. All routed
  through the clipboard util (§12); the affordance hides itself when the native
  clipboard is unavailable (e.g. tests / web).
- **Clear per tab.** Every inspector tab has its own **Clear** button that empties only
  that inspector's captured events (`store.clear(kind)`). There is **no global "clear
  all"** — clearing is always scoped to the active inspector. Clearing deletes that
  kind's rows for the current session and tells the list to discard its loaded pages.
- **Search per tab.** Every inspector tab has a **search box** that filters its list in
  real time (case-insensitive substring by default) against that inspector's relevant
  fields — Network: method/url/status; Console: message text; WebSocket/Socket.IO:
  url/namespace/event name/payload; Notifications: title/body/data; AsyncStorage:
  key/value; Element: component name. Search combines with any existing per-tab filters
  (level, method, direction, …), and is distinct from the in-payload search inside the
  §7.1 JSON viewer.
- **Theming:** light + dark, following system appearance by default (via
  `useColorScheme`), overridable through config. Minimal built-in styling, no UI-kit
  dependency.
- **Localization (i18n):** English (default), Portuguese, and Spanish. All UI strings
  are externalized into per-locale string tables; locale is auto-detected from the
  device and overridable via config. Self-contained — **no i18n library dependency**.
  The device locale comes from the library's own TurboModule (`getDeviceLocale`,
  synchronous, BCP-47), _not_ from React Native internals: Android reports the app's
  configuration locale (honours a per-app language override), iOS the head of the
  user's preferred-language list. Only the primary subtag is used — `pt-BR` and
  `pt-PT` both resolve to `pt` — and an untranslated language falls back to English,
  as does a host with no native module linked.
  (Captured data — logs, payloads, component names — is never translated.)

### 7.1 JSON / Payload Viewer (shared component)

A **virtualized** JSON viewer reused across inspectors to render potentially **large**
responses/payloads without blocking the JS thread or exhausting memory. Consumers:
Network (request/response bodies), Socket.IO args, WebSocket payloads, Console object
args, Element props/style, AsyncStorage values + snapshot, Zustand state, Redux
payloads + state.

**Problem it solves:** pretty-printing a multi-MB JSON blob into a single `<Text>`
freezes the UI and can OOM. So we never render the whole document at once.

**Approach — flatten to lines + `FlatList`:**

1. **Flatten** the parsed JSON into an ordered array of **line descriptors**, one row
   per token line:

   ```ts
   interface JsonLine {
     id: string;
     depth: number; // indent level
     path: string; // e.g. "data.items[3].name" (for copy/search)
     kind: 'key-value' | 'key-open' | 'open' | 'close' | 'primitive';
     keyText?: string; // object key, if any
     valueText?: string; // rendered primitive (string/number/bool/null)
     valueType?: 'string' | 'number' | 'boolean' | 'null';
     collapsible: boolean; // object/array openings
     collapsed: boolean;
     childCount?: number; // shown in collapsed preview: "{…} 12"
     hasTrailingComma: boolean;
   }
   ```

2. **Render with `FlatList`** (virtualized) — only visible rows mount. Each row is a
   lightweight component: indent spacer + **syntax-highlighted** tokens (key / string /
   number / boolean / null / punctuation colored from the active theme). `getItemLayout`
   with a fixed row height keeps scrolling smooth and enables scroll-to-match.

3. **Collapse/expand** — tapping a `*-open` row toggles `collapsed`; the visible-line
   array is recomputed to drop/restore that node's descendants. Collapsed nodes show a
   preview (`{…} 12 keys`, `[…] 340 items`).

4. **Large-payload guards:**
   - Flattening is **lazy/incremental** for very large docs (flatten on first view, off
     the render path); optionally cap initial expansion depth (deep nodes start
     collapsed).
   - A **max-line ceiling** with a "show more" affordance for pathological payloads.
   - Respects the truncation applied at capture — shows a "payload too large"
     banner rather than implying completeness.

5. **Search** — filter/highlight matching keys or values; scroll-to-next-match using
   the fixed row height.

6. **Actions** — copy value, copy subtree (re-serialized), copy JSON path.

7. **Non-JSON fallback** — when a body isn't JSON (HTML, plain text, binary/base64),
   fall back to a **virtualized text viewer** (same `FlatList`-per-line strategy, split
   on newlines) with content-type detection; binary shown as a size + hex/preview
   summary rather than parsed.

**Parsing/perf notes:** parse off the first render frame; guard `JSON.parse` in
try/catch (fall back to the text viewer on failure); flattened arrays are memoized per
event id so re-opening a row list is instant.

**Change flash (optional).** A viewer rendering _live_ state — the Redux State pane
today (§6.9) — takes an optional `flash: { paths, nonce }` and briefly tints the rows
whose value just changed, fading out over ~900 ms. Several details are load-bearing:

- It keys on `JsonLine.path`, **never `id`**. Ids are positional (`line-N`) and are
  reassigned on every re-flatten — which is precisely what a value change causes, so
  an id-keyed flash would land on whichever row inherited the number.
- `nonce` must change on every publish even when `paths` does not, or a value
  changing twice in a row would flash only once.
- A flashed **container takes its subtree with it**, through its matching close line.
  The diff reports the shallowest differing path, so a replaced object or a resized
  array arrives as the container's path alone — tinting only that line highlights
  `"items": [` and leaves the data inside it plain, which reads as the key having
  changed rather than the values.
- It fires **once per change**, not once per mount. The pane that plays it is
  unmounted whenever the reader switches panes, so the high-water mark of what has
  already flashed lives in the registry beside the revision counter
  (`redux/store/snapshot.ts`), not in the component. A flash points at a change the
  reader just watched happen; replaying it on every visit points at nothing.

It animates the **opacity of an overlay**, not the row's `backgroundColor`: color is
not native-driver-able, and a JS-driven animation per changed row is exactly the work
the drawer should not be doing while the app dispatches. The producing side is gated
too — the diff that fills `paths` (`redux/utils/changed-paths.ts`, which emits these
exact path strings) is skipped entirely when nothing is subscribed, so a closed
drawer costs nothing.

---

## 8. Configuration Reference

`Besouro.configure(options)` takes `BesouroOptions`. `inspectors` switches
off the five that default on; the other four are enabled by their inspector method (§4).

Payload truncation is deliberately absent from this table — the limits are fixed per
inspector and listed in §5.1.

```ts
interface BesouroOptions {
  // Retained sessions; older ones are pruned at startup. The ONLY retention
  // control: events within a session are never capped (§9).
  maxSessions?: number; // default 10
  theme?: 'system' | 'light' | 'dark'; // default 'system'
  accent?: string; // '#rrggbb'; default = the theme's own accent
  locale?: 'system' | 'en' | 'pt' | 'es'; // default 'system' → falls back to 'en'
  inspectors?: InspectorToggles; // turn off a default-on inspector
}

// The self-sufficient inspectors only — all default true. The other four are
// governed by whether their inspector method was called, so listing them here would be
// two switches for one lamp.
interface InspectorToggles {
  network?: boolean;
  console?: boolean;
  websocket?: boolean;
  element?: boolean;
  fileSystem?: boolean;
}

type Inspector =
  | 'network'
  | 'websocket'
  | 'socketio'
  | 'console'
  | 'notifications'
  | 'element'
  | 'asyncStorage'
  | 'zustand'
  | 'fileSystem';
```

The bubble takes no config. It is mounted natively (§13, `native/`), positioned and
dragged on the native side, and its only JS-driven property is color — pushed by
`core/bubble-appearance.ts` to follow the resolved theme and accent.

---

## 9. Persistence & Session Management

Captured events live in **SQLite**, not in memory. The store holds none of them (§5):
every event is written as it is captured and read back a page at a time. This is what
bounds the library's memory — the JS heap holds what the user is looking at, not what
the app has done since launch.

### Backend

Persistence needs **no consumer wiring and no optional peer**. The library ships one
implementation, `openDatabase()`, over the SQLite each platform already provides —
`libsqlite3` on iOS, `Context.openOrCreateDatabase` on Android — through its own
TurboModule (`native/NativeBesouroDatabase`). Nothing to install, nothing to
link:

**There is no opt-out.** The database is where captured events live, so declining it
would leave the drawer with nothing to show. No native module linked (Expo Go, web,
tests) means no database and no capture at all: events are dropped, and the drawer
replaces its tabs with a troubleshooting notice rather than showing empty ones
(`core/database/status.ts`). Three failures are distinguished — `unavailable` (module
not linked), `unopened` (open/migrate threw), and `write-failed` (the queue gave up
after `MAX_CONSECUTIVE_FAILURES`); only the last keeps the tabs, since rows captured
before it are still readable. Resolution lives in `connectDatabase()` in
`core/controller.ts`.

The native module is a thin, generic SQL port — `open` / `execute` / `query` /
`batch`, with parameters and rows crossing the bridge as JSON strings. Schema,
queries and row mapping all live in JS (`core/database/`), so a column change
never touches two native implementations. The `Database` port that abstracts it is
also what lets the unit tests run the **real** SQL against Node's built-in
`node:sqlite` — a broken `WHERE` clause fails a test instead of shipping.

**Dialect floor:** Android's SQLite tracks the OS, and API 24 ships ~3.9. No `UPSERT`
(3.24), no window functions (3.25). Everything stays within plain
`INSERT`/`UPDATE`/`DELETE`/`SELECT`.

### Schema

One table per event kind (seven — see §5), plus `sessions` and a `meta` table holding
`schema_version`. Every event table carries `id` (primary key), `session_id`,
`timestamp`, and an index on `(session_id, timestamp DESC, id DESC)` — covering both
the newest-first ordering and the keyset tiebreaker.

Columns are split into two groups, declared once per kind in
`core/database/rows.ts`:

- **summary** — what a list row renders and what search matches
- **heavy** — request/response bodies, headers, socket payloads, Zustand state,
  Redux payloads and changed slices, and
  base64 image previews. Never named in a list query; fetched only when a detail view
  opens. A `WHERE` may still reference them, so search covers response bodies without
  ever loading one.

The manifest is the single source of truth: the DDL, the row mappers and the
summary/heavy split are all derived from it, so a column cannot exist in the table
but be missing from the mapper.

There is **no migration ladder**. A `schema_version` mismatch drops every table and
recreates it — captured logs are disposable by definition, and carrying migrations
for a devtool's own scratch data would cost more than it could be worth.

### Storage adapter abstraction

```ts
interface Database {
  readonly name: string;
  isAvailable(): boolean;
  /** Resolves once the database is open and its schema is current. */
  ready(): Promise<void>;

  listSessions(): Promise<SessionMeta[]>;
  saveSessionMeta(meta: SessionMeta): Promise<void>;
  deleteSession(sessionId: string): Promise<void>;
  deleteSessions(sessionIds: string[]): Promise<void>;

  /** One transaction of inserts and updates; also maintains session counters. */
  writeEvents(batch: EventBatch): Promise<void>;
  /** One page of summary rows. */
  queryEvents(query: EventQuery): Promise<EventPage>;
  /** Per-connection / per-store aggregates for the grouped tabs. */
  queryGroups(query: EventGroupQuery): Promise<EventGroup[]>;
  /** One event with its heavy columns, for a detail view. */
  loadEvent(kind: InspectorKind, id: string): Promise<BesouroEvent | null>;
  countEvents(sessionId: string, kind: InspectorKind): Promise<number>;
  clearKind(sessionId: string, kind: InspectorKind): Promise<void>;
}
```

Note what is **absent**: there is no `loadSession`. Loading a session whole is the
thing this layer exists to avoid — writes are deltas, reads are pages.

The UI never sees the whole contract: it takes one repository per call site —
`EventRepository` for the tabs, `SessionRepository` for the history list — neither of
which carries `writeEvents`,
provided to the drawer tree through a context and exposed by the controller only while
persistence is active, so its presence doubles as the "history available" gate.

### Write strategy

`WriteQueue` holds captured events and drains them as **one transaction and one
bridge crossing**, every ~250ms or once 200 rows are pending. Updates coalesce by id,
so a network request patched three or four times as it completes collapses into a
single `UPDATE`; a patch to a row that hasn't been flushed yet is merged into its
pending insert instead.

**Immediate flush** on `AppState` → `background`/`inactive` and on explicit `flush()`.

**Blocking flush on the crash path.** The global JS error handler is the one caller
that cannot use any of the above: a fatal error hands control to RN's exception
manager, which stops the app before a promise gets another turn — so in a release
build the crash row (and the logs queued behind it, which are most of what makes the
crash readable) never reaches disk, and the session shows as `crashed` with an empty
Console tab. `recordUncaughtError` therefore writes through `captureEventSync` →
`WriteQueue.flushSync` → `Database.writeEventsSync` → the native `batchSync`, a
**blocking synchronous** TurboModule method that returns only once the transaction
has committed. Stalling the JS thread on a disk write is exactly what the queue
exists to prevent, and is affordable here only because the app is about to stop
running. It is reserved for this path and nothing else.

The sync write reports failure as a return value rather than a rejection (a crash
handler has nowhere to report to, and a throw would mask the original error). It
fails when the database isn't open yet — there is no `ready()` gate to await from a
handler — in which case the rows stay queued and the caller falls back to the async
`flush()`, which is a real second chance for the non-fatal errors the global handler
also fires for. Sync failures deliberately do **not** count toward the five-failure
disable below: they fail for reasons the async path doesn't share.

Three failure modes are handled explicitly, all about not losing data the drawer is
already showing:

1. **Capture before the database is open.** Interception is installed synchronously
   inside `init()`, while opening the database is a bridge round trip — so the first
   startup logs and API calls are captured with nowhere to put them yet. The
   adapter's `ready()` gate makes writes issued in that window queue rather than
   fail, and the backlog drains once it resolves.
2. **A flush fails.** Rows go back to the front of the queue and retry on the next
   tick, so a transient error costs latency rather than data.
3. **Persistence is permanently broken** (disk full, corrupt file). After five
   consecutive failures the writer disables itself and releases the queue. Events
   captured from then on are dropped, exactly as when no adapter was resolved at all.
   This is what bounds the queue — events are never capped, so an ever-growing backlog
   would otherwise be the one way this layer could consume memory without limit.

### Read strategy

`usePagedEvents` shows each tab a **window** of rows (50 to start), widening it by a
page as the list scrolls. Every render's rows come from **one query, assigned whole**:
both a live refresh and a "load more" re-read the entire window, and nothing is
concatenated, merged or reconciled in JS.

Appending a fetched page to what is on screen — the obvious alternative — means
stitching two queries taken at different instants. Any row the two disagree about is
duplicated or dropped, and the list ends up showing a state the database was never in.
Widening a single query costs one indexed read over summary columns, which is what
react-query's `useInfiniteQuery` does on refetch, and it is what makes an inconsistent
list _inexpressible_ rather than merely unlikely.

The `(timestamp, id)` keyset cursor remains the adapter's paging primitive
(`EventQuery.before`) — offset paging would skip and repeat rows as the table shifts —
but the drawer does not need it, since a window always starts at the newest row.

Refreshes are triggered by the store's version, which bumps when a **flush lands**
rather than when an event is captured (§5). Two consequences: a list is never told to
refresh for a row that isn't readable yet, and the writer's flush cadence is already
the refresh cadence — so no throttle is needed on the read side.

Filtering — text search, and the notifications origin filter — runs **in SQL**, so
results span the whole session rather than only the loaded pages. Filtering in JS
would also let a page of 50 rows render as none, leaving "load more" to guess how many
pages it takes to fill a screen.

Four tabs list groups before rows — WebSocket and Socket.IO connections, Zustand
stores, and Jotai atoms. Their counts, last-activity timestamps and connection status come from
`queryGroups` (a `GROUP BY` plus a self-join for the newest lifecycle frame per
connection, since window functions are above the dialect floor). Deriving them by
grouping loaded events in JS would mean holding every frame of every connection just
to render a handful of rows — and a chatty socket produces more frames than any other
inspector.

### Sessions & crash recovery

```ts
interface SessionMeta {
  id: string;
  startedAt: number;
  endedAt?: number;
  lastEventAt?: number; // maintained by the writer as rows land
  eventCount?: number; // stored counter, not a COUNT over seven tables
  appVersion?: string;
  inspectors?: Inspector[]; // what was recording; absent means unknown
  status: 'open' | 'closed' | 'crashed';
}
```

- On `Besouro.init()`, create a session with `status: 'open'`. Its metadata
  reaches disk a few round trips later, so the first rows are written before there is
  a session row to count them — the write that creates that row **adopts the count of
  the rows already under its id**. Without it, the startup logs every launch begins
  with (RN's own `Running "<key>"` among them) would be readable but uncounted.
- On app background, mark `status: 'closed'` (the controller's AppState listener —
  there is no teardown call); on return to the foreground, reopen it.
- **JS crash capture:** wrap `ErrorUtils.getGlobalHandler()` / `setGlobalHandler` to
  record a fatal `ConsoleEvent` and drain the writer before RN's own handler runs.
- **On next launch:** any prior session still `open` is reconciled to `crashed` and
  surfaced in the session switcher. Opening it loads **nothing** — the drawer
  identifies the session by id and its tabs page rows straight out of the database,
  so a month-old session with 50k events opens as fast as the current one.
- A _warm_ reload — one where the process survived — adopts the previous still-`open`
  session by id rather than starting a new one, so it stays one continuous session. Its
  events need no rehydration: they are already rows. The rows captured _since the
  reload_ do need work, though: interception is installed in `init()`, so they were
  already stamped with the session id the adopt discards. They are drained and re-keyed
  onto the adopted session, which is the same run continuing. This is not dev-only: it covers a
  Metro reload in dev and an in-place OTA relaunch (`Updates.reloadAsync`,
  `HotUpdater.reload`, `RNRestart`) in production, neither of which is a crash. A native
  crash also leaves the session `open`, but it kills the process, so its relaunch is
  _cold_ and reconciles to `crashed` as above.
- **Retention:** keep at most `maxSessions` (default 10); pruning deletes a session's
  rows from every table and its metadata in one transaction. Events within a session
  are never capped. Bodies are still truncated at capture before storage (§5.1).
  Because pruning works by session id, a row whose session was never written is
  unreachable _and_ beyond retention's reach — so startup also sweeps rows that belong
  to no session in the table, sparing the live one (whose rows legitimately precede its
  own metadata write).
- **Browser-class inspectors are hidden while viewing a past session.** The File
  System and element inspectors read live state on demand rather than recording
  (`BROWSER_INSPECTORS` — exactly `Inspector` minus `InspectorKind`), so in a past
  session they would show the sandbox and the component tree _as they are now_ under
  a header dated weeks ago. Live state beside a historical label is worse than no
  tab, so the session view drops them and keeps the rest.
- **A past session's tabs are the union of what is enabled now and what it recorded
  with.** The set is stored on the session at `init()` (and unioned again when a warm
  reload adopts one, since that reload is exactly when the config can change), so
  switching an inspector off cannot orphan the rows it already captured — they are
  still on disk and still counted in the panel's header. The reverse holds too: an
  inspector enabled since keeps its empty tab, because a session that captured nothing
  from it is a finding, not a gap. The rule is `core/session-tabs.ts`; the strip is
  then ordered by the user's preference (§4) and stripped of the browser-class tabs.
  Inside a past session the drawer also ignores live inspector _status_ — rows on disk
  need no interceptor installed in this process, and a `not-installed` or `degraded`
  today says nothing about the run that recorded them.

---

## 10. Security & Sensitive Data

The library captures **raw** request/response bodies, headers, storage values, socket
payloads, and console arguments — which may contain tokens, cookies, and personal data
— and stores them verbatim in the persisted session on disk (§9).
**There is no redaction**; treat all captured data as sensitive.

- **Keep it out of release builds.** The call-site condition (§11) is what keeps
  capture out of production. A build that deliberately ships the devtools also ships
  this captured data — gate access to internal users and treat it as
  security-sensitive.
- **Truncation still applies:** bodies/values are capped at capture (§5.1) before
  storage/display — this bounds memory and disk, not sensitivity.
- Persisted sessions live in app-private storage and are evicted per `maxSessions`;
  deleting a session purges its captured data.

---

## 11. Production Behavior

### Gating is the call site's job

The library has **no production switch and no internal `__DEV__` gate**. `init()`
does what it is asked, whenever it is called. There is deliberately no
`allowInProduction`-style option: a runtime flag cannot strip anything from a bundle,
so it would trade real dead-code elimination for a boolean.

Instead, keep the setup in its own module and `require()` it behind whatever condition
you want — `__DEV__`, a build channel, an internal-user check:

```ts
// App.tsx — the whole devtools graph hangs off this one conditional require.
if (__DEV__) {
  require('./tools/besouro'); // configure().zustand(...).init() lives here
}
```

A **static** condition (`if (__DEV__)`) lets the bundler dead-code-eliminate the
library, its inspectors, and their optional peers from release builds outright. That is
the intended default, and what `example/` does.

Optional peers are only referenced by the modules a consumer hands to an inspector method,
so they never enter a bundle that doesn't use them (§4.1).

### If you deliberately ship it in a release build

Some teams need in-app diagnostics in QA/staging, dogfood, or beta channels. Nothing
stops that — use a dynamic condition instead of `__DEV__`. Understand what you take on:

- **Nothing is stripped.** The library, its inspectors, and their optional peers all ship.
- **Captured data is unredacted** (§10) — it may include tokens, cookies, and PII.
  Treat such a build as security-sensitive and gate who can open the drawer (hidden
  trigger / build-channel check / internal-user check).
- **There is runtime overhead**, since interception stays installed.

Prefer separate build flavors: a plain `if (__DEV__)` require for normal releases, and
a dedicated internal/QA flavor whose condition also passes there.

`__DEV__` is still read in two narrow places, neither of which gates installation:
resuming the previous session across a JS reload (`core/controller.ts`), and suppressing
the "inspector degraded" console warning outside dev (`core/base-interceptor.ts`).

---

## 12. Dependencies

- **peerDependencies (required):** `react`, `react-native`.
- **optional peers (consumer-provided, declared in `peerDependenciesMeta`):**
  `@react-native-async-storage/async-storage`, `expo-notifications`,
  `@react-native-firebase/messaging`, `@notifee/react-native`, `socket.io-client`,
  `zustand`. Each is passed in by the consumer through `configure` or its inspector
  method, never
  statically required (§4.1). (`zustand` is listed for discoverability; the inspector
  attaches to a store instance structurally and never imports the package.)
- **persistence:** no dependency at all. Events are stored in the SQLite each
  platform already ships, reached through the library's own TurboModule (§9) — no
  `react-native-mmkv`, no `expo-file-system`, no vendored SQLite engine, and nothing
  for a consumer to install or pass in.
- **clipboard util:** copy actions (see §7 → "Copy everywhere") go through one helper
  backed by the library's own native TurboModule (`setClipboardString`, write-only) —
  no clipboard peer dependency and no consumer-supplied clipboard. When the native
  module isn't linked (tests / web), copy is a no-op and the affordances hide themselves.
- **runtime deps:** none beyond RN built-ins (`PanResponder`, `Animated`,
  `AppState`, `StyleSheet`, internal interceptor modules).

---

## 13. Repo & Tooling

- **Build:** `react-native-builder-bob` — ESM `module` target + `typescript` declarations.
- **Language:** TypeScript, strict.
- **Lint/format:** ESLint + Prettier.
- **Example app:** an Expo app under `example/` exercising all nine inspectors.
- **Tests:** Jest + `@testing-library/react-native`.
  - Unit: store, event writer, SQLite adapter (real SQL on `node:sqlite`), each
    interceptor (mock `XHRInterceptor`, `WebSocketInterceptor`, `console`,
    socket.io instance, notification listeners), session/crash flow.
  - Component: bubble drag/open, drawer tabs, session switcher.
- **CI:** typecheck + lint + test on PR.

### Code conventions

Non-negotiable engineering standards for this codebase:

- **DRY — no duplicated logic.** The nine inspectors share a common capture/lifecycle
  path: a single **base interceptor** (install / uninstall / safe-capture / degraded
  state, per §5 Resilience) that each inspector extends, rather than copy-pasted
  try/catch and store-writes. Cross-cutting concerns each live in exactly one place:
  the event **store**, **truncation**, the **clipboard util**, the
  **JSON viewer** (§7.1), the **storage adapter** (§9), theme, and i18n. If the same
  code appears twice, extract it.
- **Precise, descriptive names — full words, domain terms.** Names state exactly what
  a value is. **Banned:** abbreviations like `idx`/`tmp`/`val`/`res`/`cfg`, and vague
  placeholders like `data`, `updatedData`, `info`, `obj`, `item2`, `handleStuff`.
  **Prefer:** `connectionId`, `requestHeaders`, `flattenedLines`, `visibleLines`,
  `capturedEvent`, `previousSession`, `pushToken`, `groupedFrames`. Booleans read as
  predicates (`isConnected`, `hasResponseBody`, `shouldPersist`); functions are verbs
  (`flattenJson`, `resolveDatabase`, `truncateBody`). When indexing is genuinely
  needed, name the index for its element (`lineIndex`, `sessionIndex`), not `i`/`idx`.
- **Clarity over cleverness.** Small, single-responsibility functions and modules;
  explicit return types on the public surface; **no `any`** in exported APIs (TS
  strict). Comment the _why_ (non-obvious constraints, RN-internal quirks), not the
  _what_.

### Source layout

```
src/
  index.tsx                // public facade: BesouroBuilder + the types to call it
  global.d.ts              // ambient require() for RN-internal module loading
  core/                    // inspector-agnostic engine — no UI, no inspector specifics
    controller.ts          // the builder implementation; index.tsx wraps it (§4)
    capture.ts             // capture entry point — fan-in to the write queue (§5)
    inspector-revisions.ts // per-kind change signals that drive list re-queries
    status.ts              // per-inspector status (active/not-installed/degraded)
    base-interceptor.ts    // patch / guardInstall / safeCapture discipline (§5)
    session.ts             // the live session in memory + crash capture
    session-lifecycle.ts   // its on-disk half: AppState open/close, reconcile, pruning
    session-tabs.ts        // which tabs a past session gets: enabled now ∪ recorded then
    truncate.ts            // UTF-8 byte-budget truncation
    serialize.ts           // circular-safe stringify
    clipboard.ts           // copy util (native module, no peer dep)
    haptics.ts             // one light tap for a gesture that took (native, no permission)
    share.ts               // shareFile bridge for the File System inspector
    settings-store.ts      // runtime theme/accent/font-scale (persisted)
    persisted-state.ts     // keyed UI prefs that survive relaunch (view modes)
    ephemeral-state.ts     // keyed UI state that survives drawer close, not relaunch
    active-inspector-store.ts  // last active tab, across drawer teardown
    bubble-appearance.ts   // pushes resolved theme colors to the native bubble
    database/
      index.ts             // adapter + database factories and the queue re-export
      port.ts              // the SqlDatabase port (TurboModule at runtime, node:sqlite in tests)
      schema.ts            // DDL derived from the manifests; drop-and-recreate migration
      rows.ts              // per-kind column manifest, summary/heavy split, row mappers
      sqlite-database.ts   // the shipped implementation — batched writes, keyset paging
      write-queue.ts       // batches captured rows into one transaction per flush
      status.ts            // usable / unavailable / unopened / write-failed
    types/                 // base.ts, events.ts, options.ts, session.ts + barrel
  inspectors/              // one folder per inspector; all internal
    network/               // + cURL export
    websocket/
    socketio/
    console/
    notifications/
    element/
    asyncStorage/
    zustand/
    redux/               // + utils/changed-paths.ts (drives the viewer flash)
    jotai/
    fileSystem/
    <inspector>/           // shape shared by all of them:
      interceptor.ts       //   install(): the capture mechanism, returns its own
                           //   uninstall (element installs a React DevTools hook;
                           //   fileSystem's is a noop — see browser.ts)
      <Name>Tab.tsx        //   drawer tab; <Name>Detail.tsx for the drill-in
      components/          //   rows/pills used only by this inspector
      store/               //   inspector-local live state (see note below)
      utils/, types.ts     //   inspector-local helpers, peer shapes, non-event types
  drawer/                  // BesouroRoot (registered surface) + the shell
    BesouroShell.tsx // the drawer: chrome, back stack, stacked-panel host
    InspectorTabs.tsx      // one tab per inspector: selection + the selected content
    InspectorTabBar.tsx    // the strip itself; hooks/tab-strip.ts measures and drags it
    SessionListPanel.tsx, SessionPanel.tsx, SettingsPanel.tsx, DatabaseNotice.tsx
  shared/                  // UI building blocks reused across inspectors
    components/            // incl. JsonViewer/ (§7.1 virtualized) and Icon/ (View-composed)
    context/               // UI (theme/strings), the capture database, viewing-session
    hooks/                 // drawer data: paged-events, event-detail, event-groups,
                           //   plus safe-area, useQuery, useDetailSlide, useTextStyles
    utils/, styles.ts, detail-nav.tsx
  theme/                   // palette + spacing/type scale; imports nothing else
  i18n/                    // en/pt/es string tables (device-locale detect, no library)
  native/                  // TurboModule specs (drawer/bubble + file system)
example/                   // Expo example app
```

**Layer rule.** `core/` is inspector-agnostic: it holds the event store, the
capture discipline, sessions, persistence, and the shared type model — nothing that
names a single inspector. State belonging to one inspector lives in that
inspector's own `store/` folder instead (`notifications/store/device-tokens.ts`,
`mmkv/store/instances.ts`, `zustand/store/stores.ts`, `jotai/store/atoms.ts`,
`redux/store/snapshot.ts`, `element/store/inspection.ts`). These are the
**live-view** stores: facts about _this launch_ rather than a capture history, never
persisted with the session. Most hold only attachment metadata — what a captured row
cannot say — because the rows are the source of truth for everything a row _can_
carry; `redux/store/snapshot.ts` is the exception, holding a whole state tree its
delta rows do not (§6.9).

Each such store is a _sibling_ of its inspector's `index.ts`, never part of it, and
tabs import it directly. That is what keeps reading a device token or a store's
attachment info from pulling the inspector's interception code — and the optional peer
modules it wraps — into the drawer bundle, which `drawer/InspectorTabs.tsx` always loads.

---

## 14. Roadmap

### v1 (this spec)

Twelve inspectors (Network, WebSocket, Socket.IO, Console, Notifications, Element,
AsyncStorage, MMKV, Zustand, Redux, Jotai, File System), native bubble + drawer UI,
persisted sessions with crash recovery, copy-as-cURL, export/share.

### Phase 2 (native-optional, behind same API)

- Native network interception (`OkHttp` / `NSURLProtocol`) for native-originated
  traffic.
- OS-level notification capture (killed/background).
- Element inspector → jump-to-IDE via dev-server endpoint.
- Optional desktop/web companion viewer (stream events over the dev server).
- Performance monitors (FPS/memory).

---

## 15. Open Questions

### Resolved

- **Element inspector hit-testing:** renderer API (`getInspectorDataForViewAtPoint`
  off the DevTools hook's `rendererConfig`), not manual fiber traversal. (See §6.6.)
- **Export format:** both — **HAR** for the Network tab (opens directly in browser
  devtools), **JSON** for all inspectors. (See §7.)
- **npm scope:** unscoped `besouro` (`package.json`), not an org scope.

### Open

None — everything raised during the v1 design is resolved above. New questions go
here as they come up.
