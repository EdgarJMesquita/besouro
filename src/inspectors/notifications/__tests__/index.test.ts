/**
 * Notifications inspector — pure-JS provider wrapping. The `react-native` AppState
 * dependency is mocked (the inspector only reads `AppState.currentState`), and the
 * expo / firebase peers are hand-rolled fakes so we can drive their listeners.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

jest.mock('react-native', () => ({
  AppState: { currentState: 'active' },
}));

import { installNotificationsInspector } from '../interceptor';
import type {
  ExpoNotificationsLike,
  FirebaseMessagingLike,
  NotifeeLike,
} from '../types';
import { recordCaptures } from '../../../core/__tests__/capture-recorder';
import { startSession } from '../../../core/session';
import { getInspectorStatus } from '../../../core/status';
import { getDeviceTokens } from '../store/device-tokens';
import { getPushProviders } from '../store/push-providers';
import type { NotificationEvent } from '../../../core/types';

// ── Fake expo-notifications ───────────────────────────────────────────────────

/** Records what capture hands to persistence — see capture-recorder. */
const captured = recordCaptures();

function createFakeExpo() {
  const received: Array<(n: unknown) => void> = [];
  const responded: Array<(r: unknown) => void> = [];
  const tokenListeners: Array<(t: unknown) => void> = [];
  let removed = 0;

  const sub = () => ({
    remove() {
      removed += 1;
    },
  });

  const expo: ExpoNotificationsLike = {
    addNotificationReceivedListener(listener) {
      received.push(listener as (n: unknown) => void);
      return sub();
    },
    addNotificationResponseReceivedListener(listener) {
      responded.push(listener as (r: unknown) => void);
      return sub();
    },
    addPushTokenListener(listener) {
      tokenListeners.push(listener as (t: unknown) => void);
      return sub();
    },
    getExpoPushTokenAsync: async () => ({ data: 'ExpoToken', type: 'expo' }),
    getDevicePushTokenAsync: async () => ({ data: 'DeviceTok', type: 'ios' }),
  };

  return {
    expo,
    emitReceived: (n: unknown) => received.forEach((l) => l(n)),
    emitResponded: (r: unknown) => responded.forEach((l) => l(r)),
    emitToken: (t: unknown) => tokenListeners.forEach((l) => l(t)),
    get removed() {
      return removed;
    },
  };
}

function expoNotification(
  title: string,
  triggerType?: string,
  data?: unknown
): unknown {
  return {
    request: {
      identifier: `id-${title}`,
      content: { title, body: `${title} body`, data },
      trigger: triggerType ? { type: triggerType } : null,
    },
  };
}

// ── Fake firebase messaging ───────────────────────────────────────────────────

function createFakeFirebase() {
  const messageListeners: Array<(m: unknown) => void> = [];
  const messaging = {
    onMessage(listener: (m: unknown) => void) {
      messageListeners.push(listener);
      return () => {};
    },
    onNotificationOpenedApp() {
      return () => {};
    },
    getInitialNotification: async () => null,
    onTokenRefresh() {
      return () => {};
    },
    getToken: async () => 'FcmToken',
  };
  const factory: FirebaseMessagingLike = () => messaging as never;
  return {
    firebaseMessaging: factory,
    emitMessage: (m: unknown) => messageListeners.forEach((l) => l(m)),
  };
}

// ── Fake notifee ──────────────────────────────────────────────────────────────

// Mirror notifee's numeric EventType enum for readable test cases.
const EventType = {
  DISMISSED: 0,
  PRESS: 1,
  ACTION_PRESS: 2,
  DELIVERED: 3,
  TRIGGER_NOTIFICATION_CREATED: 7,
  UNKNOWN: -1,
} as const;

function createFakeNotifee() {
  const foreground: Array<(e: unknown) => void> = [];
  let backgroundObserver: ((e: unknown) => Promise<unknown>) | null = null;
  let unsubscribed = 0;

  const notifee: NotifeeLike = {
    onForegroundEvent(observer) {
      foreground.push(observer as (e: unknown) => void);
      return () => {
        unsubscribed += 1;
      };
    },
    onBackgroundEvent(observer) {
      backgroundObserver = observer as (e: unknown) => Promise<unknown>;
    },
    displayNotification: async () => 'display-id',
    createTriggerNotification: async () => 'trigger-id',
  };

  return {
    notifee,
    emitForeground: (type: number, notification?: unknown) =>
      foreground.forEach((l) => l({ type, detail: { notification } })),
    registerBackground: (observer: (e: unknown) => Promise<unknown>) =>
      notifee.onBackgroundEvent!(observer),
    emitBackground: (type: number, notification?: unknown) =>
      backgroundObserver?.({ type, detail: { notification } }),
    get unsubscribed() {
      return unsubscribed;
    },
  };
}

