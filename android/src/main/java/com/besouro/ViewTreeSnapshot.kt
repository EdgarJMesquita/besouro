package com.besouro

import android.app.Activity
import android.graphics.Outline
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.TextView
import androidx.fragment.app.FragmentActivity
import java.util.IdentityHashMap
import org.json.JSONArray
import org.json.JSONObject

/**
 * The whole native view tree under the app's React root, for the View Hierarchy
 * tab (SPEC §6.12).
 *
 * This is [ElementPicker.hitPath] with the point test removed: the same descent,
 * the same origin bookkeeping, the same dp conversion, the same skip rules — it
 * just visits every child instead of the first one under the finger. That is what
 * makes the tab cheap and what keeps it working in a release build: it reads only
 * plain platform getters, never React Native's internals.
 *
 * The tree is emitted **flat**, each node carrying its `depth`, and rebuilt into a
 * tree in JS. Codegen cannot express a recursive struct, and a flat array is what
 * a virtualized list wants anyway.
 *
 * UI thread only — [BesouroModule] does the hop.
 */
internal object ViewTreeSnapshot {

    /**
     * Where the walk gives up.
     *
     * A ceiling, not a budget. The job is to draw the screen as it is, so this
     * sits far above any tree that could be one: a measured screen is ~120 views
     * at ~19KB and ~5ms, so 50k is three orders of magnitude of headroom and
     * still bounded — a devtool must not hang the app it is inspecting, and an
     * unbounded walk over a corrupt or cyclic view graph would.
     *
     * Reaching it is reported rather than hidden: what comes back is a valid
     * prefix of the tree, and `truncated` says so on the payload.
     */
    private const val MAX_NODES = 50000

    /**
     * Cap on a captured string. Long enough to recognise a label, short enough
     * that a screen full of paragraphs can't turn the payload into the thing we
     * measured it to avoid being.
     */
    private const val MAX_TEXT = 120

    /**
     * Cut on a character boundary rather than a UTF-16 one.
     *
     * `take` counts code units, so a label whose 120th unit lands inside an emoji
     * or a combining sequence comes back with half a character — a lone surrogate
     * that then has to survive JSON encoding and `JSON.parse` on the other side.
     */
    private fun truncate(text: String): String {
        if (text.length <= MAX_TEXT) return text
        val end =
            if (Character.isLowSurrogate(text[MAX_TEXT])) MAX_TEXT - 1 else MAX_TEXT
        return text.substring(0, end)
    }

    /**
     * The snapshot as a JSON string.
     *
     * A string rather than a codegen struct array on purpose: it is the escape
     * hatch we would reach for anyway if node counts turn out high, it costs
     * nothing to parse at these sizes, and it makes the payload directly
     * measurable — `.length` in JS is the byte count this feature puts on the
     * bridge.
     */
    fun capture(activity: Activity, density: Float): String {
        val content = activity.findViewById<FrameLayout>(android.R.id.content)
        val root = content?.getChildAt(0)
        val nodes = JSONArray()
        val result = JSONObject()
        result.put("nodes", nodes)
        result.put("width", ((root?.width ?: 0) / density).toDouble())
        result.put("height", ((root?.height ?: 0) / density).toDouble())
        if (root == null) {
            result.put("truncated", false)
            return result.toString()
        }
        val truncated =
            !collect(root, 0, -1, 0f, 0f, density, fragmentTags(activity), nodes)
        result.put("truncated", truncated)
        return result.toString()
    }

    /**
     * Append [view] and its visible descendants to [out], depth-first in **draw
     * order** (first child first) so the flat array reads top-to-bottom the way the
     * tree does. Note this is the reverse of the picker's iteration, which walks
     * children backwards because the last-drawn one wins a hit; here nothing is
     * competing, so document order is the useful order.
     *
     * [originX]/[originY] track [view]'s position in the root's coordinate space —
     * scroll offsets subtracted — so every reported frame is absolute and the
     * wireframe can draw straight from it.
     *
     * Returns false once [MAX_NODES] is hit, which unwinds the whole walk.
     */
    /**
     * Which view belongs to which fragment, by the tag it was added under.
     *
     * A plain fact the platform already knows and a view tree cannot show: a
     * fragment's tag lives in the `FragmentManager`, not on the view. Reported
     * rather than acted on — JS decides what a tag means, the same way it decides
     * what a class name means.
     *
     * This is how the Expo dev-menu bubble is identified without guessing. Its
     * host is a bare `LinearLayout` holding a bare `ComposeView` (see
     * `DevMenuFragment.onCreateView`), so no class name tells it apart from an
     * app's own Compose — but it is added as `"ExpoDevMenuFragment"`, and that
     * does.
     *
     * `FragmentActivity` costs no dependency: React Native exposes
     * `androidx.appcompat` as an `api` dependency and `AppCompatActivity` extends
     * it. An activity that is not one degrades to an empty map, which is only the
     * absence of an extra field.
     */
    private fun fragmentTags(activity: Activity): Map<View, String> {
        val manager =
            (activity as? FragmentActivity)?.supportFragmentManager ?: return emptyMap()
        val tags = IdentityHashMap<View, String>()
        for (fragment in manager.fragments) {
            val view = fragment.view ?: continue
            val tag = fragment.tag ?: continue
            tags[view] = tag
        }
        return tags
    }

