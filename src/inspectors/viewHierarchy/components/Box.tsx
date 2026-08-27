/**
 * One captured view, drawn as a frame on its sheet.
 *
 * Everything about how a single rectangle reads lives here — its body, its
 * border, the label it carries. `Plane` decides which sheet it lands on and
 * `Exploded` decides where the camera is.
 */

import { memo } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { useBesouroUI } from '../../../shared/context';
import { withAlpha } from '../../../shared/utils/with-alpha';
import type { Frame } from '../utils/focus';
import type { HierarchyNode } from '../types';

/**
 * Smallest rendered box, in px, that gets a label. Below this the text would be
 * clipped to nothing anyway.
 */
const LABEL_MIN_WIDTH = 44;
const LABEL_MIN_HEIGHT = 14;

/**
 * Label sizes are raw px, not run through the UI's `font()` scale.
 *
 * Everything else in the drawer honours the user's text-size preference, but
 * these sit inside a plane the projection is already scaling — feeding a second
 * scale into that makes labels fight the geometry, and a large preference would
 * push text straight out of the boxes it is naming.
 */
/**
 * Nominal size for a class-name label, in the capture's dp — scaled by `fit` like
 * any frame, so it keeps its size relative to the scene.
 *
 * Under body text, which is around 14, and under the replicated strings it sits
 * beside. That gap is now the only thing separating the two kinds of label: they
 * share a colour, so size is what says which one is the app's own text and which
 * one is this tab naming a box. It buys back in hierarchy what dropping
 * `textMuted` spent.
 */
const LABEL_SIZE = 8;

/**
 * Alpha on a class-name label — a shade off the app's own strings, not a fade.
 *
 * `textMuted` was too far: it put the two halves of the annotation layer at
 * visibly different weights and the class names read as washed out. Full
 * strength was too close, leaving size as the only thing saying which label is
 * the app's text and which is this tab naming a box. This is the smallest step
 * that reads as a distinction rather than as dimming.
 */
const LABEL_ALPHA = 0.8;

/**
 * Labels take no fade at all — neither distance nor off-screen.
 *
 * Text is the thing in this picture that stops working first. A rectangle at 30%
 * strength is still a rectangle: the eye reads the shape from a few faint pixels
 * of edge, and the fade reads as depth. A 6px string at 30% is a smudge — it has
 * stopped being a word, and no amount of depth cue is worth a name you cannot
 * read. Depth is already carried by the geometry, by the perspective, and by the
 * stack order; the labels do not owe it a third telling.
 *
 * So the fades below are spent on borders and fills, and every label renders at
 * full strength. This is the constant that is not here.
 */

/**
 * Empirical shave on replicated text, and the one number here that is not derived.
 *
 * The arithmetic says a label should fit its frame exactly: the frame is
 * `node.width * fit`, the font is `node.textSize * fit`, both from the same
 * `fit`, and `allowFontScaling={false}` makes React Native convert dp to px with
 * plain density — handing back the px the platform reported. That should
 * reproduce the app's text-to-frame ratio precisely.
 *
 * It does not. Strings overshoot their frames by a consistent ~10% and ellipsize
 * where the app has room, across every string on the screen — a systematic factor
 * rather than noise, and one that survived removing every scaling term I could
 * find. The remaining suspect is font metrics: the captured `TextView` and the
 * drawer's renderer are not laying the same string out at the same advance
 * widths, which no amount of correct scaling can fix from this side.
 *
 * So: a documented shave, not a discovered constant. It costs 10% fidelity in
 * size to buy back strings that fit the way they do in the app, which is the
 * trade worth making for a label whose job is to be read. Set it to 1 to see the
 * true reported size.
 */
const TEXT_HEADROOM = 0.9;

/** Fill strength for a view's body. */
const FILL_ALPHA = 0.25;

/**
 * Memoized, with `onPress` taking the index rather than closing over it.
 *
 * A sheet can carry a hundred of these and there can be a dozen sheets. Most of
 * what the tab does leaves an individual box alone — selecting one, scrolling the
 * tree, refreshing — and without this every one of them re-rendered for it. The
 * geometry props do change together on a camera move or a knob drag, and the
 * boxes redraw then, which is the work actually being asked for.
 */
