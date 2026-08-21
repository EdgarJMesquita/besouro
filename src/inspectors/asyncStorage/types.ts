/**
 * AsyncStorage inspector types — internal.
 *
 * A structural stand-in for `@react-native-async-storage/async-storage` so the
 * library never imports (or bundles) the optional peer — §4.1. A consumer passes
 * their real AsyncStorage module to `asyncStorage` and structural typing
 * does the rest.
 */

/** Structural subset of `@react-native-async-storage/async-storage` we patch. */
export interface AsyncStorageLike {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  clear(): Promise<void>;
  getAllKeys(): Promise<readonly string[] | string[] | null | undefined>;
  multiGet?(
    keys: readonly string[]
  ): Promise<
    readonly (readonly [string, string | null])[] | [string, string | null][]
  >;
  multiSet?(pairs: readonly (readonly [string, string])[]): Promise<void>;
  multiRemove?(keys: readonly string[]): Promise<void>;
}
