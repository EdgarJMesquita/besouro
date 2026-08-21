/**
 * Settings section — change the theme (System / Light / Dark) and the drawer text
 * size at runtime. Rendered as a full overlay from the drawer's gear button.
 */

import { Pressable, Text, View } from 'react-native';
import type { LocalePreference, ThemePreference } from '../core/types';
import { useBesouroUI } from '../shared/context';
import { getTheme } from '../theme/theme';
import { withAlpha } from '../shared/utils/with-alpha';
import { BackButton } from '../shared/components/BackButton';
import { SectionHeader } from '../shared/components/SectionHeader';
import { TextButton } from '../shared/components/TextButton';
import { useTopInset } from '../shared/hooks/safe-area';
import {
  ACCENT_PRESETS,
  FONT_SCALES,
  useSettings,
} from '../core/settings-store';
import { resetTabOrder } from '../core/tab-order';
import { StyleSheet } from 'react-native';
import { useMemo } from 'react';

export function SettingsPanel({
  onClose,
}: {
  onClose: () => void;
}): React.ReactNode {
  const s = useStyles();
  const {
    theme,
    strings,
    themePreference,
    fontScale,
    localePreference,
    setThemePreference,
    setAccent,
    setFontScale,
    setLocale,
  } = useBesouroUI();
  const topInset = useTopInset();
  // Read straight from the store: both are stored preferences, not something the
  // UI context has to resolve against the configured options. The accent
  // especially — the *effective* accent falls back to the configured one, which
  // matches no swatch, so the row would show nothing as selected.
  const { tabOrder, accent: storedAccent } = useSettings();

  const themeOptions: ReadonlyArray<{
    label: string;
    value: ThemePreference;
  }> = [
    { label: strings.system, value: 'system' },
    { label: strings.light, value: 'light' },
    { label: strings.dark, value: 'dark' },
  ];

  const languageOptions: ReadonlyArray<{
    label: string;
    value: LocalePreference;
  }> = [
    { label: strings.system, value: 'system' },
    { label: strings.english, value: 'en' },
    { label: strings.portuguese, value: 'pt' },
    { label: strings.spanish, value: 'es' },
  ];

  return (
    <View style={s.surface}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          paddingTop: topInset + 16,
          paddingBottom: 10,
          paddingHorizontal: 12,
          backgroundColor: theme.surface,
          borderBottomWidth: 1,
          borderBottomColor: theme.border,
        }}
      >
        <BackButton onPress={onClose} />
        <Text style={s.label2}>{strings.settings}</Text>
      </View>

      <View style={styles.container}>
        <SectionHeader title={strings.theme} />
        <OptionRow
          options={themeOptions}
          selected={themePreference}
          onSelect={setThemePreference}
        />

        <SectionHeader title={strings.accent} />
        <AccentRow selected={storedAccent} onSelect={setAccent} />

        <SectionHeader title={strings.textSize} />
        <OptionRow
          options={FONT_SCALES}
          selected={fontScale}
          onSelect={setFontScale}
        />

        <Text style={s.label}>
          {`The quick brown fox — ${Math.round(fontScale * 100)}%`}
        </Text>

        <SectionHeader title={strings.language} />
        <OptionRow
          options={languageOptions}
          selected={localePreference}
          onSelect={setLocale}
        />

        {/* The drag itself is invisible — nothing on the strip advertises it — so
            this is where the gesture is spelled out, next to the only way back to
            the default order. */}
        <SectionHeader title={strings.tabOrder} />
        <Text style={s.label}>{strings.tabOrderHint}</Text>
        {tabOrder ? (
          <View style={styles.row}>
            <TextButton label={strings.resetOrder} onPress={resetTabOrder} />
          </View>
        ) : null}
      </View>
    </View>
  );
}

/**
 * The built-in accent as a fixed color, pinned to one theme rather than tracking
 * the current one. Used only when an accent is configured and the built-in swatch
 * therefore has to store a concrete hex (`null` is taken by the app's own accent).
 * A swatch that stores a fixed color while showing a theme-dependent one would
 * fall out of sync the moment the theme changed — showing dark blue while light
 * blue is in use, and reading as unselected. Static like the presets, which have
 * never followed the theme either.
 */
const BUILT_IN_ACCENT = getTheme('light').accent;

/** A row of tappable color swatches; the active one gets a contrasting ring. */
function AccentRow({
  selected,
  onSelect,
}: {
  selected: string | null;
  onSelect: (accent: string | null) => void;
}): React.ReactNode {
  const { theme, configuredAccent } = useBesouroUI();
  // Read from the base theme rather than `theme.accent`, which may already carry
  // an override.
  const builtInAccent = getTheme(theme.name).accent;

  // Every swatch stores the value that actually produces the color it shows.
  // `null` means "no override", which resolves to the configured accent — so it
  // belongs to the app's own swatch, and the built-in one has to name its hex
  // outright. With nothing configured there is no first swatch and `null` goes
  // back to the built-in, which is what it resolves to then anyway.
  const swatches = useMemo<
    ReadonlyArray<{ label: string; value: string | null; color: string }>
  >(() => {
    const [builtIn, ...presets] = ACCENT_PRESETS;
    return [
      ...(configuredAccent
        ? [{ label: 'App', value: null, color: configuredAccent }]
        : []),
      {
        label: builtIn?.label ?? 'Default',
        value: configuredAccent ? BUILT_IN_ACCENT : null,
        color: configuredAccent ? BUILT_IN_ACCENT : builtInAccent,
      },
      ...presets.map((preset) => ({
        label: preset.label,
        value: preset.value,
        color: preset.value ?? builtInAccent,
      })),
    ];
  }, [configuredAccent, builtInAccent]);

  return (
    <View style={styles.row2}>
      {swatches.map((option) => {
        const active = option.value === selected;
        const color = option.color;
        return (
          <Pressable
            key={option.label}
            onPress={() => onSelect(option.value)}
            accessibilityRole="button"
            accessibilityLabel={option.label}
            style={{
              width: 34,
              height: 34,
              borderRadius: 17,
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: active ? 2 : 1,
              borderColor: active ? theme.text : theme.border,
            }}
          >
            <View
              style={{
                width: 22,
                height: 22,
                borderRadius: 11,
                backgroundColor: color,
              }}
            />
          </Pressable>
        );
      })}
    </View>
  );
}

function OptionRow<Value extends string | number>({
  options,
  selected,
  onSelect,
}: {
  options: ReadonlyArray<{ label: string; value: Value }>;
  selected: Value;
  onSelect: (value: Value) => void;
}): React.ReactNode {
  const { theme, font } = useBesouroUI();
  return (
    <View style={styles.row}>
      {options.map((option) => {
        const active = option.value === selected;
        return (
          <Pressable
            key={String(option.value)}
            onPress={() => onSelect(option.value)}
            accessibilityRole="button"
            style={{
              paddingVertical: 8,
              paddingHorizontal: 16,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: active ? theme.accent : theme.border,
              backgroundColor: active
                ? withAlpha(theme.accent, 0.16)
                : theme.surfaceRaised,
            }}
          >
            <Text
              style={{
                color: active ? theme.accent : theme.text,
                fontSize: font(13),
                fontWeight: active ? '700' : '500',
              }}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  row2: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  container: {
    padding: 16,
    gap: 10,
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
          fontSize: font(13),
          marginTop: 8,
        },
        label2: {
          color: theme.text,
          fontSize: font(16),
          fontWeight: '700',
        },
        surface: {
          flex: 1,
          backgroundColor: theme.background,
        },
      }),
    [theme, font]
  );
}
