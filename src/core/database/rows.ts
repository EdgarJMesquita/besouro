/**
 * The single source of truth for how each captured event maps to a SQL row.
 *
 * One manifest per inspector kind describes its table, its columns, which of them
 * are *heavy* (never selected for a list, fetched only when a detail view opens),
 * and which are searchable. The schema DDL (`./schema.ts`), the encode/decode
 * mappers below, and the summary types the UI renders are all derived from these —
 * so a column can't exist in the table but be missing from the mapper, or be
 * dropped from a list query but still cost memory.
 *
 * Column names are snake_case (SQL convention); event fields stay camelCase.
 */

import type { BesouroEvent, InspectorKind } from '../types';
import type { SqlRow, SqlValue } from './sql-connection';

/**
 * How a value crosses the JS/SQL boundary.
 * - `text`   → TEXT, `string | undefined`
 * - `int`    → INTEGER, `number | undefined`
 * - `bool`   → INTEGER 0/1, `boolean | undefined`
 * - `json`   → TEXT holding `JSON.stringify(value)`, for the few array fields
 *
 * There is deliberately no `real`: every numeric field in the event model is a
 * millisecond duration, a byte count or a status code.
 */
export type ColumnType = 'text' | 'int' | 'bool' | 'json';

export interface ColumnSpec {
  /** SQL column name. */
  column: string;
  /** Event field this column stores. */
  field: string;
  type: ColumnType;
  /**
   * Excluded from list queries. Bodies, headers, payloads and base64 image
   * previews live here — they are what would otherwise dominate the JS heap.
   * Still searchable: a WHERE may reference a heavy column without selecting it,
   * so search covers response bodies without ever loading one.
   */
  heavy?: boolean;
  /** Included in the tab's SQL search predicate. */
  searchable?: boolean;
}

export interface TableSpec {
  kind: InspectorKind;
  table: string;
  columns: ColumnSpec[];
  /**
   * Column the tab's sub-lists group and filter by — the WebSocket/Socket.IO
   * connection list, the Zustand per-store history, and the MMKV per-instance
   * log. Absent for the flat tabs (network, console, notifications,
   * asyncStorage).
   */
  groupColumn?: string;
  /**
   * Column marking a row as the inspector's **state** rather than a log entry:
   * the MMKV Store pane's contents and the Redux State pane's tree, one row per
   * group per session, patched in place for as long as the app runs.
   *
   * Named here because Clear is the one operation that has to tell the two
   * apart. It empties the log; the state row describes what the app *currently
   * holds*, which no button in a devtool has cleared — deleting it reads as the
   * store itself having been wiped, and leaves the pane empty for the rest of the
   * session, since the interceptor goes on patching a row that is no longer
   * there.
   */
  stateColumn?: string;
}

/**
 * Columns every event table carries. `kind` is deliberately not among them: the
 * table already identifies it, and {@link decodeRow} stamps it back on.
 */
export const BASE_COLUMNS: ColumnSpec[] = [
  { column: 'id', field: 'id', type: 'text' },
  { column: 'session_id', field: 'sessionId', type: 'text' },
  { column: 'timestamp', field: 'timestamp', type: 'int' },
];

const network: TableSpec = {
  kind: 'network',
  table: 'network',
  columns: [
    { column: 'method', field: 'method', type: 'text', searchable: true },
    { column: 'url', field: 'url', type: 'text', searchable: true },
    { column: 'status', field: 'status', type: 'int', searchable: true },
    { column: 'phase', field: 'phase', type: 'text' },
    { column: 'duration_ms', field: 'durationMs', type: 'int' },
    { column: 'request_size_bytes', field: 'requestSizeBytes', type: 'int' },
    { column: 'response_size_bytes', field: 'responseSizeBytes', type: 'int' },
    { column: 'error', field: 'error', type: 'text' },
    {
      column: 'request_headers',
      field: 'requestHeaders',
      type: 'json',
      heavy: true,
    },
    {
      column: 'response_headers',
      field: 'responseHeaders',
      type: 'json',
      heavy: true,
    },
    { column: 'request_body', field: 'requestBody', type: 'text', heavy: true },
    {
      column: 'request_body_truncated',
      field: 'requestBodyTruncated',
      type: 'bool',
      heavy: true,
    },
    {
      column: 'response_body',
      field: 'responseBody',
      type: 'text',
      heavy: true,
    },
    {
      column: 'response_body_truncated',
      field: 'responseBodyTruncated',
      type: 'bool',
      heavy: true,
    },
    {
      column: 'response_image_uri',
      field: 'responseImageUri',
      type: 'text',
      heavy: true,
    },
  ],
};

