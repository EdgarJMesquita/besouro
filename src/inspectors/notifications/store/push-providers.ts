/**
 * The push providers available to the app, derived purely in JS from which
 * notification peer modules the consumer passed to `notificationsInspector(...)`.
 *
 * (Previously resolved natively via `getPushCapabilities`; now that notification
 * capture is fully JS-side, the inspector publishes the set it was given here and
 * the Notifications tab's Device Token panel subscribes.)
 */

import { useSyncExternalStore } from 'react';
import type { NotificationProvider } from '../../../core/types';

const providers = new Set<NotificationProvider>();
const listeners = new Set<() => void>();
let snapshot: NotificationProvider[] = [];

function emit(): void {
  snapshot = [...providers];
  for (const listener of listeners) {
    listener();
  }
}

/** Publish the active providers (idempotent — no-ops when the set is unchanged). */
export function setPushProviders(next: readonly NotificationProvider[]): void {
  if (
    next.length === providers.size &&
    next.every((provider) => providers.has(provider))
  ) {
    return;
  }
  providers.clear();
  for (const provider of next) {
    providers.add(provider);
  }
  emit();
}

/** Clear all providers — used when the notifications inspector tears down. */
export function clearPushProviders(): void {
  if (providers.size === 0) {
    return;
  }
  providers.clear();
  emit();
}

export function getPushProviders(): NotificationProvider[] {
  return snapshot;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Subscribe a component to the current push providers. */
export function usePushProviders(): NotificationProvider[] {
  return useSyncExternalStore(subscribe, getPushProviders);
}
