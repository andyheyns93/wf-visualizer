/** Category of a node in the workflow graph. */
export type NodeCategory = 'trigger' | 'action' | 'scope';

/** A directed dependency edge (from a `runAfter` relationship). */
export interface WfEdge {
  id: string;
  source: string;
  target: string;
  /** Human label for the run-after statuses (e.g. "Failed, TimedOut"). */
  label?: string;
  /** The raw run-after statuses that trigger this edge (e.g. ["Failed", "TimedOut"]). */
  statuses?: string[];
}

/** A nested branch of a control-flow container (an If branch, a Switch case, etc.). */
export interface WfBranch {
  id: string;
  label: string;
  region: WfRegion;
}

/** A single node: a trigger, a leaf action, or a control-flow scope. */
export interface WfNode {
  /** Unique, path-based id (e.g. `actions/Condition::then/Set_ok`). */
  id: string;
  /** The action/trigger name (the key in the WDL object). */
  name: string;
  /** The WDL `type` (e.g. `Http`, `If`, `Foreach`). */
  type: string;
  category: NodeCategory;
  /** True for control-flow scopes that contain nested branches. */
  isContainer: boolean;
  /** Nested branches (empty for leaf actions and triggers). */
  branches: WfBranch[];
  /** The raw WDL fragment for this node (for the inspector, later). */
  raw: unknown;
}

/** A set of sibling nodes and the edges between them (one scope level). */
export interface WfRegion {
  nodes: WfNode[];
  edges: WfEdge[];
}

/** Top-level parse result. */
export interface ParsedWorkflow {
  title: string;
  region: WfRegion;
}
