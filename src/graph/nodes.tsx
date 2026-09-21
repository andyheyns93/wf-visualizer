import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useCollapse } from './CollapseContext';
import type { WfNodeData } from './layout';
import { colorFor, monogram } from './palette';
import { useScramble } from './scramble';

function data(props: NodeProps): WfNodeData {
  return props.data as WfNodeData;
}

/** Diff status classes for a node (empty when not in a diff view). */
function diffClass(d: WfNodeData): string {
  let cls = '';
  if (d.diff) {
    cls += ` wf-diff--${d.diff}`;
    if ((d.diff === 'renamed' || d.diff === 'changed') && d.diffChanged) cls += ' wf-diff--changed';
  }
  if (d.focused) cls += ' wf-focused';
  return cls;
}

export function TriggerNode(props: NodeProps) {
  const d = data(props);
  const s = useScramble();
  const color = colorFor(d.wfType, 'trigger');
  return (
    <div className={`wf-node wf-node--trigger${diffClass(d)}`}>
      <div className="wf-node__head">
        <span className="wf-node__icon" style={{ background: color }}>
          {monogram(d.wfType)}
        </span>
        <span className="wf-node__type">{d.wfType} · trigger</span>
      </div>
      <div className="wf-node__name">{s(d.label)}</div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

export function ActionNode(props: NodeProps) {
  const d = data(props);
  const s = useScramble();
  const color = colorFor(d.wfType, 'action');
  return (
    <div className={`wf-node wf-node--action${diffClass(d)}`}>
      <Handle type="target" position={Position.Top} />
      <div className="wf-node__head">
        <span className="wf-node__icon" style={{ background: color }}>
          {monogram(d.wfType)}
        </span>
        <span className="wf-node__type">{d.wfType}</span>
      </div>
      <div className="wf-node__name">{s(d.label)}</div>
      {d.diff === 'renamed' && d.counterpartName && (
        <div className="wf-node__rename">↔ {s(d.counterpartName)}</div>
      )}
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

export function ScopeNode(props: NodeProps) {
  const d = data(props);
  const s = useScramble();
  const color = colorFor(d.wfType, 'scope');
  const { toggle } = useCollapse();
  const collapsed = d.collapsed === true;

  return (
    <div className={`wf-scope${collapsed ? ' wf-scope--collapsed' : ''}${diffClass(d)}`}>
      <Handle type="target" position={Position.Top} />
      <div className="wf-scope__header">
        <button
          className="wf-scope__toggle"
          onClick={(e) => {
            e.stopPropagation();
            toggle(props.id);
          }}
          aria-label={collapsed ? 'Expand' : 'Collapse'}
          title={collapsed ? 'Expand' : 'Collapse'}
        >
          {collapsed ? '▸' : '▾'}
        </button>
        <span className="wf-scope__icon" style={{ background: color }} />
        <span className="wf-scope__name">{s(d.label)}</span>
        <span className="wf-scope__badge">{d.wfType}</span>
        {collapsed && d.childCount ? (
          <span className="wf-scope__count">{d.childCount} hidden</span>
        ) : null}
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

export function BranchNode(props: NodeProps) {
  const d = data(props);
  return (
    <div className="wf-branch">
      <div className="wf-branch__header">{d.label}</div>
    </div>
  );
}

export const nodeTypes = {
  trigger: TriggerNode,
  action: ActionNode,
  scope: ScopeNode,
  branch: BranchNode,
};
