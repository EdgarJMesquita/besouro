/**
 * Notifications capture mechanism — internal.
 *
 * Pure JS. Wraps the consumer's notification provider module(s)
 * (expo-notifications, @react-native-firebase/messaging, and/or
 * @notifee/react-native), the same optional-peer pattern as the AsyncStorage
 * inspector (§4.1): the modules are passed in by the consumer, never statically
 * required here.
 *
 * Foreground capture is reliable; killed/background OS delivery is out of scope for a
 * JS-only inspector (SPEC §6.5). If several providers are passed, a single push can be
 * recorded once per provider — that is intentional and disambiguated by each event's
 * `provider`. The common FCM stack (firebase-messaging delivers, notifee displays)
 * yields complementary rows, not duplicates: firebase = "a message arrived", notifee =
 * "here is what was shown and how the user reacted" (press / action / dismiss).
 *
 * `installNotificationsInspector` is the entry point, called by the controller when
 * the consumer supplies the modules via `setNotificationsHandlers`.
 */

import { AppState } from 'react-native';
import { patchMethod, safeCapture } from '../../core/base-interceptor';
import { captureEvent, createEventId } from '../../core/capture';
import { getCurrentSession } from '../../core/session';
import { setInspectorStatus } from '../../core/status';
import { setDeviceToken, clearDeviceTokens } from './store/device-tokens';
import { setPushProviders, clearPushProviders } from './store/push-providers';
import { truncateToBytes } from '../../core/truncate';
import { safeStringify } from '../../core/serialize';
import type {
  NotificationEvent,
  NotificationPhase,
  NotificationProvider,
} from '../../core/types';
import type {
  ExpoDevicePushToken,
  ExpoNotification,
  ExpoNotificationContent,
  ExpoNotificationResponse,
  ExpoNotificationsLike,
  FirebaseMessaging,
  FirebaseMessagingLike,
  FirebaseRemoteMessage,
  NotifeeEvent,
  NotifeeLike,
  NotifeeNotification,
  NotificationsInspectorPeers,
} from './types';

/** Per-notification ceiling for the captured data payload — 500 KB. */
const MAX_DATA_BYTES = 500_000;

/**
 * The numeric `EventType` members notifee reports (verified against the library's
 * `src/types/Notification.ts`). Only user-facing types are mapped; blocked/unknown/
 * foreground-service events are ignored rather than recorded as notifications.
 */
const NOTIFEE_EVENT = {
  DISMISSED: 0,
  PRESS: 1,
  ACTION_PRESS: 2,
  DELIVERED: 3,
  TRIGGER_NOTIFICATION_CREATED: 7,
} as const;

export function installNotificationsInspector(
  peers: NotificationsInspectorPeers
): () => void {
  const { expoNotifications: expo, firebaseMessaging, notifee } = peers;

  if (!expo && !firebaseMessaging && !notifee) {
    // No peer module was passed → nothing to observe. Report `not-installed` so the
    // tab shows the "library not installed" hint. FLAG: this runs in a microtask on
    // purpose — `guardInstall` marks the inspector `active` synchronously right after
    // this function returns, so setting the status inline would be overwritten. The
    // microtask lands just after that, making `not-installed` the value that sticks.
    queueMicrotask(() => setInspectorStatus('notifications', 'not-installed'));
    return () => {};
  }

  const restores: Array<() => void> = [];

  // Provider registration reflects which peer modules the consumer passed — NOT
  // whether every listener attached cleanly. A partial install failure (e.g.
  // firebase's `messaging()` throwing when the native Firebase app isn't
  // configured) must still leave the Device Token panel showing that provider:
  // its token can resolve later, and the failure surfaces as a token-error row.
  // Coupling the two previously made a single throw silently hide the whole drawer.
  // notifee is deliberately absent — it has no device token, so it never surfaces
  // in the Device Token panel.
  const providers: NotificationProvider[] = [];
  if (expo) providers.push('expo');
  if (firebaseMessaging) providers.push('firebase');
  setPushProviders(providers);

  if (expo) {
    safeCapture(() => installExpo(expo, restores));
  }
  if (firebaseMessaging) {
    safeCapture(() => installFirebase(firebaseMessaging, restores));
  }
  if (notifee) {
    safeCapture(() => installNotifee(notifee, restores));
  }

  return () => {
    for (const restore of restores) {
      restore();
    }
    clearPushProviders();
    clearDeviceTokens();
  };
}