const websocket: TableSpec = {
  kind: 'websocket',
  table: 'websocket',
  groupColumn: 'connection_id',
  columns: [
    { column: 'connection_id', field: 'connectionId', type: 'text' },
    { column: 'url', field: 'url', type: 'text', searchable: true },
    { column: 'direction', field: 'direction', type: 'text' },
    { column: 'type', field: 'type', type: 'text', searchable: true },
    { column: 'close_code', field: 'closeCode', type: 'int' },
    { column: 'close_reason', field: 'closeReason', type: 'text' },
    { column: 'error', field: 'error', type: 'text' },
    {
      column: 'payload',
      field: 'payload',
      type: 'text',
      heavy: true,
      searchable: true,
    },
    {
      column: 'payload_truncated',
      field: 'payloadTruncated',
      type: 'bool',
      heavy: true,
    },
  ],
};

const socketio: TableSpec = {
  kind: 'socketio',
  table: 'socketio',
  groupColumn: 'client_id',
  columns: [
    { column: 'client_id', field: 'clientId', type: 'text' },
    { column: 'namespace', field: 'namespace', type: 'text', searchable: true },
    { column: 'url', field: 'url', type: 'text', searchable: true },
    { column: 'direction', field: 'direction', type: 'text' },
    { column: 'event', field: 'event', type: 'text', searchable: true },
    { column: 'has_ack', field: 'hasAck', type: 'bool' },
    {
      column: 'args',
      field: 'args',
      type: 'text',
      heavy: true,
      searchable: true,
    },
    {
      column: 'args_truncated',
      field: 'argsTruncated',
      type: 'bool',
      heavy: true,
    },
  ],
};

const consoleTable: TableSpec = {
  kind: 'console',
  table: 'console',
  columns: [
    { column: 'level', field: 'level', type: 'text' },
    { column: 'message', field: 'message', type: 'text', searchable: true },
    { column: 'fatal', field: 'fatal', type: 'bool' },
    { column: 'stack', field: 'stack', type: 'text', heavy: true },
    { column: 'message_truncated', field: 'messageTruncated', type: 'bool' },
  ],
};

const notification: TableSpec = {
  kind: 'notification',
  table: 'notification',
  columns: [
    { column: 'provider', field: 'provider', type: 'text' },
    { column: 'phase', field: 'phase', type: 'text' },
    { column: 'origin', field: 'origin', type: 'text' },
    { column: 'title', field: 'title', type: 'text', searchable: true },
    { column: 'body', field: 'body', type: 'text', searchable: true },
    { column: 'foreground', field: 'foreground', type: 'bool' },
    { column: 'notification_id', field: 'notificationId', type: 'text' },
    {
      column: 'data',
      field: 'data',
      type: 'text',
      heavy: true,
      searchable: true,
    },
    {
      column: 'data_truncated',
      field: 'dataTruncated',
      type: 'bool',
      heavy: true,
    },
  ],
};

const asyncStorage: TableSpec = {
  kind: 'asyncStorage',
  table: 'async_storage',
  columns: [
    { column: 'operation', field: 'operation', type: 'text', searchable: true },
    { column: 'keys', field: 'keys', type: 'json', searchable: true },
    { column: 'direction', field: 'direction', type: 'text' },
    { column: 'duration_ms', field: 'durationMs', type: 'int' },
    { column: 'error', field: 'error', type: 'text' },
    {
      column: 'value',
      field: 'value',
      type: 'text',
      heavy: true,
      searchable: true,
    },
    {
      column: 'value_truncated',
      field: 'valueTruncated',
      type: 'bool',
      heavy: true,
    },
  ],
};

/**
 * `key` is safe as a column name here: SQLite allows KEY as an identifier, and the
 * `meta` table already relies on that.
 */
