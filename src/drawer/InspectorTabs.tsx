/**
 * One tab per registered inspector — the horizontal bar (see
 * {@link InspectorTabBar}) plus the selected inspector's content, wrapped in a
 * per-tab error boundary.
 *
 * Extracted from {@link BesouroShell} so the live shell and a stacked
 * {@link SessionPanel} render the exact same tabs; the only difference is which
 * session's rows they read (see `useSessionEvents`).
 *
 * Detail overlays are owned by the `detailNav` controller passed in, so each host
 * keeps its own independent detail stack.
 */

import { useCallback, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import type { Inspector } from '../core/types';
import { useInspectorStatus } from '../core/status';
import { useBesouroUI, useViewingSession } from '../shared/context';
import {
  useActiveInspector,
  setActiveInspector,
} from '../core/active-inspector-store';
import { ErrorBoundary } from '../shared/components/ErrorBoundary';
import { EmptyState } from '../shared/components/EmptyState';
import { fontSize, fontWeight } from '../theme/tokens';
import type { DetailNavController } from '../shared/detail-nav';
import { InspectorTabBar } from './InspectorTabBar';
import { NetworkTab } from '../inspectors/network/NetworkTab';
import { ConsoleTab } from '../inspectors/console/ConsoleTab';
import { WebSocketTab } from '../inspectors/websocket/WebSocketTab';
import { SocketIOTab } from '../inspectors/socketio/SocketIOTab';
import { NotificationsTab } from '../inspectors/notifications/NotificationsTab';
import { AsyncStorageTab } from '../inspectors/asyncStorage/AsyncStorageTab';
import { ElementTab } from '../inspectors/element/ElementTab';
import { MMKVTab } from '../inspectors/mmkv/MMKVTab';
import { ZustandTab } from '../inspectors/zustand/ZustandTab';
import { ReduxTab } from '../inspectors/redux/ReduxTab';
import { JotaiTab } from '../inspectors/jotai/JotaiTab';
import { FileSystemTab } from '../inspectors/fileSystem/FileSystemTab';
import { ViewHierarchyTab } from '../inspectors/viewHierarchy/ViewHierarchyTab';
import { layout } from '../shared/styles';
import { StyleSheet } from 'react-native';
import { useMemo } from 'react';

export function InspectorTabs({
  inspectors,
  detailNav,
}: {
  inspectors: Inspector[];
  detailNav: DetailNavController;
}): React.ReactNode {
  const { theme, strings } = useBesouroUI();

  // Where the selection lives depends on which session these tabs are showing.
  // The live drawer remembers it process-wide, so it survives the native surface
  // being torn down on close. A past-session overlay keeps its own: it is a
  // temporary view onto a different session, and tapping through it must not move
  // the tab the user left the live drawer on. Both are read unconditionally —
  // hooks can't be called behind a branch — and only one is used.
  const viewing = useViewingSession();
  const remembered = useActiveInspector();
  const [locallySelected, setLocallySelected] = useState<Inspector | null>(
    null
  );
  // Nothing selected yet means the tab the strip opened on — captured once, not
  // read off the front of the list on every render, because dragging some other
  // tab into first place is not a choice of tab.
  const opened = useRef(inspectors[0] ?? null);
  const selected = (viewing ? locallySelected : remembered) ?? opened.current;

  const select = useCallback(
    (inspector: Inspector): void => {
      if (viewing) {
        setLocallySelected(inspector);
      } else {
        setActiveInspector(inspector);
      }
    },
    [viewing]
  );

  // Fall back to the first inspector when the selected one is no longer
  // registered — which is what happens when a past session drops the
  // browser-class tabs (see `recordingInspectors`).
  const active =
    selected && inspectors.includes(selected)
      ? selected
      : (inspectors[0] ?? null);

  return (
    <>
      {/* The tab bar stays visible while a detail is open: the detail slides
          in as an overlay over the tab content only, so the tabs remain in
          place (and the app can switch tabs, which closes the detail). */}
      <InspectorTabBar
        inspectors={inspectors}
        active={active}
        onSelect={select}
        // Only the live drawer's strip can be reordered — see InspectorTabBar.
        reorderable={!viewing}
      />

      <detailNav.Provider value={detailNav.nav}>
        <View style={layout.fill}>
          {active ? (
            <ErrorBoundary theme={theme} strings={strings}>
              <TabContent inspector={active} />
            </ErrorBoundary>
          ) : (
            <EmptyState message={strings.noEvents} />
          )}
        </View>
      </detailNav.Provider>
    </>
  );
}

function TabContent({ inspector }: { inspector: Inspector }): React.ReactNode {
  const { theme, strings } = useBesouroUI();
  const viewing = useViewingSession();
  const status = useInspectorStatus(inspector);

  // Status describes *this* process, so it can only speak for the live session:
  // a past session's rows are already on disk and need no interceptor to be read,
  // and an inspector that failed to install today says nothing about the one that
  // recorded fine last week.
  if (viewing) {
    return <TabBody inspector={inspector} />;
  }

  if (status === 'not-installed') {
    return (
      <StatusMessage
        title={strings.statusNotInstalled}
        detail={strings.notInstalledHint}
        color={theme.textMuted}
      />
    );
  }
  if (status === 'degraded') {
    return (
      <StatusMessage
        title={strings.statusError}
        detail={strings.inspectorError}
        color={theme.danger}
      />
    );
  }

  return <TabBody inspector={inspector} />;
}

/** The inspector's own UI, with no status gate in front of it. */
function TabBody({ inspector }: { inspector: Inspector }): React.ReactNode {
  switch (inspector) {
    case 'network':
      return <NetworkTab />;
    case 'console':
      return <ConsoleTab />;
    case 'websocket':
      return <WebSocketTab />;
    case 'socketio':
      return <SocketIOTab />;
    case 'notifications':
      return <NotificationsTab />;
    case 'asyncStorage':
      return <AsyncStorageTab />;
    case 'mmkv':
      return <MMKVTab />;
    case 'element':
      return <ElementTab />;
    case 'zustand':
      return <ZustandTab />;
    case 'redux':
      return <ReduxTab />;
    case 'jotai':
      return <JotaiTab />;
    case 'viewHierarchy':
      return <ViewHierarchyTab />;
    case 'fileSystem':
      return <FileSystemTab />;
  }
}

function StatusMessage({
  title,
  detail,
  color,
}: {
  title: string;
  detail: string;
  color: string;
}): React.ReactNode {
  const s = useStyles();
  const { font } = useBesouroUI();
  return (
    <View style={styles.container}>
      <Text
        style={{
          color,
          fontSize: font(fontSize.lg),
          fontWeight: fontWeight.bold,
        }}
      >
        {title}
      </Text>
      <Text style={s.label}>{detail}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 8,
  },
});

/** Theme-derived styles for this module, memoized per theme/font. */
function useStyles() {
  const { theme, font } = useBesouroUI();
  return useMemo(
    () =>
      StyleSheet.create({
        label: {
          color: theme.textMuted,
          fontSize: font(fontSize.base),
          textAlign: 'center',
        },
      }),
    [theme, font]
  );
}
