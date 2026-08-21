/**
 * A small RTK store for exercising the Redux inspector.
 *
 * `rootReducer` is exported separately from `store` on purpose: `setReduxStore`
 * needs it, because capture wraps the reducer and Redux has no way to hand one
 * back off a store. Naming it here instead of inlining
 * `configureStore({ reducer: { … } })` is the whole call-site cost of the inspector.
 *
 * The async thunk is the interesting case — it dispatches `pending` and
 * `fulfilled` from inside middleware, where a `store.dispatch` patch could not see
 * them, so it is what proves the reducer-wrapping seam works.
 */

import {
  combineReducers,
  configureStore,
  createAsyncThunk,
  createSlice,
} from '@reduxjs/toolkit';

export interface Todo {
  id: number;
  title: string;
}

export const fetchTodos = createAsyncThunk('todos/fetch', async () => {
  const response = await fetch(
    'https://jsonplaceholder.typicode.com/todos?_limit=5'
  );
  return (await response.json()) as Todo[];
});

const counterSlice = createSlice({
  name: 'counter',
  initialState: { value: 0, label: 'idle' },
  reducers: {
    increment: (state) => {
      state.value += 1;
    },
    setLabel: (state, action: { payload: string }) => {
      state.label = action.payload;
    },
    reset: (state) => {
      state.value = 0;
      state.label = 'idle';
    },
  },
});

const todosSlice = createSlice({
  name: 'todos',
  initialState: { items: [] as Todo[], status: 'idle' as string },
  reducers: {},
  extraReducers: (builder) => {
    builder
      .addCase(fetchTodos.pending, (state) => {
        state.status = 'loading';
      })
      .addCase(fetchTodos.fulfilled, (state, action) => {
        state.status = 'ready';
        state.items = action.payload;
      })
      .addCase(fetchTodos.rejected, (state) => {
        state.status = 'failed';
      });
  },
});

export const { increment, setLabel, reset } = counterSlice.actions;

export const rootReducer = combineReducers({
  counter: counterSlice.reducer,
  todos: todosSlice.reducer,
});

export const store = configureStore({ reducer: rootReducer });

export type RootState = ReturnType<typeof rootReducer>;
export type AppDispatch = typeof store.dispatch;
