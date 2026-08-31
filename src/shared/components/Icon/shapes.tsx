/**
 * The individual icon shapes, composed from `View` primitives. Kept apart from the
 * `Icon` dispatcher so that file stays a readable index of the set.
 */

import { View, type ViewStyle } from 'react-native';

export interface ShapeProps {
  size: number;
  color: string;
}

/**
 * Three stacked lines of decreasing length, aligned to one edge. Used to hint a
 * text/URL display mode (left = full/from start, center, right = end only).
 */
export function AlignLinesIcon({
  size,
  color,
  align,
}: ShapeProps & {
  align: 'flex-start' | 'center' | 'flex-end';
}): React.ReactNode {
  const line = (widthFraction: number): ViewStyle => ({
    width: size * widthFraction,
    height: Math.max(1.5, size * 0.11),
    borderRadius: size,
    backgroundColor: color,
  });
  return (
    <View
      style={{
        width: size,
        height: size,
        justifyContent: 'center',
        alignItems: align,
        gap: size * 0.22,
      }}
    >
      <View style={line(1)} />
      <View style={line(0.61)} />
      <View style={line(0.33)} />
    </View>
  );
}

/** Three stacked bars — the "list view" glyph. */
export function ListIcon({ size, color }: ShapeProps): React.ReactNode {
  const bar: ViewStyle = {
    width: size * 0.8,
    height: Math.max(1.5, size * 0.11),
    borderRadius: size,
    backgroundColor: color,
  };
  return (
    <View
      style={{
        width: size,
        height: size,
        justifyContent: 'center',
        alignItems: 'center',
        gap: size * 0.22,
      }}
    >
      <View style={bar} />
      <View style={bar} />
      <View style={bar} />
    </View>
  );
}

/** A 2×2 block of squares — the "grid view" glyph. */
export function GridIcon({ size, color }: ShapeProps): React.ReactNode {
  const cell: ViewStyle = {
    width: size * 0.28,
    height: size * 0.28,
    borderRadius: size * 0.08,
    backgroundColor: color,
  };
  const gap = size * 0.22;
  return (
    <View
      style={{
        width: size,
        height: size,
        justifyContent: 'center',
        alignItems: 'center',
        gap,
      }}
    >
      <View style={{ flexDirection: 'row', gap }}>
        <View style={cell} />
        <View style={cell} />
      </View>
      <View style={{ flexDirection: 'row', gap }}>
        <View style={cell} />
        <View style={cell} />
      </View>
    </View>
  );
}

/** A folder: a rounded body with a small raised tab at its top-left. */
export function FolderIcon({ size, color }: ShapeProps): React.ReactNode {
  const bodyHeight = size * 0.62;
  const bodyTop = size * 0.28;
  return (
    <View style={{ width: size, height: size, justifyContent: 'center' }}>
      {/* Tab */}
      <View
        style={{
          position: 'absolute',
          top: bodyTop - size * 0.12,
          left: size * 0.1,
          width: size * 0.42,
          height: size * 0.18,
          borderTopLeftRadius: size * 0.08,
          borderTopRightRadius: size * 0.08,
          backgroundColor: color,
        }}
      />
      {/* Body */}
      <View
        style={{
          position: 'absolute',
          top: bodyTop,
          left: size * 0.1,
          width: size * 0.8,
          height: bodyHeight,
          borderRadius: size * 0.1,
          backgroundColor: color,
        }}
      />
    </View>
  );
}

/** A file/page outline with a dog-eared top-right corner. */
export function FileIcon({ size, color }: ShapeProps): React.ReactNode {
  const thickness = Math.max(1.5, size * 0.08);
  const fold = size * 0.28;
  return (
    <View style={{ width: size, height: size, alignItems: 'center' }}>
      <View
        style={{
          width: size * 0.62,
          height: size * 0.82,
          marginTop: size * 0.09,
          borderWidth: thickness,
          borderColor: color,
          borderRadius: size * 0.06,
        }}
      />
      {/* Folded corner — a small triangle masking the top-right of the page. */}
      <View
        style={{
          position: 'absolute',
          top: size * 0.09,
          right: size * 0.19,
          width: 0,
          height: 0,
          borderTopWidth: fold,
          borderLeftWidth: fold,
          borderTopColor: 'transparent',
          borderLeftColor: color,
        }}
      />
    </View>
  );
}