function notifeeNotification(title: string, data?: unknown): unknown {
  return { id: `n-${title}`, title, body: `${title} body`, data };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Newest first — the order the tab renders them, which is what the ordering
 * assertions below are written against. The recorder itself keeps capture order.
 */
function notifications(): NotificationEvent[] {
  return captured.eventsOf<NotificationEvent>('notification').reverse();
}

const flush = () =>
  new Promise<void>((resolve) => setTimeout(() => resolve(), 0));

beforeEach(() => {
  captured.reset();
  startSession();
});

describe('installNotificationsInspector (expo)', () => {
  it('records a received notification with provider/phase/local origin', () => {
    const fake = createFakeExpo();
    const uninstall = installNotificationsInspector({
      expoNotifications: fake.expo,
    });

    fake.emitReceived(expoNotification('Hello'));

    const events = notifications();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      provider: 'expo',
      phase: 'received',
      origin: 'local',
      foreground: true,
      title: 'Hello',
      notificationId: 'id-Hello',
    });
    uninstall();
  });

  it('marks push-triggered notifications as remote', () => {
    const fake = createFakeExpo();
    const uninstall = installNotificationsInspector({
      expoNotifications: fake.expo,
    });

    fake.emitReceived(expoNotification('Remote', 'push'));

    expect(notifications()[0]).toMatchObject({ origin: 'remote' });
    uninstall();
  });

  it('flags a data payload the byte cap had to cut', () => {
    const fake = createFakeExpo();
    const uninstall = installNotificationsInspector({
      expoNotifications: fake.expo,
    });

    fake.emitReceived(
      expoNotification('Huge', 'push', { blob: 'x'.repeat(600_000) })
    );

    const event = notifications()[0];
    expect(event?.dataTruncated).toBe(true);
    expect((event?.data?.length ?? 0) < 600_000).toBe(true);
    uninstall();
  });

  it('leaves the flag off for a data payload that fit', () => {
    const fake = createFakeExpo();
    const uninstall = installNotificationsInspector({
      expoNotifications: fake.expo,
    });

    fake.emitReceived(expoNotification('Small', 'push', { ok: true }));

    expect(notifications()[0]?.dataTruncated).toBe(false);
    uninstall();
  });

  it('records a response as the "responded" phase', () => {
    const fake = createFakeExpo();
    const uninstall = installNotificationsInspector({
      expoNotifications: fake.expo,
    });

    fake.emitResponded({ notification: expoNotification('Tapped') });

    expect(notifications()[0]).toMatchObject({
      phase: 'responded',
      title: 'Tapped',
    });
    uninstall();
  });

  it('publishes resolved device tokens and registers the provider', async () => {
    const fake = createFakeExpo();
    const uninstall = installNotificationsInspector({
      expoNotifications: fake.expo,
    });

    expect(getPushProviders()).toEqual(['expo']);

    await flush();
    const tokens = getDeviceTokens();
    expect(tokens.map((t) => t.token).sort()).toEqual([
      'DeviceTok',
      'ExpoToken',
    ]);
    expect(tokens.every((t) => t.provider === 'expo')).toBe(true);
    uninstall();
  });

  it('emits a token-refresh event and updates the token store', () => {
    const fake = createFakeExpo();
    const uninstall = installNotificationsInspector({
      expoNotifications: fake.expo,
    });

    fake.emitToken({ type: 'android', data: 'RefreshedTok' });

    expect(notifications()[0]).toMatchObject({
      provider: 'expo',
      phase: 'token-refresh',
    });
    expect(
      getDeviceTokens().find((t) => t.token === 'RefreshedTok')
    ).toBeDefined();
    uninstall();
  });

  it('tears down listeners, providers and tokens on uninstall', async () => {
    const fake = createFakeExpo();
    const uninstall = installNotificationsInspector({
      expoNotifications: fake.expo,
    });
    await flush();

    uninstall();

    expect(fake.removed).toBeGreaterThan(0);
    expect(getPushProviders()).toEqual([]);
    expect(getDeviceTokens()).toEqual([]);
  });
});

describe('installNotificationsInspector (firebase)', () => {
  it('records onMessage as a remote firebase notification with messageId', () => {
    const fake = createFakeFirebase();
    const uninstall = installNotificationsInspector({
      firebaseMessaging: fake.firebaseMessaging,
    });

    fake.emitMessage({
      messageId: 'msg-1',
      notification: { title: 'FCM', body: 'hi' },
      data: { k: 'v' },
    });

    expect(notifications()[0]).toMatchObject({
      provider: 'firebase',
      phase: 'received',
      origin: 'remote',
      notificationId: 'msg-1',
      title: 'FCM',
    });
    uninstall();
  });

  it('still registers the provider and surfaces an error when messaging() throws', () => {
    // Mirrors an unconfigured native Firebase app: `messaging()` throws at install.
    const factory: FirebaseMessagingLike = () => {
      throw new Error("No firebase app '[DEFAULT]' has been created");
    };
    const uninstall = installNotificationsInspector({
      firebaseMessaging: factory,
    });

    // The provider must remain registered so the Device Token panel keeps showing
    // the firebase section rather than vanishing on a partial install failure.
    expect(getPushProviders()).toEqual(['firebase']);
    // ...and the failure is surfaced as a token-error row, not swallowed.
    const token = getDeviceTokens().find((t) => t.provider === 'firebase');
    expect(token?.error).toContain('[DEFAULT]');
    expect(token?.token).toBe('');
    uninstall();
  });
});

