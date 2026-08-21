package com.besouro

import android.app.Activity
import android.content.res.Configuration
import android.graphics.Color
import android.view.Gravity
import android.widget.FrameLayout
import com.facebook.react.bridge.ReactApplicationContext

/**
 * Both of the drawer's theme resolutions as JS computed them (`#rrggbb`), handed
 * over at mount so the bubble can be painted before it animates in. Which pair is
 * worn is decided natively — see [BubbleController.mount].
 *
 * [configuredTheme] is what to wear when the user has stored no preference: the
 * host app's configured theme, or `system` to follow the device.
 */
internal data class BubbleThemeColors(
    val configuredTheme: String,
    val lightBackground: String,
    val lightIcon: String,
    val darkBackground: String,
    val darkIcon: String,
)

/**
 * Owns the floating bubble's presence on the DecorView: mounting it, re-wiring
 * one that outlived a Fast Refresh, and the theme colors pushed from JS.
 *
 * It knows nothing about the drawer — a tap is reported through [onTap], and the
 * drawer's open/close choreography drives it through [slideAway] / [returnToRest].
 *
 * Every method is UI thread only; the module does the hopping.
 */
internal class BubbleController(
    private val reactContext: ReactApplicationContext,
    private val store: BubbleStore,
) {

    /** Invoked on the UI thread when the bubble is tapped. */
    var onTap: (() -> Unit)? = null

    private var bubbleView: DraggableBubbleView? = null

    // Cached bubble colors (from the JS theme/accent) so a color update that
    // arrives before the bubble mounts is applied when it appears.
    private var bubbleFillColor: Int? = null
    private var bubbleIconColor: Int? = null

    /**
     * Mount the bubble, or re-adopt one already on the DecorView. Fast Refresh
     * recreates the module instance while native views persist, so an existing
     * bubble's tap callback still points at the dead instance — re-point it at
     * this one rather than mounting a second bubble.
     *
     * [themes] carries both theme resolutions from JS; the stored preference
     * decides which one the bubble wears (see [seedColorsFromDisk]).
     */
    fun mount(activity: Activity, decorView: FrameLayout, themes: BubbleThemeColors) {
        seedColorsFromDisk(themes)

        val existing = decorView.findViewWithTag<DraggableBubbleView>(DraggableBubbleView.VIEW_TAG)
        if (existing != null) {
            existing.onTap = { onTap?.invoke() }
            applyCachedColors(existing)
            bubbleView = existing
            return
        }

        val bubble = DraggableBubbleView(activity, store) { onTap?.invoke() }
        bubble.tag = DraggableBubbleView.VIEW_TAG
        applyCachedColors(bubble)

        // Final resting spot (default or persisted) is computed once the parent
        // is laid out, in the bubble's mount animation — see animateInFromCorner.
        val size = DraggableBubbleView.BUBBLE_SIZE_DP.dpToPx(reactContext)
        val params = FrameLayout.LayoutParams(size, size).apply {
            gravity = Gravity.TOP or Gravity.START
        }
        decorView.addView(bubble, params)
        bubbleView = bubble
    }

    /**
     * Recolor the bubble to match the drawer theme/accent. Malformed colors are
     * ignored. Colors are cached, so a call that lands before the bubble mounts
     * still takes effect on mount — and outranks what [seedColorsFromDisk] would
     * read, since a push reflects the drawer as it is now.
     */
    fun applyAppearance(background: String, iconColor: String) {
        parseColorOrNull(background)?.let { bubbleFillColor = it }
        parseColorOrNull(iconColor)?.let { bubbleIconColor = it }
        bubbleView?.let { applyCachedColors(it) }
    }

    /** Slide the bubble off the nearest edge as the drawer opens. */
    fun slideAway() {
        currentBubble()?.animateAway()
    }

    /** Spring the bubble back to its resting spot as the drawer closes. */
    fun returnToRest() {
        currentBubble()?.animateBack()
    }

    /**
     * The bubble currently on screen, looked up by tag rather than read from
     * [bubbleView]: the view survives a module instance being recreated, so the
     * DecorView is the authority on which one is live.
     */
    private fun currentBubble(): DraggableBubbleView? {
        val activity = reactContext.currentActivity ?: return null
        val decorView = activity.window.decorView as? FrameLayout ?: return null
        return decorView.findViewWithTag(DraggableBubbleView.VIEW_TAG)
    }

    /**
     * Resolve the bubble's colors from the settings file JS persists, so the
     * entrance animation runs in the right theme rather than the built-in white.
     * JS reads that file asynchronously and cannot have it in hand at mount, so
     * it hands over both theme resolutions and the last step happens here: the
     * stored theme name picks one — or the configured one when the user has stored
     * none — the stored accent (when set) tints the icon, and anything
     * unrecognized, `system` included, follows the device.
     *
     * Skipped once a push has landed: that is the live truth and this file may
     * be a moment behind it.
     */
    private fun seedColorsFromDisk(themes: BubbleThemeColors) {
        if (bubbleFillColor != null || bubbleIconColor != null) return

        val stored = store.loadBubbleAppearance()
        val dark = when (stored.theme ?: themes.configuredTheme) {
            "light" -> false
            "dark" -> true
            else -> isSystemDark()
        }
        bubbleFillColor = parseColorOrNull(
            if (dark) themes.darkBackground else themes.lightBackground
        )
        bubbleIconColor = stored.accent?.let { parseColorOrNull(it) }
            ?: parseColorOrNull(if (dark) themes.darkIcon else themes.lightIcon)
    }

    private fun isSystemDark(): Boolean =
        (reactContext.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) ==
            Configuration.UI_MODE_NIGHT_YES

    /** Apply cached theme/accent colors to a bubble. No-op until a color is set —
     *  the view keeps its built-in defaults. */
    private fun applyCachedColors(bubble: DraggableBubbleView) {
        val fill = bubbleFillColor
        val icon = bubbleIconColor
        if (fill == null && icon == null) return
        bubble.setColors(
            fill ?: DraggableBubbleView.DEFAULT_FILL_COLOR,
            icon ?: DraggableBubbleView.DEFAULT_ICON_COLOR,
        )
    }

    private fun parseColorOrNull(value: String): Int? = try {
        Color.parseColor(value)
    } catch (_: IllegalArgumentException) {
        null
    }
}
