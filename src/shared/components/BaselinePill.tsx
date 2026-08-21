/**
 * The badge that marks a baseline row in the Zustand, Jotai and Redux tabs — the
 * row holding a starting state rather than a change to one.
 *
 * **One badge, the more specific label wins.** A reload's baseline is both an
 * initial state and a reload, but two neutral pills side by side read as one blob
 * and say the same thing twice — the reason this component exists rather than each
 * row rendering its own pair. "App Reload" already means "this is where a store
 * started", and adds why.
 *
 * **Why a badge and not words in the row.** A history row's text column answers
 * "what changed?", and a baseline used to answer it with its own name — a Jotai row
 * reading `Initial state · 0` under a column of bare `0`, `1`, `2`. The kind of row
 * is not the kind of fact the value column holds, so it moves out to the badge and
 * the column stays homogeneous.
 *
 * **Why "App Reload" is not translated.** It is a technical term the reader knows by
 * its English name — the dev menu and Metro both say "Reload" whatever the device
 * language is set to, and in production the same thing arrives as
 * `Updates.reloadAsync` or `RNRestart`. Translating it would invent vocabulary
 * nobody uses for the mechanism. The tabs already show untranslated technical values
 * in pills: MMKV's `set`/`delete`, a raw HTTP status, a raw Redux slice name. So
 * this literal is a decision, not a missing i18n key — please leave it out of
 * `src/i18n`. "Initial state" is ordinary UI prose and stays translated.
 *
 * Muted rather than colored: a baseline is a category, not an outcome (see `Pill`),
 * which also gives it the neutral variant's hairline border.
 */

import { useBesouroUI } from '../context';

import { Pill } from './Pill';

export function BaselinePill({
  isInitial,
  isReload,
}: {
  isInitial: boolean;
  isReload: boolean;
}): React.ReactNode {
  const { theme, strings } = useBesouroUI();
  if (isReload) {
    return <Pill label="App Reload" color={theme.textMuted} />;
  }
  if (isInitial) {
    return <Pill label={strings.initialState} color={theme.textMuted} />;
  }
  return null;
}
