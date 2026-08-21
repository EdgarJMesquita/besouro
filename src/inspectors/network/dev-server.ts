/**
 * Dev-server noise filtering — internal.
 *
 * Metro (and Expo's dev server) issues its own HTTP traffic through the app's
 * `fetch`/XHR: `/symbolicate` on every LogBox stack, source-map fetches, the
 * inspector/CDP endpoints, `/logs`. None of it is app traffic, and in a debug
 * build it can easily outnumber the requests the developer is actually looking
 * for, so it is dropped at capture time — the same treatment the WebSocket
 * inspector gives Metro's HMR socket.
 *
 * Rather than guess at dev hostnames, the packager's origin is taken from the
 * url the bundle itself was loaded from, and every request to that origin is
 * dropped. An app API on `localhost:3000` keeps being recorded — only the
 * packager's own `host:port` matches — and a release build, whose bundle comes
 * off disk, has no origin to match, so capture there is untouched.
 */

/**
 * `scheme://host:port` of the dev server, or null when the bundle wasn't served.
 * Resolved once on first use — the packager can't move under a running app.
 */
let cachedOrigin: string | null | undefined;

/** True when `url` is dev-server chatter rather than a request the app made. */
export function isDevServerRequest(url: string): boolean {
  const origin = devServerOrigin();
  return origin != null && originOf(url) === origin;
}

/** Test seam: drop the memoized origin so the next call re-resolves it. */
export function resetDevServerOrigin(): void {
  cachedOrigin = undefined;
}

function devServerOrigin(): string | null {
  if (cachedOrigin === undefined) {
    cachedOrigin = originOf(scriptUrl() ?? '');
  }
  return cachedOrigin;
}

/**
 * The url the running bundle was loaded from, per RN's `SourceCode` native
 * module — `http://<metro-host>:8081/index.bundle?…` under the packager, and a
 * `file://` / `assets://` path in a release build.
 *
 * This is the same constant RN's own `getDevServer()` derives its answer from,
 * read through the public `NativeModules` surface: a deep require of the private
 * `getDevServer` path would resolve at bundle time (§4.1) and break consumers on
 * any RN version that moves the file.
 */
function scriptUrl(): string | null {
  try {
    const { NativeModules } = require('react-native') as {
      NativeModules: Record<string, Record<string, unknown> | undefined>;
    };
    const sourceCode = NativeModules.SourceCode;
    // TurboModules expose constants through getConstants(); the legacy module
    // hangs them off the object itself.
    const constants =
      typeof sourceCode?.getConstants === 'function'
        ? (sourceCode.getConstants as () => unknown)()
        : sourceCode;
    const url = (constants as { scriptURL?: unknown } | undefined)?.scriptURL;
    return typeof url === 'string' ? url : null;
  } catch {
    return null;
  }
}

/** `scheme://host:port` of an http(s) url; null for `file://`, empty, or malformed. */
function originOf(url: string): string | null {
  const match = /^(https?:\/\/[^/?#]+)/i.exec(url);
  return match?.[1] ? match[1].toLowerCase() : null;
}
