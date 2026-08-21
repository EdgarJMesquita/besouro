/**
 * Haptic feedback, through the library's own native module — no peer dependency,
 * no `VIBRATE` permission added to the host app, and a *light* tap rather than
 * the whole-device buzz RN's `Vibration` produces on iOS. See the `haptic` entry
 * in `native/NativeBesouro.ts` for why it is native at all.
 */

import NativeBesouro from '../native/NativeBesouro';

/**
 * A single short tap, for a gesture that changed state under the finger.
 *
 * Silent when there is no native module (tests, web) and when the call itself
 * fails — including against a native build older than the method, which is what
 * a JS-only reload leaves behind. Feedback is a garnish: it must never be able to
 * take down the gesture it is decorating.
 */
export function hapticTap(): void {
  if (!NativeBesouro) return;
  try {
    NativeBesouro.haptic();
  } catch {
    // No haptics here; the gesture carries on regardless.
  }
}
