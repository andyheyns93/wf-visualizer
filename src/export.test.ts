import { describe, expect, it } from 'vitest';
import branching from '../tests/data/branching.json';
import nested from '../tests/data/nested.json';
import { buildExport, exportFilename, parseImport, scrambleWorkflow } from './export';
import { buildFlow } from './graph/layout';
import { parseWorkflow } from './parser/parseWorkflow';

const NOW = '2026-08-07T09:30:00.000Z';

/** Node + edge counts and the sorted node-type multiset — the graph's structural fingerprint. */
function fingerprint(json: unknown) {
  const { region } = parseWorkflow(json);
  const { nodes, edges } = buildFlow(region);
  const types = nodes.map((n) => (n.data as { wfType?: string }).wfType ?? n.type).sort();
  return { nodes: nodes.length, edges: edges.length, types };
}

describe('scrambleWorkflow', () => {
  for (const [name, wf] of [
    ['branching', branching],
    ['nested', nested],
  ] as const) {
    it(`preserves the graph structure of the ${name} workflow`, () => {
      const scrambled = scrambleWorkflow(wf);
      expect(fingerprint(scrambled)).toEqual(fingerprint(wf));
    });
  }

  it('scrambles action names but keeps types and runAfter statuses', () => {
    const scrambled = scrambleWorkflow(branching) as {
      definition: { actions: Record<string, { type: string; runAfter?: Record<string, string[]> }> };
    };
    const keys = Object.keys(scrambled.definition.actions);
    // Real names are gone…
    expect(keys).not.toContain('Get_item');
    expect(keys).not.toContain('Handle_failure');
    // …types are intact…
    const types = Object.values(scrambled.definition.actions).map((a) => a.type);
    expect(types).toContain('If');
    expect(types).toContain('Terminate');
    // …and run-after statuses survive (edge colors).
    const statuses = Object.values(scrambled.definition.actions)
      .flatMap((a) => Object.values(a.runAfter ?? {}))
      .flat();
    expect(statuses).toContain('Failed');
    expect(statuses).toContain('TimedOut');
  });

  it('scrambles string values too, so private data (e.g. URLs) is gone', () => {
    // nested.json contains `https://api.example.com/orders` in an action's inputs — the
    // inspector renders these values, so scramble must reach them.
    const out = JSON.stringify(scrambleWorkflow(nested));
    expect(out).not.toContain('api.example.com');
    expect(out).not.toContain('List_orders');
  });

  it('renames a runAfter dependency to match its (renamed) action key', () => {
    // In branching, Condition runs after Get_item. After scramble the edge must still connect.
    const s = scrambleWorkflow(branching) as {
      definition: { actions: Record<string, { runAfter?: Record<string, unknown> }> };
    };
    const actionKeys = new Set(Object.keys(s.definition.actions));
    for (const action of Object.values(s.definition.actions)) {
      for (const dep of Object.keys(action.runAfter ?? {})) {
        // Every dependency name resolves to a real (renamed) action key — no dangling edges.
        if (dep) expect(actionKeys.has(dep)).toBe(true);
      }
    }
  });
});

describe('buildExport', () => {
  it('builds a scrambled single bundle and hides the path', () => {
    const bundle = buildExport({
      type: 'single',
      scramble: true,
      now: NOW,
      path: '/src/Workflows/wf/workflow.json',
      workflow: JSON.stringify(branching),
    });
    expect(bundle.format).toBe('wf-visualizer-export');
    expect(bundle.type).toBe('single');
    expect(bundle.scrambled).toBe(true);
    expect(bundle.path).not.toContain('Workflows');
    expect(bundle.before).toBeUndefined();
    expect(fingerprint(bundle.workflow)).toEqual(fingerprint(branching));
  });

  it('leaves data intact when scramble is off', () => {
    const bundle = buildExport({
      type: 'single',
      scramble: false,
      now: NOW,
      path: '/a/workflow.json',
      workflow: JSON.stringify(branching),
    });
    expect(bundle.scrambled).toBe(false);
    expect(bundle.path).toBe('/a/workflow.json');
    expect(bundle.workflow).toEqual(branching);
  });

  it('builds a pr bundle with before/after (null-safe)', () => {
    const bundle = buildExport({
      type: 'pr',
      scramble: true,
      now: NOW,
      before: JSON.stringify(branching),
      after: null,
    });
    expect(bundle.type).toBe('pr');
    expect(bundle.workflow).toBeUndefined();
    expect(fingerprint(bundle.before)).toEqual(fingerprint(branching));
    expect(bundle.after).toBeNull();
  });
});

describe('exportFilename', () => {
  it('is filesystem-friendly and marks scrambled bundles', () => {
    const name = exportFilename(buildExport({ type: 'single', scramble: true, now: NOW }));
    expect(name).toBe('wf-visualizer-single-scrambled-2026-08-07_09-30-00.json');
    expect(name).not.toMatch(/[:.](?!json)/);
  });
});

describe('parseImport', () => {
  it('round-trips a built bundle', () => {
    const bundle = buildExport({ type: 'single', scramble: false, now: NOW, workflow: JSON.stringify(nested) });
    expect(parseImport(JSON.stringify(bundle))).toEqual(bundle);
  });

  it('rejects non-bundles and invalid JSON', () => {
    expect(parseImport(JSON.stringify(branching))).toBeNull();
    expect(parseImport('{"format":"something-else","type":"single"}')).toBeNull();
    expect(parseImport('not json')).toBeNull();
  });
});
