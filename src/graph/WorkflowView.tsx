import type { Node } from '@xyflow/react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { parseWorkflow } from '../parser/parseWorkflow';
import { CollapseContext } from './CollapseContext';
import { Inspector } from './Inspector';
import { ScrambleContext } from './scramble';
import { WorkflowGraph } from './WorkflowGraph';
import { buildFlow } from './layout';

export interface WorkflowViewResult {
  nodeCount: number;
  edgeCount: number;
  error: string | null;
}

interface Props {
  /** Raw Logic App workflow JSON. */
  json: string;
  /** Notified whenever the parse result changes (node/edge counts, or an error). */
  onResult?: (result: WorkflowViewResult) => void;
  /** Canvas theme (default 'dark'). */
  theme?: 'light' | 'dark';
  /** Scramble names in the diagram (screenshots). */
  scramble?: boolean;
}

/**
 * Parses workflow JSON and renders the interactive graph with collapse + inspector wired
 * up. Owns its own collapse/selection state; remount (via `key`) to reset for a new file.
 */
export function WorkflowView({ json, onResult, theme = 'dark', scramble = false }: Props) {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  const toggle = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const result = useMemo(() => {
    try {
      const raw = JSON.parse(json);
      const parsed = parseWorkflow(raw);
      const flow = buildFlow(parsed.region, collapsed);
      return { flow, error: null as string | null };
    } catch (err) {
      return { flow: null, error: err instanceof Error ? err.message : String(err) };
    }
  }, [json, collapsed]);

  useEffect(() => {
    onResult?.({
      nodeCount: result.flow?.nodes.length ?? 0,
      edgeCount: result.flow?.edges.length ?? 0,
      error: result.error,
    });
  }, [result, onResult]);

  const collapseApi = useMemo(() => ({ collapsed, toggle }), [collapsed, toggle]);
  const selectedNode: Node | null =
    result.flow?.nodes.find((n) => n.id === selectedNodeId) ?? null;

  if (!result.flow) {
    return <div className="canvas__empty">{result.error ? `⚠ ${result.error}` : 'No workflow to display.'}</div>;
  }

  return (
    <ScrambleContext.Provider value={scramble}>
      <CollapseContext.Provider value={collapseApi}>
        <WorkflowGraph
          nodes={result.flow.nodes}
          edges={result.flow.edges}
          onSelect={(node) => setSelectedNodeId(node?.id ?? null)}
          theme={theme}
        />
        <Inspector node={selectedNode} onClose={() => setSelectedNodeId(null)} />
      </CollapseContext.Provider>
    </ScrambleContext.Provider>
  );
}
