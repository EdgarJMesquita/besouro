/**
 * What the controller says when the UI cannot be mounted.
 *
 * The JS half of besouro installs from npm alone; the native half only exists
 * after a rebuild. Between the two the library used to do nothing at all — no
 * bubble, no message — which is the most common first-run report there is. Both
 * failure paths now warn.
 *
 * These drive the private `mountUI()` rather than `init()`, for the reason given
 * in `__tests__/warm-reload-resume`: `init()` additionally starts a session,
 * installs every interceptor and registers the drawer's RN surface, which this
 * node-environment suite cannot mount.
 */

import {
  describe,
  it,
  expect,
  jest,
  beforeEach,
  afterEach,
} from '@jest/globals';

const NATIVE_PATH = '../../native/NativeBesouro';
const DRAWER_ROOT_PATH = '../../drawer/BesouroRoot';

type ConsoleHolder = { console?: { warn?: (...args: unknown[]) => void } };
const globals = globalThis as ConsoleHolder;
const originalConsole = globals.console;

/**
 * Load a fresh controller against a given native module and run `mountUI()`,
 * returning whatever it warned. `null` stands in for "not linked".
 */
function mountWith(native: unknown): string[] {
  jest.resetModules();
  jest.doMock(NATIVE_PATH, () => ({ __esModule: true, default: native }));
  // The real drawer root pulls the whole component tree, which needs a React
  // Native renderer this node suite does not have. Only its registration is
  // under test, and that hands the component over without calling it.
  jest.doMock(DRAWER_ROOT_PATH, () => ({
    __esModule: true,
    BesouroRoot: () => null,
  }));

  const warnings: string[] = [];
  globals.console = {
    warn: (...args: unknown[]) => {
      warnings.push(String(args[0]));
    },
  };

  const { controller } =
    require('../controller') as typeof import('../controller');
  (controller as unknown as { mountUI(): void }).mountUI();

  return warnings;
}

describe('controller UI mount warnings', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  afterEach(() => {
    globals.console = originalConsole;
  });

  it('names the missing native module and the rebuild that fixes it', () => {
    const warnings = mountWith(null);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('[besouro]');
    expect(warnings[0]).toContain('native module not found');
    // The actionable half: the reason a reload does not help.
    expect(warnings[0]).toContain('Rebuild the app');
  });

  it('reports a throw from the mount instead of swallowing it', () => {
    // A native module that is present but blows up partway through the mount —
    // stands in for any unexpected failure inside our own mount path.
    const warnings = mountWith({
      mountBubble: () => {
        throw new Error('decor view missing');
      },
    });

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toBe(
      '[besouro] failed to mount the UI: decor view missing'
    );
  });

  it('says nothing when the mount succeeds', () => {
    // Every native call the mount path makes, not just `mountBubble` — it also
    // warms the safe-area cache on the way out, and a fake missing that would
    // pass this test through the failure branch it is meant to rule out.
    const warnings = mountWith({
      mountBubble: jest.fn(),
      getSafeAreaInsets: async () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
    });

    expect(warnings).toEqual([]);
  });
});
