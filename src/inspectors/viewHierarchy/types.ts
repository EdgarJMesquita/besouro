/**
 * The shapes the View Hierarchy tab works in.
 *
 * Mostly what `NativeBesouro.snapshotViewTree()` serializes, once the parse has
 * filled in whatever the payload left out — see `./snapshot`. Plus
 * {@link PlacedNode}, the one shape the tab derives for itself, which lives here
 * for the same reason the others do: two modules need it and neither owns it.
 */

/**
 * One native view. `NativeNode` from the pick path, plus `depth` — the flat
 * array's stand-in for nesting, since codegen can't express a recursive struct.
 *
 * `left`/`top` are absolute, in dp/points relative to the React root, with scroll
 * offsets already applied — so the wireframe can draw straight from them without
 * accumulating anything.
 */
export type HierarchyNode = {
  /**
   * The platform's own id for the view, and an internal signal only — nothing
   * shows it.
   *
   * It used to be printed beside the class name in the tree, as `#1234`, which
   * was worse than useless: a bare number nobody can look up anywhere, presented
   * as if it identified something. Whatever question a reader has about a row —
   * what is it, where is it, what does it hold — the class name, the frame and
   * the picture already answer.
   *
   * The one job left is `./dev-tooling`, which uses "has a React tag anywhere in
   * this branch" to tell the app's own UI from a tool drawn beside it. That is a
   * heuristic and is treated as one: on iOS this is the React tag, but on Android
   * it is `View.id`, which React Native happens to set to the tag for views it
   * creates and which is an ordinary resource id for anything inflated from XML.
   * Good enough to spot a branch React never touched; not a fact about React, and
   * not something to show a reader as one.
   */
  tag: number;
  className: string;
  testID: string;
  /**
   * What the view displays, capped at 120 characters natively; empty for the
   * vast majority of views, which display nothing. Read through stock platform
   * getters (`TextView.getText`, `attributedText`/`text`), so it survives a
   * release build like every other field here.
   */
  text: string;
  /**
   * How the view draws its text, so a label can be replicated rather than
   * restyled: size in dp, and `left`/`center`/`right`. Both empty or 0 when the
   * view shows no text.
   *
   * Colour is deliberately absent — a label in the stack is read against accent
   * fills and the stage, not against the surface it sits on in the app.
   *
   * These describe the *first* style in the string. Mixed-style text — nested
   * `<Text>` with different sizes or colours — reports only the leading span, so
   * the whole label draws in whichever style starts it.
   */
  textSize: number;
  textAlign: string;
  /**
   * Corner radius in dp, 0 for square corners. iOS reads `layer.cornerRadius`
   * and always has it; Android has no stock accessor and answers from the view's
   * outline when one describes a round rect, else 0.
   */
  radius: number;
  depth: number;
  /**
   * Index of this view's parent in `ViewTreeSnapshot.nodes`, or -1 for the root.
   *
   * Read straight from the walk — `subview`'s parent is whatever view it was
   * reached through — rather than inferred from `depth` and document order like
   * everything else here. That independence is the point: the two can be checked
   * against each other, and a tree where they disagree is one where something is
   * wrong in the capture rather than in the drawing.
   *
   * An index rather than a React tag, because most views report `tag: 0` — every
   * `RCTParagraphTextView`, `RCTEnhancedScrollView`, the whole Compose branch —
   * so a tag would be ambiguous exactly where the tree is hardest to read.
   */
  parent: number;
  left: number;
  top: number;
  width: number;
  height: number;
  /**
   * The tag of the fragment this view is the root of, or `''` for the vast
   * majority of views, which are not one.
   *
   * A fragment's tag lives in the `FragmentManager`, not on the view, so it is
   * something the platform knows and a view tree cannot show. Reported, not
   * interpreted — `./dev-tooling` is what decides that one particular tag means
   * a tool rather than the app.
   *
   * Android only. iOS has no equivalent, and needs none: its tooling arrives
   * under class names that already identify it.
   */
  fragment: string;
};

/** A whole capture: the root's size, and every visible view under it. */
export type ViewTreeSnapshot = {
  /** Root size in dp/points — the wireframe's coordinate space. */
  width: number;
  height: number;
  /** True when the walk stopped at native's node cap: a valid prefix, not the tree. */
  truncated: boolean;
  /** Document order, depth-first — parent immediately before its children. */
  nodes: HierarchyNode[];
};

/**
 * A captured view once the stack has decided how to draw it — worked out in one
 * pass by `Exploded`, consumed by `Plane`.
 *
 * Neither component owns it, so it is not in either: putting it in one would make
 * the other import a component for a type.
 */
export type PlacedNode = {
  node: HierarchyNode;
  /** Index into `ViewTreeSnapshot.nodes` — what selection and focus speak. */
  index: number;
  /** Whether it falls inside the captured screen, which decides how it is faded. */
  onScreen: boolean;
  /** Whether it always carries its class name, rather than only when selected. */
  named: boolean;
};