// ── expo-notifications ────────────────────────────────────────────────────────

function installExpo(
  expo: ExpoNotificationsLike,
  restores: Array<() => void>
): void {
  const received = expo.addNotificationReceivedListener((notification) => {
    safeCapture(() =>
      recordExpo('received', true, notification as ExpoNotification)
    );
  });
  restores.push(() => received.remove());

  const responded = expo.addNotificationResponseReceivedListener((response) => {
    const notification = (response as ExpoNotificationResponse | undefined)
      ?.notification;
    safeCapture(() => recordExpo('responded', isForeground(), notification));
  });
  restores.push(() => responded.remove());

  // Device push-token refreshes (native FCM/APNs token, via expo).
  if (expo.addPushTokenListener) {
    const tokenSub = expo.addPushTokenListener((raw) => {
      const token = raw as ExpoDevicePushToken | undefined;
      safeCapture(() => {
        setDeviceToken({
          provider: 'expo',
          kind: deviceTokenKind(token?.type),
          token: token?.data ?? '',
          updatedAt: Date.now(),
        });
        record({
          provider: 'expo',
          phase: 'token-refresh',
          origin: 'remote',
          foreground: isForeground(),
          data: toDataString(token?.data),
        });
      });
    });
    restores.push(() => tokenSub.remove());
  }

  // Resolve the current tokens (fire-and-forget; failures surface as `error` hints).
  void resolveExpoToken(expo.getExpoPushTokenAsync, 'expo');
  void resolveExpoDeviceToken(expo.getDevicePushTokenAsync);

  // Outgoing/local notifications the app schedules or presents itself.
  patchExpoOutgoing(expo, 'scheduleNotificationAsync', restores);
  patchExpoOutgoing(expo, 'presentNotificationAsync', restores);
}

function recordExpo(
  phase: NotificationPhase,
  foreground: boolean,
  notification: ExpoNotification | undefined
): void {
  const content = notification?.request?.content;
  const origin =
    notification?.request?.trigger?.type === 'push' ? 'remote' : 'local';
  record({
    provider: 'expo',
    phase,
    origin,
    foreground,
    title: content?.title ?? undefined,
    body: content?.body ?? undefined,
    data: toDataString(content?.data),
    messageId: notification?.request?.identifier,
  });
}

function patchExpoOutgoing(
  expo: ExpoNotificationsLike,
  key: 'scheduleNotificationAsync' | 'presentNotificationAsync',
  restores: Array<() => void>
): void {
  if (typeof expo[key] !== 'function') {
    return;
  }
  restores.push(
    patchMethod(expo, key, (original) => {
      const call = original as (...args: unknown[]) => Promise<unknown>;
      return (...args: unknown[]) => {
        const request = args[0] as
          | { identifier?: string; content?: ExpoNotificationContent }
          | undefined;
        safeCapture(() =>
          record({
            provider: 'expo',
            phase: 'scheduled',
            origin: 'local',
            foreground: isForeground(),
            title: request?.content?.title ?? undefined,
            body: request?.content?.body ?? undefined,
            data: toDataString(request?.content?.data),
            messageId: request?.identifier,
          })
        );
        return call(...args);
      };
    })
  );
}

async function resolveExpoToken(
  getter: ExpoNotificationsLike['getExpoPushTokenAsync'],
  kind: string
): Promise<void> {
  if (!getter) return;
  try {
    const result = await getter();
    safeCapture(() =>
      setDeviceToken({
        provider: 'expo',
        kind,
        token: result?.data ?? '',
        updatedAt: Date.now(),
      })
    );
  } catch (error) {
    publishTokenError('expo', kind, error);
  }
}

async function resolveExpoDeviceToken(
  getter: ExpoNotificationsLike['getDevicePushTokenAsync']
): Promise<void> {
  if (!getter) return;
  try {
    const result = await getter();
    safeCapture(() =>
      setDeviceToken({
        provider: 'expo',
        kind: deviceTokenKind(result?.type),
        token: result?.data ?? '',
        updatedAt: Date.now(),
      })
    );
  } catch (error) {
    publishTokenError('expo', 'device', error);
  }
}

