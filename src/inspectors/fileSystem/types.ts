/**
 * File System inspector types — internal.
 *
 * A browser, not an event stream: these describe the live sandbox tree the
 * dedicated native module exposes, and never enter the event store — which is why
 * they live here rather than in `core/types`. The File System tab is their only
 * consumer, so none of them are re-exported from the subpath entry.
 */

/** A sandbox directory the file browser may enter (roots come from native). */
export interface FileSystemRoot {
  /** Stable identifier, e.g. 'documents' | 'cache'. */
  key: string;
  /** Human-readable label for the tab UI. */
  label: string;
  /** Absolute filesystem path. */
  path: string;
}

/** One immediate child of a directory listing. */
export interface DirectoryEntry {
  name: string;
  /** Absolute filesystem path. */
  path: string;
  isDirectory: boolean;
  sizeBytes?: number;
  /** Last-modified time, epoch milliseconds. */
  modifiedAt?: number;
}

/** Full metadata for a single path (the file-detail header). */
export interface FileMetadata extends DirectoryEntry {
  exists: boolean;
}

/** Native-backed reader the File System tab browses the sandbox through. */
export interface FileSystemBrowser {
  listRoots(): Promise<FileSystemRoot[]>;
  listDirectory(path: string): Promise<DirectoryEntry[]>;
  stat(path: string): Promise<FileMetadata | null>;
  readText(
    path: string,
    maxBytes: number
  ): Promise<{ text: string; truncated: boolean } | null>;
}
