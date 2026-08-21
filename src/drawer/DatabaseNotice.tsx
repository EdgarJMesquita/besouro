/**
 * What the drawer shows instead of tabs when the database can't be used.
 *
 * The database is not optional (see `core/database/status`), so a failure here
 * means there is genuinely nothing to inspect. Empty tabs would read as "the app
 * did nothing" — the one wrong conclusion — so the drawer states the failure and
 * what to do about it.
 *
 * The steps are per-state and deliberately concrete: every one of these failures
 * is fixed by changing the build or the device, never by anything in the drawer, so
 * there is no retry button to offer.
 */

import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { DatabaseStatus } from '../core/database/status';
import { useBesouroUI } from '../shared/context';
import { MonoText } from '../shared/components/MonoText';
import { Icon } from '../shared/components/Icon';
import { fontSize, radius, space } from '../theme/tokens';
import type { StringTable } from '../i18n';

/**
 * Fix-it steps per failure. English only and not in the {@link StringTable}: they
 * name commands and file paths (`pod install`, `npx expo run:ios`) that are the
 * same in every locale, and a half-translated shell command is worse than an
 * untranslated one.
 */
const STEPS: Record<'unavailable' | 'unopened' | 'write-failed', string[]> = {
  'unavailable': [
    'Expo Go cannot load native modules — build a dev client: npx expo run:ios / run:android',
    'Bare React Native on iOS: cd ios && pod install, then rebuild',
    'Rebuild after installing the package — a JS-only reload does not link native code',
  ],
  'unopened': [
    'Check free space on the device — the database cannot grow on a full disk',
    'Reinstall the app to discard a corrupt database file',
    'Confirm the app has permission to write to its own sandbox',
  ],
  'write-failed': [
    'Free up space on the device, then restart the app to resume recording',
    'If it keeps happening, reinstall to discard a damaged database file',
  ],
};

function copyFor(
  status: DatabaseStatus,
  strings: StringTable
): { title: string; body: string } | null {
  switch (status.state) {
    case 'unavailable':
      return {
        title: strings.databaseUnavailableTitle,
        body: strings.databaseUnavailableBody,
      };
    case 'unopened':
      return {
        title: strings.databaseUnopenedTitle,
        body: strings.databaseUnopenedBody,
      };
    case 'write-failed':
      return {
        title: strings.databaseWriteFailedTitle,
        body: strings.databaseWriteFailedBody,
      };
    default:
      return null;
  }
}

export function DatabaseNotice({
  status,
  /** Inline above a still-usable list, rather than filling the drawer. */
  compact = false,
  onDismiss,
}: {
  status: DatabaseStatus;
  compact?: boolean;
  /**
   * Dismiss the notice — passed only for the compact banner, where the tabs
   * underneath still work. A notice that fills the drawer has nothing behind it, so
   * it is deliberately not dismissible.
   */
  onDismiss?: () => void;
}): React.ReactNode {
  const { strings, theme } = useBesouroUI();
  const s = useStyles();
  const copy = copyFor(status, strings);

  if (!copy) {
    return null;
  }

  const steps = STEPS[status.state as keyof typeof STEPS];

  if (compact) {
    return (
      <View style={[s.card, s.compact]}>
        <View style={s.header}>
          <Text style={s.title}>{copy.title}</Text>
          {onDismiss ? (
            <Pressable
              onPress={onDismiss}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={strings.close}
            >
              <Icon name="close" size={16} color={theme.textMuted} />
            </Pressable>
          ) : null}
        </View>
        <Text style={s.body}>{copy.body}</Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={s.page}>
      <View style={s.card}>
        <View style={s.header}>
          <Text style={s.title}>{copy.title}</Text>
          {onDismiss ? (
            <Pressable
              onPress={onDismiss}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={strings.close}
            >
              <Icon name="close" size={16} color={theme.textMuted} />
            </Pressable>
          ) : null}
        </View>
        <Text style={s.body}>{copy.body}</Text>

        <Text style={s.sectionLabel}>{strings.troubleshooting}</Text>
        {steps.map((step) => (
          <View key={step} style={s.step}>
            <Text style={s.bullet}>•</Text>
            <Text style={s.stepText}>{step}</Text>
          </View>
        ))}

        {/* The underlying error, when there is one. Monospaced: it is a machine
            message to be copied into a search or an issue, not prose. */}
        {status.state === 'unopened' && status.detail ? (
          <MonoText size={fontSize.caption} style={s.detail}>
            {status.detail}
          </MonoText>
        ) : null}
      </View>
    </ScrollView>
  );
}

/** Theme-derived styles for this module, memoized per theme/font. */
function useStyles() {
  const { theme } = useBesouroUI();
  return useMemo(
    () =>
      StyleSheet.create({
        page: {
          padding: space.xl,
          justifyContent: 'center',
          flexGrow: 1,
        },
        card: {
          backgroundColor: theme.surface,
          borderRadius: radius.md,
          borderWidth: StyleSheet.hairlineWidth,
          borderColor: theme.border,
          padding: space.xl,
          gap: space.md,
        },
        compact: {
          margin: space.md,
          padding: space.lg,
        },
        header: {
          flexDirection: 'row',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: space.md,
        },
        title: {
          flex: 1,
          color: theme.text,
          fontSize: fontSize.lg,
          fontWeight: '600',
        },
        body: {
          color: theme.textMuted,
          fontSize: fontSize.base,
          lineHeight: fontSize.base * 1.45,
        },
        sectionLabel: {
          color: theme.text,
          fontSize: fontSize.caption,
          fontWeight: '600',
          marginTop: space.md,
        },
        step: {
          flexDirection: 'row',
          gap: space.sm,
        },
        bullet: {
          color: theme.textMuted,
          fontSize: fontSize.base,
        },
        stepText: {
          color: theme.textMuted,
          fontSize: fontSize.base,
          lineHeight: fontSize.base * 1.45,
          flex: 1,
        },
        detail: {
          color: theme.textMuted,
          fontSize: fontSize.caption,
          marginTop: space.md,
        },
      }),
    [theme]
  );
}