const mmkv: TableSpec = {
  kind: 'mmkv',
  table: 'mmkv',
  groupColumn: 'instance_id',
  stateColumn: 'is_final',
  columns: [
    { column: 'instance_id', field: 'instanceId', type: 'text' },
    {
      column: 'instance_name',
      field: 'instanceName',
      type: 'text',
      searchable: true,
    },
    { column: 'operation', field: 'operation', type: 'text', searchable: true },
    { column: 'key', field: 'key', type: 'text', searchable: true },
    { column: 'value_type', field: 'valueType', type: 'text' },
    { column: 'direction', field: 'direction', type: 'text' },
    { column: 'is_final', field: 'isFinal', type: 'bool' },
    { column: 'error', field: 'error', type: 'text' },
    {
      column: 'value',
      field: 'value',
      type: 'text',
      heavy: true,
      searchable: true,
    },
    {
      column: 'value_truncated',
      field: 'valueTruncated',
      type: 'bool',
      heavy: true,
    },
  ],
};

const zustand: TableSpec = {
  kind: 'zustand',
  table: 'zustand',
  groupColumn: 'store_id',
  columns: [
    { column: 'store_id', field: 'storeId', type: 'text' },
    {
      column: 'store_name',
      field: 'storeName',
      type: 'text',
      searchable: true,
    },
    { column: 'is_initial', field: 'isInitial', type: 'bool' },
    { column: 'is_reload', field: 'isReload', type: 'bool' },
    { column: 'changed_keys', field: 'changedKeys', type: 'json' },
    {
      column: 'state',
      field: 'state',
      type: 'text',
      heavy: true,
      searchable: true,
    },
    {
      column: 'state_truncated',
      field: 'stateTruncated',
      type: 'bool',
      heavy: true,
    },
  ],
};

/**
 * No `groupColumn`: the Redux tab is a flat action log, not a grouped list. There
 * is one store, so the only candidate to group by would be `action_type`, which
 * would bury the chronology the log exists to show.
 */
const redux: TableSpec = {
  kind: 'redux',
  table: 'redux',
  stateColumn: 'is_final',
  columns: [
    {
      column: 'action_type',
      field: 'actionType',
      type: 'text',
      searchable: true,
    },
    { column: 'is_initial', field: 'isInitial', type: 'bool' },
    { column: 'is_reload', field: 'isReload', type: 'bool' },
    // Summary, not heavy: the archived State view finds its row with an equality
    // filter on this column, which a list query has to be able to see.
    { column: 'is_final', field: 'isFinal', type: 'bool' },
    { column: 'state_is_full', field: 'stateIsFull', type: 'bool' },
    { column: 'changed_keys', field: 'changedKeys', type: 'json' },
    // Summary, not heavy: it is the action log's subtitle, read on every row.
    { column: 'changed_paths', field: 'changedPaths', type: 'json' },
    {
      column: 'payload',
      field: 'payload',
      type: 'text',
      heavy: true,
      searchable: true,
    },
    {
      column: 'payload_truncated',
      field: 'payloadTruncated',
      type: 'bool',
      heavy: true,
    },
    {
      column: 'changed_state',
      field: 'changedState',
      type: 'text',
      heavy: true,
      searchable: true,
    },
    {
      column: 'changed_state_truncated',
      field: 'changedStateTruncated',
      type: 'bool',
      heavy: true,
    },
  ],
};

const jotai: TableSpec = {
  kind: 'jotai',
  table: 'jotai',
  groupColumn: 'atom_id',
  columns: [
    { column: 'atom_id', field: 'atomId', type: 'text' },
    { column: 'atom_name', field: 'atomName', type: 'text', searchable: true },
    { column: 'is_initial', field: 'isInitial', type: 'bool' },
    { column: 'is_reload', field: 'isReload', type: 'bool' },
    { column: 'changed_keys', field: 'changedKeys', type: 'json' },
    // Summary, not heavy: it is what a history row renders, and the full value
    // beside it is exactly the column a list query must not drag in.
    { column: 'preview', field: 'preview', type: 'text', searchable: true },
    {
      column: 'value',
      field: 'value',
      type: 'text',
      heavy: true,
      searchable: true,
    },
    {
      column: 'value_truncated',
      field: 'valueTruncated',
      type: 'bool',
      heavy: true,
    },
  ],
};

