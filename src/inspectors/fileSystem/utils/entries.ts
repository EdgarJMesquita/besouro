/** Sorting and shaping helpers for directory listings. */

import type { DirectoryEntry, FileSystemRoot } from '../types';

/** Present a root as a directory entry so the list renders it uniformly. */
export function rootToEntry(root: FileSystemRoot): DirectoryEntry {
  return { name: root.label, path: root.path, isDirectory: true };
}

/** Directories first, then files; each group sorted case-insensitively by name. */
export function sortEntries(entries: DirectoryEntry[]): DirectoryEntry[] {
  return [...entries].sort((first, second) => {
    if (first.isDirectory !== second.isDirectory) {
      return first.isDirectory ? -1 : 1;
    }
    return first.name.localeCompare(second.name, undefined, {
      sensitivity: 'base',
    });
  });
}
