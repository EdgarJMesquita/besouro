package com.besouro

import android.animation.ObjectAnimator
import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.view.Choreographer
import android.view.MotionEvent
import android.view.VelocityTracker
import android.view.View
import android.view.WindowInsets
import android.view.animation.OvershootInterpolator
import android.widget.FrameLayout
import kotlin.math.abs
import kotlin.math.hypot
import kotlin.math.sqrt

/** dp → px using [context]'s current display density. */
internal fun Int.dpToPx(context: Context): Int {
    val density = context.resources.displayMetrics.density
    return (this * density + 0.5f).toInt()
}

/**
 * Where the bubble's resting spot is kept between launches. Coordinates are 0–1
 * ratios of the draggable range, so they survive screen-size and rotation
 * changes. Implemented by [FileStore].
 */
internal interface BubblePositionStore {
    fun loadBubblePosition(): Pair<Float, Float>?
    fun saveBubblePosition(normalizedX: Float, normalizedY: Float)
}

/** The persisted theme preference and accent override, as JS wrote them: a theme
 *  name (`light`/`dark`/`system`) and an `#rrggbb` accent, either of which may be
 *  absent. Read at mount to color the bubble before it animates in. */
internal data class StoredBubbleAppearance(val theme: String?, val accent: String?)

/** Everything the bubble reads off disk. One interface so [BubbleController] takes
 *  a single store and can hand the view its position half. */
internal interface BubbleStore : BubblePositionStore {
    fun loadBubbleAppearance(): StoredBubbleAppearance
}

/**
 * A circular floating button that can be dragged anywhere on screen and
 * snaps to the nearest vertical edge on release. A tap (no drag) triggers
 * the provided callback. No ReactSurface — pure native view.
 *
 * Owns everything that happens *to the bubble itself*: drawing, touch handling,
 * the spring physics, idle dimming, and reading/writing its resting spot through
 * [positionStore]. Mounting it and wiring the tap to the drawer is
 * [BubbleController]'s job.
 */
