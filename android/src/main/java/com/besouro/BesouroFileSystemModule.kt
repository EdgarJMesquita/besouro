package com.besouro

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * Dedicated native module for the File System inspector — read-only browsing of
 * the app's sandbox tree. Kept separate from [BesouroModule] (bubble / drawer
 * / persistence) so the two concerns evolve independently.
 *
 * Every method resolves a JSON string (mirroring [BesouroModule.readFile]).
 * All `path` arguments are confined to the sandbox roots below; a path that
 * escapes them (via `..` or symlink) is rejected before any file access.
 */
class BesouroFileSystemModule(reactContext: ReactApplicationContext) :
    NativeBesouroFileSystemSpec(reactContext) {

    override fun getName(): String = NAME

    /** The sandbox directories the browser may enter, resolved to canonical paths. */
    private val roots: List<Root> by lazy { resolveRoots() }

    private data class Root(val key: String, val label: String, val dir: File)

    private fun resolveRoots(): List<Root> {
        val context = reactApplicationContext
        val candidates = mutableListOf<Root>()
        context.filesDir?.let { candidates += Root("documents", "Documents", it) }
        context.cacheDir?.let { candidates += Root("cache", "Cache", it) }
        context.getExternalFilesDir(null)?.let {
            candidates += Root("external", "External Files", it)
        }
        // Canonicalize so containment checks compare resolved paths.
        return candidates.mapNotNull { root ->
            try {
                Root(root.key, root.label, root.dir.canonicalFile)
            } catch (_: Exception) {
                null
            }
        }
    }

    /**
     * Resolve `path` to a canonical file, or null if it falls outside every root.
     * Guards against `..` traversal and symlink escapes.
     */
    private fun resolveWithinRoots(path: String): File? {
        val target = try {
            File(path).canonicalFile
        } catch (_: Exception) {
            return null
        }
        val targetPath = target.path
        val allowed = roots.any { root ->
            targetPath == root.dir.path ||
                targetPath.startsWith(root.dir.path + File.separator)
        }
        return if (allowed) target else null
    }

    override fun listRoots(promise: Promise) {
        try {
            val array = JSONArray()
            for (root in roots) {
                if (!root.dir.exists()) continue
                array.put(
                    JSONObject()
                        .put("key", root.key)
                        .put("label", root.label)
                        .put("path", root.dir.path)
                )
            }
            promise.resolve(array.toString())
        } catch (error: Exception) {
            promise.reject(NAME, error)
        }
    }

    override fun listDirectory(path: String, promise: Promise) {
        try {
            val dir = resolveWithinRoots(path)
            if (dir == null || !dir.isDirectory) {
                promise.resolve("[]")
                return
            }
            val array = JSONArray()
            dir.listFiles()?.forEach { child ->
                array.put(entryJson(child))
            }
            promise.resolve(array.toString())
        } catch (error: Exception) {
            promise.reject(NAME, error)
        }
    }

    override fun statPath(path: String, promise: Promise) {
        try {
            val file = resolveWithinRoots(path)
            if (file == null) {
                promise.resolve(JSONObject().put("exists", false).toString())
                return
            }
            promise.resolve(entryJson(file).put("exists", file.exists()).toString())
        } catch (error: Exception) {
            promise.reject(NAME, error)
        }
    }

    override fun readFileAtPath(path: String, maxBytes: Double, promise: Promise) {
        try {
            val file = resolveWithinRoots(path)
            if (file == null || !file.isFile) {
                promise.resolve(null)
                return
            }
            // Refuse oversized reads so a large file never lands in JS.
            if (file.length() > maxBytes.toLong()) {
                promise.resolve(null)
                return
            }
            promise.resolve(file.readText(Charsets.UTF_8))
        } catch (error: Exception) {
            // Not readable as UTF-8 (binary) or IO failure — degrade to null.
            promise.resolve(null)
        }
    }

    private fun entryJson(file: File): JSONObject =
        JSONObject()
            .put("name", file.name)
            .put("path", file.path)
            .put("isDirectory", file.isDirectory)
            .put("sizeBytes", file.length())
            .put("modifiedAt", file.lastModified())

    companion object {
        const val NAME = NativeBesouroFileSystemSpec.NAME
    }
}
