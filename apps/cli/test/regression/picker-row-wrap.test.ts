// Regression guard for the phantom-blank-line bug.
//
// `renderColumnGrid` padded EVERY cell to the widest cell in its column —
// including the last cell of the row, which has no following column to
// align. When one option's hint was wider than the terminal (an npm
// search result's description, say), every short row was padded past the
// terminal edge, and the terminal wrapped each row's trailing spaces into
// a "blank" line. A 20-match search rendered as 40 lines, half of them
// empty. The over-wide row itself also wrapped, throwing off clack's
// line accounting when it erased the previous frame.
//
// The fix: pad all but the row's last cell, then clip the joined row to
// the layout's width budget. These tests drive the REAL prompt over mock
// streams and assert on the frames it writes: no rendered line may be
// wider than the terminal the prompt was told it has.

import type { EventEmitter } from 'node:events';
import { Readable, Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { pageableAutocompleteMultiselect } from '../../src/ui/picker';
import { stripAnsi, visualWidth } from '../../src/ui/width';

const COLUMNS = 60;

class MockReadable extends Readable {
  isTTY = true;
  setRawMode(): this {
    return this;
  }
  override _read() {}
}

class MockWritable extends Writable {
  isTTY = true;
  columns = COLUMNS;
  rows = 30;
  chunks: string[] = [];
  override _write(chunk: unknown, _e: unknown, cb: () => void) {
    this.chunks.push(String(chunk));
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

// One hint far wider than the terminal, amid short rows — the shape of
// the npm "yo" search that surfaced the bug.
const OPTIONS = [
  { label: 'yo', value: 'yo', hint: 'CLI tool for running Yeoman generators' },
  {
    label: 'prettier-plugin-html-template-literals',
    value: 'prettier-plugin-html-template-literals',
    hint:
      'Formats HTML within tagged template literals in Prettier which is ' +
      'useful for hyperHTML, lit-html, choo, hyperx, nanohtml, snabby, ' +
      'yo-yo, and others.',
  },
  { label: 'redux-yo', value: 'redux-yo', hint: 'yo' },
  { label: 'yo-static', value: 'yo-static', hint: 'Yo-yo static isomorphic site generator' },
];

describe('regression: picker rows never overflow the terminal width', () => {
  it('clips every rendered line to the terminal, padding none past it', async () => {
    const input = new MockReadable();
    const output = new MockWritable();
    const promise = pageableAutocompleteMultiselect<string>({
      message: 'Results for “yo”',
      options: OPTIONS,
      required: false,
      input,
      output,
    });

    press(input, 'escape');
    await promise;

    // Frames are repositioned with cursor moves, not newlines, so joining
    // chunks would glue one frame's last line to the next frame's first.
    // Split within each write instead.
    const lines = output.chunks.flatMap((chunk) => chunk.split('\n'));
    for (const line of lines) {
      // Under the bug, `□ yo  (CLI tool …)` came out padded to the width
      // of the prettier-plugin row — wider than the terminal — and the
      // over-wide row itself went out unclipped.
      expect(visualWidth(line)).toBeLessThanOrEqual(COLUMNS);
    }
  });

  it('marks the clipped row with an ellipsis instead of letting it wrap', async () => {
    const input = new MockReadable();
    const output = new MockWritable();
    const promise = pageableAutocompleteMultiselect<string>({
      message: 'Results for “yo”',
      options: OPTIONS,
      required: false,
      input,
      output,
    });

    press(input, 'escape');
    await promise;

    const plain = stripAnsi(output.chunks.join(''));
    expect(plain).toContain('…');
    // The clip cut the hint, not the name: the label must survive whole.
    expect(plain).toContain('prettier-plugin-html-template-literals');
  });
});