internal class DraggableBubbleView(
    context: Context,
    private val positionStore: BubblePositionStore,
    var onTap: () -> Unit,
) : FrameLayout(context) {

    private var startRawX = 0f
    private var startRawY = 0f
    private var startViewX = 0f
    private var startViewY = 0f
    private var lastRawX = 0f
    private var lastRawY = 0f
    private var dragPath = 0f
    private var restingX = 0f
    private var velocityTracker: VelocityTracker? = null
    private val spring = BubbleSpring()

    // Idle dimming — after a spell without interaction the bubble fades to a low
    // opacity so it stops competing for attention, and wakes to full on touch.
    private var alphaAnimator: ObjectAnimator? = null
    private val idleDimRunnable = Runnable { animateAlpha(BUBBLE_IDLE_ALPHA, BUBBLE_IDLE_FADE_MS) }

    private val fillPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = DEFAULT_ICON_COLOR
        style = Paint.Style.FILL
    }
    private val linePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = DEFAULT_ICON_COLOR
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
    }
    private val bgDrawable = GradientDrawable().apply {
        shape = GradientDrawable.OVAL
        setColor(DEFAULT_FILL_COLOR)
        setStroke(BUBBLE_RING_DP.dpToPx(context), ringColorFor(DEFAULT_ICON_COLOR))
    }

    init {
        background = bgDrawable
        elevation = 10f
        setWillNotDraw(false)
    }

    /** Recolor the circle fill + bug-icon glyph to match the drawer theme/accent.
     *  The ring is a translucent tint of the accent so the flat fill gets a
     *  soft halo (mirrors expo-dev-menu's FAB border). */
    fun setColors(fill: Int, icon: Int) {
        bgDrawable.setColor(fill)
        bgDrawable.setStroke(BUBBLE_RING_DP.dpToPx(context), ringColorFor(icon))
        fillPaint.color = icon
        linePaint.color = icon
        invalidate()
    }

    /** Mount animation — slide in from off the top-left corner to the resting spot. */
    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        // Stay hidden until the first layout pass tells us where to settle.
        alpha = 0f
        animateInFromCorner()
    }

    /**
     * The parent isn't laid out yet at attach time, so wait for the first layout
     * pass. Then work out the resting position — the persisted spot (stored as
     * 0–1 ratios of the draggable range, mapped back and clamped) or wherever
     * layout placed us — launch from just off the top-left corner and settle onto
     * it with a gentle overshoot.
     */
    private fun animateInFromCorner() {
        val saved = positionStore.loadBubblePosition()
        addOnLayoutChangeListener(object : OnLayoutChangeListener {
            override fun onLayoutChange(
                v: View, l: Int, t: Int, r: Int, b: Int,
                ol: Int, ot: Int, or2: Int, ob: Int,
            ) {
                val parentW = (parent as? View)?.width?.toFloat() ?: return
                val parentH = (parent as? View)?.height?.toFloat() ?: return
                if (parentW <= 0f || parentH <= 0f || width <= 0 || height <= 0) return
                removeOnLayoutChangeListener(this)

                // Resting position: the persisted spot, or the default — right
                // edge, 70% down — matching the iOS default in the bubble controller.
                val margin = BUBBLE_MARGIN_DP.dpToPx(context).toFloat()
                val restX = saved?.let {
                    (it.first * (parentW - width)).coerceIn(0f, parentW - width)
                } ?: (parentW - width - margin).coerceIn(0f, parentW - width)
                val restY = saved?.let {
                    (it.second * (parentH - height)).coerceIn(0f, parentH - height)
                } ?: (parentH * BUBBLE_DEFAULT_VERTICAL_FRACTION).coerceIn(0f, parentH - height)

                // Launch from off the top-left corner and slide onto the resting spot.
                x = -width.toFloat()
                y = -height.toFloat()
                alpha = 1f
                animate()
                    .x(restX)
                    .y(restY)
                    .setStartDelay(60)
                    .setDuration(420)
                    .setInterpolator(OvershootInterpolator(1.1f))
                    .withEndAction { scheduleIdleDim() }
                    .start()
            }
        })
    }

    override fun onDetachedFromWindow() {
        super.onDetachedFromWindow()
        removeCallbacks(idleDimRunnable)
        alphaAnimator?.cancel()
    }

    /** Fade the bubble to [target] opacity, cancelling any in-flight alpha fade.
     *  Kept on its own animator so it never fights the scale/position animations
     *  running through [animate]. */
    private fun animateAlpha(target: Float, duration: Long) {
        alphaAnimator?.cancel()
        alphaAnimator = ObjectAnimator.ofFloat(this, View.ALPHA, alpha, target).apply {
            this.duration = duration
            start()
        }
    }

    /** Arm the idle timer; the bubble dims once it fires without interruption. */
    private fun scheduleIdleDim() {
        removeCallbacks(idleDimRunnable)
        postDelayed(idleDimRunnable, BUBBLE_IDLE_DELAY_MS)
    }

    /** Cancel a pending dim and snap back to full opacity if currently dimmed. */
    private fun wakeFromIdle() {
        removeCallbacks(idleDimRunnable)
        if (alpha < 1f) animateAlpha(1f, BUBBLE_WAKE_FADE_MS)
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val w = width.toFloat()
        val h = height.toFloat()
        // Icon proportional to bubble size (~26dp icon inside 52dp bubble).
        // Nudge down slightly so the antenna-heavy top optically centres.
        val s  = w * 0.52f
        val ox = (w - s) / 2f
        val oy = (h - s) / 2f + s * ICON_VERTICAL_NUDGE

        val barThickness = maxOf(1.5f, s * 0.07f)
        linePaint.strokeWidth = barThickness

        // Legs — 2 pairs of crossed rotated bars; body drawn on top covers centers
        val barHalfW = s * 0.38f
        drawLegPair(canvas, ox + s * 0.5f, oy + s * 0.34f + barThickness / 2f, barHalfW, 18f)
        drawLegPair(canvas, ox + s * 0.5f, oy + s * 0.52f + barThickness / 2f, barHalfW, 10f)

        // Antennae (thin, angled outward)
        linePaint.strokeWidth = maxOf(1.5f, s * 0.06f)
        val antCY = oy + s * 0.14f
        drawRotatedSegment(canvas, ox + s * 0.39f, antCY, s * 0.08f,  25f)
        drawRotatedSegment(canvas, ox + s * 0.61f, antCY, s * 0.08f, -25f)

        // Body — capsule, drawn last so it covers the leg crossings
        canvas.drawRoundRect(
            ox + s * 0.25f, oy + s * 0.18f,
            ox + s * 0.75f, oy + s * 0.80f,
            s * 0.25f, s * 0.25f,
            fillPaint
        )
    }

    private fun drawLegPair(canvas: Canvas, cx: Float, cy: Float, halfW: Float, angle: Float) {
        for (sign in floatArrayOf(1f, -1f)) {
            canvas.save()
            canvas.translate(cx, cy)
            canvas.rotate(angle * sign)
            canvas.drawLine(-halfW, 0f, halfW, 0f, linePaint)
            canvas.restore()
        }
    }

    private fun drawRotatedSegment(canvas: Canvas, cx: Float, cy: Float, halfH: Float, angle: Float) {
        canvas.save()
        canvas.translate(cx, cy)
        canvas.rotate(angle)
        canvas.drawLine(0f, -halfH, 0f, halfH, linePaint)
        canvas.restore()
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
        when (event.action) {
            MotionEvent.ACTION_DOWN -> {
                spring.cancel()
                wakeFromIdle()
                velocityTracker = VelocityTracker.obtain().apply { addMovement(event) }
                startRawX = event.rawX
                startRawY = event.rawY
                lastRawX = event.rawX
                lastRawY = event.rawY
                startViewX = x
                startViewY = y
                dragPath = 0f
                pressIn()
                return true
            }
            MotionEvent.ACTION_MOVE -> {
                velocityTracker?.addMovement(event)
                dragPath += hypot(event.rawX - lastRawX, event.rawY - lastRawY)
                lastRawX = event.rawX
                lastRawY = event.rawY
                if (dragPath > TOUCH_SLOP) {
                    val parentW = (parent as? View)?.width?.toFloat() ?: return true
                    val parentH = (parent as? View)?.height?.toFloat() ?: return true
                    x = (startViewX + event.rawX - startRawX).coerceIn(0f, parentW - width)
                    y = (startViewY + event.rawY - startRawY).coerceIn(0f, parentH - height)
                }
                return true
            }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                pressOut()
                if (dragPath < CLICK_DRAG_TOLERANCE) {
                    onTap()
                } else {
                    val vt = velocityTracker
                    vt?.computeCurrentVelocity(1000)
                    flingToEdge(vt?.xVelocity ?: 0f, vt?.yVelocity ?: 0f)
                }
                velocityTracker?.recycle()
                velocityTracker = null
                scheduleIdleDim()
                return true
            }
        }
        return super.onTouchEvent(event)
    }

    /** Subtle scale-down while the bubble is held. */
    private fun pressIn() {
        animate().scaleX(0.9f).scaleY(0.9f).setStartDelay(0).setDuration(90).start()
    }

    private fun pressOut() {
        animate().scaleX(1f).scaleY(1f).setStartDelay(0).setDuration(120).start()
    }

    /**
     * Snap to the nearest vertical edge, projecting the release momentum so a
     * flick throws the bubble, then settling with a velocity-aware spring.
     * Mirrors expo-dev-menu's calculateTargetPosition (momentum ≈ velocity/10).
     */
    private fun flingToEdge(velocityX: Float, velocityY: Float) {
        val parentW = (parent as? View)?.width?.toFloat() ?: return
        val parentH = (parent as? View)?.height?.toFloat() ?: return
        val margin = BUBBLE_MARGIN_DP.dpToPx(context).toFloat()
        // Keep the same safe gap on all 4 sides: margin + the system-bar insets
        // (status bar, nav bar, display cutout), mirroring iOS's safeAreaInsets.
        val insets = systemBarInsets()
        val minX = margin + insets[0]
        val minY = margin + insets[1]
        val maxX = parentW - width - margin - insets[2]
        val maxY = parentH - height - margin - insets[3]
        val projectedCenterX = x + width / 2f + velocityX / 10f
        val targetX = if (projectedCenterX < parentW / 2f) minX else maxX
        val targetY = (y + velocityY / 10f).coerceIn(minY, maxY)
        spring.start(targetX, targetY, velocityX, velocityY)

        // Persist the resting spot as 0–1 ratios of the draggable range.
        val rangeX = parentW - width
        val rangeY = parentH - height
        if (rangeX > 0f && rangeY > 0f) {
            positionStore.saveBubblePosition(
                (targetX / rangeX).coerceIn(0f, 1f),
                (targetY / rangeY).coerceIn(0f, 1f),
            )
        }
    }

    /** System-bar insets [left, top, right, bottom] in px, so the bubble keeps
     *  clear of the status bar, nav bar and any display cutout on every side. */
    @Suppress("DEPRECATION")
    private fun systemBarInsets(): FloatArray {
        val wi = rootWindowInsets ?: return floatArrayOf(0f, 0f, 0f, 0f)
        return if (Build.VERSION.SDK_INT >= 30) {
            val i = wi.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout())
            floatArrayOf(i.left.toFloat(), i.top.toFloat(), i.right.toFloat(), i.bottom.toFloat())
        } else {
            floatArrayOf(
                wi.systemWindowInsetLeft.toFloat(), wi.systemWindowInsetTop.toFloat(),
                wi.systemWindowInsetRight.toFloat(), wi.systemWindowInsetBottom.toFloat(),
            )
        }
    }

    /** Slide fully off the nearest edge when the drawer opens. */
    fun animateAway() {
        spring.cancel()
        // No point dimming while parked offscreen; wake so it returns at full opacity.
        wakeFromIdle()
        restingX = x
        val parentW = (parent as? View)?.width?.toFloat() ?: return
        val offX = if (x + width / 2f < parentW / 2f) -width.toFloat() else parentW
        animate().x(offX).setStartDelay(0).setDuration(300).start()
    }

    /** Spring back to the resting position when the drawer closes. */
    fun animateBack() {
        animate().cancel()
        spring.start(restingX, y, 0f, 0f)
        scheduleIdleDim()
    }

    /**
     * A dependency-free damped-spring integrator driven by the Choreographer.
     * Integrates both axes (semi-implicit Euler) toward a target, seeded with
     * the release velocity so a throw carries momentum. Tuned to Compose's
     * Spring.StiffnessLow / dampingRatio 0.65 that expo-dev-menu uses.
     */
    private inner class BubbleSpring : Choreographer.FrameCallback {
        private val naturalFreq = sqrt(SPRING_STIFFNESS)
        private val dampingCoef = 2f * SPRING_DAMPING_RATIO * naturalFreq
        private var animating = false
        private var targetX = 0f
        private var targetY = 0f
        private var velX = 0f
        private var velY = 0f
        private var lastFrameNanos = 0L

        fun start(tx: Float, ty: Float, vx: Float, vy: Float) {
            targetX = tx
            targetY = ty
            velX = vx
            velY = vy
            lastFrameNanos = 0L
            if (!animating) {
                animating = true
                Choreographer.getInstance().postFrameCallback(this)
            }
        }

        fun cancel() {
            animating = false
            Choreographer.getInstance().removeFrameCallback(this)
        }

        override fun doFrame(frameTimeNanos: Long) {
            if (!animating) return
            if (lastFrameNanos == 0L) {
                lastFrameNanos = frameTimeNanos
                Choreographer.getInstance().postFrameCallback(this)
                return
            }
            val dt = ((frameTimeNanos - lastFrameNanos) / 1e9f).coerceAtMost(MAX_FRAME_SEC)
            lastFrameNanos = frameTimeNanos

            velX += (-SPRING_STIFFNESS * (x - targetX) - dampingCoef * velX) * dt
            velY += (-SPRING_STIFFNESS * (y - targetY) - dampingCoef * velY) * dt
            x += velX * dt
            y += velY * dt

            val settled = abs(x - targetX) < REST_DISPLACEMENT && abs(velX) < REST_VELOCITY &&
                abs(y - targetY) < REST_DISPLACEMENT && abs(velY) < REST_VELOCITY
            if (settled) {
                x = targetX
                y = targetY
                animating = false
                return
            }
            Choreographer.getInstance().postFrameCallback(this)
        }
    }

    companion object {
        /** View tag identifying the bubble in the DecorView. */
        const val VIEW_TAG = "RNBesouroBubble"
        const val BUBBLE_SIZE_DP = 52
        private const val BUBBLE_MARGIN_DP = 14
        /** Default vertical resting spot (fraction of parent height), right edge —
         *  matches the iOS default so both platforms start alike. */
        private const val BUBBLE_DEFAULT_VERTICAL_FRACTION = 0.7f
        /** Downward nudge of the bug icon (fraction of icon size) for optical centering. */
        private const val ICON_VERTICAL_NUDGE = 0.06f
        /** Width of the accent halo ring around the bubble. */
        private const val BUBBLE_RING_DP = 2
        /** Opacity (0–255) of the accent applied to that ring (~30%). */
        private const val BUBBLE_RING_ALPHA = 0x4D

        // ── Idle dimming ──────────────────────────────────────────────────────
        /** Opacity the bubble fades to once idle. */
        private const val BUBBLE_IDLE_ALPHA = 0.4f
        /** Idle time (ms) without interaction before the bubble dims. */
        private const val BUBBLE_IDLE_DELAY_MS = 8000L
        /** Fade-out duration (ms) when dimming. */
        private const val BUBBLE_IDLE_FADE_MS = 500L
        /** Fade-in duration (ms) when waking on touch — quicker so it feels responsive. */
        private const val BUBBLE_WAKE_FADE_MS = 150L

        // ── Bubble drag/spring physics ────────────────────────────────────────
        /** Path length (px) below which a gesture counts as a tap, not a drag. */
        private const val CLICK_DRAG_TOLERANCE = 40f
        /** Path length (px) before the bubble starts following the finger. */
        private const val TOUCH_SLOP = 6f
        /** Spring stiffness — ω² for a unit mass. Below Compose's StiffnessLow (200)
         *  for a slightly slower, softer glide to the edge. */
        private const val SPRING_STIFFNESS = 140f
        /** Damping ratio — 0.65 gives a slight settle overshoot, matching Expo. */
        private const val SPRING_DAMPING_RATIO = 0.65f
        /** Frame-time cap (s) so a long/janky frame can't destabilise the spring. */
        private const val MAX_FRAME_SEC = 0.032f
        /** Rest thresholds: within 0.5px and 2px/s of target ends the animation. */
        private const val REST_DISPLACEMENT = 0.5f
        private const val REST_VELOCITY = 2f

        // ── Bubble colors ─────────────────────────────────────────────────────
        /** Default circle fill (white) until the JS theme pushes one. */
        val DEFAULT_FILL_COLOR = 0xFFFFFFFF.toInt()
        /** Default bug-icon tint (#2563EB) until the JS accent pushes one. */
        val DEFAULT_ICON_COLOR = 0xFF2563EB.toInt()

        /** A translucent tint of the accent, used for the bubble's halo ring so the
         *  flat fill gains some depth. Mirrors iOS. */
        private fun ringColorFor(accent: Int): Int =
            (accent and 0x00FFFFFF) or (BUBBLE_RING_ALPHA shl 24)
    }
}
