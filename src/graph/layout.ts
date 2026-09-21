import dagre from '@dagrejs/dagre';
import type { Edge, Node } from '@xyflow/react';
import type { WfNode, WfRegion } from '../parser/types';
import type { DiffStatus, NodeDiff } from './diff';

/** Data carried on each React Flow node, consumed by the custom node components. */
export interface WfNodeData extends Record<string, unknown> {
  label: string;
  wfType?: string;
  category?: WfNode['category'];
  /** The raw WDL fragment for this node (undefined for synthetic branch groups). */
  raw?: unknown;
  /** True for scope containers that can be collapsed. */
  collapsible?: boolean;
  /** True when this container is currently collapsed. */
  collapsed?: boolean;
  /** Number of nested nodes hidden when collapsed. */
  childCount?: number;
  /** Diff status when rendering a PR diff. */
  diff?: DiffStatus;
  /** True when a changed/renamed node's body also differs. */
  diffChanged?: boolean;
  /** For renamed nodes: the counterpart's name on the other side. */
  counterpartName?: string;
  /** Highlighted as the current change (diff navigator). */
  focused?: boolean;
}

// Layout constants (px).
const NODE_W = 220;
const NODE_H = 64;
const RENAME_ROW_H = 18; // extra height for a renamed node's "↔ counterpart" line
const HEADER = 36; // header strip on scope/branch containers
const COLLAPSED_H = 44; // height of a collapsed scope (header only)
const PAD = 18; // inner padding around a container's content
const BRANCH_GAP = 28; // horizontal gap between sibling branches
const NODESEP = 44; // dagre: gap between nodes in the same rank
const RANKSEP = 56; // dagre: gap between ranks
const MIN_BRANCH_W = NODE_W + PAD * 2;

interface RegionLayout {
  width: number;
  height: number;
  /** The region's own nodes, positioned relative to the region origin (no parentId). */
  topNodes: Node[];
  /** All nested descendants, already carrying their parentId + relative positions. */
  descendants: Node[];
  edges: Edge[];
}

interface ContainerLayout {
  width: number;
  height: number;
  /** Branch groups + all their contents (parentIds set). */
  nodes: Node[];
  edges: Edge[];
}

/**
 * Per-build state. Layout depends on which containers are collapsed, so results cannot
 * be memoized across builds — the cache lives for a single buildFlow() call.
 */
interface Ctx {
  collapsed: Set<string>;
  cache: Map<string, ContainerLayout>;
  diff?: Map<string, NodeDiff>;
}

/** Count all nested nodes under a container (across every branch, recursively). */
function countDescendants(node: WfNode): number {
  let count = 0;
  for (const branch of node.branches) {
    for (const child of branch.region.nodes) {
      count += 1 + countDescendants(child);
    }
  }
  return count;
}

function isCollapsed(node: WfNode, ctx: Ctx): boolean {
  return node.isContainer && ctx.collapsed.has(node.id);
}

function sizeOf(node: WfNode, ctx: Ctx): { w: number; h: number } {
  if (!node.isContainer) {
    // Renamed nodes carry an extra "↔ counterpart" line — give them room so it isn't clipped.
    const renamed = ctx.diff?.get(node.id)?.status === 'renamed';
    return { w: NODE_W, h: renamed ? NODE_H + RENAME_ROW_H : NODE_H };
  }
  if (isCollapsed(node, ctx)) return { w: NODE_W, h: COLLAPSED_H };
  const c = layoutContainer(node, ctx);
  return { w: c.width, h: c.height };
}

function layoutContainer(node: WfNode, ctx: Ctx): ContainerLayout {
  const cached = ctx.cache.get(node.id);
  if (cached) return cached;

  const nodes: Node[] = [];
  const edges: Edge[] = [];
  let x = PAD;
  let maxBranchH = 0;

  for (const branch of node.branches) {
    const rl = layoutRegion(branch.region, ctx);
    const branchW = Math.max(rl.width + PAD * 2, MIN_BRANCH_W);
    const branchH = HEADER + Math.max(rl.height, NODE_H) + PAD;

    nodes.push({
      id: branch.id,
      type: 'branch',
      parentId: node.id,
      extent: 'parent',
      position: { x, y: HEADER },
      data: { label: branch.label },
      style: { width: branchW, height: branchH },
      selectable: false,
      draggable: false,
    });

    // The branch region's own nodes become children of the branch group, offset by
    // the branch's inner padding + header.
    for (const tn of rl.topNodes) {
      nodes.push({
        ...tn,
        parentId: branch.id,
        extent: 'parent',
        position: { x: tn.position.x + PAD, y: tn.position.y + HEADER },
      });
    }
    // Deeper descendants are already positioned relative to their own parents.
    nodes.push(...rl.descendants);
    edges.push(...rl.edges);

    maxBranchH = Math.max(maxBranchH, branchH);
    x += branchW + BRANCH_GAP;
  }

  const width = Math.max(x - BRANCH_GAP + PAD, MIN_BRANCH_W + PAD * 2);
  const height = HEADER + maxBranchH + PAD;

  const result: ContainerLayout = { width, height, nodes, edges };
  ctx.cache.set(node.id, result);
  return result;
}

