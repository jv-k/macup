// Regression guard for the Add/Remove data-loss bug.
//
// `pageableAutocompleteMultiselect` used to cast clack's resolved value
// to `PickerOption[]` and read `.value` off each entry. But clack
// resolves the selected VALUES, not the option objects, so every pick
// came back `undefined`. Those undefineds flowed into ConfigStore.add,
// serialized as a YAML `null`, and replaced the user's tracked list —
// wiping 38 casks in one keystroke and leaving a config that no longer
// parsed on load.
//
// The unit tests missed it because the wizard's seam (`WizardDeps
// .pickTrackedSet`) is stubbed with hand-written string arrays, and the
// ConfigStore tests feed it hand-written string arrays too. Both sides
// of the bridge were tested; the bridge itself was not. These tests
// drive the REAL prompt over mock streams so the values are the
// prompt's, not the test's.

import type { EventEmitter } from 'node:events';
import { Readable, Writable } from 'node:stream';
import { isCancel as promptsIsCancel } from '@clack/prompts';
import { describe, expect, it } from 'vitest';
import { pageableAutocompleteMultiselect, pageableSelect } from '../../src/ui/picker';

// clack drives the prompt off readline 'keypress' events on `input` and
// needs a TTY-shaped stream. Emitting 'keypress' directly is exactly
// what readline would do for a real keystroke.
class MockReadable extends Readable {
  isTTY = true;
  setRawMode(): this {
    return this;
  }
  override _read() {}
}

class MockWritable extends Writable {
  isTTY = true;
  columns = 120;
  rows = 30;
  override _write(_c: unknown, _e: unknown, cb: () => void) {
    cb();
  }
}

function press(input: MockReadable, name: string, char = ''): void {
  (input as unknown as EventEmitter).emit('keypress', char, {
    name,
    sequence: char,
    ctrl: false,
    meta: false,
    shift: false,
  });
}

const OPTIONS = [
  { label: 'warp', value: 'warp' },
  { label: 'iterm2', value: 'iterm2' },
  { label: 'docker', value: 'docker' },
];

function startPicker(input: MockReadable, output: MockWritable, initialValues?: string[]) {
  return pageableAutocompleteMultiselect<string>({
    message: 'Tracked packages',
    options: OPTIONS,
    required: false,
    ...(initialValues ? { initialValues } : {}),
    input,
    output,
  });
}

// pageableSelect carried the identical cast, and would have handed its
// first caller `undefined` the same way. It has no caller yet, so this is
// the only thing keeping the fix honest.
describe('regression: the single-select picker resolves a value too', () => {
  it('returns the focused value, not undefined', async () => {
    const input = new MockReadable();
    const promise = pageableSelect<string>({
      message: 'Pick one',
      options: OPTIONS,
      input,
      output: new MockWritable(),
    });

    press(input, 'down'); // focus iterm2
    press(input, 'return');

    expect(await promise).toBe('iterm2');
  });
});

// The picker subclasses `@clack/core`'s AutocompletePrompt while the
// callers test cancellation with `isCancel` from `@clack/prompts`. Core's
// cancel sentinel is a unique `Symbol('clack:cancel')`, so if the two
// packages ever resolve DIFFERENT copies of core, this check silently
// returns false and the sentinel is mistaken for a real answer — which
// is what produced `TypeError: arr.map is not a function` on Esc.
// Asserting through `@clack/prompts` (the caller's import, not core's)
// is what makes this test able to see the split.
describe('regression: a cancelled picker is recognised as cancelled', () => {
  it('resolves a sentinel that @clack/prompts isCancel accepts', async () => {
    const input = new MockReadable();
    const promise = startPicker(input, new MockWritable());

    press(input, 'escape');

    const result = await promise;
    expect(promptsIsCancel(result)).toBe(true);
  });
});

describe('regression: picker resolves package names, not undefined', () => {
  it('returns the selected values — never undefined', async () => {
    const input = new MockReadable();
    const promise = startPicker(input, new MockWritable());

    // Space only toggles once the prompt is navigating (clack gates it on
    // `isNavigating` so a space can still be typed into the filter).
    press(input, 'down'); // focus iterm2
    press(input, 'space', ' ');
    press(input, 'return');

    const result = await promise;
    expect(result).toEqual(['iterm2']);
    // The precise shape of the bug: a name-shaped hole that YAML writes
    // as `null` and the applist schema then rejects on the next load.
    expect(result).not.toContain(undefined);
  });

  it('preserves pre-selected tracked names when submitted untouched', async () => {
    const input = new MockReadable();
    const promise = startPicker(input, new MockWritable(), ['warp', 'iterm2']);

    press(input, 'return'); // submit without changing anything

    // A no-op Add/Remove must round-trip the tracked set intact. Under
    // the bug this returned [undefined, undefined], which diffed to
    // "remove everything, add null".
    expect(await promise).toEqual(['warp', 'iterm2']);
  });

  it('returns every selected value, in a multi-pick', async () => {
    const input = new MockReadable();
    const promise = startPicker(input, new MockWritable());

    press(input, 'down'); // focus iterm2
    press(input, 'space', ' ');
    press(input, 'down'); // focus docker
    press(input, 'space', ' ');
    press(input, 'return');

    expect(await promise).toEqual(['iterm2', 'docker']);
  });
});
