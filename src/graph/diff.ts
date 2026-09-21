import { RENAME_THRESHOLD } from '../config';
import type { WfNode, WfRegion } from '../parser/types';
import { similarityRatio } from './textDiff';

export type DiffStatus = 'added' | 'removed' | 'changed' | 'unchanged' | 'renamed';

export interface NodeDiff {
  status: DiffStatus;
  /** True when the node body differs (relevant for `changed` and `renamed`). */
  changed: boolean;
  /** Matched node id on the other side (for changed/unchanged/renamed). */
  counterpartId?: string;
  /** Matched node name on the other side (for renamed). */
  counterpartName?: string;
}

export interface GraphDiff {
  /** Keyed by node id in region A (before). */
  a: Map<string, NodeDiff>;
  /** Keyed by node id in region B (after). */
  b: Map<string, NodeDiff>;
}

/** Container keys whose nested actions are diffed separately (not part of the node body). */
const CONTAINER_CHILD_KEYS = ['actions', 'else', 'cases', 'default'];

/** Flatten a region (and all nested scopes) into an id → node map. */
export function flattenRegion(region: WfRegion, out = new Map<string, WfNode>()): Map<string, WfNode> {
  for (const node of region.nodes) {
    out.set(node.id, node);
    for (const branch of node.branches) flattenRegion(branch.region, out);
  }
  return out;
}

/** Deterministic JSON with sorted keys, for stable comparison + line diffing. */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value), null, 2);
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) out[key] = sortKeys(obj[key]);
    return out;
  }
  return value;
}

/**
 * The comparable "body" of a node (as an object): its raw definition minus `runAfter`
 * (compared as edges) and, for containers, minus the nested action collections (child nodes).
 */
export function nodeBodyValue(node: WfNode): Record<string, unknown> {
  const raw =
    node.raw && typeof node.raw === 'object' && !Array.isArray(node.raw)
      ? { ...(node.raw as Record<string, unknown>) }
      : {};
  delete raw.runAfter;
  if (node.isContainer) for (const key of CONTAINER_CHILD_KEYS) delete raw[key];
  return raw;
}

/** The node body as stable JSON text (for equality checks + line diffs). */
export function nodeBody(node: WfNode): string {
  return stableStringify(nodeBodyValue(node));
}

/**
 * Diff two parsed workflow regions. Nodes are matched first by id (same name + scope path),
 * then remaining add/remove candidates of the same type are matched as renames/moves by body
 * similarity — so a renamed (or moved) action is reported once, and still flagged `changed`
 * if its body differs.
 */
export function diffRegions(regionA: WfRegion, regionB: WfRegion): GraphDiff {
  const flatA = flattenRegion(regionA);
  const flatB = flattenRegion(regionB);

  const bodyA = new Map([...flatA].map(([id, n]) => [id, nodeBody(n)]));
  const bodyB = new Map([...flatB].map(([id, n]) => [id, nodeBody(n)]));

  const a = new Map<string, NodeDiff>();
  const b = new Map<string, NodeDiff>();
  const unmatchedA = new Set(flatA.keys());
  const unmatchedB = new Set(flatB.keys());

  // 1) Exact id match.
  for (const id of flatA.keys()) {
    if (!flatB.has(id)) continue;
    const changed = bodyA.get(id) !== bodyB.get(id);
    const status: DiffStatus = changed ? 'changed' : 'unchanged';
    a.set(id, { status, changed, counterpartId: id });
    b.set(id, { status, changed, counterpartId: id });
    unmatchedA.delete(id);
    unmatchedB.delete(id);
  }

  // 2) Rename / move detection among the remaining nodes (same type, similar body).
  const candidates: { aId: string; bId: string; score: number }[] = [];
  for (const aId of unmatchedA) {
    const an = flatA.get(aId)!;
    for (const bId of unmatchedB) {
      const bn = flatB.get(bId)!;
      if (an.type.toLowerCase() !== bn.type.toLowerCase()) continue;
      let score = similarityRatio(bodyA.get(aId)!, bodyB.get(bId)!);
      if (an.name === bn.name) score = Math.min(1, score + 0.1); // moved (same name, new scope)
      candidates.push({ aId, bId, score });
    }
  }
  candidates.sort((x, y) => y.score - x.score);

  const usedA = new Set<string>();
  const usedB = new Set<string>();
  for (const c of candidates) {
    if (c.score < RENAME_THRESHOLD) break;
    if (usedA.has(c.aId) || usedB.has(c.bId)) continue;
    usedA.add(c.aId);
    usedB.add(c.bId);
    const changed = bodyA.get(c.aId) !== bodyB.get(c.bId);
    a.set(c.aId, {
      status: 'renamed',
      changed,
      counterpartId: c.bId,
      counterpartName: flatB.get(c.bId)!.name,
    });
    b.set(c.bId, {
      status: 'renamed',
      changed,
      counterpartId: c.aId,
      counterpartName: flatA.get(c.aId)!.name,
    });
    unmatchedA.delete(c.aId);
    unmatchedB.delete(c.bId);
  }

  // 3) Whatever is left is a genuine remove / add.
  for (const id of unmatchedA) a.set(id, { status: 'removed', changed: false });
  for (const id of unmatchedB) b.set(id, { status: 'added', changed: false });

  return { a, b };
}
