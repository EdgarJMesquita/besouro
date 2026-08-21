/**
 * Console capture: what reaches the writer, and what the drawer filters out of its
 * own output. The real `console` is patched and restored around each test.
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';

import { installConsoleInspector } from '../interceptor';
import { BESOURO_REGISTRY_KEY } from '../../../core/besouro-registry-key';
import { recordCaptures } from '../../../core/__tests__/capture-recorder';
import { startSession } from '../../../core/session';
import type { ConsoleEvent } from '../../../core/types';

const captured = recordCaptures();
let uninstall: () => void;

beforeEach(() => {
  captured.reset();
  startSession();
  uninstall = installConsoleInspector();
});

afterEach(() => {
  uninstall();
});

function messages(): string[] {
  return captured
    .eventsOf<ConsoleEvent>('console')
    .map((event) => event.message);
}

describe('console capture', () => {
  it('flags a message the byte cap had to cut', () => {
    // The row has no detail view and "show more" only reveals what was stored, so
    // an unflagged cut message would read as the whole thing.
    console.log('x'.repeat(200_000));

    const event = captured.eventsOf<ConsoleEvent>('console')[0];
    expect(event?.messageTruncated).toBe(true);
    expect(event?.message.length).toBeLessThan(200_000);
  });

  it('leaves the flag off for a message that fit', () => {
    console.log('short enough');

    expect(
      captured.eventsOf<ConsoleEvent>('console')[0]?.messageTruncated
    ).toBe(false);
  });

  it('records each level with its formatted message', () => {
    console.log('hello', 42);
    console.warn('careful');
    console.error('boom');

    const events = captured.eventsOf<ConsoleEvent>('console');
    expect(events.map((event) => event.level)).toEqual([
      'log',
      'warn',
      'error',
    ]);
    expect(events[0]?.message).toBe('hello 42');
  });

  it("drops the drawer's own AppRegistry mount log, whatever the payload", () => {
    console.log(
      `Running "${BESOURO_REGISTRY_KEY}" with {"rootTag":61,"initialProps":{},"fabric":true}`
    );
    console.log(
      `Running "${BESOURO_REGISTRY_KEY}" with {"rootTag":9182,"initialProps":{"a":1},"fabric":false,"concurrentRoot":true}`
    );
    console.log(`Running "${BESOURO_REGISTRY_KEY}" with {}`);

    expect(messages()).toEqual([]);
  });

  it("keeps the host app's mount log", () => {
    console.log('Running "ExampleApp" with {"rootTag":1}');
    expect(messages()).toEqual(['Running "ExampleApp" with {"rootTag":1}']);
  });

  it('keeps a log that merely mentions the drawer key', () => {
    console.log(`registered ${BESOURO_REGISTRY_KEY}`);
    console.log('Running', `"${BESOURO_REGISTRY_KEY}" with {"rootTag":61}`);

    expect(messages()).toHaveLength(2);
  });
});
