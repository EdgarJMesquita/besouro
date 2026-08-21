package com.besouro

import android.content.Context
import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * Captured-event database, backed by the SQLite the platform already ships
 * ([Context.openOrCreateDatabase] — no dependency to add, nothing to link).
 * Mirrors the iOS BesouroDatabase.
 *
 * This is a thin, generic SQL port: the schema, the queries and the row mapping all
 * live in JS (`core/persistence/`), so a column change never touches native code.
 *
 * Threading: every method runs on one single-thread executor, so the
 * [SQLiteDatabase] handle has exactly one owner and a flush can never interleave
 * with a page read mid-transaction. The methods are all promise-returning, so the
 * hop is invisible to JS.
 *
 * SQL dialect floor: the framework's SQLite tracks the OS, and API 24 ships ~3.9 —
 * no UPSERT (3.24), no window functions (3.25). The JS side stays within plain
 * INSERT/UPDATE/DELETE/SELECT.
 */
class BesouroDatabaseModule(reactContext: ReactApplicationContext) :
    NativeBesouroDatabaseSpec(reactContext) {

    override fun getName(): String = NAME

    /** Serializes all database access; see the threading note above. */
    private val executor = Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "BesouroDatabase")
    }

    @Volatile
    private var database: SQLiteDatabase? = null

    override fun invalidate() {
        // Close on the executor so we can't free the handle mid-statement.
        val db = database
        database = null
        executor.execute {
            try {
                db?.close()
            } catch (_: Exception) {
                // Teardown is best-effort.
            }
        }
        executor.shutdown()
        super.invalidate()
    }

    override fun open(promise: Promise) {
        executor.execute {
            try {
                if (database != null) {
                    promise.resolve(null) // Idempotent — already open.
                    return@execute
                }
                val db = reactApplicationContext.openOrCreateDatabase(
                    DATABASE_NAME,
                    Context.MODE_PRIVATE,
                    null
                )
                // WAL lets reads (the drawer paging) proceed while a flush writes;
                // synchronous=NORMAL trades an fsync per commit for throughput,
                // which is the right call for capture data that is reconstructible
                // by definition.
                db.enableWriteAheadLogging()
                db.execSQL("PRAGMA synchronous=NORMAL")
                database = db
                promise.resolve(null)
            } catch (error: Exception) {
                promise.reject(NAME, error)
            }
        }
    }

    override fun execute(sql: String, paramsJson: String, promise: Promise) {
        executor.execute {
            try {
                val db = requireDatabase()
                val params = parseJsonArray(paramsJson)
                promise.resolve(runStatement(db, sql, params))
            } catch (error: Exception) {
                promise.reject(NAME, error)
            }
        }
    }

    override fun query(sql: String, paramsJson: String, promise: Promise) {
        executor.execute {
            try {
                val db = requireDatabase()
                val params = parseJsonArray(paramsJson)
                db.rawQuery(sql, selectionArgs(params)).use { cursor ->
                    promise.resolve(rowsToJson(cursor).toString())
                }
            } catch (error: Exception) {
                promise.reject(NAME, error)
            }
        }
    }

    override fun batch(statementsJson: String, promise: Promise) {
        executor.execute {
            try {
                runBatch(requireDatabase(), parseJsonArray(statementsJson))
                promise.resolve(null)
            } catch (error: Exception) {
                promise.reject(NAME, error)
            }
        }
    }

    /**
     * [batch], run synchronously — the JS thread blocks here until the transaction
     * commits. Only the crash path calls it: a fatal error tears the app down
     * before any promise can resolve, so the crash row has to be written while the
     * process is still alive.
     *
     * Still goes through the executor (submit + [Future.get]) rather than touching
     * the handle directly, so the single-owner threading contract holds even here —
     * a crash landing mid-flush waits for that flush instead of interleaving with
     * it. The wait is bounded: a stuck executor must not turn a crash into an ANR,
     * and losing the row is the better failure.
     */
    override fun batchSync(statementsJson: String): Boolean {
        return try {
            val task = executor.submit<Boolean> {
                runBatch(requireDatabase(), parseJsonArray(statementsJson))
                true
            }
            task.get(SYNC_BATCH_TIMEOUT_MS, TimeUnit.MILLISECONDS)
        } catch (_: Exception) {
            // Never throws: the caller is a crash handler with nowhere to report,
            // and a throw here would mask the error being recorded.
            false
        }
    }

    // ── Internals ────────────────────────────────────────────────────────────

    /** One transaction of statements. Callers must already be on [executor]. */
    private fun runBatch(db: SQLiteDatabase, statements: JSONArray) {
        if (statements.length() == 0) return
        db.beginTransaction()
        try {
            for (i in 0 until statements.length()) {
                val entry = statements.optJSONObject(i) ?: continue
                val sql = entry.optString("sql", "")
                if (sql.isEmpty()) continue
                val params = entry.optJSONArray("params") ?: JSONArray()
                runStatement(db, sql, params)
            }
            db.setTransactionSuccessful()
        } finally {
            // Without setTransactionSuccessful this rolls the whole flush back — a
            // half-applied batch would leave rows the JS side believes it has
            // already written.
            db.endTransaction()
        }
    }

    private fun requireDatabase(): SQLiteDatabase =
        database ?: throw IllegalStateException("database is not open")

    private fun parseJsonArray(json: String): JSONArray =
        if (json.isEmpty()) JSONArray() else JSONArray(json)

    /**
     * Run one statement with typed binding, returning the rows it changed (0 for
     * anything that isn't DML). [android.database.sqlite.SQLiteStatement] is used
     * rather than `execSQL` because it binds longs/doubles/strings/nulls with their
     * real types — which matters on the write path, where a timestamp bound as text
     * would be stored as text.
     */
    private fun runStatement(db: SQLiteDatabase, sql: String, params: JSONArray): Int {
        db.compileStatement(sql).use { statement ->
            for (i in 0 until params.length()) {
                val index = i + 1 // sqlite bind indexes are 1-based
                when (val value = params.get(i)) {
                    JSONObject.NULL -> statement.bindNull(index)
                    // SQLite has no boolean type; the JS row mappers read these
                    // back as integers.
                    is Boolean -> statement.bindLong(index, if (value) 1L else 0L)
                    is Int -> statement.bindLong(index, value.toLong())
                    is Long -> statement.bindLong(index, value)
                    is Double -> statement.bindDouble(index, value)
                    is String -> statement.bindString(index, value)
                    // Arrays/objects are never bound directly — the JS side
                    // stringifies them into text columns first. Treat anything else
                    // as NULL rather than guessing.
                    else -> statement.bindNull(index)
                }
            }
            val verb = sql.trimStart().takeWhile { !it.isWhitespace() }.uppercase()
            return if (verb in DML_VERBS) {
                statement.executeUpdateDelete()
            } else {
                statement.execute()
                0
            }
        }
    }

    /**
     * Bind values for [SQLiteDatabase.rawQuery], which only accepts strings.
     *
     * Numbers are safe to stringify here because every column they are compared
     * against is declared INTEGER: SQLite applies the column's numeric affinity to
     * a text operand before comparing, so `timestamp < '1699999999'` evaluates
     * numerically, not lexicographically. That guarantee is why the schema declares
     * `timestamp INTEGER` rather than leaving it untyped — and why `LIMIT` is
     * written as a literal in the generated SQL instead of being bound.
     */
    private fun selectionArgs(params: JSONArray): Array<String?> =
        Array(params.length()) { i ->
            when (val value = params.get(i)) {
                JSONObject.NULL -> null
                is Boolean -> if (value) "1" else "0"
                else -> value.toString()
            }
        }

    private fun rowsToJson(cursor: Cursor): JSONArray {
        val rows = JSONArray()
        val columnCount = cursor.columnCount
        while (cursor.moveToNext()) {
            val row = JSONObject()
            for (i in 0 until columnCount) {
                val name = cursor.getColumnName(i)
                when (cursor.getType(i)) {
                    Cursor.FIELD_TYPE_INTEGER -> row.put(name, cursor.getLong(i))
                    Cursor.FIELD_TYPE_FLOAT -> row.put(name, cursor.getDouble(i))
                    Cursor.FIELD_TYPE_STRING -> row.put(name, cursor.getString(i))
                    // Nothing in the schema stores BLOBs (image previews are base64
                    // text), so one would mean a schema/mapper mismatch — surface it
                    // as null rather than inventing an encoding.
                    else -> row.put(name, JSONObject.NULL)
                }
            }
            rows.put(row)
        }
        return rows
    }

    companion object {
        const val NAME = NativeBesouroDatabaseSpec.NAME
        private const val DATABASE_NAME = "besouro.db"

        /** How long [batchSync] waits for the executor before giving up. */
        private const val SYNC_BATCH_TIMEOUT_MS = 2_000L

        private val DML_VERBS = setOf("INSERT", "UPDATE", "DELETE", "REPLACE")
    }
}
