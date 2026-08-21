/**
 * A stacked panel that shows a single past session read-only. Same tab UI as the
 * live drawer ({@link InspectorTabs}), but its tabs read from the loaded snapshot via
 * {@link ViewingSessionProvider}, and its header identifies the session (when it
 * started, how long it ran, how much it captured, plus a crashed badge) instead
 * of offering settings — the same wording the history list used to get here, so
 * the row you tapped and the header you land on match.
 *
 * Shares the hosting drawer's detail-nav stack rather than owning one: details
 * opened here mount after this drawer registered itself, so the stack's LIFO
 * order already closes them first. An independent stack would be invisible to
 * the drawer's back handling, and back would close this whole overlay instead of
 * the detail on top of it.
 */

import { Text, View } from 'react-native';
import { recordingInspectors, type Inspector } from '../core/types';
import { sessionTabs } from '../core/session-tabs';
import { useTabOrder } from '../core/tab-order';
import {
  useBesouroUI,
  ViewingSessionProvider,
  type ViewingSession,
} from '../shared/context';
import { InspectorTabs } from './InspectorTabs';
import { BackButton } from '../shared/components/BackButton';
import { Pill } from '../shared/components/Pill';
import { useTopInset } from '../shared/hooks/safe-area';
import type { DetailNavController } from '../shared/detail-nav';
import {
  sessionDuration,
  sessionEventCount,
  sessionStartLabel,
} from './utils/session-labels';
import { space, fontSize, fontWeight } from '../theme/tokens';
import { layout } from '../shared/styles';
import { useTextStyles } from '../shared/hooks/text-styles';
import { StyleSheet } from 'react-native';
import { useMemo } from 'react';

export function SessionPanel({
  session,
  inspectors,
  detailNav,
  onClose,
}: {
  session: ViewingSession;
  inspectors: Inspector[];
  detailNav: DetailNavController;
  onClose: () => void;
}): React.ReactNode {
  const s = useStyles();
  const text = useTextStyles();
  const { theme, strings, language } = useBesouroUI();
  const topInset = useTopInset();
  const crashed = session.meta.status === 'crashed';
  // Which tabs this session gets: everything enabled now, plus everything it was
  // recording with — otherwise switching an inspector off would hide rows this
  // session already captured (and still counts in the subtitle below). Ordered
  // by the user's preference like the live strip, then stripped of the File
  // System and element inspectors, which browse live state and so have nothing
  // to say about a past session — see BROWSER_INSPECTORS.
  const recorded = session.meta.inspectors;
  const covered = useMemo(
    () => sessionTabs(inspectors, recorded),
    [inspectors, recorded]
  );
  const ordered = useTabOrder(covered);
  const replayable = useMemo(() => recordingInspectors(ordered), [ordered]);
  // The id was here before and told no one anything; when it ran, for how long,
  // and how much it captured is what identifies a session to a person. Duration
  // and count are dropped when unknown rather than shown as zero.
  const subtitle = [
    sessionStartLabel(session.meta, language),
    sessionDuration(session.meta),
    sessionEventCount(session.meta, strings),
  ]
    .filter((part): part is string => part != null)
    .join(' · ');

  return (
    <ViewingSessionProvider session={session}>
      <View style={s.surface}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: space.md,
            paddingTop: topInset + 16,
            paddingBottom: space.lg,
            paddingHorizontal: space.xl,
            backgroundColor: theme.surface,
          }}
        >
          <BackButton onPress={onClose} />
          <View style={styles.block}>
            <View style={layout.rowGapMd}>
              <Text style={s.label}>{strings.session}</Text>
              {crashed ? (
                <Pill label={strings.crashed} color={theme.danger} />
              ) : null}
            </View>
            <Text style={text.caption}>{subtitle}</Text>
          </View>
        </View>

        <InspectorTabs inspectors={replayable} detailNav={detailNav} />
      </View>
    </ViewingSessionProvider>
  );
}

const styles = StyleSheet.create({
  block: {
    flex: 1,
    gap: space.tight,
  },
});

/** Theme-derived styles for this module, memoized per theme/font. */
function useStyles() {
  const { theme, font } = useBesouroUI();
  return useMemo(
    () =>
      StyleSheet.create({
        label: {
          color: theme.text,
          fontSize: font(fontSize.lg),
          fontWeight: fontWeight.bold,
        },
        surface: {
          flex: 1,
          backgroundColor: theme.background,
        },
      }),
    [theme, font]
  );
}
