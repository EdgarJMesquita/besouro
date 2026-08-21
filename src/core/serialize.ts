/**
 * Circular-safe serialization of arbitrary values into a display string. Shared by
 * the console, Socket.IO, and AsyncStorage inspectors.
 */

export function safeStringify(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value === null) {
    return 'null';
  }
  if (value === undefined) {
    return 'undefined';
  }

  const valueType = typeof value;
  if (
    valueType === 'number' ||
    valueType === 'boolean' ||
    valueType === 'bigint'
  ) {
    return String(value);
  }
  if (valueType === 'function') {
    const name = (value as { name?: string }).name;
    return `[Function ${name && name.length > 0 ? name : 'anonymous'}]`;
  }

  // Types whose own enumerable properties are empty, so `JSON.stringify` renders
  // them as a useless "{}" — a truthy string, which means the `?? String(value)`
  // fallback below never fires for them. Handled explicitly instead.
  if (value instanceof Error) {
    return formatError(value);
  }
  if (value instanceof Map) {
    return `Map(${value.size}) ${safeStringify(Object.fromEntries(value))}`;
  }
  if (value instanceof Set) {
    return `Set(${value.size}) ${safeStringify([...value])}`;
  }
  if (value instanceof RegExp) {
    return String(value);
  }

  try {
    const seen = new WeakSet<object>();
    const json = JSON.stringify(value, (_key, entry: unknown) => {
      if (typeof entry === 'bigint') {
        return String(entry);
      }
      if (typeof entry === 'object' && entry !== null) {
        if (seen.has(entry)) {
          return '[Circular]';
        }
        seen.add(entry);
        // Same "{}" problem one level down: an Error/Map/Set nested inside an
        // otherwise-plain object. Replace with its display string.
        if (
          entry instanceof Error ||
          entry instanceof Map ||
          entry instanceof Set ||
          entry instanceof RegExp
        ) {
          return safeStringify(entry);
        }
      }
      return entry;
    });
    return json ?? String(value);
  } catch {
    return String(value);
  }
}

/**
 * `name: message`, plus any custom own-enumerable fields an error carries (API
 * clients often attach `code`/`status`). The stack is deliberately excluded —
 * callers that want it read {@link errorStack} into a separate field.
 */
function formatError(error: Error): string {
  const name = error.name && error.name.length > 0 ? error.name : 'Error';
  const head = error.message ? `${name}: ${error.message}` : name;

  const extras = Object.keys(error).filter((key) => key !== 'stack');
  if (extras.length === 0) {
    return head;
  }
  const fields: Record<string, unknown> = {};
  for (const key of extras) {
    fields[key] = (error as unknown as Record<string, unknown>)[key];
  }
  return `${head} ${safeStringify(fields)}`;
}

/** The stack of an error-like value, for `ConsoleEvent.stack`. */
export function errorStack(value: unknown): string | undefined {
  if (value instanceof Error && typeof value.stack === 'string') {
    return value.stack;
  }
  return undefined;
}

/** Join a console-style argument list into a single display string. */
export function formatArguments(args: readonly unknown[]): string {
  return args.map(safeStringify).join(' ');
}
