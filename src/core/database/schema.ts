/**
 * Schema DDL, derived from the column manifests in `./rows.ts` so the tables and
 * the mappers cannot drift apart.
 *
 * Dialect floor: Android's framework SQLite tracks the OS and API 24 ships ~3.9,
 * so everything here (and every query built against it) stays within plain
 * CREATE/INSERT/UPDATE/DELETE/SELECT — no UPSERT (3.24), no window functions
 * (3.25), no `ALTER TABLE ... DROP COLUMN` (3.35).
 */

import type { SqlConnection, SqlStatement } from './sql-connection';
import {
  ALL_TABLES,
  allColumns,
  type ColumnSpec,
  type TableSpec,
} from './rows';

/**
 * Bump when any table's columns change. There is no migration ladder: a mismatch
 * drops every table and recreates it (see {@link migrate}). Captured logs are
 * disposable by definition — carrying migrations for a devtool's own scratch data
 * would cost more than it could ever be worth.
 *
 * "Any table's columns change" includes *adding* one to a table introduced earlier
 * in the same unreleased branch. `migrate` only drops when the stored version
 * differs, and every CREATE is `IF NOT EXISTS`, so a column added without a bump
 * silently never reaches a database that already stored this version — every
 * insert then fails on the missing column until the queue disables itself and the
 * drawer reports "stopped recording". `manifest-version.test.ts` pins the manifest
 * against this number so the two cannot drift apart again.
 */
export const SCHEMA_VERSION = 11;

const SQL_TYPES: Record<ColumnSpec['type'], string> = {
  text: 'TEXT',
  int: 'INTEGER',
  // SQLite has no boolean type; the row mappers encode 0/1.
  bool: 'INTEGER',
  json: 'TEXT',
};

function columnDdl(column: ColumnSpec): string {
  const type = SQL_TYPES[column.type];
  if (column.column === 'id') return `${column.column} ${type} PRIMARY KEY`;
  if (column.column === 'session_id' || column.column === 'timestamp') {
    return `${column.column} ${type} NOT NULL`;
  }
  return `${column.column} ${type}`;
}

function createTableDdl(spec: TableSpec): string {
  const columns = allColumns(spec).map(columnDdl).join(', ');
  return `CREATE TABLE IF NOT EXISTS ${spec.table} (${columns})`;
}

/**
 * The index every list query rides: `session_id` narrows to the session,
 * `timestamp DESC` gives the newest-first order without a sort, and `id DESC`
 * covers the keyset tiebreaker so paging never needs a second lookup.
 */
function createIndexDdl(spec: TableSpec): string {
  return (
    `CREATE INDEX IF NOT EXISTS ${spec.table}_session_ts ` +
    `ON ${spec.table} (session_id, timestamp DESC, id DESC)`
  );
}

/**
 * A second index for the tabs whose sub-lists filter by group (WebSocket and
 * Socket.IO connections, Zustand stores, MMKV instances), so a per-connection
 * frame list pages as cheaply as a whole-session one.
 */
function createGroupIndexDdl(spec: TableSpec): string | null {
  if (!spec.groupColumn) return null;
  return (
    `CREATE INDEX IF NOT EXISTS ${spec.table}_${spec.groupColumn}_ts ` +
    `ON ${spec.table} (session_id, ${spec.groupColumn}, timestamp DESC, id DESC)`
  );
}

/**
 * `inspectors` is a JSON array of the inspectors that were running for the
 * session — null when the writer didn't record it (see `core/session-tabs.ts`).
 * Text rather than a join table: it is read whole, once, and never queried on.
 */
export const CREATE_SESSIONS = `CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  last_event_at INTEGER,
  event_count INTEGER NOT NULL DEFAULT 0,
  app_version TEXT,
  status TEXT NOT NULL,
  inspectors TEXT
)`;

const CREATE_SESSIONS_INDEX =
  'CREATE INDEX IF NOT EXISTS sessions_started_at ON sessions (started_at DESC)';

const CREATE_META =
  'CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)';

/** Every statement that builds an empty database, in dependency order. */
export function createSchemaStatements(): SqlStatement[] {
  const statements: SqlStatement[] = [
    { sql: CREATE_META, params: [] },
    { sql: CREATE_SESSIONS, params: [] },
    { sql: CREATE_SESSIONS_INDEX, params: [] },
  ];
  for (const spec of ALL_TABLES) {
    statements.push({ sql: createTableDdl(spec), params: [] });
    statements.push({ sql: createIndexDdl(spec), params: [] });
    const groupIndex = createGroupIndexDdl(spec);
    if (groupIndex) statements.push({ sql: groupIndex, params: [] });
  }
  statements.push({
    sql: 'INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)',
    params: ['schema_version', String(SCHEMA_VERSION)],
  });
  return statements;
}

/** Drop everything this library owns, leaving any other table untouched. */
export function dropSchemaStatements(): SqlStatement[] {
  const statements: SqlStatement[] = ALL_TABLES.map((spec) => ({
    sql: `DROP TABLE IF EXISTS ${spec.table}`,
    params: [],
  }));
  statements.push({ sql: 'DROP TABLE IF EXISTS sessions', params: [] });
  statements.push({ sql: 'DROP TABLE IF EXISTS meta', params: [] });
  return statements;
}

/**
 * Bring the database up to {@link SCHEMA_VERSION}, creating it on first run and
 * recreating it from scratch when the stored version differs.
 *
 * Runs as two batches (drop, then create) rather than one, so a failure to read a
 * corrupt `meta` table still ends with a usable empty schema.
 */
export async function migrate(connection: SqlConnection): Promise<void> {
  const storedVersion = await readSchemaVersion(connection);
  if (storedVersion !== null && storedVersion !== SCHEMA_VERSION) {
    await connection.batch(dropSchemaStatements());
  }
  await connection.batch(createSchemaStatements());
}

/**
 * The schema version on disk, or null when the database is empty or its `meta`
 * table is unreadable — both of which mean "create from scratch", so they are
 * deliberately not distinguished.
 */
async function readSchemaVersion(
  connection: SqlConnection
): Promise<number | null> {
  try {
    const rows = await connection.query(
      'SELECT value FROM meta WHERE key = ?',
      ['schema_version']
    );
    const raw = rows[0]?.value;
    if (typeof raw !== 'string') return null;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    // No `meta` table yet (first run) — the create batch below handles it.
    return null;
  }
}
