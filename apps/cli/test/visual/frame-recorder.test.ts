import { describe, expect, it } from 'vitest';
import { FrameRecorder } from './frame-recorder';

describe('FrameRecorder', () => {
  it('presents a fixed TTY shape and records writes', () => {
    const rec = new FrameRecorder({ columns: 80, rows: 24 });
    expect(rec.isTTY).toBe(true);
    expect(rec.columns).toBe(80);
    expect(rec.rows).toBe(24);
    rec.write('a');
    rec.write('b');
    expect(rec.bytes()).toBe('ab');
  });
});
