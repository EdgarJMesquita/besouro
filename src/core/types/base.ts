/**
 * Inspector identifiers and the base shape every captured event extends.
 *
 * These are the vocabulary the rest of the type model is built from, so this file
 * imports nothing.
 */

/**
 * Inspector identifiers that produce persisted events — one per table in the
 * event database.
 *
 * `element` is deliberately absent, alongside `fileSystem`: both are
 * "browser"-class inspectors that inspect on demand rather than logging. The
 * element inspector holds exactly one live element in a session-only side store
 * (`inspectors/element/store/inspection.ts`), keeping its fiber and renderer —
 * which are not serializable — out of anything that reaches disk.
 */
export type InspectorKind =
  | 'network'
  | 'websocket'
  | 'socketio'
  | 'console'
  | 'notification'
  | 'asyncStorage'
  | 'mmkv'
  | 'zustand'
  | 'redux'
  | 'jotai';

/**
 * Config-facing inspector identifiers (what a consumer enables).
 *
 * `fileSystem` is the first "browser"-class inspector: it navigates the app's
 * sandbox on demand rather than capturing events, so it appears here (and as a
 * drawer tab) but contributes no member to {@link InspectorKind} /
 * {@link BesouroEvent}. `viewHierarchy` is the same: it snapshots the native
 * view tree when asked and keeps nothing.
 */
export type Inspector =
  | 'network'
  | 'websocket'
  | 'socketio'
  | 'console'
  | 'notifications'
  | 'element'
  | 'asyncStorage'
  | 'mmkv'
  | 'zustand'
  | 'redux'
  | 'jotai'
  | 'fileSystem'
  | 'viewHierarchy';

/**
 * Tab order in the drawer, and the order the controller installs in.
 *
 * A library constant rather than the consumer's registration order: with the
 * self-sufficient inspectors on by default, most of the list is never named at the
 * call site, so there is no call order to honour for them. Deriving half the strip
 * from a constant and half from call sequence would make the layout depend on
 * something invisible — a fixed order everywhere is the honest version.
 *
 * The browser-class tools trail, and that is the one rule here with teeth: they are
 * the ones a past session drops (see {@link recordingInspectors}), so keeping them
 * last means the strip shortens from the end instead of gapping in the middle. It is
 * also the only absence that moves a tab. An inspector the consumer never wired up
 * is not rendered at all — it collapses out of the strip rather than leaving a hole —
 * so ordering the middle by how likely a tab is to be missing buys nothing.
 *
 * What orders the middle is instead what each tab looks at: the wire (network, the
 * two socket tabs, and notifications, which is an inbound stream like them), then
 * what the app holds (the three stores, then the two persisted ones). `console` is
 * the deliberate exception, kept second on frequency — it is the only tab that has
 * something in it before the app does anything. The first *enabled* entry is what
 * the drawer opens on, which is why `network` leads.
 *
 * Must list every {@link Inspector}.
 */
export const INSPECTOR_ORDER: readonly Inspector[] = [
  'network',
  'console',
  'websocket',
  'socketio',
  'notifications',
  'redux',
  'zustand',
  'jotai',
  'asyncStorage',
  'mmkv',
  'element',
  'viewHierarchy',
  'fileSystem',
];

/**
 * Inspectors that inspect live state on demand instead of recording events —
 * the "browser"-class tools. They are exactly {@link Inspector} minus
 * {@link InspectorKind}, and they contribute no rows to any session.
 *
 * Hidden when a past session is open: the File System browser would list the
 * sandbox as it is *now*, and the element inspector would pick from the tree
 * mounted *now*, both under a header dated weeks ago. Live state next to a
 * historical label is worse than no tab.
 */
export const BROWSER_INSPECTORS: readonly Inspector[] = [
  'element',
  'viewHierarchy',
  'fileSystem',
];

/** Whether an inspector browses live state rather than recording events. */
export function isBrowserInspector(inspector: Inspector): boolean {
  return BROWSER_INSPECTORS.includes(inspector);
}

/** The inspectors whose data a past session can actually replay. */
export function recordingInspectors(inspectors: Inspector[]): Inspector[] {
  return inspectors.filter((inspector) => !isBrowserInspector(inspector));
}

export interface BaseEvent {
  /** Unique id, generated without native crypto. */
  id: string;
  sessionId: string;
  /** Epoch milliseconds (`Date.now()`). */
  timestamp: number;
  kind: InspectorKind;
}

/**
 * Frame direction, shared by the WebSocket and Socket.IO inspectors — which is
 * why it lives here rather than in either one.
 */
export type SocketDirection = 'send' | 'receive' | 'lifecycle';
