import type { ParsedWorkflow, WfBranch, WfEdge, WfNode, WfRegion } from './types';

/** WDL `type` values (lower-cased) that introduce nested scopes. */
const CONTAINER_TYPES = new Set(['if', 'switch', 'foreach', 'until', 'scope']);

// Minimal structural view of the WDL shapes we read. Everything is optional and
// defensively accessed, because real-world definitions vary and may be malformed.
type Json = Record<string, unknown>;

function asObject(value: unknown): Json {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Json)
    : {};
}

/**
 * Locate the workflow definition (the object holding `triggers`/`actions`) inside
 * an arbitrary JSON payload. Handles a bare definition, the Standard `{definition}`
 * wrapper, and the ARM `{properties:{definition}}` shape.
 */
export function findDefinition(raw: unknown): Json {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Workflow JSON must be an object.');
  }
  const root = raw as Json;
  const candidates: Json[] = [
    root,
    asObject(root.definition),
    asObject(asObject(root.properties).definition),
  ];
  for (const c of candidates) {
    if (c.actions || c.triggers) return c;
  }
  throw new Error(
    'Could not locate a workflow definition — no "actions" or "triggers" found.',
  );
}

/**
 * Format a `runAfter` status array into an edge label (e.g. "Succeeded",
 * "Failed, TimedOut"). Returns undefined only when no statuses are present.
 */
function formatStatuses(statuses: unknown): string | undefined {
  if (!Array.isArray(statuses) || statuses.length === 0) return undefined;
  return statuses.map(String).join(', ');
}

/** Build a branch (a nested region) from a container's actions object. */
function makeBranch(id: string, label: string, actions: unknown): WfBranch {
  return { id, label, region: parseRegion(asObject(actions), id) };
}

/** Derive the nested branches of a container action based on its type. */
function parseBranches(id: string, type: string, action: Json): WfBranch[] {
  switch (type) {
    case 'if': {
      const branches = [makeBranch(`${id}::then`, 'If true', action.actions)];
      const elseActions = asObject(action.else).actions;
      if (elseActions) branches.push(makeBranch(`${id}::else`, 'If false', elseActions));
      return branches;
    }
    case 'switch': {
      const branches: WfBranch[] = [];
      const cases = asObject(action.cases);
      for (const caseName of Object.keys(cases)) {
        const c = asObject(cases[caseName]);
        const label = `Case: ${c.case ?? caseName}`;
        branches.push(makeBranch(`${id}::case_${caseName}`, label, c.actions));
      }
      const defaultActions = asObject(action.default).actions;
      if (defaultActions) branches.push(makeBranch(`${id}::default`, 'Default', defaultActions));
      return branches;
    }
    case 'foreach':
      return [makeBranch(`${id}::do`, 'For each', action.actions)];
    case 'until':
      return [makeBranch(`${id}::do`, 'Until', action.actions)];
    default: // scope
      return [makeBranch(`${id}::do`, 'Scope', action.actions)];
  }
}

/** Parse a single action/trigger object into a node. */
function parseActionNode(
  id: string,
  name: string,
  action: Json,
  category: 'action' | 'trigger',
): WfNode {
  const type = String(action.type ?? (category === 'trigger' ? 'Trigger' : 'Unknown'));
  const isContainer = category === 'action' && CONTAINER_TYPES.has(type.toLowerCase());
  return {
    id,
    name,
    type,
    category: isContainer ? 'scope' : category,
    isContainer,
    branches: isContainer ? parseBranches(id, type.toLowerCase(), action) : [],
    raw: action,
  };
}

/**
 * Parse one scope level (an `actions` object) into a region: sibling nodes plus the
 * `runAfter` edges between them. `prefix` namespaces ids so identically-named actions
 * in different scopes stay unique.
 */
export function parseRegion(actions: Json, prefix: string): WfRegion {
  const nodes: WfNode[] = [];
  const edges: WfEdge[] = [];

  for (const name of Object.keys(actions)) {
    const action = asObject(actions[name]);
    const id = `${prefix}/${name}`;
    nodes.push(parseActionNode(id, name, action, 'action'));

    const runAfter = asObject(action.runAfter);
    for (const dep of Object.keys(runAfter)) {
      const raw = runAfter[dep];
      const statuses = Array.isArray(raw) ? raw.map(String) : [];
      edges.push({
        id: `${prefix}/${dep}->${name}`,
        source: `${prefix}/${dep}`,
        target: id,
        label: formatStatuses(raw),
        statuses,
      });
    }
  }

  return { nodes, edges };
}

/** True when an action has no `runAfter` dependencies (a root of its scope). */
function isRoot(action: Json): boolean {
  return Object.keys(asObject(action.runAfter)).length === 0;
}

/**
 * Parse an arbitrary Logic App JSON payload into a graph model. Triggers and root
 * actions are wired together at the top level.
 */
export function parseWorkflow(raw: unknown, title = 'Workflow'): ParsedWorkflow {
  const def = findDefinition(raw);
  const triggers = asObject(def.triggers);
  const actions = asObject(def.actions);

  const region = parseRegion(actions, 'actions');

  const triggerNodes: WfNode[] = [];
  for (const name of Object.keys(triggers)) {
    triggerNodes.push(
      parseActionNode(`triggers/${name}`, name, asObject(triggers[name]), 'trigger'),
    );
  }

  // Connect each trigger to every root action (actions with no runAfter). These are
  // implicit connectors (no runAfter status), so they render as plain neutral edges.
  const rootActions = Object.keys(actions).filter((name) => isRoot(asObject(actions[name])));
  const triggerEdges: WfEdge[] = [];
  for (const t of triggerNodes) {
    for (const rootName of rootActions) {
      triggerEdges.push({
        id: `${t.id}->actions/${rootName}`,
        source: t.id,
        target: `actions/${rootName}`,
      });
    }
  }

  return {
    title,
    region: {
      nodes: [...triggerNodes, ...region.nodes],
      edges: [...triggerEdges, ...region.edges],
    },
  };
}
