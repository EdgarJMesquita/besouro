/**
 * One console entry: level badge, single-line message preview, and timestamp.
 */

import { memo, useState } from 'react';
import { Text, View } from 'react-native';

import type { ConsoleEvent, ConsoleLevel } from '../../../core/types';
import { useBesouroUI } from '../../../shared/context';
import type { Theme } from '../../../theme/theme';
import { CopyButton } from '../../../shared/components/CopyButton';

import { MonoText } from '../../../shared/components/MonoText';
import { Pill } from '../../../shared/components/Pill';
import { space, fontSize, fontWeight } from '../../../theme/tokens';

import { formatTime } from '../../../shared/utils/date-format';
import { layout } from '../../../shared/styles';
import { StyleSheet } from 'react-native';
import { useMemo } from 'react';

const CONSOLE_CHAR_CAP = 300;

export const ConsoleRow = memo(function ConsoleRow({
  event,
}: {
  event: ConsoleEvent;
}): React.ReactNode {
  const s = useStyles();
  const { theme, strings } = useBesouroUI();
  const [expanded, setExpanded] = useState(false);

  const message = oneLine(event.message);
  const isLong = message.length > CONSOLE_CHAR_CAP;
  const shown =
    !isLong || expanded ? message : `${message.slice(0, CONSOLE_CHAR_CAP)}…`;
  const copyValue = event.stack
    ? `${event.message}\n\n${event.stack}`
    : event.message;

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={layout.rowGapSm}>
        <LevelPill level={event.level} />
        {event.fatal ? (
          <Pill label={strings.fatal} color={theme.danger} filled />
        ) : null}
        {/* The row has no detail view, so "show more" reveals the stored message
            and nothing beyond it — this is what says the stored message is itself
            already cut. */}
        {event.messageTruncated ? (
          <Pill label={strings.payloadTooLarge} color={theme.warning} />
        ) : null}
        <Text style={s.label2}>{formatTime(event.timestamp)}</Text>
        <CopyButton value={copyValue} />
      </View>
      {/* Body */}
      <View style={styles.block}>
        <MonoText
          color={colorForLevel(theme, event.level)}
          size={fontSize.body}
        >
          {shown}
        </MonoText>
        {isLong ? (
          <Text onPress={() => setExpanded((v) => !v)} style={s.label}>
            {expanded ? strings.showLess : strings.showMore}
          </Text>
        ) : null}
      </View>
    </View>
  );
});

function LevelPill({ level }: { level: ConsoleLevel }): React.ReactNode {
  const { theme } = useBesouroUI();
  return (
    // UNCAUGHT and CRASH stay tinted like ERROR — the label carries the
    // distinction. The solid fill is reserved for the FATAL badge that sits
    // beside UNCAUGHT, so visual weight tracks severity rather than provenance.
    // CRASH never carries that badge: the level already means fatal.
    <Pill label={level.toUpperCase()} color={colorForLevel(theme, level)} />
  );
}

function colorForLevel(theme: Theme, level: ConsoleLevel): string {
  switch (level) {
    case 'crash':
    case 'uncaught':
    case 'error':
      return theme.danger;
    case 'warn':
      return theme.warning;
    default:
      // LOG / INFO / DEBUG are not outcomes — keep them neutral so only WARN and
      // ERROR earn a color.
      return theme.textMuted;
  }
}

function oneLine(message: string): string {
  return message.replace(/\s+/g, ' ').trim();
}

const styles = StyleSheet.create({
  block: {
    gap: space.tight,
  },
  container: {
    paddingVertical: space.xl,
    paddingHorizontal: space.lg,
    gap: space.xs,
  },
});

/** Theme-derived styles for this module, memoized per theme/font. */
function useStyles() {
  const { theme, font } = useBesouroUI();
  return useMemo(
    () =>
      StyleSheet.create({
        label: {
          color: theme.accent,
          fontSize: font(fontSize.caption),
          fontWeight: fontWeight.semibold,
        },
        label2: {
          color: theme.textMuted,
          fontSize: font(fontSize.caption),
          flex: 1,
        },
      }),
    [theme, font]
  );
}
