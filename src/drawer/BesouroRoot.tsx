/**
 * The root of the devtools React tree — everything the drawer renders hangs off
 * this.
 *
 * Registered under the `RNBesouro` AppRegistry key, for which native
 * creates a ReactSurface on demand when the bubble is tapped. Despite the name it
 * is **not** something a consumer mounts: there is no user JSX anywhere in this
 * library's integration (§11), and this component is internal. It shares the host
 * app's JS context, so inspector data flows normally.
 *
 * There is no Modal wrapper and no `visible` flag: the native surface/window is
 * the container, and closing tears the surface down rather than toggling a
 * boolean — so the drawer's existence *is* its visibility.
 */

import { controller } from '../core/controller';
import type { BesouroOptions } from '../core/types';
import { useTabOrder } from '../core/tab-order';
import { BesouroUIProvider, DatabaseProvider } from '../shared/context';
import { BesouroShell } from './BesouroShell';
import NativeBesouro from '../native/NativeBesouro';

export function BesouroRoot(): React.ReactElement {
  const options = controller.getOptions();
  const database = controller.getDatabase();
  // The controller hands over install order; the user's own order is applied once,
  // here, so every strip below (the live drawer's and a past session's) shows the
  // same one.
  const inspectors = useTabOrder(controller.getInspectors());

  return (
    <BesouroUIProvider options={options as BesouroOptions}>
      {/* Every tab pages its events out of this, so it is provided to the whole
          drawer tree rather than threaded down as a prop. */}
      <DatabaseProvider database={database}>
        <BesouroShell inspectors={inspectors} onClose={closeDrawerNative} />
      </DatabaseProvider>
    </BesouroUIProvider>
  );
}

function closeDrawerNative(): void {
  NativeBesouro?.closeDrawer();
}
