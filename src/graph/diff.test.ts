import { describe, expect, it } from 'vitest';
import base from '../../tests/data/diff-base.json';
import pr from '../../tests/data/diff-pr.json';
import { parseWorkflow } from '../parser/parseWorkflow';
import { diffRegions } from './diff';

const regionA = parseWorkflow(base).region;
const regionB = parseWorkflow(pr).region;
const { a, b } = diffRegions(regionA, regionB);

describe('diffRegions', () => {
  it('keeps unchanged actions unchanged', () => {
    expect(a.get('actions/Initialize_state')?.status).toBe('unchanged');
    expect(b.get('actions/Initialize_state')?.status).toBe('unchanged');
    expect(a.get('triggers/manual')?.status).toBe('unchanged');
  });

  it('flags a body change', () => {
    expect(b.get('actions/Compose_message')).toMatchObject({ status: 'changed', changed: true });
  });

  it('detects an addition and a removal', () => {
    expect(a.get('actions/Cleanup')?.status).toBe('removed');
    expect(b.get('actions/Notify')?.status).toBe('added');
  });

  it('matches a rename (same body) instead of remove+add', () => {
    const before = a.get('actions/Old_name');
    const after = b.get('actions/New_name');
    expect(before).toMatchObject({ status: 'renamed', changed: false, counterpartName: 'New_name' });
    expect(after).toMatchObject({ status: 'renamed', changed: false, counterpartName: 'Old_name' });
    // The old/new names are NOT reported as a plain removal/addition.
    expect(a.get('actions/Old_name')?.status).not.toBe('removed');
    expect(b.get('actions/New_name')?.status).not.toBe('added');
  });

  it('flags a renamed action whose body also changed', () => {
    const renamedChanged = parseWorkflow({
      definition: {
        triggers: {},
        actions: {
          A_old: { type: 'Http', inputs: { method: 'GET', uri: 'x' }, runAfter: {} },
        },
      },
    }).region;
    const renamedChanged2 = parseWorkflow({
      definition: {
        triggers: {},
        actions: {
          A_new: { type: 'Http', inputs: { method: 'POST', uri: 'x' }, runAfter: {} },
        },
      },
    }).region;
    const d = diffRegions(renamedChanged, renamedChanged2);
    expect(d.b.get('actions/A_new')).toMatchObject({ status: 'renamed', changed: true, counterpartName: 'A_old' });
  });
});
