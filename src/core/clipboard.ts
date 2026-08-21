/**
 * Clipboard bridge. Copy affordances appear throughout the UI and route through
 * the library's own native TurboModule (write-only) — no clipboard peer
 * dependency and no consumer-supplied clipboard. When the native module isn't
 * available (tests / web), copy is a no-op and the UI hides copy affordances.
 */

import NativeBesouro from '../native/NativeBesouro';

/** Whether a clipboard is available — the UI hides copy affordances when false. */
export function isClipboardAvailable(): boolean {
  return NativeBesouro != null;
}

/** Copy text if the native clipboard is available; a no-op (false) otherwise. */
export function copyToClipboard(text: string): boolean {
  if (!NativeBesouro) return false;
  try {
    // try/catch guards the call itself (a native clipboard write can fail);
    // method presence is guaranteed by codegen once the module is non-null.
    NativeBesouro.setClipboardString(text);
    return true;
  } catch {
    return false;
  }
}
