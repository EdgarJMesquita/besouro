/**
 * Session history — lists previously persisted sessions and loads one into the
 * drawer for read-only inspection. Rendered as a full-drawer overlay from the
 * drawer header's history button (only present when persistence is active).
 *
 * The live (current) session is omitted: it's the only `open` session at runtime
 * — prior launches are reconciled to `crashed`/`closed` at startup — and it's
 * already what the drawer shows by default.
 *
 * Picking a session does not dismiss this list; the session overlay stacks over it and
 * closing it comes back here. The list is therefore loaded once per opening of
 * the history, not once per session viewed. Nothing can go stale in between:
 * the only mutation is `handleClearAll` below, which lives here (so it's
 * unreachable while covered) and already updates state optimistically.
 */

import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import type { SessionMeta } from '../core/types';
import type { SessionRepository } from '../core/database/types';
import { useBesouroUI, type ViewingSession } from '../shared/context';
import { BackButton } from '../shared/components/BackButton';
import { EmptyState } from '../shared/components/EmptyState';
import { Pill } from '../shared/components/Pill';
import { TextButton } from '../shared/components/TextButton';
import { Icon } from '../shared/components/Icon';
import { useTopInset } from '../shared/hooks/safe-area';
import { relativeAge } from '../shared/utils/date-format';
import {
  ageLabel,
  clockTime,
  sessionDuration,
  sessionEventCount,
} from './utils/session-labels';
import { space, radius, fontSize, fontWeight } from '../theme/tokens';
import { layout } from '../shared/styles';
import { useTextStyles } from '../shared/hooks/text-styles';
import { StyleSheet } from 'react-native';
import { useMemo } from 'react';

export function SessionListPanel({
  sessionRepository,
  onClose,
  onSelect,
}: {
  sessionRepository: SessionRepository;
  onClose: () => void;
  /** A session was chosen: its snapshot is loaded and handed up to open. */
  onSelect: (session: ViewingSession) => void;
}): React.ReactNode {
  const s = useStyles();
  const { theme, strings } = useBesouroUI();
  const topInset = useTopInset();
  const [sessions, setSessions] = useState<SessionMeta[] | null>(null);

  useEffect(() => {
    let active = true;
    void sessionRepository.list().then((all) => {
      if (active) {
        // Drop the live session (the only `open` one); it's the default view.
        setSessions(all.filter((session) => session.status !== 'open'));
      }
    });
    return () => {
      active = false;
    };
  }, [sessionRepository]);

  // Opening a session loads nothing: the drawer identifies it by id and its tabs
  // page rows straight out of the database, so this is instant regardless of how
  // much the session captured.
  const handleSelect = (meta: SessionMeta): void => {
    onSelect({ meta });
  };

  const handleClearAll = (): void => {
    const ids = (sessions ?? []).map((session) => session.id);
    // Optimistic: empty the list now; the live session isn't in it, so nothing
    // that's currently shown is at risk. One atomic bulk delete (not N racing
    // single deletes) so the on-disk index is rewritten exactly once.
    setSessions([]);
    void sessionRepository.deleteMany(ids).catch(() => {
      // Best-effort; a failed clear just leaves those files on disk.
    });
  };

  const hasSessions = sessions != null && sessions.length > 0;

  return (
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
          borderBottomWidth: 1,
          borderBottomColor: theme.border,
        }}
      >
        <BackButton onPress={onClose} />
        <Text style={s.label}>{strings.sessionHistory}</Text>
        <View style={layout.fill} />
        {hasSessions ? (
          <TextButton label={strings.clear} plain onPress={handleClearAll} />
        ) : null}
      </View>

      {sessions && sessions.length === 0 ? (
        <EmptyState message={strings.noSessions} />
      ) : (
        <ScrollView contentContainerStyle={{ padding: space.gutter }}>
          {sessions?.map((session) => (
            <SessionRow
              key={session.id}
              session={session}
              onPress={() => handleSelect(session)}
            />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

function SessionRow({
  session,
  onPress,
}: {
  session: SessionMeta;
  onPress: () => void;
}): React.ReactNode {
  const s = useStyles();
  const text = useTextStyles();
  const { theme, strings, language } = useBesouroUI();
  const crashed = session.status === 'crashed';

  // "2h ago" / "Yesterday" / "Jul 28" — the closest thing a session has to a
  // name, and the one field worth scanning down the list.
  const label = ageLabel(relativeAge(session.startedAt), strings, language);
  // Clock time keeps an older session identifiable once its label is only a
  // date; duration and size are omitted when unknown rather than shown as zero.
  const details = [
    clockTime(session.startedAt),
    sessionDuration(session),
    sessionEventCount(session, strings),
  ].filter((part): part is string => part != null);

  return (
    <Pressable onPress={onPress} style={s.row}>
      <View style={styles.block}>
        <Text style={text.title}>{label}</Text>
        <Text style={text.caption}>{details.join(' · ')}</Text>
      </View>
      {crashed ? <Pill label={strings.crashed} color={theme.danger} /> : null}
      {/* Affordance only — the whole row is the target, so it's faint and not
          separately focusable. */}
      <Icon name="chevron-right" size={16} color={theme.textFaint} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  block: {
    flex: 1,
    gap: space.xs,
  },
});

/** Theme-derived styles for this module, memoized per theme/font. */
function useStyles() {
  const { theme, font } = useBesouroUI();
  return useMemo(
    () =>
      StyleSheet.create({
        row: {
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: space.md,
          paddingVertical: space.xl,
          paddingHorizontal: space.gutter,
          marginBottom: space.md,
          backgroundColor: theme.surfaceRaised,
          borderWidth: 1,
          borderColor: theme.border,
          borderRadius: radius.lg,
        },
        label: {
          color: theme.text,
          fontSize: font(fontSize.xl),
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
