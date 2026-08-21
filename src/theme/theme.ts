/**
 * Theming — light + dark palettes following system appearance by default, tuned
 * for dense, legible, utility-first display (no UI-kit dependency). Colors are
 * flat tokens consumed directly by components and the JSON viewer's syntax
 * highlighting.
 */

import { useColorScheme } from 'react-native';
import type { ThemePreference } from '../core/types';

export interface Theme {
  readonly name: 'light' | 'dark';
  readonly background: string;
  readonly surface: string;
  readonly surfaceRaised: string;
  readonly border: string;
  readonly text: string;
  readonly textMuted: string;
  /** Faintest text tier — for labels that should recede (e.g. meta keys). */
  readonly textFaint: string;
  readonly textInverse: string;
  readonly accent: string;
  readonly success: string;
  readonly warning: string;
  readonly danger: string;
  /** Directional token for outbound socket frames (received reuses `success`). */
  readonly sent: string;
  readonly overlay: string;
  /** Syntax-highlight tokens for the JSON/payload viewer. */
  readonly syntax: {
    readonly key: string;
    readonly string: string;
    readonly number: string;
    readonly boolean: string;
    readonly null: string;
    readonly punctuation: string;
  };
}

const lightTheme: Theme = {
  name: 'light',
  background: '#ffffff',
  surface: '#ffffff',
  surfaceRaised: '#f7f7f8',
  border: '#e4e4e7',
  text: '#18181b',
  textMuted: '#71717a',
  textFaint: '#a1a1aa',
  textInverse: '#ffffff',
  accent: '#2563eb',
  success: '#2d8a4e',
  warning: '#a05c00',
  danger: '#c0392b',
  sent: '#1a6fa8',
  overlay: 'rgba(0,0,0,0.35)',
  syntax: {
    key: '#8250df',
    string: '#0a7d33',
    number: '#0550ae',
    boolean: '#953800',
    null: '#6b7280',
    punctuation: '#57606a',
  },
};

const darkTheme: Theme = {
  name: 'dark',
  background: '#0d1117',
  surface: '#161b22',
  surfaceRaised: '#21262d',
  border: '#30363d',
  text: '#e6edf3',
  textMuted: '#8b949e',
  textFaint: '#6e7681',
  textInverse: '#0d1117',
  accent: '#58a6ff',
  success: '#3fb950',
  warning: '#d29922',
  danger: '#f85149',
  sent: '#4c9ad4',
  overlay: 'rgba(0,0,0,0.6)',
  syntax: {
    key: '#d2a8ff',
    string: '#7ee787',
    number: '#79c0ff',
    boolean: '#ffa657',
    null: '#8b949e',
    punctuation: '#8b949e',
  },
};

export function getTheme(name: 'light' | 'dark'): Theme {
  return name === 'dark' ? darkTheme : lightTheme;
}

/**
 * Resolve the active theme from the configured preference, falling back to the
 * system color scheme when set to `'system'` (the default).
 */
export function useResolvedTheme(preference: ThemePreference): Theme {
  const systemScheme = useColorScheme();
  if (preference === 'light' || preference === 'dark') {
    return getTheme(preference);
  }
  return getTheme(systemScheme === 'dark' ? 'dark' : 'light');
}
