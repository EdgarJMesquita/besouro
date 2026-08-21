/** One-line summary of what an action touched, for the action log. */

import type { ReduxEvent } from '../../../core/types';

/**
 * The subtitle under an action's type, or `''` when there is nothing worth saying.
 *
 * The changed slices are usually redundant with the type: RTK names actions
 * `slice/action`, so `counter/increment` changing `counter` tells the reader
 * something they just read. Repeating it on every row trains them to ignore the
 * line — which is a problem, because the times it *isn't* redundant are the
 * interesting ones:
 *
 * - an action that changed **nothing**, when you expected it to move state;
 * - an action that changed **more** than its own slice;
 * - an action that changed a **different** slice than its name suggests —
 *   `auth/login` touching `cart` is worth a second look.
 *
 * So the exact-match case is suppressed and everything else is shown, leaving a
 * caption that is always information.
 */
export function actionSummary(
  event: ReduxEvent,
  noChangeLabel: string
): string {
  if (event.changedKeys.length === 0) {
    return noChangeLabel;
  }
  // Prefer the nested paths — `counter.value` over `counter` — since the slice
  // name is usually already the action type's prefix. Falls back to the slices for
  // a row written before paths were recorded, or one whose diff hit its cap at the
  // top level (a slice replaced wholesale reports as just the slice).
  const listed =
    event.changedPaths.length > 0 ? event.changedPaths : event.changedKeys;

  const only = listed.length === 1 ? listed[0] : null;
  if (only != null && only === slicePrefix(event.actionType)) {
    return '';
  }
  return listed.join(', ');
}

/**
 * The slice an RTK action type names — the segment before the first `/`.
 *
 * `''` for a type with no separator (a hand-written `ADD_TODO`), which never
 * matches a state key, so those rows keep their caption.
 */
function slicePrefix(actionType: string): string {
  const separator = actionType.indexOf('/');
  return separator === -1 ? '' : actionType.slice(0, separator);
}
