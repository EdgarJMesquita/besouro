/**
 * Size ceilings the Redux inspector's two state views must share.
 *
 * A constant rather than a number in each file because the same tree is cut in two
 * different places, and the cuts have to match: `interceptor.ts` truncates the
 * closing snapshot on its way to disk, and `ReduxTab.tsx` truncates the live tree on
 * its way to the screen. Two independent 500 KB literals would drift the first time
 * one was tuned, and the symptom — a past session showing more (or less) of a tree
 * than the live pane does — is not one anybody would trace back to a constant.
 *
 * **Why the live pane truncates at all**, when every other inspector truncates only
 * at capture: the Redux registry holds state *by reference and never serializes it*
 * (see `store/snapshot.ts` — doing that per dispatch would be the heaviest thing
 * this library imposes on the host app). So the tab is not re-cutting something
 * already captured; it is the first and only place that value is ever stringified,
 * which makes it the capture point for this one view.
 *
 * Its own module, not an export from `interceptor.ts`: the tab would otherwise pull
 * the whole interception path — and the peer modules it wraps — into the drawer
 * bundle, which `drawer/InspectorTabs.tsx` always loads. This file imports nothing.
 */

/**
 * Ceiling on a serialized Redux state tree — the Zustand state budget (SPEC §4).
 *
 * Applies to the closing snapshot written per session and to the live State pane.
 * Not to an action's payload, which is cut at a deliberately lower ceiling
 * (`MAX_PAYLOAD_BYTES` in `interceptor.ts`) because the network inspector has
 * already captured any large response at full fidelity.
 */
export const MAX_STATE_BYTES = 500_000;