/** Every persisted kind, keyed by {@link InspectorKind}. */
export const TABLES: Record<InspectorKind, TableSpec> = {
  network,
  websocket,
  socketio,
  console: consoleTable,
  notification,
  asyncStorage,
  mmkv,
  zustand,
  redux,
  jotai,
};

export const ALL_TABLES: TableSpec[] = Object.values(TABLES);

/** Every column of a table, base columns first. */
export function allColumns(spec: TableSpec): ColumnSpec[] {
  return [...BASE_COLUMNS, ...spec.columns];
}

/** The columns a list query selects — everything except the heavy ones. */
export function summaryColumns(spec: TableSpec): ColumnSpec[] {
  return allColumns(spec).filter((column) => !column.heavy);
}

/** Columns a text search matches against. */
export function searchableColumns(spec: TableSpec): ColumnSpec[] {
  return spec.columns.filter((column) => column.searchable);
}

// ── Encoding ─────────────────────────────────────────────────────────────────

function encodeValue(value: unknown, type: ColumnType): SqlValue {
  if (value === undefined || value === null) return null;
  switch (type) {
    case 'text':
      return typeof value === 'string' ? value : String(value);
    case 'int':
      return typeof value === 'number' && Number.isFinite(value) ? value : null;
    case 'bool':
      return value ? 1 : 0;
    case 'json':
      try {
        return JSON.stringify(value);
      } catch {
        return null;
      }
  }
}

function decodeValue(value: SqlValue | undefined, type: ColumnType): unknown {
  if (value === null || value === undefined) return undefined;
  switch (type) {
    case 'text':
      return typeof value === 'string' ? value : String(value);
    case 'int':
      return typeof value === 'number' ? value : Number(value);
    case 'bool':
      return Boolean(value);
    case 'json':
      try {
        return typeof value === 'string' ? JSON.parse(value) : undefined;
      } catch {
        return undefined;
      }
  }
}

/**
 * An event as column/value pairs, ready for an INSERT. Columns are in manifest
 * order, so callers can cache the column list and reuse it across a batch.
 */
export function encodeEvent(event: BesouroEvent): {
  spec: TableSpec;
  columns: string[];
  values: SqlValue[];
} {
  const spec = TABLES[event.kind];
  const columns = allColumns(spec);
  const source = event as unknown as Record<string, unknown>;
  return {
    spec,
    columns: columns.map((column) => column.column),
    values: columns.map((column) =>
      encodeValue(source[column.field], column.type)
    ),
  };
}

/**
 * A partial event as column/value pairs, for an UPDATE. Only fields present on
 * the patch are included — `undefined` means "not part of this patch", so a patch
 * never blanks a column it doesn't mention. Clearing a column is expressed by an
 * explicit `null` (which is how the network inspector drops an evicted image).
 */
export function encodePatch(
  kind: InspectorKind,
  patch: Partial<BesouroEvent>
): { spec: TableSpec; columns: string[]; values: SqlValue[] } {
  const spec = TABLES[kind];
  const source = patch as unknown as Record<string, unknown>;
  const columns: string[] = [];
  const values: SqlValue[] = [];
  for (const column of allColumns(spec)) {
    if (!(column.field in source)) continue;
    // Never rewrite identity/routing columns from a patch.
    if (column.field === 'id' || column.field === 'sessionId') continue;
    columns.push(column.column);
    values.push(encodeValue(source[column.field], column.type));
  }
  return { spec, columns, values };
}

/**
 * Rebuild an event from a row. Works for both a summary row (heavy columns simply
 * absent, so their fields stay undefined) and a full row, which is what lets the
 * same mapper serve list queries and detail fetches.
 */
export function decodeRow(kind: InspectorKind, row: SqlRow): BesouroEvent {
  const spec = TABLES[kind];
  const event: Record<string, unknown> = { kind };
  for (const column of allColumns(spec)) {
    if (!(column.column in row)) continue;
    const decoded = decodeValue(row[column.column], column.type);
    if (decoded !== undefined) {
      event[column.field] = decoded;
    }
  }
  return event as unknown as BesouroEvent;
}
