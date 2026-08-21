/**
 * Structural stand-ins for the parts of Redux this inspector touches.
 *
 * We never import `redux` or `@reduxjs/toolkit` (§4.1), so these describe the
 * store by the shape we actually use rather than by its real type. A store from
 * `createStore`, `configureStore`, or anything wrapped by `applyMiddleware`
 * satisfies `ReduxStoreLike` — `applyMiddleware` returns `{ ...store, dispatch }`,
 * so `replaceReducer` survives the spread and still closes over the same reducer
 * slot the base store dispatches through.
 */

/** The minimum an action must have to be dispatched — Redux requires a `type`. */
export interface ReduxActionLike {
  type: string;
  [key: string]: unknown;
}

/** A reducer as this inspector calls it: `(state, action) -> nextState`. */
export type ReduxReducerLike<State = unknown> = (
  state: State | undefined,
  action: ReduxActionLike
) => State;

/**
 * The store surface the inspector needs — all public API.
 *
 * `dispatch` is here for completeness of the shape a consumer passes; capture does
 * not patch it. Patching `dispatch` would miss every action a middleware emits
 * internally (thunks, `createAsyncThunk`, RTK Query), because `applyMiddleware`
 * hands middleware the *pre-patch* dispatch. Wrapping the reducer instead sees
 * everything that reaches state. See §6.9.
 */
export interface ReduxStoreLike<State = unknown> {
  getState: () => State;
  dispatch: (action: ReduxActionLike) => unknown;
  replaceReducer: (nextReducer: ReduxReducerLike<State>) => void;
}

/** What {@link installReduxInspector} — and `setReduxStore` — takes. */
export interface ReduxInspectorPeers<State = unknown> {
  store: ReduxStoreLike<State>;
  rootReducer: ReduxReducerLike<State>;
}
