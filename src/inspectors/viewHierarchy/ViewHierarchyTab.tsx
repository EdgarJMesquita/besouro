/**
 * The View Hierarchy tab.
 *
 * "Capture" snapshots the native view tree in one TurboModule call and shows it
 * two ways at once: the exploded 3D stack ({@link Exploded}) and the indented
 * tree it came from. Selection is shared both ways — tapping a box highlights its
 * row, tapping a row highlights its box.
 *
 * There is deliberately no flat/3D toggle. A first pass drew the tree flattened
 * onto one plane, and it was unreadable: every view is nested inside another, so
 * the whole capture collapses into concentric rectangles. Separating the depth
 * levels isn't a nicer way to show the tree, it is the only one that shows
 * anything — so there is no second mode worth switching to.
 *
 * Still out of scope: the handoff into the Element tab.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { StyleSheet } from 'react-native';
import { useBesouroUI } from '../../shared/context';
import { layout } from '../../shared/styles';
import { useListBottomPadding } from '../../shared/hooks/safe-area';
import { fontSize, fontWeight, space } from '../../theme/tokens';
import { Exploded } from './components/Exploded';
import { ViewTreeRow } from './components/ViewTreeRow';
import { Toolbar } from './components/Toolbar';
import { captureViewTree, isHierarchyAvailable } from './snapshot';
import { assignPlanes, planeDepth } from './planes';
import { RangeSlider, Slider } from '../../shared/components/Slider';
import { subtreeRange } from './utils/focus';
import { useDoubleTap } from '../../shared/hooks/double-tap';
import { Icon } from '../../shared/components/Icon';
import type { HierarchyNode, ViewTreeSnapshot } from './types';

export function ViewHierarchyTab(): React.ReactNode {
  const s = useStyles();
  const { theme, strings } = useBesouroUI();
  const [snapshot, setSnapshot] = useState<ViewTreeSnapshot | null>(null);
  /**
   * True until the first capture has been attempted.
   *
   * Without it the tab flashes its failure message on the render before the
   * effect below runs — a capture costs a few milliseconds, so "no result yet"
   * and "no result possible" are otherwise indistinguishable for exactly one
   * frame, and the wrong one shows.
   */
  const [pending, setPending] = useState(true);
  const [selected, setSelected] = useState<number | null>(null);
  /**
   * Index of the view both halves are narrowed to, or null for the whole
   * capture. Held here rather than in the stack because the tree list narrows
   * with it — a focused picture beside a complete list is the disagreement this
   * tab keeps working to avoid. See `./focus`.
   */
  const [focus, setFocus] = useState<number | null>(null);

  const listBottom = useListBottomPadding();
  const list = useRef<FlatList<HierarchyNode>>(null);
  /**
   * Set when a selection came from the stack, so the effect below knows to bring
   * the matching row into view. A tap on the row itself must not scroll — the row
   * is already under the finger, and moving it out from under one is the worst
   * thing a list can do.
   */
  const reveal = useRef(false);

  // A tap selects, and only selects. It used to toggle, which was the only way
  // back out of a selection until the stage grew a backdrop to tap; toggling also
  // spoke for the second tap on a box, which is now what focuses. Deselecting
  // lives on a tap away from everything, which is what it means everywhere else.
  const select = useCallback((index: number): void => {
    setSelected(index);
  }, []);

  /** Selecting from the stack: same toggle, but the list follows. */
  const selectFromStage = useCallback(
    (index: number): void => {
      reveal.current = true;
      select(index);
    },
    [select]
  );

  // Bring the selected row into view after a pick in the stack. The tree is the
  // half that says where a view sits in the hierarchy, and a tap on a box a
  // hundred rows down otherwise highlights something off screen.
  /**
   * Narrow to a view and its descendants, or back out.
   *
   * The focused view stays selected — it was selected by the first of the two
   * taps that focused it, and it is the thing being looked at.
   */
  const focusOn = useCallback((index: number): void => {
    setFocus(index);
    setSelected(index);
    // The list re-roots under it, so bring the row it is now showing into view —
    // otherwise FlatList keeps whatever offset it had and clamps it against a
    // list that just got shorter, landing somewhere arbitrary.
    reveal.current = true;
  }, []);

  /** Back to the whole capture, with the view you were focused on kept in view. */
  const unfocus = useCallback((): void => {
    setFocus(null);
    reveal.current = true;
  }, []);

  // A row answers a double tap the same way a box does. Its own pairing, not the
  // stack's — see `./use-double-tap` for why they are not shared.
  const tapRow = useDoubleTap(select, focusOn);

  /**
   * The window of planes drawn, closed from either end — see `RangeSlider`.
   * `from` opens at 0 rather than past the full-bleed chrome: an inspector that
   * decides for you which of your views are uninteresting is guessing, and the
   * back thumb is right there.
   */
  const [depth, setDepth] = useState({ from: 0, to: DEFAULT_DEPTH });
  const [spread, setSpread] = useState(DEFAULT_SPREAD);

  /**
   * Depth and Spread survive a focus, the way the camera does.
   *
   * Both knobs are set against a particular stack. Focus replaces that stack with
   * a smaller one — the depth window is clamped to a subtree that may be three
   * planes deep instead of twelve — so whatever you settle on in there is an
   * answer to a different question than the one you had outside it. Carrying it
   * back out silently reduced the capture to a slice of itself, and there was
   * nothing on screen to say why.
   *
   * Saved and restored rather than left alone, for the same reason `Exploded`
   * saves the camera: leaving a focus is "put it back the way it was".
   *
   * Read through a ref so the effect below can depend on `focus` alone — it must
   * run when the focus changes and at no other time.
   */
  const knobs = useRef({ depth, spread });
  knobs.current = { depth, spread };
  const beforeFocus = useRef<{
    depth: { from: number; to: number };
    spread: number;
  } | null>(null);
  useEffect(() => {
    if (focus != null) {
      beforeFocus.current = knobs.current;
      return;
    }
    const saved = beforeFocus.current;
    if (!saved) return;
    beforeFocus.current = null;
    setDepth(saved.depth);
    setSpread(saved.spread);
  }, [focus]);

  // Which plane each view is drawn on. Not the same as `node.depth`: views that
  // share a depth *and* a rectangle get pushed apart, or they would be drawn on
  // top of each other on one sheet. Computed above the early returns below, so
  // the hook order stays fixed. See `./planes`.
  const planes = useMemo(
    () => (snapshot ? assignPlanes(snapshot.nodes) : []),
    [snapshot]
  );

  /**
   * The slice of the capture the tree list shows: the focused subtree, or all of
   * it. Contiguous, so a row's absolute index is `range.start + its position` —
   * which is what selection, planes and the stack all speak. See `./focus`.
   */
  const range = useMemo(
    () => subtreeRange(snapshot?.nodes ?? [], focus),
    [snapshot, focus]
  );
  const rows = useMemo(
    () => snapshot?.nodes.slice(range.start, range.end) ?? [],
    [snapshot, range]
  );
  /**
   * Depth the tree list indents from.
   *
   * `node.depth` is absolute — it counts every ancestor back to the window — so a
   * focused subtree rooted eight levels down would open eight rails deep, all of
   * them descending from parents the list no longer shows. Rails that come from
   * nowhere are worse than no rails: they are the one thing in this list that
   * claims to say who a row's parent is.
   *
   * The capture's own depth is untouched — this is only what the drawing counts
   * from, the same way the stack re-bases its planes on the focus root.
   */
  const baseDepth = snapshot?.nodes[range.start]?.depth ?? 0;

  /**
   * How many planes the stack draws, and so how far the depth control runs.
   *
   * Computed here rather than inside the stack so the control and the picture
   * cannot disagree about the height of the thing being controlled — a slider
   * whose last notch changes nothing is a slider that is lying about its range.
   */
  const maxDepth = useMemo(
    () =>
      snapshot ? planeDepth(snapshot.nodes, planes, range.start, range.end) : 0,
    [snapshot, planes, range]
  );

  /**
   * The list's props, held still.
   *
   * All four are recreated on every render when written inline, and the tab
   * re-renders on every frame of a slider drag — so the list saw new props sixty
   * times a second and re-rendered every mounted cell each time. That is what
   * React Native's "large list is slow to update" warning was reporting, and
   * memoizing `ViewTreeRow` fixes none of it on its own: a memo compares props,
   * and the props were new objects.
   *
   * `renderRow` still changes when the selection or the focus does, which is
   * right — those are the two things a row's appearance depends on, and they
   * change on a tap rather than on a drag.
   */
  const listPadding = useMemo(
    () => ({ paddingBottom: listBottom }),
    [listBottom]
  );
  const keyOf = useCallback(
    (_: HierarchyNode, index: number) => String(range.start + index),
    [range.start]
  );
  const scrollNear = useCallback(
    ({
      index,
      averageItemLength,
    }: {
      index: number;
      averageItemLength: number;
    }) =>
      list.current?.scrollToOffset({
        offset: index * averageItemLength,
        animated: true,
      }),
    []
  );
  const renderRow = useCallback(
    ({ item, index }: { item: HierarchyNode; index: number }) => (
      <ViewTreeRow
        node={item}
        depth={item.depth - baseDepth}
        index={range.start + index}
        selected={range.start + index === selected}
        onPress={tapRow}
      />
    ),
    [baseDepth, range.start, selected, tapRow]
  );

  // Bring the selected row into view after a pick in the stack. The tree is the
  // half that says where a view sits in the hierarchy, and a tap on a box a
  // hundred rows down otherwise highlights something off screen.
  useEffect(() => {
    if (!reveal.current) return;
    reveal.current = false;
    if (selected == null) return;
    // The list holds the focused slice, so its index is the offset into that —
    // and a selection outside the focus has no row to scroll to.
    const row = selected - range.start;
    if (row < 0 || row >= range.end - range.start) return;
    // Centred rather than scrolled to the top, so the row keeps its neighbours —
    // the parents and siblings are most of what the list is for.
    list.current?.scrollToIndex({
      index: row,
      viewPosition: 0.5,
      animated: true,
    });
  }, [selected, range]);

  /**
   * Which capture is current. Two taps on Refresh start two walks and the slower
   * one would otherwise win; the tab also unmounts when the drawer changes tab,
   * and a walk in flight would land on a component that is gone.
   */
  const request = useRef(0);
  useEffect(
    () => () => {
      request.current += 1;
    },
    []
  );

  const capture = useCallback(async (): Promise<void> => {
    const ticket = ++request.current;
    const next = await captureViewTree();
    if (ticket !== request.current) return;
    setPending(false);
    setSnapshot(next);
    setSelected(null);
    // A focus points at an index in the tree that just went away.
    setFocus(null);
    // Open on a depth that is legible rather than complete. A native RN tree runs
    // hundreds of views deep-ish; drawing all of it at once is the difference
    // between the screenshot the user sent and a grey rectangle.
    // `planeDepth`, not `lastPlane`: the control's ceiling counts planes that
    // are actually drawn, skipping zero-area views, and seeding the window from
    // a different measure can open it past its own maximum.
    const fresh = next ? assignPlanes(next.nodes) : [];
    setDepth({
      from: 0,
      to: next
        ? Math.min(
            DEFAULT_DEPTH,
            planeDepth(next.nodes, fresh, 0, next.nodes.length)
          )
        : 0,
    });
  }, []);

  // Capture on arrival. The tab renders only while it is the selected one, so it
  // mounts fresh on every visit and the tree is always the screen as it is now —
  // which is the whole premise of a live inspector. Nothing is lost by not
  // waiting for a tap: the capture costs a few milliseconds, and the button stays
  // for when the app has moved on since.
  useEffect(() => {
    void capture();
  }, [capture]);

  if (!isHierarchyAvailable()) {
    return (
      <View style={styles.center}>
        <Text style={s.hint}>{strings.viewHierarchyUnavailable}</Text>
      </View>
    );
  }

  // A parsed payload with no nodes is not a capture. Android answers with one
  // when there is no current activity and iOS when serialization fails, and the
  // difference matters: without this the tab renders a toolbar over an empty
  // stage and an empty list, saying nothing about why.
  if (!snapshot || snapshot.nodes.length === 0) {
    return (
      <View style={layout.fill}>
        <Toolbar onRefresh={capture} />
        {/* Nothing at all while the first capture is in flight — it is over in a
            few milliseconds, and a spinner that brief is just a flicker. */}
        {pending ? null : (
          <View style={styles.center}>
            <Text style={s.hint}>{strings.viewHierarchyHint}</Text>
          </View>
        )}
      </View>
    );
  }

  return (
    <View style={layout.fill}>
      <Toolbar onRefresh={capture} />

      {/* Above the stage rather than in the line under it, which the selection
          takes over: a partial tree stays partial while you are picking through
          it, and a warning that disappears the moment you start using the thing
          it warns about is worse than none. */}
      {snapshot.truncated ? (
        <Text style={s.truncated}>{strings.viewHierarchyTruncated}</Text>
      ) : null}

      <View style={styles.stage}>
        <Exploded
          snapshot={snapshot}
          planes={planes}
          depth={depth}
          maxDepth={maxDepth}
          spread={spread}
          selected={selected}
          onSelect={selectFromStage}
          onClear={() => setSelected(null)}
          focus={focus}
          onFocus={focusOn}
        />
      </View>

      {/* The two knobs, under the stage and full width — Xcode's arrangement,
          arrived at the same way. They were a pair of −/+ steppers in the stage's
          top-right corner, which cost no vertical room but made you sample the
          picture one tap at a time. Both are judged by what the stack looks like,
          so sweeping the range and stopping where it reads best is the way anyone
          actually uses them, and that needs a slider. A slider needs width, and
          width inside the stage means a drag target fighting the orbit gesture
          underneath it — so the bar is outside. See `./Slider`.
          
          Depth has two thumbs. The near end alone answers "less of the app's
          own tree", which is most of what you want — but a capture opens with a
          run of full-bleed chrome nobody is inspecting, and that sits at the
          back, where one thumb could never reach it.
          
          Unlabelled, and no numbers either. Both are read by watching the stack
          rather than by knowing where they sit, so a label names something you
          never needed to say out loud, and in a bar this narrow it costs the
          travel that makes a slider better than the buttons it replaced. The
          accessible names carry what a sighted reader gets from the picture. */}
      <View style={styles.knobs}>
        <RangeSlider
          // Clamped on the way in, not just on the way out. Focusing a shallow
          // subtree shrinks `maxDepth` under a window set against the whole
          // capture, and the drawing already clamps — but a thumb handed a value
          // past its own maximum writes that stale value straight back the next
          // time it is touched.
          low={Math.min(depth.from, maxDepth)}
          high={Math.min(depth.to, maxDepth)}
          min={0}
          max={maxDepth}
          step={1}
          onChange={(from, to) => setDepth({ from, to })}
          accessibilityLabel={strings.viewHierarchyDepth}
        />
        <Slider
          value={spread}
          min={SPREAD_RANGE.min}
          max={SPREAD_RANGE.max}
          step={SPREAD_RANGE.step}
          onChange={setSpread}
          accessibilityLabel={strings.viewHierarchySpread}
        />
      </View>

      {/* Xcode's "Focused" bar, and for its reasons.
          
          Two jobs the picture cannot do on its own. It *names the state*: a
          focused stack looks exactly like a capture of a smaller screen, so
          without a word somewhere the tab is just quietly showing less than it
          has. And it holds the way out.
          
          Pinned above the list rather than inside it — this is not
          `ListHeaderComponent`, which scrolls. The exit was on the focus root's
          row for a version, and that row scrolls away; before that it was on the
          selection line, which disappears the moment you tap away from a view.
          A control that leaves a mode has to outlast anything you can do inside
          the mode. */}
      {focus != null ? (
        <View style={[styles.focusBar, { borderBottomColor: theme.border }]}>
          <Text style={s.focusTitle}>{strings.viewHierarchyFocused}</Text>
          <Pressable
            onPress={unfocus}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={strings.viewHierarchyUnfocus}
          >
            <Icon name="close" size={13} color={theme.textMuted} />
          </Pressable>
        </View>
      ) : null}

      {/* Every prop here is stable across a render, and that is the point.
          
          A capture is hundreds of rows and the tab re-renders on every frame of a
          slider drag. An inline `renderItem` is a new function each time, which
          makes the list re-render every mounted cell — React Native says so, in
          the "large list is slow to update" warning. Memoizing the row alone does
          not help while the props handed to it are new objects. */}
      <FlatList
        ref={list}
        style={layout.fill}
        contentContainerStyle={listPadding}
        data={rows}
        keyExtractor={keyOf}
        // Rows are one line of fixed padding, so the list can be scrolled to an
        // index it has not rendered yet — which is the usual case here, since a
        // pick in the stack can land far below the fold.
        onScrollToIndexFailed={scrollNear}
        renderItem={renderRow}
      />
    </View>
  );
}

