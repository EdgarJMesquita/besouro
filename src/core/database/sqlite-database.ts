/**
 * The SQLite implementation of {@link Database} — both repositories, built over
 * one {@link SqlConnection}.
 *
 * `sessions` and `events` are separate objects so a caller can be handed one and
 * not the other, but they close over the same connection: the event counters on
 * the `sessions` table, and a session delete that removes event rows, are each
 * still a single transaction.
 *
 * Writes are deltas applied in one transaction; reads are keyset-paginated pages
 * of summary columns. Nothing here loads a session whole, which is the whole
 * point: the in-memory cost of the drawer is bounded by what the user is looking
 * at, not by how long the app has been running.
 *
 * All SQL is built here from the manifests in `./rows.ts` and stays within the
 * dialect floor documented in `./schema.ts` (Android API 24 ships SQLite ~3.9).
 */

import type {
  BesouroEvent,
  Inspector,
  InspectorKind,
  SessionMeta,
} from '../types';
import type {
  Database,
  EventBatch,
  EventCursor,
  EventGroup,
  EventGroupQuery,
  EventPage,
  EventQuery,
  EventRepository,
  SessionRepository,
} from './types';
import type {
  SqlConnection,
  SqlRow,
  SqlStatement,
  SqlValue,
} from './sql-connection';
import { migrate } from './schema';
import {
  ALL_TABLES,
  TABLES,
  decodeRow,
  encodeEvent,
  encodePatch,
  searchableColumns,
  summaryColumns,
} from './rows';

