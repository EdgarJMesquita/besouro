/**
 * Two MMKV instances for exercising the MMKV inspector.
 *
 * Deliberately two, because that is the case AsyncStorage never produces: apps
 * routinely keep a general store next to a separate one for settings or secrets,
 * and the inspector has to keep their logs and contents apart.
 *
 * Seeded at module load, which is *before* `init()` runs — so these writes are
 * deliberately never captured as operations. That is the point: they stand in for the
 * keys a real app wrote during a previous launch, and the Store pane showing them
 * anyway is the whole reason it reads from a snapshot of the instance rather than
 * from the operation log. The App's buttons drive everything that should appear in
 * the log.
 *
 * Only when empty, so tapping "MMKV: clear all" is not undone on the next reload
 * until the store has actually been emptied.
 */

import { createMMKV } from 'react-native-mmkv';

export const storage = createMMKV();

export const settingsStorage = createMMKV({ id: 'settings' });

if (storage.getAllKeys().length === 0) {
  storage.set('install.id', 'a3f1c0de-seeded');
  storage.set('onboarding.completed', true);
}

if (settingsStorage.getAllKeys().length === 0) {
  settingsStorage.set('theme', 'system');
}
