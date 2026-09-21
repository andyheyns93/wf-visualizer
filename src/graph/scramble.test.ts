import { describe, expect, it } from 'vitest';
import { scrambleText } from './scramble';

describe('scrambleText', () => {
  it('is deterministic (same input → same output)', () => {
    expect(scrambleText('Initialize_CustomerId')).toBe(scrambleText('Initialize_CustomerId'));
  });

  it('hides the original text', () => {
    const input = 'sb-events-to-app-member';
    const out = scrambleText(input);
    expect(out).not.toBe(input);
    expect(out).not.toContain('events');
    expect(out).not.toContain('member');
  });

  it('preserves length, case class, and non-alphanumeric separators', () => {
    const out = scrambleText('/src/Workflows/wf/workflow.json');
    expect(out).toHaveLength('/src/Workflows/wf/workflow.json'.length);
    // Slashes and dots (path structure) are untouched, so it still reads as a path.
    expect(out.startsWith('/')).toBe(true);
    expect(out.split('/')).toHaveLength(5);
    expect(out).toContain('.');
    // Letters map to letters of the same case; digits to digits; separators unchanged.
    for (let i = 0; i < out.length; i++) {
      const a = '/src/Workflows/wf/workflow.json'[i];
      const b = out[i];
      if (/[a-z]/.test(a)) expect(b).toMatch(/[a-z]/);
      else if (/[A-Z]/.test(a)) expect(b).toMatch(/[A-Z]/);
      else if (/[0-9]/.test(a)) expect(b).toMatch(/[0-9]/);
      else expect(b).toBe(a);
    }
  });

  it('keeps repeated identifiers consistent (so a node and its runAfter match)', () => {
    expect(scrambleText('Read_Message')).toBe(scrambleText('Read_Message'));
    expect(scrambleText('Read_Message')).not.toBe(scrambleText('Parse_JSON_Request'));
  });

  it('returns empty for empty input', () => {
    expect(scrambleText('')).toBe('');
  });
});
