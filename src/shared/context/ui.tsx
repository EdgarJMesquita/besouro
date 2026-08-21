/**
 * UI context — resolves theme (from runtime settings, falling back to the
 * configured/system theme), the string table, and a font scaler, exposing them to
 * every drawer component via a single hook.
 */

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type {
  BesouroOptions,
  LocalePreference,
  ThemePreference,
} from '../../core/types';
import { useResolvedTheme, type Theme } from '../../theme/theme';
import {
  resolveLanguage,
  resolveStrings,
  type LanguageCode,
  type StringTable,
} from '../../i18n';
import { useSettings, updateSettings } from '../../core/settings-store';

interface BesouroUI {
  theme: Theme;
  strings: StringTable;
  /** Scale a base font size by the active text-size setting. */
  font: (size: number) => number;
  /** Effective theme preference (override or configured/system). */
  themePreference: ThemePreference;
  /** Effective accent override (`#rrggbb`), or `null` for the theme default. */
  accent: string | null;
  /**
   * The accent the host configured, before any user override — what "no override"
   * actually resolves to. `null` when none was configured, leaving the theme's
   * built-in accent. Settings needs this to show what its first swatch gives.
   */
  configuredAccent: string | null;
  fontScale: number;
  /** Effective locale preference (override or configured/system). */
  localePreference: LocalePreference;
  /** The preference resolved to a concrete language, for `Intl` formatting. */
  language: LanguageCode;
  setThemePreference: (preference: ThemePreference) => void;
  setAccent: (accent: string | null) => void;
  setFontScale: (scale: number) => void;
  setLocale: (locale: LocalePreference) => void;
}

const BesouroUIContext = createContext<BesouroUI | null>(null);

export function BesouroUIProvider({
  options,
  children,
}: {
  options: BesouroOptions;
  children: ReactNode;
}): ReactNode {
  const settings = useSettings();
  const themePreference = settings.theme ?? options.theme ?? 'system';
  const baseTheme = useResolvedTheme(themePreference);
  const accent = settings.accent ?? options.accent ?? null;
  const fontScale = settings.fontScale;
  const localePreference = settings.locale ?? options.locale ?? 'system';

  // Apply the accent override on top of the resolved theme (null keeps the
  // theme's built-in accent).
  const theme = useMemo<Theme>(
    () => (accent ? { ...baseTheme, accent } : baseTheme),
    [baseTheme, accent]
  );

  const strings = useMemo(
    () => resolveStrings(localePreference),
    [localePreference]
  );
  const language = useMemo(
    () => resolveLanguage(localePreference),
    [localePreference]
  );

  const value = useMemo<BesouroUI>(
    () => ({
      theme,
      strings,
      fontScale,
      themePreference,
      accent,
      configuredAccent: options.accent ?? null,
      localePreference,
      language,
      font: (size: number) => Math.round(size * fontScale),
      setThemePreference: (preference) => updateSettings({ theme: preference }),
      setAccent: (next) => updateSettings({ accent: next }),
      setFontScale: (scale) => updateSettings({ fontScale: scale }),
      setLocale: (locale) => updateSettings({ locale }),
    }),
    [
      theme,
      strings,
      fontScale,
      themePreference,
      accent,
      options.accent,
      localePreference,
      language,
    ]
  );

  return (
    <BesouroUIContext.Provider value={value}>
      {children}
    </BesouroUIContext.Provider>
  );
}

export function useBesouroUI(): BesouroUI {
  const value = useContext(BesouroUIContext);
  if (!value) {
    throw new Error('useBesouroUI must be used within a BesouroUIProvider');
  }
  return value;
}
