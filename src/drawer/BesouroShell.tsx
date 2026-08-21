/**
 * The devtools shell — the right-side drawer everything else is rendered inside.
 *
 * It holds no inspector content of its own ({@link InspectorTabs} does). What it owns
 * is the container and the navigation around it:
 *
 * - the drawer's geometry, and — through {@link useDrawerSlide} — its slide, the
 *   dimmed backdrop that fades with it, and the swipe that closes it
 * - the header: session history, settings, close
 * - the **back stack** — it creates the `detailNav` controller that every stacked
 *   drawer and every detail view registers with, and owns the Android
 *   `BackHandler` that unwinds it one level at a time
 * - the stacked panels themselves: {@link SessionListPanel}, {@link SessionPanel},
 *   {@link SettingsPanel}, each wrapped in a `SlideOverlay`
 *
 * When the database is usable, the history button opens the session list; picking
 * a past session slides a read-only {@link SessionPanel} over it, which stays
 * mounted underneath so closing returns there. When it is not, the tabs give way
 * to {@link DatabaseNotice} — there is nothing to inspect, and nothing in here can
 * fix it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  BackHandler,
  Dimensions,
  Platform,
  Pressable,
  StyleSheet,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import type { Inspector } from '../core/types';
import {
  useBesouroUI,
  useSessionRepository,
  type ViewingSession,
} from '../shared/context';
import { Icon } from '../shared/components/Icon';
import { useTopInset } from '../shared/hooks/safe-area';
import { useDetailNavController, type DetailNav } from '../shared/detail-nav';
import { useDetailSlide } from '../shared/hooks/detail-slide';
import { useDrawerSlide } from './hooks/drawer-slide';
import { InspectorTabs } from './InspectorTabs';
import { ResizeGrip } from './ResizeGrip';
import { SettingsPanel } from './SettingsPanel';
import { SessionListPanel } from './SessionListPanel';
import { SessionPanel } from './SessionPanel';
import { layout } from '../shared/styles';
import { radius } from '../theme/tokens';
import {
  isDatabaseFailure,
  isDatabaseUsable,
  useDatabaseStatus,
  type DatabaseStatus,
} from '../core/database/status';
import { DatabaseNotice } from './DatabaseNotice';
import { getSettings, updateSettings } from '../core/settings-store';
import { useMiniWindowGestures } from './hooks/mini-window-gestures';
import {
  animateFrameTo,
  forgetFrame,
  fullScreenFrame,
  getPanelFrame,
  releaseFrame,
  setPanelFrame,
} from './mini-window';

interface ShellProps {
  inspectors: Inspector[];
  onClose: () => void;
}

const DRAWER_WIDTH = Math.min(Dimensions.get('window').width * 0.9, 520);

/** How long the dim takes to arrive once the drawer has finished growing. */
const DIM_FADE_DURATION = 160;

/** How long the floating panel takes to fade in when the drawer opens minimized. */
const PANEL_ENTER_DURATION = 140;

