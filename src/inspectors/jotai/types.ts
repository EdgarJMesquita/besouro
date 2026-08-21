/**
 * Structural stand-ins for the parts of Jotai this inspector touches.
 *
 * We never import `jotai` (§4.1). Only the public v2 store surface is described —
 * `get` and `sub` — deliberately leaving out `INTERNAL_getBuildingBlocksRev3` and
 * the experimental `storeHooks` that would let us discover atoms automatically.
 * Those would find derived atoms too, and would need no declaration, but they are
 * documented as experimental and unversioned: a jotai minor could stop capture
 * dead with no type error to warn us. See §6.10.
 *
 * `get` and `sub` are declared with method syntax, not property syntax. That makes
 * their parameters bivariant, which is what lets a real `Store` — whose `get` is
 * `<Value>(atom: Atom<Value>) => Value` — satisfy this looser shape.
 */

/**
 * An atom, described by what distinguishes one structurally rather than by what we
 * do with it: this library only ever passes an atom back to the store.
 *
 * `read` is present on every jotai atom, primitive and derived alike, and is what
 * keeps this from matching any object at all. It is never called here.
 */
export interface JotaiAtomLike {
  read: unknown;
  /** Set by the consumer via `atom.debugLabel`; not used for the tab's naming. */
  debugLabel?: string;
  toString(): string;
}

/** The store surface the inspector needs — `getDefaultStore()` or `createStore()`. */
export interface JotaiStoreLike {
  get(atom: JotaiAtomLike): unknown;
  /**
   * Jotai's subscribe hands the listener nothing — the new value comes from a
   * `get`, and the previous one is whatever the caller remembered.
   */
  sub(atom: JotaiAtomLike, listener: () => void): () => void;
}

/** The atoms to watch, keyed by the name each appears under in the drawer. */
export type JotaiAtoms = Record<string, JotaiAtomLike>;

/** What {@link installJotaiInspector} — and `setJotaiAtoms` — takes. */
export interface JotaiInspectorPeers {
  store: JotaiStoreLike;
  atoms: JotaiAtoms;
}
