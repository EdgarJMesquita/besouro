/**
 * A {@link Database} backed by Node's built-in `node:sqlite`, for tests.
 *
 * This is a real SQLite engine, not a fake: the schema, the indexes and every
 * query in `sqlite-database.ts` actually execute, so a broken WHERE clause or a
 * mistyped column fails a test instead of shipping. It is built into Node (stable
 * on the v24 in `.nvmrc`, which CI uses), so it costs no dependency.
 *
 * The one thing it cannot cover is the native bridge itself — JSON encoding of
 * params and rows, and the Android/iOS SQLite version floor. Those are verified by
 * building and running the example app.
 */

import { DatabaseSync } from 'node:sqlite';
import type {
  SqlConnection,
  SqlRow,
  SqlStatement,
  SqlValue,
} from '../sql-connection';

export interface NodeDatabase extends SqlConnection {
  /** Close the underlying handle; call in `afterEach` to avoid leaking fds. */
  close(): void;
  /** Statements executed so far — lets a test assert on batching behaviour. */
  readonly log: string[];
}

export function createNodeDatabase(): NodeDatabase {
  const db = new DatabaseSync(':memory:');
  const log: string[] = [];

  const run = (sql: string, params: SqlValue[]): number => {
    log.push(sql);
    const statement = db.prepare(sql);
    const result = statement.run(...toBindValues(params));
    return Number(result.changes ?? 0);
  };

  const runBatch = (statements: SqlStatement[]): void => {
    if (statements.length === 0) return;
    db.exec('BEGIN');
    try {
      for (const statement of statements) {
        run(statement.sql, statement.params);
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  };

  return {
    log,

    async open() {
      // `:memory:` is already open; the pragmas the native side sets (WAL,
      // synchronous) are meaningless for an in-memory database.
    },

    async execute(sql, params = []) {
      return run(sql, params);
    },

    async query(sql, params = []) {
      log.push(sql);
      const statement = db.prepare(sql);
      const rows = statement.all(...toBindValues(params)) as Array<
        Record<string, unknown>
      >;
      return rows.map(normalizeRow);
    },

    async batch(statements: SqlStatement[]) {
      runBatch(statements);
    },

    batchSync(statements: SqlStatement[]) {
      // `node:sqlite` is synchronous throughout, so the two paths differ only in
      // how they report failure — which is exactly what the native modules do.
      try {
        runBatch(statements);
        return true;
      } catch {
        return false;
      }
    },

    close() {
      db.close();
    },
  };
}

/**
 * `node:sqlite` rejects booleans and `undefined` as bind values, so they are
 * mapped the same way the native modules do: booleans to 0/1, nothing else
 * changed.
 */
function toBindValues(params: SqlValue[]): Array<string | number | null> {
  return params.map((value) => {
    if (typeof value === 'boolean') return value ? 1 : 0;
    if (value === undefined) return null;
    return value;
  });
}

/**
 * Rows come back with a null prototype and may carry BigInt for INTEGER columns;
 * normalize to the plain `SqlRow` shape the adapter expects from the bridge.
 */
function normalizeRow(row: Record<string, unknown>): SqlRow {
  const normalized: SqlRow = {};
  for (const [key, value] of Object.entries(row)) {
    if (typeof value === 'bigint') {
      normalized[key] = Number(value);
    } else if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      value === null
    ) {
      normalized[key] = value;
    } else if (value === undefined) {
      normalized[key] = null;
    } else {
      // Buffers (BLOB) — nothing in the schema stores one; surface as null the
      // way both native implementations do.
      normalized[key] = null;
    }
  }
  return normalized;
}