export function BesouroShell({
  inspectors,
  onClose,
}: ShellProps): React.ReactNode {
  const { theme, strings } = useBesouroUI();
  // The history button and the session list need sessions; the tabs read events
  // through their own hook.
  const sessionRepository = useSessionRepository();
  const databaseStatus = useDatabaseStatus();
  // `connecting` counts as usable: opening is a bridge round trip that normally
  // resolves long before the drawer is ever opened, and flashing a failure notice
  // during it would be wrong more often than right.
  const usable =
    isDatabaseUsable(databaseStatus) || databaseStatus.state === 'connecting';

  // Only the banner is dismissible, and only because the tabs behind it still
  // work. An unusable database has nothing behind its notice, so dismissing it
  // would leave a drawer of empty tabs — the exact reading the notice exists to
  // prevent. Keyed on the state it was dismissed for, so a *new* failure
  // (ready → write-failed) surfaces again instead of inheriting the dismissal.
  const [dismissedFor, setDismissedFor] = useState<
    DatabaseStatus['state'] | null
  >(null);
  const showNotice =
    isDatabaseFailure(databaseStatus) &&
    !(usable && dismissedFor === databaseStatus.state);
  const topInset = useTopInset();
  const detailNav = useDetailNavController();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [viewingSession, setViewingSession] = useState<ViewingSession | null>(
    null
  );
  // Opens the way it was left: the mode is remembered across reloads and
  // relaunches, like the panel's shape. Read once — later settings changes are
  // this component writing its own state back.
  const [minimized, setMinimized] = useState(
    () => getSettings().drawerMinimized
  );
  const miniWindow = useMiniWindowGestures();

  /**
   * Whether the dim behind the drawer is on screen, and how strongly.
   *
   * Kept apart from `minimized` because the dim can only ever be correct at one
   * of the two sizes. It is an `absoluteFill` *inside* the native surface, so it
   * covers exactly what the surface covers — and restoring animates that surface
   * from panel to full screen. Shown at any point during that trip it is a dimmed
   * rectangle with three visible edges over an undimmed app, the bottom one worst
   * because that is where the growing surface falls furthest short. Fading it in
   * over the trip only makes those edges faint rather than absent.
   *
   * So it simply does not exist while the surface is in motion: it goes out the
   * instant a minimize starts, and comes back only once the frame has landed on
   * the full screen, where it has no edge to show.
   */
  const dockedDim = useRef(new Animated.Value(minimized ? 0 : 1)).current;
  const [dimVisible, setDimVisible] = useState(!minimized);

  /**
   * Settings, the session list and a past session are all full-drawer panels:
   * unreadable at panel size, and their back stack is unreachable there because
   * the app owns the back button while the panel floats. So minimizing with one
   * open could only mean discarding it — which is not something a button should
   * do silently.
   *
   * They cover this header outright, so the button is inert rather than gone:
   * the only press it has to refuse is the one that beats the overlay there — a
   * second tap landing on minimize while history is still sliding over it, which
   * would open a panel and immediately shrink the drawer out from under it.
   * Unmounting instead would rearrange the toolbar under the finger for the same
   * effect.
   */
  const stackedPanelOpen =
    settingsOpen || historyOpen || viewingSession !== null;

  // On mount, put the surface back in step with what is about to render.
  //
  // Reconcile rather than reset, because "mount" is not always a fresh drawer: a
  // Fast Refresh remounts this component while `minimized` survives and the native
  // surface keeps whatever frame it had. Releasing unconditionally there would
  // drop panel chrome into a full-screen window — header under the status bar,
  // where the system takes the touches, and nothing left to press. Reading the
  // flag through a ref keeps this a mount effect without lying about its deps.
  const minimizedAtMount = useRef(minimized);

  /**
   * The floating panel's entrance, 0 → 1. Only ever animated when the drawer
   * *opens* minimized; the docked drawer has its own slide and starts at 1.
   *
   * It exists because the surface is born full-screen — native sizes it to its
   * host and only learns about the panel's frame once the effect below has run
   * and crossed to the UI thread. Rendering straight away means a frame or two of
   * panel chrome at full-screen size before it snaps down, which reads as the
   * drawer collapsing into the panel every time the bubble is tapped. Holding the
   * panel invisible until the frame has landed and fading it in there costs
   * nothing — it is one native-driven opacity, and it is why the panel now simply
   * appears where it was left.
   */
  const enter = useRef(new Animated.Value(minimized ? 0 : 1)).current;
  /** Guards the fade against its two triggers both firing. */
  const entered = useRef(!minimized);

  const revealPanel = useCallback((): void => {
    if (entered.current) {
      return;
    }
    entered.current = true;
    Animated.timing(enter, {
      toValue: 1,
      duration: PANEL_ENTER_DURATION,
      useNativeDriver: true,
    }).start();
  }, [enter]);

  /**
   * The panel's own layout is what says the frame push landed: the surface
   * shrinking to the panel's rect is what re-lays this view out, and its width
   * follows the surface. Waiting on that rather than on a fixed number of frames
   * starts the fade exactly when there is something panel-sized to fade in.
   */
  const handlePanelLayout = useCallback(
    (event: LayoutChangeEvent): void => {
      if (entered.current) {
        return;
      }
      // Still the whole screen — this is the mount layout, not the resize. The
      // pixel of slack absorbs the rounding `setSurfaceFrame` does on the way
      // down to device pixels.
      if (event.nativeEvent.layout.width > getPanelFrame().width + 1) {
        return;
      }
      revealPanel();
    },
    [revealPanel]
  );

  useEffect(() => {
    // First drop whatever frame the module still believes the surface is wearing.
    // A mount can follow a teardown JS never heard about — the element pick
    // dismisses the drawer natively and reopens it once the tap resolves — and the
    // surface that comes back is a new, full-screen one. Left unsaid, the push
    // below would be recognised as the frame already in place and skipped, which
    // is the full-screen panel it is here to prevent. See `forgetFrame`.
    forgetFrame();
    if (!minimizedAtMount.current) {
      releaseFrame();
      return;
    }
    setPanelFrame(getPanelFrame());
    // A floor under the layout signal above, because an invisible panel is a far
    // worse failure than an early one: if the resize never comes back — a native
    // call that went nowhere — the panel shows itself anyway. Two frames rather
    // than one, since the push has to cross to the UI thread and back.
    let inner: number | undefined;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(revealPanel);
    });
    return () => {
      cancelAnimationFrame(outer);
      if (inner !== undefined) {
        cancelAnimationFrame(inner);
      }
    };
  }, [revealPanel]);

  // Minimizing and restoring are the same tree at two sizes — the inspector, its
  // list and its scroll position stay mounted throughout, and only the chrome
  // around them changes. So both directions flip the flag *first* and let the
  // surface animate around a layout that is already correct; there is no content
  // swap to hide, which is what used to make the growing half stutter.
  const minimize = useCallback((): void => {
    setMinimized(true);
    updateSettings({ drawerMinimized: true });
    // Dropped outright rather than faded: the shrink starts on this same frame,
    // and a dim still on its way out would spend it edged against a surface that
    // no longer fills the screen. Reading it as "the app is back" is also exactly
    // what the button meant.
    setDimVisible(false);
    dockedDim.setValue(0);
    animateFrameTo(getPanelFrame());
  }, [dockedDim]);

  const restore = useCallback((): void => {
    setMinimized(false);
    updateSettings({ drawerMinimized: false });
    animateFrameTo(fullScreenFrame(), () => {
      releaseFrame();
      // Landed: the surface is the whole screen, so the dim can come up without
      // an edge anywhere. A short fade rather than a pop — the drawer it belongs
      // behind is already in place, so there is nothing left for it to lag.
      setDimVisible(true);
      Animated.timing(dockedDim, {
        toValue: 1,
        duration: DIM_FADE_DURATION,
        useNativeDriver: true,
      }).start();
    });
    // An interrupted frame animation never runs its callback, so a minimize
    // caught mid-restore leaves the dim down, which is where it belongs.
  }, [dockedDim]);
  const backSubRef = useRef<{ remove: () => void } | null>(null);

  /** Drop the hardware-back subscription, if one is installed. */
  const releaseBack = useCallback((): void => {
    backSubRef.current?.remove();
    backSubRef.current = null;
  }, []);

  const handleClosed = useCallback((): void => {
    // Release before handing control back: the Android close only detaches the
    // ReactSurface view (native never calls `surface.stop()`), so this
    // component is *not* unmounted and the effect cleanup below never runs.
    // Without this, every drawer open would leave another live listener behind,
    // each one swallowing the host app's back presses.
    releaseBack();
    // The surface is about to be torn down; drop the frame with it so the next
    // open starts from a full screen rather than from wherever the panel was.
    releaseFrame();
    onClose();
  }, [releaseBack, onClose]);

  const drawer = useDrawerSlide({
    width: DRAWER_WIDTH,
    onClose: handleClosed,
  });
  const handleClose = drawer.close;

  // Two things dim this backdrop and neither owns it: the drawer's own slide,
  // which fades it in on open and back out on a swipe-close, and `dockedDim`,
  // which holds it down across a minimize. Multiplied so neither has to know
  // about the other — whichever is at zero wins.
  const backdropOpacity = useMemo(
    () => Animated.multiply(drawer.backdropOpacity, dockedDim),
    [drawer.backdropOpacity, dockedDim]
  );

  // Unwind the top-most closable layer, then the drawer itself. Every layer —
  // the settings/history/session overlays and each detail view, in either the
  // live drawer or a session overlay — registers with the same stack, so
  // "top-most" is just the most recently mounted one. No priority list to keep
  // in sync with the z-order.
  const handleBack = (): void => {
    if (!detailNav.closeTop()) {
      handleClose();
    }
  };

  // Read through a ref so the subscription below installs once and still calls
  // the current `handleBack` (rebuilt every render, over a fresh `onClose`).
  const handleBackRef = useRef(handleBack);
  handleBackRef.current = handleBack;

  // Android hardware button and back gesture. The drawer lives in a
  // native-injected ReactSurface, where nothing routes back at all — so without
  // this the press falls through to the host Activity and takes the whole drawer
  // with it.
  useEffect(() => {
    // While minimized the drawer owns nothing to unwind and the app underneath
    // is live again, so back belongs to it. This subscription exists only to stop
    // a stray back press from taking the whole drawer down; a floating panel has
    // no such mistake to prevent, and holding it would swallow the app's presses.
    if (Platform.OS !== 'android' || minimized) {
      return;
    }
    backSubRef.current = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        handleBackRef.current();
        // Always claim the press: while the drawer is up it owns back, and every
        // branch of `handleBack` consumes it (closing a layer or the drawer).
        return true;
      }
    );
    return releaseBack;
  }, [releaseBack, minimized]);

  const body = (
    <View style={styles.row}>
      {/* Full-screen dim behind everything, including under the drawer, so the
          slide-out reveals the backdrop rather than a bare gap.

          It carries the swipe as well as the tap: it is the only surface in here
          that scrolls nothing, so a drag on it can't be mistaken for anything
          else (see `useDrawerSlide`). The `Pressable` keeps the tap and the
          accessibility label — the pan sits above it and takes the touch only
          once the finger has actually travelled. */}
      {dimVisible ? (
        <Animated.View
          {...drawer.panHandlers}
          style={{
            ...StyleSheet.absoluteFill,
            backgroundColor: theme.overlay,
            opacity: backdropOpacity,
          }}
        >
          <Pressable
            style={layout.fill}
            onPress={handleClose}
            accessibilityRole="button"
            accessibilityLabel={strings.close}
          />
        </Animated.View>
      ) : null}

      {/* The drawer and the floating panel are this one view at two sizes. Docked,
          it is a fixed-width sheet on the right that slides in over a dimmed app;
          minimized, the native surface *is* the panel, so it fills its host
          outright — no slide (there is nowhere to slide from), no left border, and
          a rounded outline to read as a window rather than an edge. */}
      <Animated.View
        onLayout={handlePanelLayout}
        style={{
          width: minimized ? '100%' : DRAWER_WIDTH,
          height: minimized ? '100%' : undefined,
          // 1 for the whole life of a docked drawer — see `enter`. Only an open
          // that starts minimized has anything to fade.
          opacity: enter,
          backgroundColor: theme.background,
          borderWidth: minimized ? 1 : 0,
          borderLeftWidth: 1,
          borderColor: theme.border,
          borderLeftColor: theme.border,
          borderRadius: minimized ? radius.lg : 0,
          overflow: minimized ? 'hidden' : 'visible',
          transform: minimized ? [] : [{ translateX: drawer.translateX }],
        }}
      >
        <View
          // Dragging the panel is a gesture on its header; docked, the same view
          // is a plain toolbar and the handlers are absent.
          {...(minimized ? miniWindow.dragHandlers : null)}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'flex-end',
            // Docked, clear the status bar / notch plus a small gap below it. The
            // panel is already clamped clear of the bars by `clampFrame`, so it
            // pads for looks only.
            paddingTop: minimized ? 8 : topInset + 16,
            paddingBottom: minimized ? 8 : 10,
            paddingHorizontal: 12,
            backgroundColor: theme.surface,
          }}
        >
          {/* Panel-sized, the header is a drag handle first and a toolbar second:
              only the two controls that change what it *is* stay, because history
              and settings both open full-drawer panels there is no room for. */}
          {minimized ? (
            <Pressable
              onPress={restore}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel={strings.restore}
              style={styles.block}
            >
              {/* 16, like the close beside it: the panel header runs its icons a
                  step down from the drawer's 20. */}
              <Icon name="expand" size={16} color={theme.text} />
            </Pressable>
          ) : (
            <>
              {sessionRepository ? (
                <Pressable
                  onPress={() => setHistoryOpen(true)}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel={strings.sessionHistory}
                  style={styles.block2}
                >
                  <Icon name="history" size={20} color={theme.text} />
                </Pressable>
              ) : null}
              <Pressable
                onPress={minimize}
                disabled={stackedPanelOpen}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={strings.minimize}
                style={styles.block}
              >
                <Icon name="minimize" size={20} color={theme.text} />
              </Pressable>
              <Pressable
                onPress={() => setSettingsOpen(true)}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={strings.settings}
                style={styles.block}
              >
                <Icon
                  name="gear"
                  size={20}
                  color={theme.text}
                  background={theme.surface}
                />
              </Pressable>
            </>
          )}
          <Pressable
            onPress={minimized ? handleClosed : handleClose}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={strings.close}
          >
            <Icon name="close" size={minimized ? 16 : 20} color={theme.text} />
          </Pressable>
        </View>

        {/* A database that never opened means there is nothing to inspect, so the
            notice replaces the tabs outright — empty tabs would read as "the app
            did nothing", and there is nothing to dismiss it *to*. A write failure
            still leaves earlier rows readable, so that one is a dismissible banner
            above the tabs it does not block. */}
        {showNotice ? (
          <DatabaseNotice
            status={databaseStatus}
            compact={usable}
            onDismiss={
              usable ? () => setDismissedFor(databaseStatus.state) : undefined
            }
          />
        ) : null}
        {usable ? (
          <InspectorTabs inspectors={inspectors} detailNav={detailNav} />
        ) : null}

        {minimized ? <ResizeGrip handlers={miniWindow.resizeHandlers} /> : null}

        {historyOpen && sessionRepository ? (
          <SlideOverlay
            zIndex={30}
            nav={detailNav.nav}
            onClosed={() => setHistoryOpen(false)}
          >
            {(requestClose) => (
              <SessionListPanel
                sessionRepository={sessionRepository}
                onClose={requestClose}
                // Deliberately does not close this overlay: the session
                // overlay stacks over it (zIndex 35 vs 30), so the list keeps its
                // rows and scroll position, and closing it returns here rather
                // than dropping all the way back to the live drawer.
                onSelect={setViewingSession}
              />
            )}
          </SlideOverlay>
        ) : null}

        {viewingSession ? (
          <SlideOverlay
            // The list stays live underneath, so picking a second session while
            // this one is open reconciles in place — and a slide that's already
            // finished won't replay. Keying on the session forces a remount.
            key={viewingSession.meta.id}
            zIndex={35}
            nav={detailNav.nav}
            onClosed={() => setViewingSession(null)}
          >
            {(requestClose) => (
              <SessionPanel
                session={viewingSession}
                inspectors={inspectors}
                detailNav={detailNav}
                onClose={requestClose}
              />
            )}
          </SlideOverlay>
        ) : null}

        {settingsOpen ? (
          <SlideOverlay
            zIndex={40}
            nav={detailNav.nav}
            onClosed={() => setSettingsOpen(false)}
          >
            {(requestClose) => <SettingsPanel onClose={requestClose} />}
          </SlideOverlay>
        ) : null}
      </Animated.View>
    </View>
  );

  return body;
}

