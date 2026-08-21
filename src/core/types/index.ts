/**
 * Core type model shared by every inspector and the UI.
 *
 * A single {@link BesouroEvent} discriminated union (on `kind`) flows into the
 * shared store; each inspector contributes one member of that union.
 *
 * Split by concern across this folder — `base` (identifiers), `events` (the union),
 * `session` (persistence), `options` (consumer config) — and re-exported here, so
 * `core/types` stays a single import site for everything downstream.
 *
 * The File System inspector's types are not here: it browses the sandbox on demand
 * rather than capturing events, so nothing it describes enters the store. They live
 * in `inspectors/fileSystem/types.ts`.
 */

export * from './base';
export * from './events';
export * from './session';
export * from './options';