export function openDatabase(connection: SqlConnection): Database {
  // One shared open+migrate promise: every method awaits it, so a call made
  // before the database is ready queues rather than failing. Captured at
  // construction (not on first use) so the open starts immediately.
  // Mirrors `ready` as a plain flag, because the sync write path cannot await it:
  // a crash handler has to decide *now* whether writing is possible at all.
  let open = false;

  const ready = (async () => {
    await connection.open();
    await migrate(connection);
    open = true;
  })();

  const awaitReady = (): Promise<void> => ready;

  const sessions: SessionRepository = {
    async list() {
      await ready;
      const rows = await connection.query(
        'SELECT id, started_at, ended_at, last_event_at, event_count, app_version, status, inspectors ' +
          'FROM sessions ORDER BY started_at DESC'
      );
      return rows.map(decodeSessionRow);
    },

    async save(meta) {
      await ready;
      // Three statements rather than INSERT OR REPLACE: replacing the row would
      // reset event_count and last_event_at, which the writer maintains
      // independently. UPSERT would express the first two in one statement but
      // needs SQLite 3.24 — above the Android floor.
      await connection.batch([
        {
          sql:
            'INSERT OR IGNORE INTO sessions (id, started_at, status, app_version, inspectors) ' +
            'VALUES (?, ?, ?, ?, ?)',
          params: [
            meta.id,
            meta.startedAt,
            meta.status,
            meta.appVersion ?? null,
            encodeInspectors(meta.inspectors),
          ],
        },
        {
          sql:
            'UPDATE sessions SET started_at = ?, ended_at = ?, status = ?, app_version = ?, inspectors = ? ' +
            'WHERE id = ?',
          params: [
            meta.startedAt,
            meta.endedAt ?? null,
            meta.status,
            meta.appVersion ?? null,
            encodeInspectors(meta.inspectors),
            meta.id,
          ],
        },
        // Adopt the rows already on disk under this id. Only when the counter is
        // still zero, which is exactly the row this save just created: capture
        // flushes before the lifecycle writes the session (see
        // `SessionRepository.save`), and those bumps found no row to update.
        // The guard is also what keeps this cheap — SQLite evaluates a SET
        // expression only for rows the WHERE admits, so an established session
        // never pays for the seven counts.
        recomputeCounters(meta.id, { onlyIfUncounted: true }),
      ]);
    },

    async delete(sessionId) {
      return sessions.deleteMany([sessionId]);
    },

    async deleteMany(sessionIds) {
      if (sessionIds.length === 0) return;
      await ready;
      const placeholders = sessionIds.map(() => '?').join(', ');
      const statements: SqlStatement[] = ALL_TABLES.map((spec) => ({
        sql: `DELETE FROM ${spec.table} WHERE session_id IN (${placeholders})`,
        params: [...sessionIds],
      }));
      statements.push({
        sql: `DELETE FROM sessions WHERE id IN (${placeholders})`,
        params: [...sessionIds],
      });
      // One transaction, so a bulk clear can't half-apply and leave orphan rows
      // pointing at a session that no longer exists.
      await connection.batch(statements);
    },

    async reassignEvents(fromSessionId, toSessionId) {
      if (fromSessionId === toSessionId) return;
      await ready;
      const statements: SqlStatement[] = ALL_TABLES.map((spec) => ({
        sql: `UPDATE ${spec.table} SET session_id = ? WHERE session_id = ?`,
        params: [toSessionId, fromSessionId],
      }));
      // Recomputed, not adjusted by the number of rows moved: the count and the
      // move are then the same statement sequence in the same transaction, so
      // there is no moment where one has happened and the other has not. No
      // counter is owed to the source — a session whose rows can be moved out
      // from under it is one that never had a row to count them.
      statements.push(recomputeCounters(toSessionId));
      await connection.batch(statements);
    },

    async deleteOrphanedEvents(keepSessionId) {
      await ready;
      await connection.batch(
        ALL_TABLES.map((spec) => ({
          sql:
            `DELETE FROM ${spec.table} WHERE session_id <> ? ` +
            'AND session_id NOT IN (SELECT id FROM sessions)',
          params: [keepSessionId],
        }))
      );
    },
  };

  const events: EventRepository = {
    async commit(batch) {
      if (batch.inserts.length === 0 && batch.updates.length === 0) return;
      await ready;
      await connection.batch(buildWriteStatements(batch));
    },

    commitSync(batch) {
      if (batch.inserts.length === 0 && batch.updates.length === 0) return true;
      // No `await ready` is possible here, so a crash in the first moments of
      // startup — before the open round trip lands — cannot be written. Reported
      // as a failure so the caller falls back to the async flush, which is at
      // least a chance if the process survives.
      if (!open) return false;
      return connection.batchSync(buildWriteStatements(batch));
    },

    async query(query) {
      await ready;
      const spec = TABLES[query.kind];
      const columns = summaryColumns(spec).map((column) => column.column);
      const { where, params } = buildWhere(query);

      // LIMIT is interpolated, not bound: it is always a number this module
      // controls (never user input), and Android's rawQuery binds every argument
      // as a string — which SQLite's numeric affinity rescues for column
      // comparisons but not for a bare LIMIT expression.
      const pageSize = Math.max(1, Math.floor(query.limit));
      const rows = await connection.query(
        `SELECT ${columns.join(', ')} FROM ${spec.table} ${where} ` +
          `ORDER BY timestamp DESC, id DESC LIMIT ${pageSize + 1}`,
        params
      );

      // The extra row is the `hasMore` probe — cheaper than a COUNT, and exact.
      const hasMore = rows.length > pageSize;
      const page = hasMore ? rows.slice(0, pageSize) : rows;
      const decoded = page.map((row) => decodeRow(query.kind, row));
      const last = decoded[decoded.length - 1];
      return {
        rows: decoded,
        hasMore,
        cursor:
          hasMore && last ? { timestamp: last.timestamp, id: last.id } : null,
      };
    },

    async groups(query) {
      await ready;
      const spec = TABLES[query.kind];
      if (!spec.groupColumn) return [];
      const group = spec.groupColumn;

      // The search narrows what is counted, so a filtered connection list shows
      // which connections carried a matching frame — and how many.
      const search = buildSearch(query.kind, query.search);
      // Two counts in one pass: every row, and the ones the caller calls a change
      // (see `countWhere`). Summed here rather than subtracted by the caller,
      // because "all rows minus one baseline" is only true until a reload writes a
      // second one.
      const changes = buildChangeCount(query);
      const aggregates = await connection.query(
        `SELECT ${group} AS group_key, COUNT(*) AS count, ` +
          `${changes.select} AS change_count, ` +
          `MIN(timestamp) AS first_at, MAX(timestamp) AS last_at ` +
          `FROM ${spec.table} WHERE session_id = ? AND ${group} IS NOT NULL` +
          (search ? ` AND ${search.clause}` : '') +
          ` GROUP BY ${group}`,
        [...changes.params, query.sessionId, ...(search?.params ?? [])]
      );

      // Two passes: the newest row of any kind identifies the connection (url,
      // label), while the newest *lifecycle* row is what its status reads.
      const newestByKey = await queryLatestPerGroup(connection, query, group);
      const latestByKey = query.latestWhere
        ? await queryLatestPerGroup(connection, query, group, query.latestWhere)
        : new Map<string, BesouroEvent>();

      return aggregates.map((row) => {
        const key = String(row.group_key ?? '');
        return {
          key,
          count: Number(row.count ?? 0),
          changeCount: Number(row.change_count ?? 0),
          firstAt: Number(row.first_at ?? 0),
          lastAt: Number(row.last_at ?? 0),
          newest: newestByKey.get(key) ?? null,
          latest: latestByKey.get(key) ?? null,
        };
      });
    },

    async load(kind, id) {
      await ready;
      const spec = TABLES[kind];
      const rows = await connection.query(
        `SELECT * FROM ${spec.table} WHERE id = ?`,
        [id]
      );
      const row = rows[0];
      return row ? decodeRow(kind, row) : null;
    },

    async count(sessionId, kind) {
      await ready;
      const spec = TABLES[kind];
      const rows = await connection.query(
        `SELECT COUNT(*) AS count FROM ${spec.table} WHERE session_id = ?`,
        [sessionId]
      );
      return Number(rows[0]?.count ?? 0);
    },

    async clear(sessionId, kind) {
      await ready;
      const spec = TABLES[kind];
      // Clear empties the *log*. Where a kind also keeps a state row — MMKV's
      // Store contents, Redux's state tree — that row stays: it describes what
      // the app is holding right now, not what it did, and the button that says
      // "Clear" over a list of operations has never claimed to reach into the
      // app's own storage. See `TableSpec.stateColumn`.
      //
      // COALESCE rather than `= 0`, because the column is only written by the
      // kinds that mean something by it: a row that left it NULL is a log row.
      const keepState = spec.stateColumn
        ? ` AND COALESCE(${spec.stateColumn}, 0) = 0`
        : '';
      const cleared = await connection.execute(
        `DELETE FROM ${spec.table} WHERE session_id = ?${keepState}`,
        [sessionId]
      );
      // Keep the session's counter honest — it is a stored total, not a COUNT.
      await connection.execute(
        'UPDATE sessions SET event_count = MAX(0, event_count - ?) WHERE id = ?',
        [cleared, sessionId]
      );
    },
  };

  // Two repositories over one connection: a write that spans them — the event
  // counters on `sessions`, a session delete that removes event rows — is still
  // one `batch`, and so still one transaction.
  return { ready: awaitReady, events, sessions };
}

