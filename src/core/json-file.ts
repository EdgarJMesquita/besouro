/**
 * The disk round-trip for the small JSON files the library keeps in app-private
 * storage — currently `settings-store.ts` and `persisted-state.ts`.
 *
 * Those two stores are unrelated in what they hold (see each file's header); what
 * they share is the plumbing: guard the native module, read/parse or
 * stringify/write, and swallow the failure either way. That plumbing lives here so
 * neither store has to repeat it, and so neither has to import the native module
 * to hold its own state.
 *
 * Every call is a no-op when the native module is absent (tests, web) and on a
 * missing or corrupt file — persisting a UI preference is best-effort by nature,
 * and the caller's defaults are always a valid answer.
 */

import NativeBesouro from '../native/NativeBesouro';

/**
 * Read and parse `filename`. Returns `null` when there is nothing usable to
 * read — no native module, no file, or contents that will not parse — so callers
 * keep whatever defaults they already hold.
 */
export async function readJsonFile<T>(filename: string): Promise<T | null> {
  if (!NativeBesouro) return null;
  try {
    const raw = await NativeBesouro.readFile(filename);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * Serialize `value` to `filename`. Best-effort: a failed write just means the
 * choice isn't remembered next launch, which never justifies surfacing an error.
 */
export async function writeJsonFile(
  filename: string,
  value: unknown
): Promise<void> {
  if (!NativeBesouro) return;
  try {
    await NativeBesouro.writeFile(filename, JSON.stringify(value));
  } catch {
    // Intentionally ignored — see the note above.
  }
}
