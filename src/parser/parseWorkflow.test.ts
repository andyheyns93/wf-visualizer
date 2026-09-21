import { describe, expect, it } from 'vitest';
import branching from '../../tests/data/branching.json';
import nested from '../../tests/data/nested.json';
import simple from '../../tests/data/simple.json';
import { buildFlow } from '../graph/layout';
import { findDefinition, parseWorkflow } from './parseWorkflow';
import type { WfNode } from './types';

/** Depth-first search for a node by name in a region tree. */
function findNode(nodes: WfNode[], name: string): WfNode | undefined {
  for (const n of nodes) {
    if (n.name === name) return n;
    for (const b of n.branches) {
      const hit = findNode(b.region.nodes, name);
      if (hit) return hit;
    }
  }
  return undefined;
}

describe('findDefinition', () => {
  it('finds a definition wrapped in { definition }', () => {
    const def = findDefinition({ definition: { actions: {}, triggers: {} } });
    expect(def).toHaveProperty('actions');
  });

  it('finds a bare definition (no wrapper)', () => {
    const def = findDefinition({ actions: { A: { type: 'Compose' } } });
    expect(def.actions).toBeDefined();
  });

  it('finds a definition under properties.definition (ARM shape)', () => {
    const def = findDefinition({ properties: { definition: { triggers: { t: {} } } } });
    expect(def.triggers).toBeDefined();
  });

  it('throws when no definition is present', () => {
    expect(() => findDefinition({ foo: 'bar' })).toThrow(/could not locate/i);
  });
});

describe('parseWorkflow — simple', () => {
  const { region } = parseWorkflow(simple);

  it('produces a trigger plus three actions', () => {
    expect(region.nodes).toHaveLength(4);
    expect(findNode(region.nodes, 'manual')?.category).toBe('trigger');
  });

  it('connects the trigger to the root action', () => {
    const edge = region.edges.find(
      (e) => e.source === 'triggers/manual' && e.target === 'actions/Initialize_count',
    );
    expect(edge).toBeDefined();
  });

  it('creates runAfter edges between actions', () => {
    const edge = region.edges.find((e) => e.target === 'actions/Response');
    expect(edge?.source).toBe('actions/Compose_greeting');
  });
});

describe('parseWorkflow — branching', () => {
  const { region } = parseWorkflow(branching);

  it('marks Condition as a container with then + else branches', () => {
    const condition = findNode(region.nodes, 'Condition');
    expect(condition?.isContainer).toBe(true);
    expect(condition?.branches.map((b) => b.label)).toEqual(['If true', 'If false']);
    expect(findNode(condition!.branches[0].region.nodes, 'Set_ok')).toBeDefined();
    expect(findNode(condition!.branches[1].region.nodes, 'Set_fail')).toBeDefined();
  });

  it('labels a non-default runAfter status', () => {
    const edge = region.edges.find((e) => e.target === 'actions/Handle_failure');
    expect(edge?.label).toBe('Failed, TimedOut');
  });

  it('labels the default Succeeded status', () => {
    const edge = region.edges.find((e) => e.target === 'actions/Condition');
    expect(edge?.label).toBe('Succeeded');
  });

  it('connects trigger to root action as a plain (statusless) edge', () => {
    const edge = region.edges.find((e) => e.source === 'triggers/When_a_HTTP_request_is_received');
    expect(edge?.target).toBe('actions/Get_item');
    expect(edge?.label).toBeUndefined();
    expect(edge?.statuses).toBeUndefined();
  });

  it('carries the run-after statuses as an array (for multi-status edges)', () => {
    const failEdge = region.edges.find((e) => e.target === 'actions/Handle_failure');
    expect(failEdge?.statuses).toEqual(['Failed', 'TimedOut']);

    const okEdge = region.edges.find((e) => e.target === 'actions/Condition');
    expect(okEdge?.statuses).toEqual(['Succeeded']);
  });
});

