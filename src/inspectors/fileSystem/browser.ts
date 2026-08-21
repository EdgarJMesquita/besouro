/**
 * File System data-acquisition mechanism — internal.
 *
 * Where the other inspectors put their interception logic, this one puts its reads:
 * {@link FileSystemBrowser} is a thin wrapper over the dedicated `BesouroFileSystem`
 * module's `Spec | null` export (via `TurboModuleRegistry.get`, null under Expo Go /
 * web / tests), null-checked once and parsing the module's JSON-string results into
 * the shared types. The tab pulls a browser from here on demand; nothing reaches the
 * public surface.
 *
 * Every browser method is defensive: a rejected native call or malformed payload
 * resolves to an empty/neutral value so a browse action degrades to an inline
 * message in the UI rather than throwing.
 *
 * Note this wraps `BesouroFileSystem`, a different native module from
 * `BesouroDatabase` behind `core/database/` (captured events).
 */

import type {
  DirectoryEntry,
  FileMetadata,
  FileSystemBrowser,
  FileSystemRoot,
} from './types';
import NativeBesouroFileSystem from '../../native/NativeBesouroFileSystem';

/** True when the dedicated filesystem native module is linked and callable. */
export function isFileSystemNativeAvailable(): boolean {
  return NativeBesouroFileSystem != null;
}

function parseJson<T>(raw: string, fallback: T): T {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return (parsed ?? fallback) as T;
  } catch {
    return fallback;
  }
}

/**
 * Build a browser bound to the native module, or null when it isn't available.
 * The UI checks this once and shows a "not available" state when null.
 */
export function createFileSystemBrowser(): FileSystemBrowser | null {
  // Non-null const so the narrowing carries into the async methods below.
  const fileSystem = NativeBesouroFileSystem;
  if (!fileSystem) {
    return null;
  }
  return {
    async listRoots() {
      try {
        const roots = parseJson<FileSystemRoot[]>(
          await fileSystem.listRoots(),
          []
        );
        return Array.isArray(roots) ? roots : [];
      } catch {
        return [];
      }
    },

    async listDirectory(path) {
      try {
        const entries = parseJson<DirectoryEntry[]>(
          await fileSystem.listDirectory(path),
          []
        );
        return Array.isArray(entries) ? entries : [];
      } catch {
        return [];
      }
    },

    async stat(path) {
      try {
        return parseJson<FileMetadata | null>(
          await fileSystem.statPath(path),
          null
        );
      } catch {
        return null;
      }
    },

    async readText(path, maxBytes) {
      try {
        const text = await fileSystem.readFileAtPath(path, maxBytes);
        if (text == null) {
          return null;
        }
        // The native side caps at maxBytes; a full-budget read is treated as
        // truncated so the viewer can flag it (matches the byte-budget contract
        // used elsewhere in the library).
        return { text, truncated: byteLength(text) >= maxBytes };
      } catch {
        return null;
      }
    },
  };
}

function byteLength(text: string): number {
  // Prefer TextEncoder when present; fall back to a UTF-8 estimate for RN
  // runtimes that lack it (Hermes exposes it, but tests/older engines may not).
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(text).length;
  }
  return unescape(encodeURIComponent(text)).length;
}
