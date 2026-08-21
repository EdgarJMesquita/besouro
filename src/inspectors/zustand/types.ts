/**
 * Zustand inspector types — internal.
 *
 * Structural stand-ins so the library never imports `zustand` itself: a store from
 * `create(...)` (the hook, which also carries the store API) or `createStore(...)`
 * (the vanilla store) both satisfy `ZustandStoreLike`. A consumer passes their real
 * store to `setZustandStores` and structural typing does the rest.
 */

/** Structural subset of a Zustand store (vanilla store or the `create` hook). */
export interface ZustandStoreLike<State = Record<string, unknown>> {
  getState: () => State;
  subscribe: (
    listener: (nextState: State, prevState: State) => void
  ) => () => void;
}

/**
 * The Zustand stores to watch, keyed by the name each appears under in the drawer.
 * Every listed store has its initial state and each subsequent transition captured.
 *
 * These are the only stores watched — there is no way to add one later, by design
 * (see `interceptor.ts`).
 *
 * State is `unknown` (not the default `Record<string, unknown>`) so stores with a
 * concrete, index-signature-free State type stay assignable.
 */
export type ZustandStores = Record<string, ZustandStoreLike<unknown>>;