/** Map an expo device-token `type` to our token kind. */
function deviceTokenKind(type: string | undefined): string {
  if (type === 'ios') return 'apns';
  if (type === 'android') return 'fcm';
  return type || 'device';
}

// ── @react-native-firebase/messaging ──────────────────────────────────────────

function installFirebase(
  firebaseMessaging: FirebaseMessagingLike,
  restores: Array<() => void>
): void {
  let messaging: FirebaseMessaging;
  try {
    messaging = firebaseMessaging();
  } catch (error) {
    // Typically "No firebase app '[DEFAULT]' has been created" when the native
    // Firebase app isn't configured. Surface it as a token-error row instead of
    // silently dropping the provider, so the Device Token panel explains itself.
    publishTokenError('firebase', 'fcm', error);
    return;
  }

  const offMessage = messaging.onMessage((message) => {
    safeCapture(() => recordFirebase('received', true, message));
  });
  restores.push(offMessage);

  const offOpened = messaging.onNotificationOpenedApp((message) => {
    safeCapture(() => recordFirebase('opened', false, message));
  });
  restores.push(offOpened);

  // App opened from a quit state by tapping a notification.
  void messaging
    .getInitialNotification()
    .then((message) => {
      if (message) safeCapture(() => recordFirebase('opened', false, message));
    })
    .catch(() => {});

  const offToken = messaging.onTokenRefresh((raw) => {
    const token = typeof raw === 'string' ? raw : safeStringify(raw);
    safeCapture(() => {
      setDeviceToken({
        provider: 'firebase',
        kind: 'fcm',
        token,
        updatedAt: Date.now(),
      });
      record({
        provider: 'firebase',
        phase: 'token-refresh',
        origin: 'remote',
        foreground: isForeground(),
        data: toDataString(token),
      });
    });
  });
  restores.push(offToken);

  void messaging
    .getToken()
    .then((token) =>
      safeCapture(() =>
        setDeviceToken({
          provider: 'firebase',
          kind: 'fcm',
          token,
          updatedAt: Date.now(),
        })
      )
    )
    .catch((error: unknown) => publishTokenError('firebase', 'fcm', error));

  // Background messages — only captured when the host registers its handler after
  // install (a handler registered earlier can't be intercepted). Passthrough wrap.
  if (typeof messaging.setBackgroundMessageHandler === 'function') {
    restores.push(
      patchMethod(messaging, 'setBackgroundMessageHandler', (original) => {
        const call = original as NonNullable<
          FirebaseMessaging['setBackgroundMessageHandler']
        >;
        return (handler: (message: unknown) => Promise<unknown>) =>
          call((message: unknown) => {
            safeCapture(() => recordFirebase('background', false, message));
            return handler(message);
          });
      })
    );
  }
}

function recordFirebase(
  phase: NotificationPhase,
  foreground: boolean,
  raw: unknown
): void {
  const message = raw as FirebaseRemoteMessage | undefined;
  record({
    provider: 'firebase',
    phase,
    origin: 'remote',
    foreground,
    title: message?.notification?.title,
    body: message?.notification?.body,
    data: toDataString(message?.data),
    messageId: message?.messageId,
  });
}

// ── @notifee/react-native ─────────────────────────────────────────────────────

function installNotifee(
  notifee: NotifeeLike,
  restores: Array<() => void>
): void {
  const off = notifee.onForegroundEvent((event) => {
    safeCapture(() => recordNotifee(event, true));
  });
  restores.push(off);

  // Background events — only captured when the host registers its handler after
  // install (notifee allows a single handler, usually set at module load, before
  // install). Best-effort passthrough wrap, mirroring firebase's background handler.
  if (typeof notifee.onBackgroundEvent === 'function') {
    restores.push(
      patchMethod(notifee, 'onBackgroundEvent', (original) => {
        const call = original as NonNullable<NotifeeLike['onBackgroundEvent']>;
        return (observer: (event: unknown) => Promise<unknown>) =>
          call((event: unknown) => {
            safeCapture(() => recordNotifee(event, false));
            return observer(event);
          });
      })
    );
  }

  // Outgoing local notifications the app displays or schedules itself.
  patchNotifeeOutgoing(notifee, 'displayNotification', restores);
  patchNotifeeOutgoing(notifee, 'createTriggerNotification', restores);
}