describe('installNotificationsInspector (notifee)', () => {
  it('maps each foreground EventType to the right phase', () => {
    const fake = createFakeNotifee();
    const uninstall = installNotificationsInspector({
      notifee: fake.notifee,
    });

    fake.emitForeground(EventType.DELIVERED, notifeeNotification('Shown'));
    fake.emitForeground(EventType.PRESS, notifeeNotification('Tapped'));
    fake.emitForeground(EventType.ACTION_PRESS, notifeeNotification('Acted'));
    fake.emitForeground(EventType.DISMISSED, notifeeNotification('Swiped'));

    // The store returns events newest-first, so the emit order is reversed here.
    expect(
      notifications().map((e) => ({
        provider: e.provider,
        phase: e.phase,
        origin: e.origin,
        foreground: e.foreground,
        title: e.title,
        notificationId: e.notificationId,
      }))
    ).toEqual([
      {
        provider: 'notifee',
        phase: 'dismissed',
        origin: 'local',
        foreground: true,
        title: 'Swiped',
        notificationId: 'n-Swiped',
      },
      {
        provider: 'notifee',
        phase: 'responded',
        origin: 'local',
        foreground: true,
        title: 'Acted',
        notificationId: 'n-Acted',
      },
      {
        provider: 'notifee',
        phase: 'opened',
        origin: 'local',
        foreground: true,
        title: 'Tapped',
        notificationId: 'n-Tapped',
      },
      {
        provider: 'notifee',
        phase: 'received',
        origin: 'local',
        foreground: true,
        title: 'Shown',
        notificationId: 'n-Shown',
      },
    ]);
    uninstall();
  });

  it('ignores non-user-facing event types', () => {
    const fake = createFakeNotifee();
    const uninstall = installNotificationsInspector({
      notifee: fake.notifee,
    });

    fake.emitForeground(EventType.UNKNOWN, notifeeNotification('Nope'));

    expect(notifications()).toHaveLength(0);
    uninstall();
  });

  it('records displayNotification as an outgoing "scheduled" event and passes through', async () => {
    const fake = createFakeNotifee();
    const uninstall = installNotificationsInspector({
      notifee: fake.notifee,
    });

    const result = await fake.notifee.displayNotification!(
      notifeeNotification('Outgoing', { k: 'v' })
    );

    expect(result).toBe('display-id');
    expect(notifications()[0]).toMatchObject({
      provider: 'notifee',
      phase: 'scheduled',
      origin: 'local',
      title: 'Outgoing',
      notificationId: 'n-Outgoing',
    });
    uninstall();
  });

  it('captures background events for handlers registered after install', () => {
    const fake = createFakeNotifee();
    const uninstall = installNotificationsInspector({
      notifee: fake.notifee,
    });

    const hostHandler = jest.fn(async () => {});
    fake.registerBackground(hostHandler);
    fake.emitBackground(EventType.PRESS, notifeeNotification('BgTap'));

    expect(hostHandler).toHaveBeenCalledTimes(1);
    expect(notifications()[0]).toMatchObject({
      provider: 'notifee',
      phase: 'opened',
      foreground: false,
      title: 'BgTap',
    });
    uninstall();
  });

  it('does not register notifee as a device-token provider', () => {
    const fake = createFakeNotifee();
    const uninstall = installNotificationsInspector({
      notifee: fake.notifee,
    });

    // notifee has no device token, so the Device Token panel must stay hidden.
    expect(getPushProviders()).toEqual([]);
    expect(getDeviceTokens()).toEqual([]);
    uninstall();
  });

  it('unsubscribes its foreground listener on uninstall', () => {
    const fake = createFakeNotifee();
    const uninstall = installNotificationsInspector({
      notifee: fake.notifee,
    });

    uninstall();

    expect(fake.unsubscribed).toBeGreaterThan(0);
  });
});

describe('installNotificationsInspector (both providers)', () => {
  it('records the same push once per provider (no dedup)', () => {
    const expoFake = createFakeExpo();
    const fbFake = createFakeFirebase();
    const uninstall = installNotificationsInspector({
      expoNotifications: expoFake.expo,
      firebaseMessaging: fbFake.firebaseMessaging,
    });

    expoFake.emitReceived(expoNotification('Dup', 'push'));
    fbFake.emitMessage({ messageId: 'm', notification: { title: 'Dup' } });

    const providers = notifications().map((e) => e.provider);
    expect(providers.sort()).toEqual(['expo', 'firebase']);
    expect(getPushProviders().sort()).toEqual(['expo', 'firebase']);
    uninstall();
  });
});

describe('installNotificationsInspector (no peer)', () => {
  it('reports not-installed and records nothing', async () => {
    const uninstall = installNotificationsInspector({});

    // Status is set in a microtask (works around guardInstall's forced active).
    await Promise.resolve();
    expect(getInspectorStatus('notifications')).toBe('not-installed');
    expect(notifications()).toHaveLength(0);
    uninstall();
  });
});