// ── Write statements ─────────────────────────────────────────────────────────

/**
 * Turn a batch into statements: one INSERT per new event, one UPDATE per patch,
 * and one counter bump per session touched.
 *
 * `INSERT OR REPLACE` (not plain INSERT) because a re-delivered event — a patched
 * row flushed twice across a reload, say — must land idempotently rather than
 * abort the whole transaction on a primary-key collision.
 */
function buildWriteStatements(batch: EventBatch): SqlStatement[] {
  const statements: SqlStatement[] = [];

  for (const event of batch.inserts) {
    const { spec, columns, values } = encodeEvent(event);
    const placeholders = columns.map(() => '?').join(', ');
    statements.push({
      sql: `INSERT OR REPLACE INTO ${spec.table} (${columns.join(', ')}) VALUES (${placeholders})`,
      params: values,
    });
  }

  for (const update of batch.updates) {
    const { spec, columns, values } = encodePatch(update.kind, update.patch);
    if (columns.length === 0) continue;
    const assignments = columns.map((column) => `${column} = ?`).join(', ');
    statements.push({
      sql: `UPDATE ${spec.table} SET ${assignments} WHERE id = ?`,
      params: [...values, update.id],
    });
  }

  for (const [sessionId, stats] of countBySession(batch.inserts)) {
    statements.push({
      sql:
        'UPDATE sessions SET event_count = event_count + ?, ' +
        'last_event_at = MAX(COALESCE(last_event_at, 0), ?) WHERE id = ?',
      params: [stats.count, stats.lastAt, sessionId],
    });
  }

  return statements;
}

function countBySession(
  events: BesouroEvent[]
): Map<string, { count: number; lastAt: number }> {
  const bySession = new Map<string, { count: number; lastAt: number }>();
  for (const event of events) {
    const existing = bySession.get(event.sessionId);
    if (existing) {
      existing.count += 1;
      existing.lastAt = Math.max(existing.lastAt, event.timestamp);
    } else {
      bySession.set(event.sessionId, {
        count: 1,
        lastAt: event.timestamp,
      });
    }
  }
  return bySession;
}

// ── Session counters ─────────────────────────────────────────────────────────

/**
 * The session's rows across all seven tables as one column of timestamps, for
 * the aggregates that have to see every table at once. Built from the manifest,
 * so a new event table joins it automatically; takes one bound session id per
 * table.
 */
