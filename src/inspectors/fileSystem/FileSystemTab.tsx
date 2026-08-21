/**
 * File System tab — a read-only browser of the app's sandbox tree, backed by the
 * dedicated `BesouroFileSystem` native module. Unlike the event-stream tabs it holds
 * its own navigation state (a directory path stack) and pulls listings/reads from
 * native on demand.
 *
 * Directory navigation happens in the tab body (with a back affordance) and opening
 * a file pushes a detail overlay, but both register with the shared detail-nav — so
 * Android hardware back unwinds the open file first, then the directory stack one
 * folder at a time, and only closes the drawer once the roots are showing.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePersistedState } from '../../core/persisted-state';
import { useEphemeralState } from '../../core/ephemeral-state';
import {
  ActivityIndicator,
  FlatList,
  View,
  type ListRenderItem,
} from 'react-native';
import type { DirectoryEntry, FileSystemRoot } from './types';
import { createFileSystemBrowser } from './browser';

import { useBesouroUI } from '../../shared/context';
import { DetailOverlay } from '../../shared/components/DetailOverlay';
import { useDetailEntrance } from '../../shared/hooks/detail-slide';
import { useDetailLevel } from '../../shared/detail-nav';

import { SearchBox } from '../../shared/components/SearchBox';
import { BackButton } from '../../shared/components/BackButton';
import { EmptyState } from '../../shared/components/EmptyState';

import { MonoText } from '../../shared/components/MonoText';
import { space, fontSize } from '../../theme/tokens';
import { useListBottomPadding } from '../../shared/hooks/safe-area';
import { EntryRow } from './components/EntryRow';
import { GridCell, GRID_COLUMNS } from './components/GridCell';
import { RefreshButton } from './components/RefreshButton';
import { ViewModeToggle, type ViewMode } from './components/ViewModeToggle';
import { rootToEntry, sortEntries } from './utils/entries';
import { FileDetail } from './FileSystemDetail';
import { layout } from '../../shared/styles';
import { StyleSheet } from 'react-native';

export function FileSystemTab(): React.ReactNode {
  const s = useStyles();
  const { theme, strings } = useBesouroUI();
  const browser = useMemo(() => createFileSystemBrowser(), []);
  const [roots, setRoots] = useState<FileSystemRoot[]>([]);
  const [pathStack, setPathStack] = useEphemeralState<string[]>(
    'fileSystem.pathStack',
    []
  );
  const [entries, setEntries] = useState<DirectoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedFile, setSelectedFile] =
    useEphemeralState<DirectoryEntry | null>('fileSystem.selectedFile', null);
  const [query, setQuery] = useState('');
  const [viewMode, setViewMode] = usePersistedState<ViewMode>(
    'fileSystem.viewMode',
    'list'
  );
  const listBottomPadding = useListBottomPadding();

  const currentPath = pathStack[pathStack.length - 1] ?? null;
  const atRoots = currentPath == null;

  // Read by the refresh below to check, at resolve time, that the listing it
  // just fetched is still the one on screen.
  const currentPathRef = useRef(currentPath);
  currentPathRef.current = currentPath;

  // Roots are stable for the session — load once.
  useEffect(() => {
    if (!browser) {
      return;
    }
    let cancelled = false;
    browser.listRoots().then((resolved) => {
      if (!cancelled) {
        setRoots(resolved);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [browser]);

  // (Re)load the current directory whenever it changes. A cancelled flag drops
  // stale responses so a fast back/forward can't render the wrong listing.
  useEffect(() => {
    if (!browser || currentPath == null) {
      setEntries([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    browser.listDirectory(currentPath).then((resolved) => {
      if (cancelled) {
        return;
      }
      setEntries(sortEntries(resolved));
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [browser, currentPath]);

  // Clear the filter when moving between directories.
  useEffect(() => {
    setQuery('');
  }, [currentPath]);

  // Every hook below must stay above the `!browser` guard — an early return
  // between hooks would change hook order when the native module isn't linked.
  const openEntry = useCallback(
    (entry: DirectoryEntry): void => {
      if (entry.isDirectory) {
        setPathStack((stack) => [...stack, entry.path]);
      } else {
        setSelectedFile(entry);
      }
    },
    [setPathStack, setSelectedFile]
  );

  const leaveDirectory = useCallback(
    () => setPathStack((stack) => stack.slice(0, -1)),
    [setPathStack]
  );

  // Directory descent is navigation, so it belongs on the same back stack as the
  // detail overlays: Android back (and the drawer's own back routing) pops one
  // directory at a time until the roots are showing, and only then closes the
  // drawer. One registration covers the whole descent — it stays active while
  // the stack is non-empty, and each back press pops a single level off it.
  //
  // Held back while a file detail is open so the two can't compete for the top
  // of the stack. The overlay registers from a child effect, which on a fresh
  // mount runs *before* this one — so a tab remount that restores both an open
  // file and a directory stack (both are ephemeral state) would otherwise put
  // the directory on top and pop a folder out from under the open file.
  useDetailLevel(!atRoots && selectedFile == null, leaveDirectory);

  // Re-reads the directory on screen. Deliberately not wired through the load
  // effect above: that one blanks the list behind a spinner, which is right when
  // the directory changed and wrong when the same rows are being re-read.
  const refresh = useCallback(async (): Promise<void> => {
    const path = currentPathRef.current;
    if (!browser || path == null) {
      return;
    }
    setRefreshing(true);
    try {
      const resolved = await browser.listDirectory(path);
      // Navigating away mid-read hands the directory back to the effect below;
      // writing this listing now would show the old folder's rows under the new
      // folder's path.
      if (currentPathRef.current === path) {
        setEntries(sortEntries(resolved));
      }
    } finally {
      setRefreshing(false);
    }
  }, [browser]);

  const keyExtractor = useCallback((entry: DirectoryEntry) => entry.path, []);
  const renderGridCell = useCallback<ListRenderItem<DirectoryEntry>>(
    ({ item }) => <GridCell entry={item} onSelect={openEntry} />,
    [openEntry]
  );
  const renderEntryRow = useCallback<ListRenderItem<DirectoryEntry>>(
    ({ item }) => <EntryRow entry={item} onSelect={openEntry} />,
    [openEntry]
  );
  const gridContentStyle = useMemo(
    () => ({
      paddingVertical: space.md,
      paddingBottom: space.md + listBottomPadding,
    }),
    [listBottomPadding]
  );
  const listContentStyle = useMemo(
    () => ({ paddingBottom: listBottomPadding }),
    [listBottomPadding]
  );
  const closeDetail = useCallback(
    () => setSelectedFile(null),
    [setSelectedFile]
  );
  // Before the early return below — hooks can't be called conditionally.
  const animateDetail = useDetailEntrance(selectedFile);

  if (!browser) {
    return <EmptyState message={strings.fileSystemUnavailable} />;
  }

  const listData = atRoots ? roots.map(rootToEntry) : entries;
  const needle = query.trim().toLowerCase();
  const filtered = needle
    ? listData.filter((entry) => entry.name.toLowerCase().includes(needle))
    : listData;

  return (
    <View style={layout.fill}>
      {selectedFile ? (
        <DetailOverlay onClose={closeDetail} animateIn={animateDetail}>
          <FileDetail browser={browser} entry={selectedFile} />
        </DetailOverlay>
      ) : null}
      <View style={s.surface}>
        {!atRoots ? (
          <View style={styles.row2}>
            <BackButton onPress={leaveDirectory} />
            <MonoText
              style={layout.fill}
              color={theme.textMuted}
              size={fontSize.caption}
            >
              {currentPath}
            </MonoText>
            <RefreshButton onPress={refresh} busy={refreshing} />
          </View>
        ) : null}
        <View style={styles.row}>
          <SearchBox value={query} onChangeText={setQuery} />
          <ViewModeToggle value={viewMode} onChange={setViewMode} />
        </View>
      </View>
      {loading ? (
        <View style={styles.block}>
          <ActivityIndicator color={theme.accent} />
        </View>
      ) : filtered.length === 0 ? (
        <EmptyState message={query ? strings.noResults : strings.emptyFolder} />
      ) : viewMode === 'grid' ? (
        <FlatList
          key="grid"
          data={filtered}
          keyExtractor={keyExtractor}
          numColumns={GRID_COLUMNS}
          contentContainerStyle={gridContentStyle}
          renderItem={renderGridCell}
        />
      ) : (
        <FlatList
          key="list"
          data={filtered}
          keyExtractor={keyExtractor}
          contentContainerStyle={listContentStyle}
          renderItem={renderEntryRow}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    flex: 1,
    justifyContent: 'center',
  },
  row: {
    padding: space.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
  row2: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingHorizontal: space.sm,
    paddingTop: space.sm,
  },
});

/** Theme-derived styles for this module, memoized per theme/font. */
function useStyles() {
  const { theme } = useBesouroUI();
  return useMemo(
    () =>
      StyleSheet.create({
        surface: {
          backgroundColor: theme.surface,
          borderBottomWidth: 1,
          borderBottomColor: theme.border,
        },
      }),
    [theme]
  );
}
