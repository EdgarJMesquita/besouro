/**
 * MMKV inspector types — internal.
 *
 * Structural stand-ins so the library never imports `react-native-mmkv` itself
 * (§4.1). A consumer passes their real instances to `mmkv` and
 * structural typing does the rest.
 *
 * {@link MMKVLike} deliberately spans v2 through v4 of the library, which disagree
 * on how an instance is made and what removal is called: v2/v3 export an `MMKV`
 * class (`new MMKV({ id })`) with `delete(key)`, while v4 exports `createMMKV(config)`
 * returning a Nitro HybridObject with `remove(key)`. Both are just objects by the
 * time they reach us, so the interface asks for the intersection and treats the two
 * removal spellings as optional alternatives.
 */

/** Unsubscribe handle returned by `addOnValueChangedListener`. */
export interface MMKVListenerLike {
  remove(): void;
}

/**
 * Structural subset of an MMKV instance.
 *
 * `addOnValueChangedListener` is required rather than optional because it is how
 * this inspector captures at all (see `interceptor.ts`) — an object without it is
 * not something we can watch, and failing at registration is better than attaching
 * to it and recording nothing.
 */
export interface MMKVLike {
  /** The instance's own storage id, e.g. `mmkv.default`. Absent on v2. */
  readonly id?: string;
  set(key: string, value: boolean | string | number | ArrayBuffer): void;
  getString(key: string): string | undefined;
  getNumber(key: string): number | undefined;
  getBoolean(key: string): boolean | undefined;
  getBuffer?(key: string): ArrayBufferLike | undefined;
  contains(key: string): boolean;
  getAllKeys(): string[];
  clearAll(): void;
  /** v4. */
  remove?(key: string): boolean;
  /** v2/v3, renamed to `remove` in v4. */
  delete?(key: string): void;
  /** Fallback capture path when an instance's method slots refuse a wrapper. */
  addOnValueChangedListener(
    onValueChanged: (key: string) => void
  ): MMKVListenerLike;
}

/**
 * The MMKV instances to watch, keyed by the name each appears under in the drawer.
 *
 * These are the only instances watched — there is no way to add one later, by
 * design (see `interceptor.ts`). The key is the drawer label rather than the
 * instance's own `id` because `id` is often a path-ish default (`mmkv.default`)
 * that says less than the name the app knows it by; `id` is still shown in the
 * instance detail, where it is the fact and not the label.
 */
export type MMKVInstances = Record<string, MMKVLike>;

/**
 * An instance's contents as a snapshot row carries them: key → serialized value.
 *
 * Flat and string-valued rather than typed, because this is what the State pane
 * renders as label/value rows — the same shape the network tab's header list takes.
 * The per-key type still travels on the change rows, where it disambiguates; in a
 * contents listing it was noise.
 */
export type MMKVContents = Record<string, string>;