/** Map a notifee `EventType` to a phase, or `null` for events we don't record. */
function notifeePhase(type: number | undefined): NotificationPhase | null {
  switch (type) {
    case NOTIFEE_EVENT.DELIVERED:
      return 'received';
    case NOTIFEE_EVENT.PRESS:
      return 'opened';
    case NOTIFEE_EVENT.ACTION_PRESS:
      return 'responded';
    case NOTIFEE_EVENT.DISMISSED:
      return 'dismissed';
    case NOTIFEE_EVENT.TRIGGER_NOTIFICATION_CREATED:
      return 'scheduled';
    default:
      // UNKNOWN / *_BLOCKED / FG_ALREADY_EXIST — not user-facing notifications.
      return null;
  }
}

function recordNotifee(raw: unknown, foreground: boolean): void {
  const event = raw as NotifeeEvent | undefined;
  const phase = notifeePhase(event?.type);
  if (!phase) {
    return;
  }
  const notification = event?.detail?.notification;
  record({
    provider: 'notifee',
    phase,
    // notifee only ever displays on-device; the remote source (if any) is captured
    // separately by firebase.
    origin: 'local',
    foreground,
    title: notification?.title,
    body: notification?.body,
    data: toDataString(notification?.data),
    messageId: notification?.id,
  });
}

function patchNotifeeOutgoing(
  notifee: NotifeeLike,
  key: 'displayNotification' | 'createTriggerNotification',
  restores: Array<() => void>
): void {
  if (typeof notifee[key] !== 'function') {
    return;
  }
  restores.push(
    patchMethod(notifee, key, (original) => {
      const call = original as (...args: unknown[]) => Promise<unknown>;
      return (...args: unknown[]) => {
        const notification = args[0] as NotifeeNotification | undefined;
        safeCapture(() =>
          record({
            provider: 'notifee',
            phase: 'scheduled',
            origin: 'local',
            foreground: isForeground(),
            title: notification?.title,
            body: notification?.body,
            data: toDataString(notification?.data),
            messageId: notification?.id,
          })
        );
        return call(...args);
      };
    })
  );
}

// ── Shared helpers ────────────────────────────────────────────────────────────

/** A serialized data payload and whether capture had to cut it. */
interface CapturedData {
  text: string;
  truncated: boolean;
}

interface RecordInput {
  provider: NotificationProvider;
  phase: NotificationPhase;
  origin: 'local' | 'remote';
  foreground: boolean;
  title?: string;
  body?: string;
  data?: CapturedData;
  messageId?: string;
}

function record(input: RecordInput): void {
  const session = getCurrentSession();
  if (!session) {
    return;
  }
  const { data, ...rest } = input;
  const event: NotificationEvent = {
    id: createEventId(),
    sessionId: session.id,
    timestamp: Date.now(),
    kind: 'notification',
    ...rest,
    data: data?.text,
    dataTruncated: data?.truncated ?? false,
  };
  captureEvent(event);
}

function publishTokenError(
  provider: NotificationProvider,
  kind: string,
  error: unknown
): void {
  safeCapture(() =>
    setDeviceToken({
      provider,
      kind,
      token: '',
      error: error instanceof Error ? error.message : safeStringify(error),
      updatedAt: Date.now(),
    })
  );
}

/**
 * Capture a notification data payload, or `undefined` when there is nothing worth
 * recording. Reports the truncation alongside the text so the row can say so rather
 * than presenting a cut payload as whole.
 *
 * A string is kept as-is rather than JSON-encoded — the plain-text callers are push
 * tokens, and quoting them would only add noise — while anything else is serialized
 * first. Both then go through the same cap, so a token cannot slip past it.
 */
function toDataString(data: unknown): CapturedData | undefined {
  if (data == null) return undefined;
  if (typeof data === 'object' && Object.keys(data).length === 0) {
    return undefined;
  }
  const raw = typeof data === 'string' ? data : safeStringify(data);
  const { text, truncated } = truncateToBytes(raw, MAX_DATA_BYTES);
  return { text, truncated };
}

function isForeground(): boolean {
  return AppState.currentState === 'active';
}
