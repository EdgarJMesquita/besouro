/**
 * The choices the user makes in the drawer's Settings section, and only those:
 * theme, accent, font scale, locale and tab order. Kept as a tiny observable
 * store so the UI provider re-resolves theme and text size live, and persisted to
 * the app's internal storage so they survive reloads and relaunches.
 *
 * Deliberately *not* a home for state the UI remembers on its own — where the
 * floating panel was dragged, whether the drawer was left minimized, an
 * inspector's view mode. Those are view state nobody chose, and they live in
 * `persisted-state.ts`. Two reasons to keep the line sharp: this file is the
 * one the native bubble reads (see the note on {@link BesouroSettings.theme}), so
 * its shape is a contract; and every field here is written only when someone
 * opens Settings, which keeps a drag gesture from rewriting the file the bubble
 * depends on twenty times a second.
 */

import { useSyncExternalStore } from 'react';
import type { Inspector, LocalePreference, ThemePreference } from './types';
import { readJsonFile, writeJsonFile } from './json-file';

export interface BesouroSettings {
  /**
   * User theme override; `null` falls back to the configured/system theme.
   *
   * NATIVE CONTRACT: read by name out of the persisted file at bubble mount
   * (`BubbleController.seedColorsFromDisk` / `-seedColorsFromDiskWith…`), which
   * needs the colors before JS has finished reading this file. Renaming the key
   * or changing its values leaves the bubble on the wrong theme for its entrance
   * animation, silently. Same for `accent` below.
   */
  theme: ThemePreference | null;
  /**
   * User accent-color override (`#rrggbb`); `null` falls back to the configured
   * accent, or the theme's built-in accent when none is configured. Also read
   * natively at mount — see the note on `theme`.
   */
  accent: string | null;
  /** Text scale multiplier applied to drawer font sizes. */
  fontScale: number;
  /** User language override; `null` falls back to the configured/system locale. */
  locale: LocalePreference | null;
  /**
   * Drawer tab order, set by dragging a tab; `null` means the library default
   * (`INSPECTOR_ORDER`). Stored as written — it is `core/tab-order.ts` that
   * reconciles it with the inspectors actually running, so a stale entry here is
   * harmless.
   */
  tabOrder: Inspector[] | null;
}

const DEFAULTS: BesouroSettings = {
  theme: null,
  accent: null,
  fontScale: 1,
  locale: null,
  tabOrder: null,
};

const SETTINGS_FILE = 'besouro_settings.json';

let settings: BesouroSettings = DEFAULTS;
const listeners = new Set<() => void>();

export function getSettings(): BesouroSettings {
  return settings;
}

export function updateSettings(patch: Partial<BesouroSettings>): void {
  settings = { ...settings, ...patch };
  for (const listener of listeners) {
    listener();
  }
  void persist();
}

/** Subscribe to settings changes. Returns an unsubscribe fn. */
export function subscribeSettings(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useSettings(): BesouroSettings {
  return useSyncExternalStore(subscribeSettings, getSettings);
}

// ── Persistence ──────────────────────────────────────────────────────────────

/**
 * Load persisted settings and merge them over the defaults, field by field so a
 * hand-edited or half-written file can never widen the in-memory shape. Notifies
 * subscribers so a live UI (and the native bubble) re-resolves.
 */
export async function hydrateSettings(): Promise<void> {
  const parsed = await readJsonFile<Partial<BesouroSettings>>(SETTINGS_FILE);
  if (!parsed) return;
  settings = {
    theme: parsed.theme ?? DEFAULTS.theme,
    accent: parsed.accent ?? DEFAULTS.accent,
    fontScale:
      typeof parsed.fontScale === 'number'
        ? parsed.fontScale
        : DEFAULTS.fontScale,
    locale: parsed.locale ?? DEFAULTS.locale,
    tabOrder: Array.isArray(parsed.tabOrder)
      ? parsed.tabOrder
      : DEFAULTS.tabOrder,
  };
  for (const listener of listeners) {
    listener();
  }
}

async function persist(): Promise<void> {
  await writeJsonFile(SETTINGS_FILE, settings);
}

/** Available text-size presets. */
export const FONT_SCALES = [
  { label: 'S', value: 0.9 },
  { label: 'M', value: 1 },
  { label: 'L', value: 1.15 },
  { label: 'XL', value: 1.3 },
] as const;

/**
 * Accent-color presets offered in Settings. `null` restores the theme's built-in
 * accent; the rest are single hexes tuned to read on both light and dark
 * backgrounds. Greens/reds are intentionally omitted so the accent never clashes
 * with the status colors (success/danger).
 */
export const ACCENT_PRESETS: ReadonlyArray<{
  label: string;
  value: string | null;
}> = [
  { label: 'Default', value: null },
  { label: 'Indigo', value: '#6366f1' },
  { label: 'Violet', value: '#8b5cf6' },
  { label: 'Sky', value: '#0ea5e9' },
  { label: 'Teal', value: '#14b8a6' },
  { label: 'Pink', value: '#ec4899' },
  { label: 'Amber', value: '#f59e0b' },
];
