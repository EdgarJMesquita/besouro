/**
 * Self-contained i18n — English (default), Portuguese, Spanish. All UI strings
 * live in per-locale tables (`./en`, `./pt`, `./es`, all filling the shape in
 * `./types`); locale comes from the device (via this library's own native module)
 * and is overridable via config. No i18n library. Captured data is never
 * translated.
 *
 * This module is the entry point: it owns which table is active, not what is in
 * one.
 */

import type { LocalePreference } from '../core/types';
import NativeBesouro from '../native/NativeBesouro';
import type { LanguageCode, StringTable } from './types';
import { en } from './en';
import { pt } from './pt';
import { es } from './es';

export type { LanguageCode, StringTable } from './types';

const tables: Record<LanguageCode, StringTable> = { en, pt, es };

/** Resolve the active language from the configured locale preference. */
export function resolveLanguage(preference: LocalePreference): LanguageCode {
  return preference === 'system' ? detectDeviceLanguage() : preference;
}

/** Resolve the active string table from the configured locale preference. */
export function resolveStrings(preference: LocalePreference): StringTable {
  return tables[resolveLanguage(preference)] ?? en;
}

/**
 * Device-language detection. Only the primary subtag matters here — the tables
 * are language-level, so `pt-BR` and `pt-PT` both resolve to `pt` — and anything
 * we don't translate falls back to English.
 */
function detectDeviceLanguage(): LanguageCode {
  const prefix = readDeviceLocale().slice(0, 2).toLowerCase();
  if (prefix === 'pt' || prefix === 'es') {
    return prefix;
  }
  return 'en';
}

/**
 * The device locale as a BCP-47 tag, from the library's own native module. Falls
 * back to English when it isn't linked (tests / web / Expo Go) and when the call
 * itself fails — which is what a JS bundle running against a native build older
 * than `getDeviceLocale` does, since the method is simply absent there.
 */
function readDeviceLocale(): string {
  if (!NativeBesouro) return 'en';
  try {
    return NativeBesouro.getDeviceLocale();
  } catch {
    return 'en';
  }
}
