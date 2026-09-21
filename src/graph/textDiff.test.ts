import { describe, expect, it } from 'vitest';
import { diffLines, similarityRatio } from './textDiff';

describe('diffLines', () => {
  it('marks unchanged, added, and removed lines', () => {
    const result = diffLines('a\nb\nc', 'a\nB\nc\nd');
    expect(result).toEqual([
      { type: 'same', text: 'a' },
      { type: 'del', text: 'b' },
      { type: 'add', text: 'B' },
      { type: 'same', text: 'c' },
      { type: 'add', text: 'd' },
    ]);
  });

  it('is all-same for identical text', () => {
    expect(diffLines('x\ny', 'x\ny').every((l) => l.type === 'same')).toBe(true);
  });
});

describe('similarityRatio', () => {
  it('is 1 for identical text and lower as they diverge', () => {
    expect(similarityRatio('a\nb\nc', 'a\nb\nc')).toBe(1);
    expect(similarityRatio('a\nb\nc\nd', 'a\nb\nc')).toBeGreaterThan(0.7);
    expect(similarityRatio('a\nb\nc', 'x\ny\nz')).toBe(0);
  });
});
