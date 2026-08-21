/**
 * A few Jotai atoms for exercising the Jotai inspector.
 *
 * Deliberately mixed: a primitive atom, an object atom, and a derived one. The
 * primitive is the case Zustand never produces — it has no keys to list, so the
 * history row leans on the value preview instead. The derived atom is the case the
 * declared-atoms seam handles only because it is named here: nothing discovers it.
 */

import { atom } from 'jotai';

export const counterAtom = atom(0);
counterAtom.debugLabel = 'counter';

export const statusAtom = atom('idle');
statusAtom.debugLabel = 'status';

export const cartAtom = atom<{ items: string[]; total: number }>({
  items: [],
  total: 0,
});
cartAtom.debugLabel = 'cart';

/** Derived — recomputed by jotai, and captured because it is declared. */
export const cartCountAtom = atom((get) => get(cartAtom).items.length);
cartCountAtom.debugLabel = 'cartCount';
