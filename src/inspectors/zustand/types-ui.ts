/**
 * What the store list renders.
 *
 * One shape from one source — the session's own rows — so `StoreRow` has never
 * needed to know which session it is in, and now neither does the builder (see
 * `utils/store-list.ts`). The state itself is not here: it is a heavy column the
 * list query never selects, fetched only when a store's detail opens.
 */
export interface ZustandStoreListItem {
  storeId: string;
  storeName: string;
  changeCount: number;
  updatedAt: number;
}