export function ArrowLeftIcon({ size, color }: ShapeProps): React.ReactNode {
  const thickness = Math.max(2, size * 0.1);
  const head = size * 0.36;
  const centerY = size / 2;
  return (
    <View style={{ width: size, height: size }}>
      {/* Shaft */}
      <View
        style={{
          position: 'absolute',
          left: size * 0.2,
          top: centerY - thickness / 2,
          width: size * 0.62,
          height: thickness,
          borderRadius: thickness,
          backgroundColor: color,
        }}
      />
      {/* Head: a left-pointing chevron at the shaft's tip. */}
      <View
        style={{
          position: 'absolute',
          left: size * 0.18,
          top: centerY - head / 2,
          width: head,
          height: head,
          borderLeftWidth: thickness,
          borderBottomWidth: thickness,
          borderColor: color,
          transform: [{ rotate: '45deg' }],
        }}
      />
    </View>
  );
}

export function ChevronLeftIcon({ size, color }: ShapeProps): React.ReactNode {
  const box = size * 0.42;
  const thickness = Math.max(2, size * 0.11);
  return (
    <View
      style={{
        width: size,
        height: size,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {/* A square with two adjacent borders, rotated 45°, forms a "<" chevron. */}
      <View
        style={{
          width: box,
          height: box,
          borderLeftWidth: thickness,
          borderBottomWidth: thickness,
          borderColor: color,
          transform: [{ rotate: '45deg' }],
          marginLeft: size * 0.1,
        }}
      />
    </View>
  );
}

export function ChevronRightIcon({ size, color }: ShapeProps): React.ReactNode {
  const box = size * 0.42;
  const thickness = Math.max(2, size * 0.11);
  return (
    <View
      style={{
        width: size,
        height: size,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {/* The mirror of the left chevron: the opposite pair of borders on the
          same 45° rotation points ">". */}
      <View
        style={{
          width: box,
          height: box,
          borderRightWidth: thickness,
          borderTopWidth: thickness,
          borderColor: color,
          transform: [{ rotate: '45deg' }],
          marginRight: size * 0.1,
        }}
      />
    </View>
  );
}

/**
 * Picture-in-picture: a window outline with a small solid pane resting in its
 * bottom-right corner — the drawer becoming the floating panel, drawn as the
 * thing it becomes rather than as a direction to move in.
 */
export function MinimizeIcon({ size, color }: ShapeProps): React.ReactNode {
  const thickness = Math.max(1.5, size * 0.09);
  // The frame is centered, so its own inset is what the pane is placed against.
  const frameInsetX = size * 0.07;
  const frameInsetY = size * 0.14;
  const paneGap = size * 0.05;
  return (
    <View
      style={{
        width: size,
        height: size,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <View
        style={{
          width: size - frameInsetX * 2,
          height: size - frameInsetY * 2,
          borderWidth: thickness,
          borderColor: color,
          borderRadius: size * 0.14,
        }}
      />
      <View
        style={{
          position: 'absolute',
          right: frameInsetX + thickness + paneGap,
          bottom: frameInsetY + thickness + paneGap,
          width: size * 0.32,
          height: size * 0.24,
          borderRadius: size * 0.06,
          backgroundColor: color,
        }}
      />
    </View>
  );
}

/**
 * Two corner brackets pushed to opposite diagonals — the panel opening back out
 * to the full drawer. The mirror of {@link MinimizeIcon}, and deliberately not a
 * chevron: the pair has to read as one axis (small ↔ large), not as navigation.
 */
export function ExpandIcon({ size, color }: ShapeProps): React.ReactNode {
  const bracket = size * 0.34;
  const thickness = Math.max(1.5, size * 0.1);
  const inset = size * 0.12;
  const radius = size * 0.08;
  return (
    <View style={{ width: size, height: size }}>
      <View
        style={{
          position: 'absolute',
          top: inset,
          left: inset,
          width: bracket,
          height: bracket,
          borderLeftWidth: thickness,
          borderTopWidth: thickness,
          borderColor: color,
          borderTopLeftRadius: radius,
        }}
      />
      <View
        style={{
          position: 'absolute',
          bottom: inset,
          right: inset,
          width: bracket,
          height: bracket,
          borderRightWidth: thickness,
          borderBottomWidth: thickness,
          borderColor: color,
          borderBottomRightRadius: radius,
        }}
      />
    </View>
  );
}

export function CopyIcon({ size, color }: ShapeProps): React.ReactNode {
  const sheet = size * 0.62;
  const radius = Math.max(1, size * 0.08);
  const offset = size * 0.27;
  return (
    <View style={{ width: size, height: size }}>
      <View
        style={{
          position: 'absolute',
          right: offset,
          top: offset,
          width: sheet,
          height: sheet,
          borderWidth: Math.max(1, size * 0.08),
          borderColor: color,
          borderRadius: radius,
        }}
      />
      <View
        style={{
          position: 'absolute',
          left: offset,
          bottom: offset,
          width: sheet,
          height: sheet,
          borderWidth: Math.max(1, size * 0.08),
          borderColor: color,
          borderRadius: radius,
          backgroundColor: 'transparent',
        }}
      />
    </View>
  );
}

/**
 * The iOS-style share glyph: an upward arrow (shaft + caret head) rising out of
 * an open-topped tray. Built from primitive shapes like the rest of the set.
 */
export function ShareIcon({ size, color }: ShapeProps): React.ReactNode {
  const thickness = Math.max(1.5, size * 0.09);
  const arm = size * 0.3;
  return (
    <View style={{ width: size, height: size }}>
      {/* Tray — a box with an open top for the arrow to rise out of. */}
      <View
        style={{
          position: 'absolute',
          left: size * 0.2,
          right: size * 0.2,
          bottom: size * 0.08,
          height: size * 0.48,
          borderWidth: thickness,
          borderTopWidth: 0,
          borderColor: color,
          borderRadius: size * 0.12,
        }}
      />
      {/* Arrow shaft. */}
      <View
        style={{
          position: 'absolute',
          top: size * 0.14,
          left: size / 2 - thickness / 2,
          width: thickness,
          height: size * 0.42,
          borderRadius: thickness,
          backgroundColor: color,
        }}
      />
      {/* Arrow head — two bars meeting in an upward caret over the shaft. */}
      <View
        style={{
          position: 'absolute',
          top: size * 0.08,
          left: 0,
          right: 0,
          flexDirection: 'row',
          justifyContent: 'center',
        }}
      >
        <View
          style={{
            width: arm,
            height: thickness,
            backgroundColor: color,
            borderRadius: thickness,
            transform: [{ rotate: '-45deg' }],
            marginRight: -thickness * 0.5,
          }}
        />
        <View
          style={{
            width: arm,
            height: thickness,
            backgroundColor: color,
            borderRadius: thickness,
            transform: [{ rotate: '45deg' }],
            marginLeft: -thickness * 0.5,
          }}
        />
      </View>
    </View>
  );
}

/** A checkmark: an "L" (right + bottom borders) rotated 45° into a tick. */
export function CheckIcon({ size, color }: ShapeProps): React.ReactNode {
  const thickness = Math.max(2, size * 0.12);
  const shortArm = size * 0.3;
  const longArm = size * 0.58;
  return (
    <View
      style={{
        width: size,
        height: size,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <View
        style={{
          width: shortArm,
          height: longArm,
          borderRightWidth: thickness,
          borderBottomWidth: thickness,
          borderColor: color,
          transform: [{ rotate: '45deg' }],
          // Rotation pivots around center, leaving the tick sitting slightly low;
          // nudge it up so it reads as vertically centered.
          marginTop: -size * 0.08,
        }}
      />
    </View>
  );
}

export function CloseIcon({ size, color }: ShapeProps): React.ReactNode {
  const bar: ViewStyle = {
    position: 'absolute',
    top: size / 2 - Math.max(1, size * 0.06),
    left: size * 0.1,
    width: size * 0.8,
    height: Math.max(1.5, size * 0.12),
    backgroundColor: color,
    borderRadius: size,
  };
  return (
    <View style={{ width: size, height: size }}>
      <View style={[bar, { transform: [{ rotate: '45deg' }] }]} />
      <View style={[bar, { transform: [{ rotate: '-45deg' }] }]} />
    </View>
  );
}

export function SearchIcon({ size, color }: ShapeProps): React.ReactNode {
  const ring = size * 0.62;
  return (
    <View style={{ width: size, height: size }}>
      <View
        style={{
          position: 'absolute',
          top: size * 0.07,
          left: 0,
          width: ring,
          height: ring,
          borderWidth: Math.max(1.5, size * 0.1),
          borderColor: color,
          borderRadius: ring,
        }}
      />
      <View
        style={{
          position: 'absolute',
          top: ring + size * 0.14,
          left: ring - size * 0.18,
          width: size * 0.5,
          height: Math.max(1.5, size * 0.12),
          backgroundColor: color,
          borderRadius: size,
          transform: [{ rotate: '45deg' }],
        }}
      />
    </View>
  );
}

export function GearIcon({
  size,
  color,
  background,
}: ShapeProps & { background?: string }): React.ReactNode {
  // Four chunky bars crossing at the center make eight rounded teeth; the body
  // disc then covers all but the teeth tips, and the hole punches the middle.
  const toothLen = size * 0.82;
  const toothThick = size * 0.19;
  const teeth = [0, 45, 90, 135].map((angle) => (
    <View
      key={angle}
      style={{
        position: 'absolute',
        top: (size - toothThick) / 2,
        left: (size - toothLen) / 2,
        width: toothLen,
        height: toothThick,
        backgroundColor: color,
        borderRadius: size * 0.06,
        transform: [{ rotate: `${angle}deg` }],
      }}
    />
  ));
  const body = size * 0.6;
  const hole = size * 0.25;
  return (
    <View style={{ width: size, height: size }}>
      {teeth}
      {/* Body disc — hides the inner span of the bars, leaving only tooth tips. */}
      <View
        style={{
          position: 'absolute',
          top: (size - body) / 2,
          left: (size - body) / 2,
          width: body,
          height: body,
          borderRadius: body,
          backgroundColor: color,
        }}
      />
      {/* Center hole — matches the surface behind so the cog reads as hollow. */}
      <View
        style={{
          position: 'absolute',
          top: (size - hole) / 2,
          left: (size - hole) / 2,
          width: hole,
          height: hole,
          borderRadius: hole,
          backgroundColor: background ?? color,
        }}
      />
    </View>
  );
}

/** A clock — ring plus an hour and minute hand — the "history" glyph. */
export function HistoryIcon({ size, color }: ShapeProps): React.ReactNode {
  const thickness = Math.max(1.5, size * 0.09);
  const center = size / 2;
  return (
    <View style={{ width: size, height: size }}>
      {/* Ring */}
      <View
        style={{
          position: 'absolute',
          top: size * 0.08,
          left: size * 0.08,
          width: size * 0.84,
          height: size * 0.84,
          borderWidth: thickness,
          borderColor: color,
          borderRadius: size,
        }}
      />
      {/* Minute hand — vertical, from center upward. */}
      <View
        style={{
          position: 'absolute',
          top: size * 0.26,
          left: center - thickness / 2,
          width: thickness,
          height: center - size * 0.26,
          backgroundColor: color,
          borderRadius: thickness,
        }}
      />
      {/* Hour hand — horizontal, from center rightward. */}
      <View
        style={{
          position: 'absolute',
          top: center - thickness / 2,
          left: center,
          width: size * 0.22,
          height: thickness,
          backgroundColor: color,
          borderRadius: thickness,
        }}
      />
    </View>
  );
}

export function BugIcon({ size, color }: ShapeProps): React.ReactNode {
  const bodyWidth = size * 0.5;
  const bodyHeight = size * 0.62;
  const legStyle = (top: number, rotate: string): ViewStyle => ({
    position: 'absolute',
    top,
    left: size * 0.12,
    width: size * 0.76,
    height: Math.max(1.5, size * 0.07),
    backgroundColor: color,
    borderRadius: size,
    transform: [{ rotate }],
  });
  return (
    <View style={{ width: size, height: size }}>
      <View style={legStyle(size * 0.34, '18deg')} />
      <View style={legStyle(size * 0.34, '-18deg')} />
      <View style={legStyle(size * 0.52, '10deg')} />
      <View style={legStyle(size * 0.52, '-10deg')} />
      {/* Antennae */}
      <View
        style={{
          position: 'absolute',
          top: size * 0.06,
          left: size * 0.36,
          width: Math.max(1, size * 0.06),
          height: size * 0.16,
          backgroundColor: color,
          transform: [{ rotate: '25deg' }],
        }}
      />
      <View
        style={{
          position: 'absolute',
          top: size * 0.06,
          right: size * 0.36,
          width: Math.max(1, size * 0.06),
          height: size * 0.16,
          backgroundColor: color,
          transform: [{ rotate: '-25deg' }],
        }}
      />
      {/* Body */}
      <View
        style={{
          position: 'absolute',
          top: size * 0.18,
          left: (size - bodyWidth) / 2,
          width: bodyWidth,
          height: bodyHeight,
          backgroundColor: color,
          borderTopLeftRadius: bodyWidth,
          borderTopRightRadius: bodyWidth,
          borderBottomLeftRadius: bodyWidth * 0.7,
          borderBottomRightRadius: bodyWidth * 0.7,
        }}
      />
    </View>
  );
}

/**
 * Two diagonal bars stepping down to the bottom-right — the grab handle of a
 * resizable panel.
 *
 * Centered in its box like every other glyph in the set. What reads as a grip is
 * the diagonal step, not where the ink sits in the square; the corner it resizes
 * from is supplied by where the *control* is placed, so anchoring the ink there
 * as well only pushed the whole glyph into one corner of its own button.
 *
 * Both bars are positioned along the box's main diagonal rather than stacked in a
 * column, because each one rotates about its *own* center: two bars sharing a
 * vertical axis come out offset along their own length, so their midpoints miss
 * each other and the pair reads as two strokes rather than one grip. Sitting on
 * the diagonal makes the whole centre-to-centre distance perpendicular to the
 * strokes, which is the offset a grip is actually made of.
 */
export function ResizeGripIcon({ size, color }: ShapeProps): React.ReactNode {
  const thickness = Math.max(1.5, size * 0.083);
  const gap = size * 0.125;
  const longBar = size * 0.58;
  const shortBar = size * 0.33;

  // A bar rotated 45° occupies a square of (length + thickness) / √2, so these
  // are how far each one reaches from its own center along the diagonal.
  const longReach = (longBar + thickness) / (2 * Math.SQRT2);
  const shortReach = (shortBar + thickness) / (2 * Math.SQRT2);
  // Center-to-center distance that leaves `gap` of clear space between two
  // parallel strokes, converted from perpendicular distance to diagonal travel.
  const offset = (thickness + gap) / (2 * Math.SQRT2);
  // The long bar reaches further from its center than the short one, so a pair
  // placed symmetrically about the box center would still *look* top-left heavy.
  // This nudges both back until the ink is centered rather than the anchors.
  const balance = (longReach - shortReach) / 2;

  const bar = (length: number, along: number): ViewStyle => ({
    position: 'absolute',
    left: (size - length) / 2 + along,
    top: (size - thickness) / 2 + along,
    width: length,
    height: thickness,
    borderRadius: size,
    backgroundColor: color,
    transform: [{ rotate: '-45deg' }],
  });

  return (
    <View style={{ width: size, height: size }}>
      <View style={bar(longBar, balance - offset)} />
      <View style={bar(shortBar, balance + offset)} />
    </View>
  );
}

/**
 * A circular arrow — re-read what is on screen. The ring is drawn as a full
 * circle with its top border left transparent and the whole thing rotated 45°,
 * which puts the gap in the top-right quadrant; the arrowhead sits on the arc's
 * upper terminus pointing into that gap, so the stroke reads as travelling
 * clockwise rather than as a broken circle.
 */
export function RefreshIcon({ size, color }: ShapeProps): React.ReactNode {
  const thickness = Math.max(1.5, size * 0.09);
  // Inset to the same optical weight as the other ring glyph (see HistoryIcon):
  // the arrowhead overhangs the stroke, so a ring drawn edge to edge would make
  // this icon read a size larger than the ones beside it.
  const inset = size * 0.1;
  // Base and length are set apart rather than sharing one number: a triangle as
  // long as half its base reads as a blunt wedge, not as the point of an arrow.
  // The half-base is what bounds this — the head is rotated a quarter turn, so
  // that value becomes the *vertical* reach from the arc's top end, and much
  // past 1.6 the point clips out of the icon box.
  const headHalfBase = thickness * 1.55;
  const headLength = thickness * 2.4;
  return (
    <View style={{ width: size, height: size }}>
      <View
        style={{
          position: 'absolute',
          top: inset,
          left: inset,
          width: size - inset * 2,
          height: size - inset * 2,
          borderWidth: thickness,
          borderColor: color,
          borderTopColor: 'transparent',
          borderRadius: size,
          transform: [{ rotate: '45deg' }],
        }}
      />
      {/* Straddles the arc's top end (centered on x, half a stroke down) and is
          rotated a quarter turn from pointing up to pointing along the arc. */}
      <View
        style={{
          position: 'absolute',
          left: size / 2 - headHalfBase,
          top: inset + thickness / 2 - headLength / 2,
          width: 0,
          height: 0,
          borderLeftWidth: headHalfBase,
          borderRightWidth: headHalfBase,
          borderBottomWidth: headLength,
          borderLeftColor: 'transparent',
          borderRightColor: 'transparent',
          borderBottomColor: color,
          transform: [{ rotate: '90deg' }],
        }}
      />
    </View>
  );
}

// The `row` used by GridOutlineIcon's two rows of cells.
const rowStyle: ViewStyle = { flexDirection: 'row' };

/**
 * Four outlined squares, nearly touching — the stage seen square on.
 *
 * The drawer's own `grid` icon with two changes: outlined rather than filled, and
 * the cells pulled almost together. Filled cells read as content; these are
 * frames, which is what the stage draws. And the wide gap that suits a
 * list/grid switch reads here as four separate things, when the point is one
 * surface seen flat.
 */
export function GridOutlineIcon({ size, color }: ShapeProps): React.ReactNode {
  const gap = Math.max(1, size * 0.09);
  const cell: ViewStyle = {
    width: (size - gap) / 2,
    height: (size - gap) / 2,
    borderWidth: 1,
    borderColor: color,
  };
  return (
    <View style={{ width: size, height: size, gap }}>
      <View style={[rowStyle, { gap }]}>
        <View style={cell} />
        <View style={cell} />
      </View>
      <View style={[rowStyle, { gap }]}>
        <View style={cell} />
        <View style={cell} />
      </View>
    </View>
  );
}

/**
 * Three sheets stacked back and to the left — the stack, offset.
 *
 * The same figure the stage draws when the toggle is on, down to the direction:
 * far sheets ride left and up, which is where {@link ANGLED} sends them. Xcode's
 * view-debugger button is this shape, and it is the shape for the same reason —
 * a picture of the thing, not a symbol standing in for it.
 *
 * Offset rather than turned or leaned. A `rotateY` foreshortens the sheet, so at
 * an angle steep enough to read as turned each one came out a sliver, and three
 * slivers do not read as a stack of anything. A skew avoids that — it keeps the
 * vertical edges vertical and tilts only the horizontal ones, which is what the
 * reference glyph does — but the two platforms disagree about which axis is
 * which, and not consistently across React Native and Android versions, so the
 * lean came out mirrored on some of them. Plain offsets draw the same figure
 * everywhere; at fifteen pixels across the lean was the part that read least.
 *
 * Almost entirely overlapped, and that is the whole figure: one sheet drawn whole
 * with a sliver of each one behind it. Spaced evenly they carry equal weight and
 * the thing reads as columns; stacked this way there is a front, and the rest is
 * depth behind it.
 *
 * ## The fill
 *
 * The sheets are opaque, and that is what makes the stack a stack. Outlined
 * alone, the back sheets' far edges run straight through the front one, so the
 * figure is a tangle of crossing lines with no front and no back. Filling them
 * lets the near sheet hide what is behind it, which is the only depth cue a
 * fifteen-pixel drawing has.
 *
 * The fill is the surface the glyph sits on rather than any colour of its own —
 * it is occlusion, not paint, and a colour would read as a solid object.
 *
 * ## Filling the box
 *
 * Every number below is chosen so the figure spans nearly the whole `size`, the
 * way {@link GridOutlineIcon}'s four cells do. Two glyphs at one `size` only look like
 * one size if each fills its box: this one drew a sheet half the width with tight
 * steps, so the figure lived in about 70% of its box and read visibly smaller
 * beside the other at the same nominal size. The alternative — a different `size`
 * per glyph — pushes the problem onto every caller.
 *
 * The horizontal fill is `width + 2 · step`, not width alone — the part worth
 * remembering. Widening the sheet to fill the box turned a square card into a
 * rectangle, when the step was the half that had room to give.
 */
export function LayersIcon({
  size,
  color,
  background,
}: ShapeProps & {
  /** What the glyph is drawn on — see the fill note above. */
  background: string;
}): React.ReactNode {
  const sheet: ViewStyle = {
    position: 'absolute',
    width: size * 0.62,
    height: size * 0.62,
    borderWidth: 1,
    borderColor: color,
    borderRadius: Math.max(1, size * 0.08),
    backgroundColor: background,
  };

  return (
    <View style={{ width: size, height: size }}>
      {/* Painted back to front, so the nearest sheet — the lowest, rightmost
          one — is the one drawn whole and the others fall behind it. */}
      {[0, 1, 2].map((step) => (
        <View
          key={step}
          style={[
            sheet,
            {
              left: size * (0.045 + 0.145 * step),
              top: size * (0.1 + 0.09 * step),
            },
          ]}
        />
      ))}
    </View>
  );
}
