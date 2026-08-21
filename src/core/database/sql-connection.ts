/**
 * The connection to SQLite — the lowest layer of `core/database`, and the only
 * one that knows how statements reach the engine.
 *
 * It carries no schema and no queries: those are built a layer up, against this
 * interface. Two things implement it: the `BesouroDatabase` TurboModule at
 * runtime (below), and `node:sqlite` in the unit tests. Because the surface is
 * this small and the schema/queries live entirely in JS, the tests exercise the
 * *real* SQL — a broken WHERE clause fails a test instead of shipping.
 */

import NativeBesouroDatabase from '../../native/NativeBesouroDatabase';

/** A bind value. Objects/arrays are stringified by the row mappers first. */
export type SqlValue = string | number | boolean | null;

export interface SqlStatement {
  sql: string;
  params: SqlValue[];
}

/** A row as returned by `query`, keyed by column name. */
export type SqlRow = Record<string, SqlValue>;

export interface SqlConnection {
  /** Open/create the database and apply connection pragmas. Idempotent. */
  open(): Promise<void>;
  /** Run one statement that returns no rows; resolves rows changed. */
  execute(sql: string, params?: SqlValue[]): Promise<number>;
  /** Run one statement that returns rows. */
  query(sql: string, params?: SqlValue[]): Promise<SqlRow[]>;
  /** Run many statements in one transaction — one round trip, all-or-nothing. */
  batch(statements: SqlStatement[]): Promise<void>;
  /**
   * {@link batch}, blocking until the transaction commits, and reporting success
   * as a return value rather than a rejection.
   *
   * The crash path's only option — see the note on the native `batchSync`. Nothing
   * else may call it.
   */
  batchSync(statements: SqlStatement[]): boolean;
}

/**
 * The runtime connection, or null when the native module isn't linked (Expo Go /
 * web / tests). A null here is what turns persistence off — captured events are
 * dropped rather than anything failing.
 */
export function createNativeSqlConnection(): SqlConnection | null {
  // Captured once as a non-null local so the closures below don't re-narrow.
  const native = NativeBesouroDatabase;
  if (!native) return null;

  return {
    open: () => native.open(),

    async execute(sql, params = []) {
      return native.execute(sql, JSON.stringify(params));
    },

    async query(sql, params = []) {
      const raw = await native.query(sql, JSON.stringify(params));
      // The native side always resolves a JSON array; treat anything else as an
      // empty result rather than throwing into a render path.
      try {
        const parsed = JSON.parse(raw) as unknown;
        return Array.isArray(parsed) ? (parsed as SqlRow[]) : [];
      } catch {
        return [];
      }
    },

    async batch(statements) {
      if (statements.length === 0) return;
      await native.batch(JSON.stringify(statements));
    },

    batchSync(statements) {
      if (statements.length === 0) return true;
      return native.batchSync(JSON.stringify(statements));
    },
  };
}
