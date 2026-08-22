/** The key each provider's own record uses for the id we capture as `notificationId`. */

import type { NotificationProvider } from '../../../core/types';

/**
 * Capture normalizes three differently-named ids into one `notificationId` field, but a
 * log must not rename what it logged: displaying expo's `request.identifier` under
 * FCM's `messageId` invents a key the consumer will never find in their own code.
 * So the normalized value is shown back under the name its provider gave it.
 */
const NOTIFICATION_ID_KEY: Record<NotificationProvider, string> = {
  // expo-notifications: `notification.request.identifier`
  expo: 'identifier',
  // @react-native-firebase/messaging: `message.messageId`
  firebase: 'messageId',
  // @notifee/react-native: `notification.id`
  notifee: 'id',
};

export function notificationIdKey(provider: NotificationProvider): string {
  return NOTIFICATION_ID_KEY[provider] ?? 'id';
}
