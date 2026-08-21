/**
 * The column manifest is pinned against {@link SCHEMA_VERSION}.
 *
 * `migrate` only drops and recreates when the stored version *differs*, and every
 * CREATE is `IF NOT EXISTS`. So a column added without a version bump never
 * reaches a database that already stored this version: the table stays as it was,
 * every insert fails on the missing column, and after
 * {@link MAX_CONSECUTIVE_FAILURES} the queue disables itself and the drawer says
 * "Devtools stopped recording" — on every launch, with nothing to explain it.
 *
 * It is an easy mistake precisely when it looks safest: adding a column to a table
 * that was itself introduced earlier in the same unreleased branch feels free,
 * because "the schema is being reset anyway" — but any device that already ran the
 * branch has stored the version and will not reset again.
 *
 * So this test fails on *any* manifest change. When it does, change both numbers
 * below: bump `SCHEMA_VERSION`, then paste the printed fingerprint here.
 */

import { describe, it, expect } from '@jest/globals';
import { SCHEMA_VERSION } from '../schema';
import { ALL_TABLES, allColumns } from '../rows';

/**
 * Every table, column, SQL type and heavy/searchable flag, flattened and sorted —
 * everything that changes what the DDL or the row mappers produce.
 */
function manifestFingerprint(): string {
  return ALL_TABLES.map((spec) => {
    const columns = allColumns(spec)
      .map(
        (column) =>
          `${column.column}:${column.type}` +
          `${column.heavy ? ':heavy' : ''}${column.searchable ? ':search' : ''}`
      )
      .join(',');
    return `${spec.table}(${spec.groupColumn ?? '-'})[${columns}]`;
  })
    .sort()
    .join('|');
}

/** Update together with SCHEMA_VERSION — never one without the other. */
const PINNED = {
  version: 10,
  fingerprint:
    'async_storage(-)[id:text,session_id:text,timestamp:int,operation:text:search,keys:json:search,direction:text,duration_ms:int,error:text,value:text:heavy:search,value_truncated:bool:heavy]|console(-)[id:text,session_id:text,timestamp:int,level:text,message:text:search,fatal:bool,stack:text:heavy,message_truncated:bool]|jotai(atom_id)[id:text,session_id:text,timestamp:int,atom_id:text,atom_name:text:search,is_initial:bool,is_reload:bool,changed_keys:json,preview:text:search,value:text:heavy:search,value_truncated:bool:heavy]|mmkv(instance_id)[id:text,session_id:text,timestamp:int,instance_id:text,instance_name:text:search,operation:text:search,key:text:search,value_type:text,direction:text,is_final:bool,error:text,value:text:heavy:search,value_truncated:bool:heavy]|network(-)[id:text,session_id:text,timestamp:int,method:text:search,url:text:search,status:int:search,phase:text,duration_ms:int,request_size_bytes:int,response_size_bytes:int,error:text,request_headers:json:heavy,response_headers:json:heavy,request_body:text:heavy,request_body_truncated:bool:heavy,response_body:text:heavy,response_body_truncated:bool:heavy,response_image_uri:text:heavy]|notification(-)[id:text,session_id:text,timestamp:int,provider:text,phase:text,origin:text,title:text:search,body:text:search,foreground:bool,message_id:text,data:text:heavy:search,data_truncated:bool:heavy]|redux(-)[id:text,session_id:text,timestamp:int,action_type:text:search,is_initial:bool,is_reload:bool,is_final:bool,state_is_full:bool,changed_keys:json,changed_paths:json,payload:text:heavy:search,payload_truncated:bool:heavy,changed_state:text:heavy:search,changed_state_truncated:bool:heavy]|socketio(client_id)[id:text,session_id:text,timestamp:int,client_id:text,namespace:text:search,url:text:search,direction:text,event:text:search,has_ack:bool,args:text:heavy:search,args_truncated:bool:heavy]|websocket(connection_id)[id:text,session_id:text,timestamp:int,connection_id:text,url:text:search,direction:text,type:text:search,close_code:int,close_reason:text,error:text,payload:text:heavy:search,payload_truncated:bool:heavy]|zustand(store_id)[id:text,session_id:text,timestamp:int,store_id:text,store_name:text:search,is_initial:bool,is_reload:bool,changed_keys:json,state:text:heavy:search,state_truncated:bool:heavy]',
};

describe('schema manifest', () => {
  it('has not changed without a SCHEMA_VERSION bump', () => {
    // If this fails, the manifest changed. Bump SCHEMA_VERSION and update PINNED
    // with the received value — a devtool's captured logs are disposable, but a
    // schema that silently does not match the database is not.
    expect({
      version: SCHEMA_VERSION,
      fingerprint: manifestFingerprint(),
    }).toEqual(PINNED);
  });
});