/**
 * A full-drawer overlay that slides in from the right on mount and back out
 * before unmounting — the same motion as detail views. Covers the whole drawer
 * (header and tab bar included) since its child carries its own header.
 * `onClosed` unmounts it once the slide-out finishes. Registers itself as a
 * closable level on `nav`, so Android back plays the slide rather than an
 * instant dismiss — and, because the stack is LIFO, a later overlay (or a detail
 * opened inside this one) is always closed first. The child is a render prop
 * receiving the animated close.
 */
function SlideOverlay({
  zIndex,
  nav,
  onClosed,
  children,
}: {
  zIndex: number;
  nav: DetailNav;
  onClosed: () => void;
  children: (requestClose: () => void) => React.ReactNode;
}): React.ReactNode {
  const { theme } = useBesouroUI();
  const { translateX, requestClose } = useDetailSlide(onClosed);

  // Register once per mount (reading the current close through a ref) so this
  // level keeps its position in the stack across re-renders.
  const closeRef = useRef(requestClose);
  closeRef.current = requestClose;

  useEffect(() => nav.register(() => closeRef.current()), [nav]);

  return (
    <Animated.View
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex,
        backgroundColor: theme.background,
        transform: [{ translateX }],
      }}
    >
      {children(requestClose)}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  block: {
    marginRight: 18,
  },
  block2: {
    marginRight: 18,
  },
  row: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
});
