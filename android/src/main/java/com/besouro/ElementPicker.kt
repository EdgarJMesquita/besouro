package com.besouro

import android.app.Activity
import android.graphics.Matrix
import android.graphics.PointF
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Callback
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap

/**
 * The native half of the element inspector (SPEC §6.6). Floats a transparent
 * capture view over the app's content view; the next tap reports its point —
 * converted from px to the dp coordinate space the renderer's hit-test expects,
 * relative to the React root — along with the chain of native views under it.
 *
 * The native path is the only one that survives a release build, so everything
 * here reads through plain platform getters and never through React Native's
 * internals.
 *
 * UI thread only; the module does the hopping, and dismisses the drawer first so
 * taps reach the app.
 */
internal class ElementPicker(private val reactContext: ReactApplicationContext) {

    /**
     * Enter element-pick mode. The next tap fires `onResult(x, y, rootTag, path)`
     * exactly once and removes the overlay. One-shot: a pending overlay is replaced.
     */
    fun start(activity: Activity, onResult: Callback) {
        val content = activity.findViewById<FrameLayout>(android.R.id.content) ?: return
        // Replace any overlay left from a prior pick that was never tapped.
        content.findViewWithTag<View>(PICK_TAG)?.let { content.removeView(it) }

        val density = reactContext.resources.displayMetrics.density
        // The React root is content's first child; its id doubles as the root
        // tag. JS treats a non-positive tag as "no preference" and falls back to
        // the first root, which is correct for single-root apps.
        val rootTag = content.getChildAt(0)?.id ?: 0

        var fired = false
        val overlay = View(activity)
        overlay.tag = PICK_TAG
        overlay.setOnTouchListener { _, event ->
            if (event.action == MotionEvent.ACTION_UP && !fired) {
                fired = true
                val x = (event.x / density).toDouble()
                val y = (event.y / density).toDouble()
                // Remove the overlay *before* hit-testing so it can't win the
                // hit itself — it covers the whole content view.
                content.removeView(overlay)
                val reactRoot = content.getChildAt(0)
                val path = if (reactRoot != null) {
                    // `event` is in overlay space, which matches `content`;
                    // rebase onto the React root (usually coincident).
                    hitPath(
                        reactRoot,
                        event.x - reactRoot.left,
                        event.y - reactRoot.top,
                        density
                    )
                } else {
                    Arguments.createArray()
                }
                onResult.invoke(x, y, rootTag.toDouble(), path)
            }
            true
        }
        content.addView(
            overlay,
            FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT,
                FrameLayout.LayoutParams.MATCH_PARENT
            )
        )
    }

    /**
     * The chain of native views under ([x], [y]), [root] first and the deepest hit
     * view last, each described by [describeView].
     *
     * Deliberately not routed through touch dispatch: `dispatchTouchEvent` skips
     * views that don't accept touches, which is most plain `<View>`s — exactly the
     * ones worth inspecting. This mirrors `ViewGroup`'s own geometry instead —
     * reverse child order, so the last-drawn (topmost) child wins, and the child
     * matrix applied so transformed views hit correctly.
     *
     * Coordinates come in as px in [root]'s space and are reported in dp, matching
     * the units the pick callback already uses.
     */
    private fun hitPath(root: View, x: Float, y: Float, density: Float): WritableArray {
        val path = Arguments.createArray()
        var view: View = root
        var localX = x
        var localY = y
        // Origin of `view` in root coordinates, so reported bounds are absolute.
        var originX = 0f
        var originY = 0f
        val local = PointF()
        while (true) {
            path.pushMap(describeView(view, originX, originY, density))
            val group = view as? ViewGroup ?: break
            var next: View? = null
            for (i in group.childCount - 1 downTo 0) {
                val child = group.getChildAt(i)
                if (child.visibility != View.VISIBLE || child.alpha < 0.01f) continue
                if (!pointInChild(group, child, localX, localY, local)) continue
                originX += child.left - group.scrollX
                originY += child.top - group.scrollY
                localX = local.x
                localY = local.y
                next = child
                break
            }
            view = next ?: break
        }
        return path
    }

    /**
     * Whether ([x], [y]) — in [parent]'s coordinate space — falls inside [child],
     * writing the child-space point into [out]. Mirrors `ViewGroup`'s own
     * `isTransformedTouchPointInView`: shift by scroll and child offset, then undo
     * any child transform.
     */
    private fun pointInChild(
        parent: ViewGroup,
        child: View,
        x: Float,
        y: Float,
        out: PointF
    ): Boolean {
        var localX = x + parent.scrollX - child.left
        var localY = y + parent.scrollY - child.top
        if (!child.matrix.isIdentity) {
            val point = floatArrayOf(localX, localY)
            val inverse = Matrix()
            // A non-invertible matrix (scale 0) means nothing is visible there.
            if (!child.matrix.invert(inverse)) return false
            inverse.mapPoints(point)
            localX = point[0]
            localY = point[1]
        }
        out.set(localX, localY)
        return localX >= 0 && localY >= 0 && localX < child.width && localY < child.height
    }

    /**
     * One entry of the pick path.
     *
     * Both identity fields are read through plain platform getters, never through
     * React Native's internals — this has to keep working in a release build, so a
     * compile-time dependency on something like `com.facebook.react.R.id` (a
     * private resource id) is exactly what we don't want.
     *
     * `id` doubles as the React tag: `ViewManager.createView` assigns the tag as
     * the Android view id on both architectures. Views React doesn't own report 0.
     * `tag` is where `BaseViewManager.setTestId` mirrors `testID` — best-effort, so
     * a non-String tag (an app may use the slot for anything) just yields "".
     */
    private fun describeView(
        view: View,
        originX: Float,
        originY: Float,
        density: Float
    ): WritableMap = Arguments.createMap().apply {
        putInt("tag", if (view.id == View.NO_ID) 0 else view.id)
        putString("className", view.javaClass.simpleName)
        putString("testID", view.tag as? String ?: "")
        putDouble("left", (originX / density).toDouble())
        putDouble("top", (originY / density).toDouble())
        putDouble("width", (view.width / density).toDouble())
        putDouble("height", (view.height / density).toDouble())
    }

    companion object {
        private const val PICK_TAG = "RNBesouroPick"
    }
}
