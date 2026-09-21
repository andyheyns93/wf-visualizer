import { describe, expect, it } from 'vitest';
import simple from '../../tests/data/simple.json';
import { isLikelyWorkflowPath, parseIfWorkflow } from './detectWorkflow';

describe('isLikelyWorkflowPath', () => {
  it('accepts .json paths (case-insensitive)', () => {
    expect(isLikelyWorkflowPath('/ProjectName/Workflows/wf/workflow.json')).toBe(true);
    expect(isLikelyWorkflowPath('/a/B.JSON')).toBe(true);
  });

  it('rejects non-json paths and missing paths', () => {
    expect(isLikelyWorkflowPath('/src/readme.md')).toBe(false);
    expect(isLikelyWorkflowPath(undefined)).toBe(false);
  });
});

describe('parseIfWorkflow', () => {
  it('returns the text when it is a valid Logic App workflow', () => {
    const text = JSON.stringify(simple);
    expect(parseIfWorkflow(text)).toBe(text);
  });

  it('returns null for JSON that is not a workflow', () => {
    expect(parseIfWorkflow('{"hello":"world"}')).toBeNull();
  });

  it('returns null for invalid JSON', () => {
    expect(parseIfWorkflow('not json')).toBeNull();
  });
});
