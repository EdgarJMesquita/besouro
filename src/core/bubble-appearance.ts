/**
 * Keeps the native floating bubble's colors in sync with the drawer theme/accent.
 *
 * The bubble is drawn natively and lives outside the React tree, so it can't read
 * the UI context. Instead we resolve its two colors — circle fill + bug-icon tint —
 * from the same inputs the drawer uses (persisted settings → configured options →
 * system appearance) and push them across the native bridge whenever any of those
 * change. Runs regardless of whether the drawer is currently open.
 *
 * Covers every change *after* the bubble exists — its first paint is native's,
 * see `resolveBubbleColorPairs`.
 */

import { Appearance } from 'react-native';
import type { BesouroOptions } from './types';
import { getSettings, subscribeSettings } from './settings-store';
import { getTheme } from '../theme/theme';
import NativeBesouro from '../native/NativeBesouro';

interface BubbleColors {
  /** Circle fill (`#rrggbb`). */
  background: string;
  /** Bug-icon tint (`#rrggbb`). */
  icon: string;
}

/**
 * The bubble's colors under one named theme, with the accent override applied.
 * The bubble sits on the app's own screens, so its fill uses the theme `surface`
 * color; the accent falls back options → the theme's built-in accent.
 */
function colorsForTheme(
  name: 'light' | 'dark',
  options: BesouroOptions,
  accentOverride: string | null
): BubbleColors {
  const theme = getTheme(name);
  const accent = accentOverride ?? options.accent ?? theme.accent;
  return { background: theme.surface, icon: accent };
}

/**
 * Both theme resolutions, for the native mount to choose between (see
 * `mountBubble` in the spec). Takes only the configured options — no persisted
 * settings — because it runs before hydration: native applies the stored theme
 * and accent itself, and these are what it falls back to when nothing is stored.
 */
export function resolveBubbleColorPairs(
  options: BesouroOptions
): Record<'light' | 'dark', BubbleColors> {
  return {
    light: colorsForTheme('light', options, null),
    dark: colorsForTheme('dark', options, null),
  };
}

/**
 * Resolve the bubble's colors for the live push, mirroring the drawer's theme
 * resolution: the theme preference falls back settings → options → `'system'`,
 * and `'system'` reads the current appearance.
 */
function resolveColors(options: BesouroOptions): BubbleColors {
  const settings = getSettings();
  const preference = settings.theme ?? options.theme ?? 'system';
  const name =
    preference === 'system'
      ? Appearance.getColorScheme() === 'dark'
        ? 'dark'
        : 'light'
      : preference;
  return colorsForTheme(name, options, settings.accent);
}

/**
 * Re-push the bubble's colors whenever the user's settings or the system
 * appearance change. Returns a teardown fn that stops the syncing. No-ops (but
 * still returns a teardown) when the native module is unavailable.
 *
 * Deliberately does not push on start. That would run in the same tick as the
 * mount, before the persisted settings are read, and overwrite the colors native
 * just resolved from the settings file with a guess made from the configured
 * options — leaving the bubble mid-animation in the wrong theme until hydration
 * lands. Hydration notifies subscribers, so the first push happens with real
 * values.
 */
export function startBubbleAppearanceSync(options: BesouroOptions): () => void {
  // Capture as a non-null const so the guard narrows into the `push` closure.
  const native = NativeBesouro;
  if (!native) return () => {};

  const push = (): void => {
    const { background, icon } = resolveColors(options);
    native.setBubbleAppearance(background, icon);
  };

  const unsubscribeSettings = subscribeSettings(push);
  const appearanceSub = Appearance.addChangeListener(push);

  return () => {
    unsubscribeSettings();
    appearanceSub.remove();
  };
}