export const Box = memo(function BoxFrame({
  node,
  origin,
  index,
  fit,
  nearness,
  filled,
  named,
  selected,
  onPress,
}: {
  node: HierarchyNode;
  /** The sheet's rectangle — frames are drawn relative to it, not to the screen. */
  origin: Frame;
  fit: number;
  /** 0–1 depth fade for this sheet — see {@link Plane}. */
  nearness: number;
  /** False on the screen-frame sheet, which is drawn as an outline only. */
  filled: boolean;
  /**
   * Whether this box is one of the two that always shows its class name.
   *
   * Every box used to. It was the densest thing in the scene and the only
   * invented one — the app did not put those words on the screen, this tab did —
   * and most of them named a container nobody was looking for. The picture is of
   * *shapes*: which rectangles there are, how they nest, where they sit. A name
   * on each one buries that under a wall of text and answers a question the tree
   * list below already answers better, with the full name and no clipping.
   *
   * So the name is on demand, with two standing exceptions. Full-screen frames
   * keep theirs — see {@link coversFrame} — because they are all the same
   * rectangle and the picture has nothing else to tell them apart with. And the
   * selection gets one, because finding a view in the stack is the whole point
   * of picking it.
   *
   * Replicated app text is not affected: that is content, not annotation, and it
   * is what makes a box recognisable in the first place.
   */
  named: boolean;
  /** This box's index into `ViewTreeSnapshot.nodes`, handed back on press. */
  index: number;
  selected: boolean;
  onPress: (index: number) => void;
}): React.ReactNode {
  const { theme } = useBesouroUI();
  const width = node.width * fit;
  const height = node.height * fit;
  // Named at all, and with room to show it — a name clipped to two letters is
  // worse than none, and the tree list has the whole thing either way.
  const labelled =
    (named || selected) &&
    width >= LABEL_MIN_WIDTH &&
    height >= LABEL_MIN_HEIGHT;
  return (
    <Pressable
      onPress={() => onPress(index)}
      style={{
        position: 'absolute',
        left: (node.left - origin.left) * fit,
        top: (node.top - origin.top) * fit,
        width,
        height,
        // The view's own rounding, so a pill button reads as a pill rather than
        // as a rectangle that happens to sit where a pill is.
        borderRadius: node.radius * fit,
        borderWidth: selected ? 1.5 : StyleSheet.hairlineWidth,
        // The border is what separates one frame from the next, and it has to
        // carry that alone wherever fills overlap. A run of near-screen-sized
        // views — the ScrollView chain is four deep — stacks its translucent
        // bodies into a single slab, and at a faint border strength there is
        // nothing left to say where one view ends and the next begins. Small
        // views never hit this, which is why they looked fine while the big ones
        // merged.
        borderColor: selected
          ? theme.accent
          : withAlpha(theme.accent, 0.9 * nearness),
        // The fill lives here and nowhere else. A sheet with a background is a
        // full-size rectangle repeated on every plane, which is what made the
        // stack read as one thing duplicated; a *view* with a background is the
        // view itself, so the fills differ plane to plane exactly as much as the
        // layout does. It also gives each view a body rather than a wire outline,
        // which is what makes a busy plane resolve into parts.
        //
        // Translucent so overlapping views on one sheet stay separate bodies
        // instead of merging into a single silhouette.
        backgroundColor: selected
          ? withAlpha(theme.accent, 0.4)
          : filled
            ? withAlpha(theme.accent, FILL_ALPHA * nearness)
            : 'transparent',
        overflow: 'hidden',
        // The distance fade is spent on these two colours rather than on the
        // box's `opacity`, which is what made the labels unreadable: opacity is
        // inherited, so every fade the sheet carried landed on the text as well.
        // Fading the geometry directly leaves the labels out of it entirely.
        //
        // The selection is exempt from all of it: the point of selecting a view
        // is to find it, which fails if it dims into the stack.
        // No inset on a text frame: a text view's frame is measured to fit its
        // string exactly, so stealing even 2px of it guarantees an ellipsis that
        // the app does not have.
        paddingHorizontal: node.text ? 0 : 2,
      }}
    >
      {/* One line per box, never two stacked.
          
          A view that shows text is identified by that text, so it gets the string
          at the app's own size and alignment and nothing else. A view that shows
          none gets its class name. Printing both was what cut them off: the class
          name is a fixed 8px annotation while the box is only `height * fit` tall
          — 6px for a 22dp paragraph at a fitted zoom — so two lines never had
          room in the box that was clipping them. */}
      {node.text ? (
        <Text
          numberOfLines={1}
          // The ellipsis costs a character's width to say the string was cut.
          // Clipping says the same thing and spends nothing, which matters on a
          // frame measured to fit its text exactly.
          ellipsizeMode="clip"
          // Never re-scale a size that is already an absolute measurement.
          //
          // `textSize` is what the platform reported the view rendering at, which
          // on Android is `getTextSize()` in px — already multiplied by the
          // reader's font-size preference. RN's `<Text>` applies that preference
          // again by default, so the label came out `fontScale` times too big and
          // ellipsized inside a frame the app fits the string in exactly.
          allowFontScaling={false}
          // No `pointerEvents` needed: a `Text` without `onPress` registers no
          // touch handler, so taps fall through to the `Pressable` around it.
          style={{
            color: theme.text,
            textAlign: horizontalAlign(node.textAlign),
            // The scene's scale, and nothing else.
            //
            // `fit` is the wireframe-to-screen ratio — the rendered root plane's
            // height over the captured screen's height — so it is the single
            // number every dimension here is multiplied by. Frames use it, so
            // text uses it: 18pt on a screen drawn at a third of its size is 6pt,
            // and a label keeps exactly the size relative to the wireframe that it
            // has relative to the screen.
            //
            // No floor and no cap. A floor was what clipped labels before, holding
            // text at a fixed size while its frame shrank around it; a cap tied
            // the label to its own box instead of to the scene. Zoom is what makes
            // small text readable, and zoom moves `fit`.
            fontSize:
              (node.textSize > 0 ? node.textSize : LABEL_SIZE) *
              fit *
              TEXT_HEADROOM,
          }}
        >
          {node.text}
        </Text>
      ) : labelled ? (
        <Text
          numberOfLines={1}
          allowFontScaling={false}
          // The text colour a shade back — see `LABEL_ALPHA` — and scaled by
          // `fit` like everything else in the scene.
          //
          // `textMuted` was the wrong lever. It is the drawer's colour for text
          // subordinate to text beside it, and these two labels are not in that
          // relationship: they are alternatives, one per box, never on screen
          // together. What is wanted is a shade of difference, not a rank.
          style={{
            color: withAlpha(theme.text, LABEL_ALPHA),
            fontSize: LABEL_SIZE * fit,
          }}
        >
          {node.className}
        </Text>
      ) : null}
    </Pressable>
  );
});

/** RN accepts only these three; anything unreported falls back to `left`. */

function horizontalAlign(align: string): 'left' | 'center' | 'right' {
  return align === 'center' || align === 'right' ? align : 'left';
}