    private fun collect(
        view: View,
        depth: Int,
        parent: Int,
        originX: Float,
        originY: Float,
        density: Float,
        fragments: Map<View, String>,
        out: JSONArray
    ): Boolean {
        if (out.length() >= MAX_NODES) return false
        // Where this node lands, captured before appending so children can point
        // back at it. An index rather than a React tag: most views report tag 0,
        // so a tag would be ambiguous exactly where the tree is hardest to read.
        val index = out.length()
        out.put(
            describe(view, depth, parent, originX, originY, density, fragments)
        )
        val group = view as? ViewGroup ?: return true
        for (i in 0 until group.childCount) {
            val child = group.getChildAt(i)
            if (child.visibility != View.VISIBLE || child.alpha < 0.01f) continue
            val ok = collect(
                child,
                depth + 1,
                index,
                originX + child.left - group.scrollX,
                originY + child.top - group.scrollY,
                density,
                fragments,
                out
            )
            if (!ok) return false
        }
        return true
    }

    /**
     * A readable class name for [view].
     *
     * `simpleName` is empty for an anonymous class, and React Native's root is
     * one — which is why the first row of a capture came back blank. Falling back
     * to what it extends gives the useful identity anyway: an anonymous subclass
     * is almost always a one-off override of something with a real name.
     */
    private fun classNameOf(view: View): String {
        val type = view.javaClass
        if (type.simpleName.isNotEmpty()) return type.simpleName
        val parent = type.superclass?.simpleName
        if (!parent.isNullOrEmpty()) return parent
        return type.name.substringAfterLast('.')
    }

    /**
     * How a text view draws its string — size in dp, colour, horizontal
     * alignment — so the wireframe can set a label the way the app set it instead
     * of rendering every string in one flat house style.
     *
     * Stock `TextView` getters. Alignment comes from gravity, which is what React
     * Native sets for `textAlign`.
     *
     * Colour is deliberately not reported: a label in the stack is read against
     * the accent fills and the stage behind them, not against whatever surface it
     * sits on in the app, so reproducing the app's colour makes it harder to read
     * rather than more faithful.
     *
     * These describe the *first* style in the view — a `TextView` holding a
     * Spannable with several spans reports only the leading one, so mixed-style
     * text draws in whichever style starts it.
     */
    private fun putTextStyle(target: JSONObject, view: TextView, density: Float) {
        target.put("textSize", (view.textSize / density).toDouble())
        target.put(
            "textAlign",
            when (view.gravity and Gravity.HORIZONTAL_GRAVITY_MASK) {
                Gravity.CENTER_HORIZONTAL -> "center"
                Gravity.RIGHT, Gravity.END -> "right"
                else -> "left"
            }
        )
    }

    /**
     * The view's corner radius in dp, or 0 when it has square corners.
     *
     * Android has no stock accessor for this. React Native paints rounded corners
     * inside a private background drawable, and depending on that class is
     * exactly the dependency the rest of this walk avoids — so the radius comes
     * from the view's [Outline] instead, which is public API and which a rounded
     * view fills in for clipping and shadow casting. [Outline.getRadius] answers
     * a negative number when the outline is not a round rect, and throws on some
     * shapes, so both are treated as "square".
     *
     * A view that rounds its corners without publishing an outline reports 0.
     * That costs a little fidelity in the drawing and nothing else.
     */
    private fun cornerRadius(view: View, density: Float): Double {
        val provider = view.outlineProvider ?: return 0.0
        val outline = Outline()
        return try {
            provider.getOutline(view, outline)
            val radius = outline.radius
            if (radius > 0f) (radius / density).toDouble() else 0.0
        } catch (e: Exception) {
            0.0
        }
    }

    /**
     * One node. Same fields as [ElementPicker.describeView] plus [depth], and read
     * through the same plain getters for the same reason: this has to keep working
     * in a release build, where `com.facebook.react.R.id` is not something to
     * depend on.
     */
    private fun describe(
        view: View,
        depth: Int,
        parent: Int,
        originX: Float,
        originY: Float,
        density: Float,
        fragments: Map<View, String>
    ): JSONObject = JSONObject().apply {
        put("tag", if (view.id == View.NO_ID) 0 else view.id)
        put("className", classNameOf(view))
        put("depth", depth)
        // Index of this view's parent in the node array, or -1 for the root. Read
        // straight from the walk rather than inferred from [depth], so the two
        // can be checked against each other.
        put("parent", parent)
        put("left", (originX / density).toDouble())
        put("top", (originY / density).toDouble())
        put("width", (view.width / density).toDouble())
        put("height", (view.height / density).toDouble())

        // Everything below is present only when the view actually has it. Most
        // views have none of it, so carrying empty strings and zeroes on every
        // node was most of the payload — and JS fills the defaults back in on
        // parse, so nothing downstream notices they are gone.
        (view.tag as? String)?.takeIf { it.isNotEmpty() }?.let { put("testID", it) }
        cornerRadius(view, density).takeIf { it > 0 }?.let { put("radius", it) }
        // The tag of the fragment this view is the root of, when it is one.
        // See [fragmentTags].
        fragments[view]?.let { put("fragment", it) }

        // `ReactTextView` extends `TextView`, so the stock getter covers RN text
        // on both architectures — no React internals, same as everything else.
        val text = (view as? TextView)?.text?.toString()?.let(::truncate)
        if (!text.isNullOrEmpty()) {
            put("text", text)
            putTextStyle(this, view as TextView, density)
        }
    }
}
