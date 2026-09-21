import {
  Background,
  BackgroundVariant,
  Controls,
  ReactFlow,
  useNodesInitialized,
  useReactFlow,
  type Edge,
  type Node,
  type ReactFlowInstance,
  type Viewport,
} from '@xyflow/react';
import { useEffect, useRef } from 'react';
import { nodeTypes } from './nodes';
import { StatusEdge } from './StatusEdge';

const edgeTypes = { status: StatusEdge };
const FIT_OPTIONS = { padding: 0.15 };

// Canvas colors passed to React Flow's Background as props (can't be CSS variables), per theme.
// They mirror the Azure DevOps neutral themes (see the CSS tokens in styles.css / panel.css).
const CANVAS = {
  dark: { bg: '#1b1a19', dots: '#3b3a39' },
  light: { bg: '#faf9f8', dots: '#e1dfdd' },
} as const;

/**
 * Centers/fits the diagram once its nodes have actually been measured. Fitting on `<ReactFlow
 * fitView>` alone can run before measurement (or before the panel is sized), leaving the graph
 * off-center. Remounting (via the parent's `key`) re-fits for a new workflow.
 */
function FitOnReady() {
  const nodesInitialized = useNodesInitialized();
  const { fitView } = useReactFlow();
  const fitted = useRef(false);

  useEffect(() => {
    if (nodesInitialized && !fitted.current) {
      fitted.current = true;
      void fitView(FIT_OPTIONS);
    }
  }, [nodesInitialized, fitView]);

  return null;
}

interface Props {
  nodes: Node[];
  edges: Edge[];
  onSelect?: (node: Node | null) => void;
  theme?: 'light' | 'dark';
  onInit?: (instance: ReactFlowInstance) => void;
  onMoveStart?: () => void;
  onMove?: (viewport: Viewport) => void;
  onMoveEnd?: () => void;
}

export function WorkflowGraph({
  nodes,
  edges,
  onSelect,
  theme = 'dark',
  onInit,
  onMoveStart,
  onMove,
  onMoveEnd,
}: Props) {
  const c = CANVAS[theme];

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      fitView
      fitViewOptions={FIT_OPTIONS}
      proOptions={{ hideAttribution: true }}
      minZoom={0.05}
      maxZoom={2}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable
      onInit={onInit}
      onMoveStart={onMoveStart}
      onMove={(_, viewport) => onMove?.(viewport)}
      onMoveEnd={onMoveEnd}
      onNodeClick={(_, node) => {
        if (node.type !== 'branch') onSelect?.(node);
      }}
      onPaneClick={() => onSelect?.(null)}
      style={{ background: c.bg }}
    >
      <FitOnReady />
      <Background variant={BackgroundVariant.Dots} gap={22} size={1.4} color={c.dots} />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}