function sessionRowsSql(): string {
  return ALL_TABLES.map(
    (spec) => `SELECT timestamp FROM ${spec.table} WHERE session_id = ?`
  ).join(' UNION ALL ');
}

/**
 * Set `event_count` and `last_event_at` to what the session's rows actually say.
 *
 * The counters are a stored total the writer increments, never a COUNT run on
 * read — that is what keeps the history list cheap however large a session gets.
 * This is the one statement that reconciles the total with the rows, for the two
 * cases an increment cannot reach: a session row created *after* rows were
 * written under its id (`onlyIfUncounted`, see {@link SessionRepository.save}),
 * and rows moved between sessions (`reassignEvents`).
 */
function recomputeCounters(
  sessionId: string,
  { onlyIfUncounted = false }: { onlyIfUncounted?: boolean } = {}
): SqlStatement {
  const rows = sessionRowsSql();
  const ids = ALL_TABLES.map(() => sessionId);
  return {
    sql:
      'UPDATE sessions SET ' +
      `event_count = (SELECT COUNT(*) FROM (${rows})), ` +
      `last_event_at = (SELECT MAX(timestamp) FROM (${rows})) ` +
      `WHERE id = ?${onlyIfUncounted ? ' AND event_count = 0' : ''}`,
    params: [...ids, ...ids, sessionId],
  };
}

// ── Read helpers ─────────────────────────────────────────────────────────────

/**
 * The WHERE clause for a page query, assembled per query shape rather than with
 * `? IS NULL OR ...` sentinels — those would stop SQLite using the
 * `(session_id, timestamp DESC, id DESC)` index, which is the entire reason paging
 * stays cheap as a session grows.
 */
function buildWhere(query: EventQuery): { where: string; params: SqlValue[] } {
  const clauses = ['session_id = ?'];
  const params: SqlValue[] = [query.sessionId];

  const spec = TABLES[query.kind];
  if (query.group != null && spec.groupColumn) {
    clauses.push(`${spec.groupColumn} = ?`);
    params.push(query.group);
  }

  if (query.where) {
    // Resolved through the manifest so a caller can never inject a column name.
    const column = spec.columns.find(
      (candidate) => candidate.field === query.where?.field
    );
    if (column) {
      clauses.push(`${column.column} = ?`);
      params.push(query.where.value);
    }
  }

  if (query.before) {
    // Strictly-older than the cursor, in the same order as the ORDER BY.
    clauses.push('(timestamp < ? OR (timestamp = ? AND id < ?))');
    params.push(
      query.before.timestamp,
      query.before.timestamp,
      query.before.id
    );
  }

  const search = buildSearch(query.kind, query.search);
  if (search) {
    clauses.push(search.clause);
    params.push(...search.params);
  }

  return { where: `WHERE ${clauses.join(' AND ')}`, params };
}

/**
 * The OR-of-LIKEs a text search compiles to, or null when there is nothing to
 * search for. Shared by the page query and the grouped aggregate so the two can't
 * disagree about which columns a search covers.
 */
/**
 * The `change_count` aggregate: how many of a group's rows the caller counts as a
 * change.
 *
 * Resolved through the manifest, like every other caller-supplied field, so a column
 * name can never come in from outside.
 *
 * A `bool` column gets two wrappers, and both are load-bearing. COALESCE, because
 * "not a baseline" has to include a row that never wrote the flag at all — a NULL
 * compares as neither 0 nor 1 and the row would silently stop counting. And CAST on
 * the parameter, because SQLite only applies a column's INTEGER affinity to the
 * other side of a comparison when that side *is* a bare column: wrapping it in
 * COALESCE makes it an expression, the bound `'0'` stays text, and `0 = '0'` is
 * false. That combination counted every group as zero until the CAST went in.
 *
 * With no `countWhere`, every row is a change and this is plain COUNT(*).
 */
function buildChangeCount(query: EventGroupQuery): {
  select: string;
  params: SqlValue[];
} {
  const field = query.countWhere?.field;
  const column = field
    ? TABLES[query.kind].columns.find((candidate) => candidate.field === field)
    : undefined;
  if (!column || !query.countWhere) {
    return { select: 'COUNT(*)', params: [] };
  }
  const test =
    column.type === 'bool'
      ? `COALESCE(${column.column}, 0) = CAST(? AS INTEGER)`
      : `${column.column} = ?`;
  return {
    select: `SUM(CASE WHEN ${test} THEN 1 ELSE 0 END)`,
    params: [query.countWhere.value],
  };
}