/**
 * Depth to open on — deep enough to show structure, shallow enough to read. It is
 * also the plane count, and every extra plane is another translucent sheet
 * between the viewer and the back of the stack.
 */
const DEFAULT_DEPTH = 12;
/** dp between adjacent depth planes — the gap the stack opens with. */
const DEFAULT_SPREAD = 26;

/**
 * Bounds handed to the spread control.
 *
 * The ceiling came down from 120, which the slider is what exposed. As a pair of
 * −/+ buttons this was twenty taps away and cost nothing to leave there; as a
 * slider the whole range is one sweep, so a top half nobody travels to is just
 * travel stolen from the half that does the work. Past ~60dp the sheets are
 * further apart than the stage is tall and the stack runs off the stage anyway.
 *
 * The step came down with it, for the opposite reason: 6dp was sized for a
 * button, where a tap has to move enough to be worth having made. A slider has
 * no such floor, and a coarse step makes a continuous sweep jump.
 */
const SPREAD_RANGE = { min: 0, max: 60, step: 2 };

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: space.gutter * 2,
    gap: space.md,
  },
  focusBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.gutter,
    paddingVertical: space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  knobs: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.gutter,
    // Below only. Above, the row already sits under the stage's own bottom
    // padding; below, the tree list starts flush and the first row read as part
    // of the control strip.
    paddingBottom: space.md,
  },
  // A fixed share of the drawer rather than an aspect ratio: the drawer is short,
  // and the tree list below it has to stay usable.
  stage: {
    flex: 3,
    paddingHorizontal: space.gutter,
    paddingBottom: space.md,
  },
});

/** Theme-derived styles for this module, memoized per theme/font. */
function useStyles() {
  const { theme, font } = useBesouroUI();
  return useMemo(
    () =>
      StyleSheet.create({
        hint: {
          color: theme.textMuted,
          fontSize: font(fontSize.base),
          textAlign: 'center',
        },
        truncated: {
          color: theme.warning,
          fontSize: font(fontSize.caption),
          paddingHorizontal: space.gutter,
          paddingBottom: space.md,
        },
        focusTitle: {
          color: theme.textMuted,
          fontSize: font(fontSize.caption),
          fontWeight: fontWeight.bold,
          textTransform: 'uppercase',
          letterSpacing: 0.5,
        },
      }),
    [theme, font]
  );
}