describe('parseWorkflow — nested', () => {
  const { region } = parseWorkflow(nested);

  it('nests a Switch inside a Foreach with 3 branches', () => {
    const foreach = findNode(region.nodes, 'For_each_order');
    expect(foreach?.type).toBe('Foreach');
    const sw = findNode(foreach!.branches[0].region.nodes, 'Switch_on_status');
    expect(sw?.isContainer).toBe(true);
    expect(sw?.branches.map((b) => b.label)).toEqual([
      'Case: shipped',
      'Case: cancelled',
      'Default',
    ]);
  });

  it('keeps runAfter edges scoped within a Switch case', () => {
    const sw = findNode(region.nodes, 'Switch_on_status')!;
    const cancelled = sw.branches.find((b) => b.label === 'Case: cancelled')!;
    const edge = cancelled.region.edges.find((e) => e.target.endsWith('/Notify_cancel'));
    expect(edge?.source).toContain('Refund');
  });
});

describe('parseWorkflow — run-after statuses', () => {
  it('carries multi-status (uppercase) run-after entries through as-is', () => {
    const { region } = parseWorkflow({
      definition: {
        triggers: {},
        actions: {
          Start: { type: 'Compose', inputs: 'go', runAfter: {} },
          Cleanup: { type: 'Compose', inputs: 'cleanup', runAfter: { Start: ['TIMEDOUT', 'SKIPPED', 'FAILED'] } },
        },
      },
    });
    const edge = region.edges.find((e) => e.target.endsWith('/Cleanup'));
    expect(edge?.statuses).toEqual(['TIMEDOUT', 'SKIPPED', 'FAILED']);
  });
});

describe('buildFlow', () => {
  it('renders every fixture without throwing and keeps edges valid', () => {
    for (const fixture of [simple, branching, nested]) {
      const { region } = parseWorkflow(fixture);
      const { nodes, edges } = buildFlow(region);
      expect(nodes.length).toBeGreaterThan(0);

      const ids = new Set(nodes.map((n) => n.id));
      for (const e of edges) {
        expect(ids.has(e.source)).toBe(true);
        expect(ids.has(e.target)).toBe(true);
      }
    }
  });

  it('carries the raw action definition into node data', () => {
    const { region } = parseWorkflow(simple);
    const { nodes } = buildFlow(region);
    const compose = nodes.find((n) => n.id === 'actions/Compose_greeting');
    const raw = (compose?.data as { raw?: Record<string, unknown> }).raw;
    expect(raw?.type).toBe('Compose');
    expect(raw?.inputs).toBe('Hello, world');
  });

  it('orders parents before their children', () => {
    const { region } = parseWorkflow(nested);
    const { nodes } = buildFlow(region);
    const index = new Map(nodes.map((n, i) => [n.id, i]));
    for (const n of nodes) {
      if (n.parentId) {
        expect(index.get(n.parentId)!).toBeLessThan(index.get(n.id)!);
      }
    }
  });

  it('hides descendants of a collapsed container but keeps the container', () => {
    const { region } = parseWorkflow(nested);
    const containerId = 'actions/For_each_order';

    const expanded = buildFlow(region);
    expect(expanded.nodes.some((n) => n.id.startsWith(`${containerId}::`))).toBe(true);

    const collapsed = buildFlow(region, new Set([containerId]));
    const container = collapsed.nodes.find((n) => n.id === containerId);
    expect((container?.data as { collapsed?: boolean }).collapsed).toBe(true);
    // No nested branch/child nodes of the collapsed container remain.
    expect(collapsed.nodes.some((n) => n.id.startsWith(`${containerId}::`))).toBe(false);
    // Sibling nodes and the container itself are still present.
    expect(collapsed.nodes.some((n) => n.id === 'actions/List_orders')).toBe(true);
    expect(collapsed.nodes.length).toBeLessThan(expanded.nodes.length);
  });
});
