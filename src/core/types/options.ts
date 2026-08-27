/**
 * Consumer-facing configuration: what `Besouro.configure(...)` accepts.
 */

export type ThemePreference = 'system' | 'light' | 'dark';
export type LocalePreference = 'system' | 'en' | 'pt' | 'es';

/**
 * Per-inspector switches for the inspectors that need nothing from the consumer to
 * work. They are **on by default** — this exists to turn one off, which is the rare
 * case, so it lives here rather than as a method on the builder.
 *
 * The inspectors that require a dependency (asyncStorage, mmkv, zustand, redux,
 * jotai, socketio, notifications) are deliberately absent: supplying the dependency
 * via the matching inspector method *is* their switch, and a second one here would be
 * two controls for one lamp.
 *
 * Values are `boolean` today. They are keyed rather than flattened into
 * {@link BesouroOptions} so a value can widen to `boolean | <per-inspector
 * options>` later without colliding with a global option of the same name.
 */
export interface InspectorToggles {
  network?: boolean;
  console?: boolean;
  websocket?: boolean;
  element?: boolean;
  viewHierarchy?: boolean;
  fileSystem?: boolean;
}

export interface BesouroOptions {
  /**
   * How many sessions to retain; older ones are pruned at startup. Defaults to 10.
   *
   * This is the **only** retention control. Events within a session are never
   * capped: they live in SQLite, are read a page at a time, and cost the JS heap
   * nothing until a list scrolls to them — so there is no memory pressure for a
   * per-inspector limit to relieve.
   */
  maxSessions?: number;
  theme?: ThemePreference;
  /**
   * Default accent color (`#rrggbb`) for the drawer's primary highlights. The user
   * can override this from Settings; when omitted, the theme's built-in accent is
   * used.
   */
  accent?: string;
  locale?: LocalePreference;
  /**
   * Turn off inspectors that are otherwise on by default. Omit it and every
   * self-sufficient inspector runs.
   */
  inspectors?: InspectorToggles;
}

/** Runtime status of a single inspector, surfaced in the drawer. */
export type InspectorStatus = 'active' | 'not-installed' | 'degraded';
