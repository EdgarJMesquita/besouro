/**
 * AppRegistry key the surface is registered under.
 *
 * Lives in core, apart from `drawer/` itself, because two unrelated places need
 * it — `index.tsx` registers the component under this key, and the console
 * inspector filters out the log line RN emits when that surface mounts — and
 * neither should pull the drawer's UI into its bundle graph to learn a string.
 */
export const BESOURO_REGISTRY_KEY = 'RNBesouro';