function buildSearch(
  kind: InspectorKind,
  search: string | undefined
): { clause: string; params: SqlValue[] } | null {
  const needle = search?.trim();
  if (!needle) return null;
  const columns = searchableColumns(TABLES[kind]);
  if (columns.length === 0) return null;

  const pattern = `%${escapeLike(needle.toLowerCase())}%`;
  const matches = columns.map((column) =>
    // Integer columns (a status code) are cast so a search for "404" works;
    // text and JSON columns are lowered to match the lowered needle.
    column.type === 'int'
      ? `CAST(${column.column} AS TEXT) LIKE ? ESCAPE '\\'`
      : `LOWER(${column.column}) LIKE ? ESCAPE '\\'`
  );
  return {
    clause: `(${matches.join(' OR ')})`,
    params: columns.map(() => pattern),
  };
}

/**
 * Neutralize LIKE's own wildcards so a search box behaves like substring search.
 * Without this, pasting a URL containing `_` would silently match any character.
 */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

/**
 * Newest row per group, as a map keyed by the group value.
 *
 * Done as a `GROUP BY` + self-join rather than `ROW_NUMBER()`: window functions
 * need SQLite 3.25 and Android API 24 ships ~3.9. Rows tying on the group's max
 * timestamp yield more than one row for that group; the first wins, which is
 * arbitrary but stable and only affects two frames logged in the same
 * millisecond.
 */
async function queryLatestPerGroup(
  connection: SqlConnection,
  query: EventGroupQuery,
  group: string,
  filter?: { field: string; value: string }
): Promise<Map<string, BesouroEvent>> {
  const spec = TABLES[query.kind];
  const columns = summaryColumns(spec)
    .map((column) => `t.${column.column}`)
    .join(', ');

  const filterColumn = filter
    ? spec.columns.find((column) => column.field === filter.field)?.column
    : undefined;
  const extra = filterColumn ? ` AND ${filterColumn} = ?` : '';
  const extraOuter = filterColumn ? ` AND t.${filterColumn} = ?` : '';
  const filterParams: SqlValue[] = filterColumn && filter ? [filter.value] : [];

  const rows = await connection.query(
    `SELECT ${columns} FROM ${spec.table} t ` +
      `JOIN (SELECT ${group} AS g, MAX(timestamp) AS mt FROM ${spec.table} ` +
      `WHERE session_id = ?${extra} GROUP BY ${group}) m ` +
      `ON t.${group} = m.g AND t.timestamp = m.mt ` +
      `WHERE t.session_id = ?${extraOuter}`,
    [query.sessionId, ...filterParams, query.sessionId, ...filterParams]
  );

  const latest = new Map<string, BesouroEvent>();
  for (const row of rows) {
    const key = String(row[group] ?? '');
    if (!latest.has(key)) latest.set(key, decodeRow(query.kind, row));
  }
  return latest;
}

function decodeSessionRow(row: SqlRow): SessionMeta {
  const meta: SessionMeta = {
    id: String(row.id ?? ''),
    startedAt: Number(row.started_at ?? 0),
    status: (row.status as SessionMeta['status']) ?? 'closed',
  };
  if (row.ended_at != null) meta.endedAt = Number(row.ended_at);
  if (row.last_event_at != null) meta.lastEventAt = Number(row.last_event_at);
  if (row.event_count != null) meta.eventCount = Number(row.event_count);
  if (row.app_version != null) meta.appVersion = String(row.app_version);
  const inspectors = decodeInspectors(row.inspectors);
  if (inspectors) meta.inspectors = inspectors;
  return meta;
}

function encodeInspectors(inspectors: Inspector[] | undefined): string | null {
  return inspectors ? JSON.stringify(inspectors) : null;
}

/**
 * The session's recorded inspector list, or undefined when the column is null or
 * holds anything but an array of strings.
 *
 * Structural only — the ids themselves are not checked against this version's
 * inspectors here. That is `sessionTabs`' call, so there is one place that
 * decides what is real rather than two that can disagree.
 */
function decodeInspectors(
  value: SqlValue | undefined
): Inspector[] | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return undefined;
    return parsed.filter(
      (entry): entry is Inspector => typeof entry === 'string'
    );
  } catch {
    // A hand-edited or truncated value: unknown, which the panel already handles.
    return undefined;
  }
}

export type { EventCursor, EventGroup, EventPage, EventQuery, InspectorKind };
