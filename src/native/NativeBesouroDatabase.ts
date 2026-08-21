import { TurboModuleRegistry, type TurboModule } from 'react-native';

/**
 * Dedicated TurboModule for the captured-event database — the persistence backend
 * for every inspector that records events. Kept separate from the `Besouro`
 * module (bubble/drawer/clipboard/share/settings files) and `BesouroFileSystem` (the
 * File System inspector's sandbox browser) so the three concerns evolve
 * independently.
 *
 * Backed by the SQLite each platform already ships — `libsqlite3` on iOS,
 * `Context.openOrCreateDatabase` on Android — so there is no dependency to add and
 * nothing for a consumer to link. The database lives in app-private storage, in
 * each platform's conventional place for one:
 *   Android: <databases>/rn-inapp-devtools-events.db
 *   iOS:     Library/Application Support/RNBesouro/events.db
 *            (excluded from iCloud/iTunes backup — captured logs are disposable
 *            and can grow large)
 *
 * The API is deliberately a thin, generic SQL port rather than an event-shaped one:
 * the schema, the queries and the row mapping all live in JS
 * (`core/database/`), so changing a column never means touching two native
 * implementations. See `core/database/port.ts` for the JS-side port this
 * backs.
 *
 * SQL dialect floor: Android's SQLite tracks the OS, and API 24 ships ~3.9 — so no
 * UPSERT (3.24) and no window functions (3.25). Statements built in JS must stay
 * within plain INSERT/UPDATE/DELETE/SELECT.
 *
 * Not available in Expo Go (custom native code needs a Dev Client / bare build);
 * the JS side treats a missing module as "no persistence" and keeps working from
 * memory.
 */
export interface Spec extends TurboModule {
  /**
   * Open the database, creating the file and its directory if needed, and apply
   * the connection pragmas (WAL journaling, `synchronous=NORMAL`). Idempotent —
   * calling it again on an open database resolves without reopening.
   *
   * Must resolve before any other method; the JS side awaits it once at install.
   */
  open(): Promise<void>;

  /**
   * Run one statement that returns no rows. `paramsJson` is a JSON-encoded array
   * of bind values, positional against the `?` placeholders in `sql`; JSON keeps
   * the null/number/string/boolean distinction intact across the bridge (booleans
   * bind as 0/1, matching how they are stored). Resolves the number of rows the
   * statement changed.
   */
  execute(sql: string, paramsJson: string): Promise<number>;

  /**
   * Run one statement that returns rows, bound as in {@link execute}. Resolves a
   * JSON-encoded array of row objects keyed by column name (mirroring the
   * JSON-string convention of `BesouroFileSystem`), with SQL NULL as JSON null.
   */
  query(sql: string, paramsJson: string): Promise<string>;

  /**
   * Run many statements inside a single transaction and a single bridge crossing.
   * `statementsJson` is a JSON-encoded `Array<{ sql: string; params: unknown[] }>`,
   * each element bound as in {@link execute}.
   *
   * This is the write path's whole reason for existing: a flush of captured events
   * is one call and one transaction instead of one per row, which is what makes
   * persistence O(delta) rather than O(session). The transaction rolls back whole
   * on any failing statement, so a partial flush never lands.
   */
  batch(statementsJson: string): Promise<void>;

  /**
   * {@link batch}, run **synchronously** — the JS thread blocks until the
   * transaction commits.
   *
   * Exists for one caller: the crash path. A fatal error hands control to RN's
   * exception manager, which tears the app down immediately, so the promise of an
   * async `batch` never gets a turn to resolve and the crash row is lost — the very
   * row the developer opened the drawer to find. Blocking is the point: the write
   * has to finish while the process is still alive.
   *
   * Nothing on the steady-state write path may call this. A synchronous SQLite
   * commit on the JS thread is exactly the stall the queue exists to avoid, and it
   * is affordable here only because the app is about to stop rendering anyway.
   *
   * Returns whether the transaction committed, and never throws: a crash handler
   * has nowhere to report to, and a throw here would mask the original error.
   */
  batchSync(statementsJson: string): boolean;
}

/**
 * `get` (not `getEnforcing`) so the export is `Spec | null` instead of throwing
 * when the module isn't linked (Expo Go / web / tests). The JS wrapper null-checks
 * once and turns persistence off; codegen guarantees every `Spec` method is present
 * on a non-null module.
 */
export default TurboModuleRegistry.get<Spec>('BesouroDatabase');
