/**
 * Notifications inspector types — internal.
 *
 * Structural stand-ins for the peer modules the inspector wraps (expo-notifications,
 * @react-native-firebase/messaging, @notifee/react-native). They exist so the library
 * never imports (or bundles) any of them — §4.1: a consumer passes their real modules
 * to `notifications` and structural typing does the rest.
 */

interface PeerSubscription {
  remove(): void;
}

// ── expo-notifications ───────────────────────────────────────────────────────

export interface ExpoNotificationContent {
  title?: string | null;
  body?: string | null;
  data?: unknown;
}

export interface ExpoNotification {
  request?: {
    /** Expo's own notification identifier — correlates `received` with `responded`. */
    identifier?: string;
    content?: ExpoNotificationContent;
    trigger?: { type?: string } | null;
  };
}

export interface ExpoNotificationResponse {
  notification?: ExpoNotification;
}

export interface ExpoDevicePushToken {
  type?: string;
  data?: string;
}

/**
 * Structural subset of `expo-notifications` the inspector uses. Listener payloads
 * are typed `unknown` at the boundary (and narrowed internally) so the real module —
 * whose own types don't line up bidirectionally with a hand-rolled shape — assigns
 * cleanly under strict variance.
 */
export interface ExpoNotificationsLike {
  addNotificationReceivedListener(
    listener: (notification: unknown) => void
  ): PeerSubscription;
  addNotificationResponseReceivedListener(
    listener: (response: unknown) => void
  ): PeerSubscription;
  addPushTokenListener?(listener: (token: unknown) => void): PeerSubscription;
  getExpoPushTokenAsync?(): Promise<{ data: string; type?: string }>;
  getDevicePushTokenAsync?(): Promise<ExpoDevicePushToken>;
  scheduleNotificationAsync?(...args: unknown[]): Promise<unknown>;
  presentNotificationAsync?(...args: unknown[]): Promise<unknown>;
}

// ── @react-native-firebase/messaging ─────────────────────────────────────────

export interface FirebaseRemoteMessage {
  messageId?: string;
  data?: Record<string, unknown>;
  notification?: { title?: string; body?: string } | null;
}

export interface FirebaseMessaging {
  onMessage(listener: (message: unknown) => void): () => void;
  onNotificationOpenedApp(listener: (message: unknown) => void): () => void;
  getInitialNotification(): Promise<unknown>;
  onTokenRefresh(listener: (token: unknown) => void): () => void;
  getToken(): Promise<string>;
  setBackgroundMessageHandler?(
    handler: (message: unknown) => Promise<unknown>
  ): void;
}

/** The `messaging` default export of `@react-native-firebase/messaging` (a factory). */
export type FirebaseMessagingLike = () => FirebaseMessaging;

// ── @notifee/react-native ─────────────────────────────────────────────────────

export interface NotifeeNotification {
  /** notifee's own notification id — captured as `notificationId`, shown as `id`. */
  id?: string;
  title?: string;
  body?: string;
  data?: Record<string, unknown>;
}

/**
 * A notifee event, as delivered to `onForegroundEvent` / `onBackgroundEvent`.
 * `type` is a member of notifee's numeric `EventType` enum (see `NOTIFEE_EVENT`
 * in `index.ts`).
 */
export interface NotifeeEvent {
  type?: number;
  detail?: {
    notification?: NotifeeNotification;
    pressAction?: { id?: string };
  };
}

/**
 * Structural subset of the `@notifee/react-native` default export the inspector uses.
 * notifee is a local-display + interaction library with no device-token concept, so —
 * unlike expo/firebase — it is never registered as a push-token provider.
 */
export interface NotifeeLike {
  onForegroundEvent(observer: (event: unknown) => void): () => void;
  onBackgroundEvent?(observer: (event: unknown) => Promise<unknown>): void;
  displayNotification?(...args: unknown[]): Promise<unknown>;
  createTriggerNotification?(...args: unknown[]): Promise<unknown>;
}

/** The peer modules a consumer hands to `notificationsInspector(...)`. */
export interface NotificationsInspectorPeers {
  expoNotifications?: ExpoNotificationsLike;
  firebaseMessaging?: FirebaseMessagingLike;
  notifee?: NotifeeLike;
}
