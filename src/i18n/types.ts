/**
 * The shape every locale table fills in, and the languages there are tables for.
 *
 * Split from the tables themselves so `en.ts`, `pt.ts` and `es.ts` can each
 * import the shape without importing one another — and so a new key is added in
 * exactly one place, with the three tables then failing to compile until they
 * carry it.
 */

export type LanguageCode = 'en' | 'pt' | 'es';

/** Every UI string key. The English table is the source of truth for the shape. */
export interface StringTable {
  clear: string;
  close: string;
  /** Collapse the drawer into the floating panel. */
  minimize: string;
  /** Open the floating panel back out to the full drawer. */
  restore: string;
  sessionHistory: string;
  session: string;
  crashed: string;
  noSessions: string;
  justNow: string;
  yesterday: string;
  /** Relative-time wrapper; `{0}` is a span like `2h`. Word order varies. */
  timeAgo: string;
  search: string;
  settings: string;
  theme: string;
  accent: string;
  textSize: string;
  language: string;
  tabOrder: string;
  /** Explains the hold-and-drag gesture, which nothing on the strip hints at. */
  tabOrderHint: string;
  resetOrder: string;
  system: string;
  light: string;
  dark: string;
  english: string;
  portuguese: string;
  spanish: string;
  copy: string;
  retry: string;
  share: string;
  statusNotInstalled: string;
  statusError: string;
  notInstalledHint: string;
  inspectorError: string;
  noEvents: string;
  noResults: string;
  noRequests: string;
  noLogs: string;
  noConnections: string;
  noOperations: string;
  noNotifications: string;
  noBody: string;
  noHeaders: string;
  noPayload: string;
  payload: string;
  noValue: string;
  noContent: string;
  response: string;
  responseHeaders: string;
  contentType: string;
  request: string;
  requestHeaders: string;
  copyAsCurl: string;
  duration: string;
  pending: string;
  sent: string;
  received: string;
  lifecycle: string;
  /** Socket connection status labels, shown beside the status dot. */
  connected: string;
  disconnected: string;
  /**
   * History only: the connection was still up when the session ended, so it went
   * down with the app rather than being dropped — see `settled` in SocketTabBase.
   */
  ended: string;
  /** No lifecycle frame was captured, so the connection's state was never seen. */
  unknownStatus: string;
  error: string;
  event: string;
  events: string;
  change: string;
  noDeviceToken: string;
  tokenRefreshed: string;
  /** Banner over a payload capture had to cut (§5.1). */
  payloadTooLarge: string;
  showMore: string;
  showLess: string;
  /** Badge on a console row whose uncaught error brought the app down. */
  fatal: string;
  hierarchy: string;
  props: string;
  source: string;
  inspectElement: string;
  elementPickHint: string;
  elementDevOnly: string;
  elementNativeOnly: string;
  elementReadOnlyProps: string;
  boxModel: string;
  position: string;
  styleLabel: string;
  addLabel: string;
  key: string;
  value: string;
  tabNetwork: string;
  tabConsole: string;
  tabWebSocket: string;
  tabSocketIO: string;
  tabNotifications: string;
  tabAsyncStorage: string;
  tabMMKV: string;
  tabZustand: string;
  tabRedux: string;
  tabJotai: string;
  tabElement: string;
  tabFileSystem: string;
  noStores: string;
  noInstances: string;
  operations: string;
  /** The contents pane, in both the MMKV detail and the Redux tab. */
  store: string;
  currentState: string;
  snapshot: string;
  changes: string;
  history: string;
  changedKeys: string;
  initialState: string;
  /**
   * Redux tab. `actions` names the log pane; the pane beside it is labelled with
   * the shared `store` above, as MMKV's is. `state` is *not* that pane — it names
   * one action's resulting tree inside the action detail, where `changedSlices` is
   * the alternative when the row holds only a delta.
   */
  actions: string;
  state: string;
  noActions: string;
  changedSlices: string;
  noState: string;
  noAtoms: string;
  currentValue: string;
  lastValue: string;
  lastState: string;
  finalState: string;
  noChanges: string;
  emptyFolder: string;
  /** Re-read the directory on screen (nested folders only). */
  refresh: string;
  fileTooLarge: string;
  cannotPreview: string;
  imageTooLarge: string;
  previewUnavailable: string;
  /** Segmented control over an HTML response body: markup vs rendered page. */
  raw: string;
  preview: string;
  previewFailed: string;
  fileSystemUnavailable: string;
  modified: string;
  size: string;
  path: string;
  fileType: string;
  /** Shown in place of the tabs when the database can't be used. */
  databaseUnavailableTitle: string;
  databaseUnavailableBody: string;
  databaseUnopenedTitle: string;
  databaseUnopenedBody: string;
  databaseWriteFailedTitle: string;
  databaseWriteFailedBody: string;
  troubleshooting: string;
  /** Accessibility label on the element inspector's remove-added-prop button. */
  remove: string;
}
