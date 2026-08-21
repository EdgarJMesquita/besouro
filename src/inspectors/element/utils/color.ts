/**
 * Recognise which prop/style values are colors, so the rows that hold one can
 * show it instead of only spelling it out — `#3b82f6` says far less at a glance
 * than the blue itself does.
 *
 * Detection is by *value*, not by key: `backgroundColor` is obvious, but colors
 * also arrive through `tintColor`, `shadowColor`, a custom `overlay` prop, or a
 * theme object spread into a style, and all of those deserve the same preview.
 */

/** `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa` — the four lengths RN accepts. */
const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** `rgb(…)` / `hsla(…)` / `hwb(…)` — the arguments are checked separately. */
const FUNCTIONAL = /^(?:rgba?|hsla?|hwb)\(([^()]*)\)$/i;

/** Angle units a hue may carry; stripped before the arguments are validated. */
const ANGLE_UNIT = /(?:deg|grad|rad|turn)\b/gi;

/**
 * What's left of a functional color's arguments once the angle units are gone:
 * numbers, percentages, and the separators CSS allows (commas, spaces, and the
 * `/` before an alpha). Anything else means it isn't a color we can hand to RN.
 */
const COMPONENTS = /^[\d.,%/\s+-]+$/;

/**
 * The CSS named colors, which RN resolves natively. Kept as one split string
 * rather than 148 quoted lines — the list is data, and nothing here reads it
 * except `Set.has`.
 */
const NAMED = new Set(
  `transparent aliceblue antiquewhite aqua aquamarine azure beige bisque black
   blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate
   coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod
   darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange
   darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray
   darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey
   dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold
   goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory
   khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral
   lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink
   lightsalmon lightseagreen lightskyblue lightslategray lightslategrey
   lightsteelblue lightyellow lime limegreen linen magenta maroon
   mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen
   mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue
   mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange
   orangered orchid palegoldenrod palegreen paleturquoise palevioletred
   papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red
   rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna
   silver skyblue slateblue slategray slategrey snow springgreen steelblue tan
   teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen`.split(
    /\s+/
  )
);

/**
 * The color `value` holds, ready to use as a `backgroundColor`, or null when it
 * isn't one. The returned string is the value as written — RN parses these forms
 * itself, so there's nothing to normalize.
 *
 * Numbers are never colors here. RN does accept a packed integer (what
 * `processColor` returns), but in a style a bare number is nearly always a
 * length, and swatching every `width: 100` would be far worse than missing the
 * rare packed one.
 */
export function asColor(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const text = value.trim();
  if (HEX.test(text) || NAMED.has(text.toLowerCase())) {
    return text;
  }
  const args = FUNCTIONAL.exec(text)?.[1];
  return args !== undefined && COMPONENTS.test(args.replace(ANGLE_UNIT, ' '))
    ? text
    : null;
}