function layoutRegion(region: WfRegion, ctx: Ctx): RegionLayout {
  const nodeById = new Map(region.nodes.map((n) => [n.id, n]));

  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'TB', nodesep: NODESEP, ranksep: RANKSEP, marginx: 0, marginy: 0 });
  g.setDefaultEdgeLabel(() => ({}));

  const descendants: Node[] = [];
  const edgesOut: Edge[] = [];

  for (const n of region.nodes) {
    const s = sizeOf(n, ctx);
    g.setNode(n.id, { width: s.w, height: s.h });
    // Only pull in a container's contents when it is expanded.
    if (n.isContainer && !isCollapsed(n, ctx)) {
      const c = layoutContainer(n, ctx);
      descendants.push(...c.nodes);
      edgesOut.push(...c.edges);
    }
  }

  const validEdges = region.edges.filter(
    (e) => nodeById.has(e.source) && nodeById.has(e.target),
  );
  for (const e of validEdges) g.setEdge(e.source, e.target);

  dagre.layout(g);

  // Compute the bounding box so we can normalize positions to start at (0, 0).
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of region.nodes) {
    const gn = g.node(n.id);
    const s = sizeOf(n, ctx);
    minX = Math.min(minX, gn.x - s.w / 2);
    minY = Math.min(minY, gn.y - s.h / 2);
    maxX = Math.max(maxX, gn.x + s.w / 2);
    maxY = Math.max(maxY, gn.y + s.h / 2);
  }
  if (!Number.isFinite(minX)) {
    minX = minY = maxX = maxY = 0;
  }

  const topNodes: Node[] = region.nodes.map((n) => {
    const gn = g.node(n.id);
    const s = sizeOf(n, ctx);
    const data: WfNodeData = {
      label: n.name,
      wfType: n.type,
      category: n.category,
      raw: n.raw,
    };
    if (n.isContainer) {
      data.collapsible = true;
      data.collapsed = isCollapsed(n, ctx);
      data.childCount = countDescendants(n);
    }
    const nodeDiff = ctx.diff?.get(n.id);
    if (nodeDiff) {
      data.diff = nodeDiff.status;
      data.diffChanged = nodeDiff.changed;
      data.counterpartName = nodeDiff.counterpartName;
    }
    const rfNode: Node = {
      id: n.id,
      type: n.category === 'trigger' ? 'trigger' : n.isContainer ? 'scope' : 'action',
      position: { x: gn.x - s.w / 2 - minX, y: gn.y - s.h / 2 - minY },
      data,
      style: { width: s.w, height: s.h },
    };
    return rfNode;
  });

  edgesOut.push(
    ...validEdges.map(
      (e): Edge => ({
        id: e.id,
        source: e.source,
        target: e.target,
        type: 'status',
        data: { statuses: e.statuses ?? [] },
      }),
    ),
  );

  return { width: maxX - minX, height: maxY - minY, topNodes, descendants, edges: edgesOut };
}

/**
 * Order nodes so every parent appears before its children — a React Flow requirement
 * for subflow (grouped) nodes.
 */
function orderByDepth(nodes: Node[]): Node[] {
  const parentOf = new Map(nodes.map((n) => [n.id, n.parentId]));
  const depthCache = new Map<string, number>();
  const depthOf = (id: string | undefined): number => {
    if (!id) return 0;
    const hit = depthCache.get(id);
    if (hit !== undefined) return hit;
    const d = depthOf(parentOf.get(id)) + (parentOf.get(id) ? 1 : 0);
    depthCache.set(id, d);
    return d;
  };
  return [...nodes].sort((a, b) => depthOf(a.id) - depthOf(b.id));
}

/**
 * Convert a parsed top-level region into laid-out React Flow nodes and edges.
 * `collapsed` is the set of scope-node ids whose contents should be hidden.
 */
export function buildFlow(
  region: WfRegion,
  collapsed: Set<string> = new Set(),
  diff?: Map<string, NodeDiff>,
): { nodes: Node[]; edges: Edge[] } {
  const ctx: Ctx = { collapsed, cache: new Map(), diff };
  const rl = layoutRegion(region, ctx);
  return { nodes: orderByDepth([...rl.topNodes, ...rl.descendants]), edges: rl.edges };
}
