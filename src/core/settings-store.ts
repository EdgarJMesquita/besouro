/**
 * Runtime UI settings the user can change from the drawer's Settings section:
 * a theme override (falling back to the configured/system theme), an accent
 * override, and a font scale. Kept as a tiny observable store so the UI provider
 * re-resolves theme and text size live, and persisted to the app's internal
 * storage (via the native module) so choices survive reloads and relaunches.
 */

import { useSyncExternalStore } from 'react';
import type { Inspector, LocalePreference, ThemePreference } from './types';
import {
  isStoredFrame,
  type StoredFrame,
} from '../drawer/mini-window-geometry';
import NativeBesouro from '../native/NativeBesouro';

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
  /**
   * Where the minimized panel was left, position stored as a ratio of its travel
   * so it survives a rotation or a different device (see `StoredFrame`). `null`
   * means it has never been moved — the panel opens in its default corner.
   */
  miniWindow: StoredFrame | null;
  /**
   * Whether the drawer was last left minimized. Restored on the next *open*, not
   * on launch — the drawer only exists once the bubble is tapped — so this says
   * "open it the way I left it" rather than putting a panel on screen unasked.
   */
  drawerMinimized: boolean;
}

const DEFAULTS: BesouroSettings = {
  theme: null,
  accent: null,
  fontScale: 1,
  locale: null,
  tabOrder: null,
  miniWindow: null,
  drawerMinimized: false,
};

const SETTINGS_FILE = 'rn-inapp-devtools_settings.json';

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

// ── Native persistence ───────────────────────────────────────────────────────

/**
 * Load persisted settings from native storage and merge them over the defaults.
 * Notifies subscribers so a live UI (and the native bubble) re-resolves. Safe to
 * call when the native module is absent (tests, web) — it just no-ops.
 */
export async function hydrateSettings(): Promise<void> {
  if (!NativeBesouro) return;
  try {
    const raw = await NativeBesouro.readFile(SETTINGS_FILE);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Partial<BesouroSettings>;
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
      miniWindow: isStoredFrame(parsed.miniWindow)
        ? parsed.miniWindow
        : DEFAULTS.miniWindow,
      drawerMinimized:
        typeof parsed.drawerMinimized === 'boolean'
          ? parsed.drawerMinimized
          : DEFAULTS.drawerMinimized,
    };
    for (const listener of listeners) {
      listener();
    }
  } catch {
    // Corrupt/missing file — keep defaults.
  }
}

async function persist(): Promise<void> {
  if (!NativeBesouro) return;
  try {
    await NativeBesouro.writeFile(SETTINGS_FILE, JSON.stringify(settings));
  } catch {
    // Best-effort — a failed write just means the choice isn't remembered.
  }
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
