/**
 * What the atom list renders.
 *
 * One shape from one source — the session's own rows (see `utils/atom-list.ts`).
 * `preview` is a summary column and rides along; the full value is a heavy one the
 * list query never selects, fetched only when an atom's detail opens.
 */
export interface JotaiAtomListItem {
  atomId: string;
  atomName: string;
  /** One-line rendering of the newest value recorded. */
  preview: string;
  changeCount: number;
  updatedAt: number;
}
