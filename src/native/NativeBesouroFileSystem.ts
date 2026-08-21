import { TurboModuleRegistry, type TurboModule } from 'react-native';

/**
 * Dedicated TurboModule for the File System inspector — read-only browsing of the
 * app's sandbox directory tree. Kept separate from the `Besouro` module
 * (bubble/drawer/persistence) so the two concerns evolve independently.
 *
 * Every method returns a JSON string (mirroring `Besouro.readFile`) rather
 * than a codegen struct. The native side confines all `path` arguments to the
 * sandbox roots and rejects `..` traversal that escapes them.
 *
 * Not available in Expo Go (custom native code needs a Dev Client / bare build);
 * the JS wrapper requires this lazily and treats a missing module as "degraded".
 */
export interface Spec extends TurboModule {
  /** JSON-encoded `FileSystemRoot[]` — the sandbox roots the browser may enter. */
  listRoots(): Promise<string>;

  /** JSON-encoded `DirectoryEntry[]` listing the immediate children of `path`. */
  listDirectory(path: string): Promise<string>;

  /** JSON-encoded `FileMetadata` for `path`. */
  statPath(path: string): Promise<string>;

  /**
   * Read at most `maxBytes` bytes of `path` as UTF-8. The native side stats first
   * and refuses oversized reads, so a large file never lands in JS. Resolves null
   * when the file is missing or not readable as text.
   */
  readFileAtPath(path: string, maxBytes: number): Promise<string | null>;
}

/**
 * `get` (not `getEnforcing`) so the export is `Spec | null` instead of throwing
 * when the module isn't linked (Expo Go / web / tests). The JS wrapper
 * null-checks once and treats absence as "degraded"; codegen guarantees every
 * `Spec` method is present on a non-null module.
 */
export default TurboModuleRegistry.get<Spec>('BesouroFileSystem');
