import type { Edge, Node, ReactFlowInstance, Viewport } from '@xyflow/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DIFF_JUMP_DURATION_MS, DIFF_SYNC_ENABLE_DELAY_MS } from '../config';
import { parseWorkflow } from '../parser/parseWorkflow';
import type { WfRegion } from '../parser/types';
import { CollapseContext } from './CollapseContext';
import { ScrambleContext, useScramble, useScrambleObject } from './scramble';
import { WorkflowGraph } from './WorkflowGraph';
import type { WfNode } from '../parser/types';
import {
  diffRegions,
  flattenRegion,
  nodeBodyValue,
  stableStringify,
  type DiffStatus,
  type GraphDiff,
} from './diff';
import { JsonFieldsDiff } from './JsonView';
import { buildFlow } from './layout';
import { DIFF_COLORS, colorForStatus } from './palette';
import { diffLines } from './textDiff';

function runAfterEntries(node: WfNode | undefined): [string, unknown][] {
  const raw = node && typeof node.raw === 'object' && node.raw ? (node.raw as Record<string, unknown>) : {};
  const ra = raw.runAfter;
  return ra && typeof ra === 'object' && !Array.isArray(ra) ? Object.entries(ra as Record<string, unknown>) : [];
}

function RunAfterList({ entries }: { entries: [string, unknown][] }) {
  const scr = useScramble();
  if (entries.length === 0) return <div className="inspector__muted">Start — no dependencies</div>;
  return (
    <ul className="inspector__deps">
      {entries.map(([dep, statuses]) => {
        const list = Array.isArray(statuses) ? statuses.map(String) : ['Succeeded'];
        return (
          <li key={dep}>
            <span className="inspector__dep-name">{scr(dep)}</span>
            <span className="inspector__dep-statuses">
              {list.map((s, i) => (
                <span
                  key={i}
                  className="inspector__dep-dot"
                  style={{ background: colorForStatus(s) }}
                  title={s}
                />
              ))}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

interface Props {
  before: string | null;
  after: string | null;
  theme?: 'light' | 'dark';
  /** Scramble names in the diagram (screenshots). */
  scramble?: boolean;
}

const EMPTY: WfRegion = { nodes: [], edges: [] };

function safeRegion(json: string | null): WfRegion {
  if (!json) return EMPTY;
  try {
    return parseWorkflow(JSON.parse(json)).region;
  } catch {
    return EMPTY;
  }
}

interface Selected {
  id: string;
  side: 'a' | 'b';
}

interface Change {
  status: DiffStatus;
  name: string;
  aId?: string;
  bId?: string;
}

/** Ordered list of changes (document order: after-side first, then removals). */
function collectChanges(diff: GraphDiff, flatA: Map<string, { name: string }>, flatB: Map<string, { name: string }>): Change[] {
  const changes: Change[] = [];
  for (const [id, nd] of diff.b) {
    if (nd.status === 'unchanged') continue;
    changes.push({ status: nd.status, name: flatB.get(id)!.name, bId: id, aId: nd.counterpartId });
  }
  for (const [id, nd] of diff.a) {
    if (nd.status === 'removed') changes.push({ status: 'removed', name: flatA.get(id)!.name, aId: id });
  }
  return changes;
}

/** One side of the diff (its own collapse state), with viewport hooks for sync + jump. */
function DiffPane({
  title,
  nodes,
  edges,
  collapseValue,
  theme,
  onSelect,
  onInit,
  onMove,
}: {
  title: string;
  nodes: Node[];
  edges: Edge[];
  collapseValue: { collapsed: Set<string>; toggle: (id: string) => void };
  theme?: 'light' | 'dark';
  onSelect: (id: string | null) => void;
  onInit: (instance: ReactFlowInstance) => void;
  onMove: (viewport: Viewport) => void;
}) {
  return (
    <div className="wf-diff__pane">
      <div className="wf-diff__pane-title">{title}</div>
      <div className="wf-diff__canvas">
        <CollapseContext.Provider value={collapseValue}>
          <WorkflowGraph
            nodes={nodes}
            edges={edges}
            theme={theme}
            onSelect={(node) => onSelect(node?.id ?? null)}
            onInit={onInit}
            onMove={onMove}
          />
        </CollapseContext.Provider>
      </div>
    </div>
  );
}

function useCollapseState() {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const toggle = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  return useMemo(() => ({ collapsed, toggle }), [collapsed, toggle]);
}

/** Mark one node id as focused (for the navigator highlight) without rebuilding layout. */
function withFocus(nodes: Node[], focusId: string | undefined): Node[] {
  if (!focusId) return nodes;
  return nodes.map((n) => (n.id === focusId ? { ...n, data: { ...n.data, focused: true } } : n));
}

/** Scoped before/after JSON diff for the selected node. */
function DiffInspector({
  selected,
  diff,
  flatA,
  flatB,
  onClose,
}: {
  selected: Selected | null;
  diff: GraphDiff;
  flatA: ReturnType<typeof flattenRegion>;
  flatB: ReturnType<typeof flattenRegion>;
  onClose: () => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [view, setView] = useState<'fields' | 'raw'>('fields');
  const [tab, setTab] = useState<'definition' | 'runafter'>('definition');
  const scr = useScramble();
  const scrObj = useScrambleObject();
  if (!selected) return null;
  const map = selected.side === 'a' ? diff.a : diff.b;
  const nd = map.get(selected.id);
  const node = (selected.side === 'a' ? flatA : flatB).get(selected.id);
  if (!nd || !node) return null;

  const beforeNode = selected.side === 'a' ? node : nd.counterpartId ? flatA.get(nd.counterpartId) : undefined;
  const afterNode = selected.side === 'b' ? node : nd.counterpartId ? flatB.get(nd.counterpartId) : undefined;
  // Honor scramble mode: scramble each side's body (deterministic, so the diff still lines up).
  const beforeValue = beforeNode ? scrObj(nodeBodyValue(beforeNode)) : undefined;
  const afterValue = afterNode ? scrObj(nodeBodyValue(afterNode)) : undefined;
  const lines = diffLines(
    beforeNode ? stableStringify(beforeValue) : '',
    afterNode ? stableStringify(afterValue) : '',
  );
  const bothSides = !!beforeNode && !!afterNode;
  const showViewToggle = tab === 'definition';

  return (
    <div className={`inspector${collapsed ? ' inspector--collapsed' : ''}`}>
      <div className="inspector__header">
        <span className="inspector__icon" style={{ background: DIFF_COLORS[nd.status] }} />
        <div className="inspector__titles">
          <div className="inspector__name">{scr(node.name)}</div>
          <div className="inspector__type">
            {nd.status}
            {nd.status === 'renamed' && nd.counterpartName ? ` · ${scr(nd.counterpartName)}` : ''}
          </div>
        </div>
        <button
          className="inspector__close"
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? 'Expand' : 'Collapse'}
          title={collapsed ? 'Expand' : 'Collapse'}
        >
          {collapsed ? '▸' : '▾'}
        </button>
        <button className="inspector__close" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
      {!collapsed && (
        <>
          <div className="inspector__tabs">
            <div className="inspector__tabbtns">
              <button
                className={`inspector__tab${tab === 'definition' ? ' inspector__tab--active' : ''}`}
                onClick={() => setTab('definition')}
              >
                Definition
              </button>
              <button
                className={`inspector__tab${tab === 'runafter' ? ' inspector__tab--active' : ''}`}
                onClick={() => setTab('runafter')}
              >
                Runs after
              </button>
            </div>
            {showViewToggle && (
              <div className="inspector__viewtoggle">
                <button
                  className={view === 'fields' ? 'is-active' : ''}
                  onClick={() => setView('fields')}
                >
                  Fields
                </button>
                <button className={view === 'raw' ? 'is-active' : ''} onClick={() => setView('raw')}>
                  Raw
                </button>
              </div>
            )}
          </div>

          <div className="inspector__body">
            {tab === 'definition' ? (
              view === 'fields' ? (
                <JsonFieldsDiff before={beforeValue} after={afterValue} />
              ) : (
                <pre className="diff-lines">
                  {lines.map((line, i) => (
                    <div
                      key={i}
                      className={`diff-lines__row${line.type === 'add' ? ' diff-lines__row--add' : line.type === 'del' ? ' diff-lines__row--del' : ''}`}
                    >
                      {line.type === 'add' ? '+ ' : line.type === 'del' ? '- ' : '  '}
                      {line.text}
                    </div>
                  ))}
                </pre>
              )
            ) : (
              <>
                {beforeNode && (
                  <div>
                    {bothSides && <div className="inspector__label">Before</div>}
                    <RunAfterList entries={runAfterEntries(beforeNode)} />
                  </div>
                )}
                {afterNode && (
                  <div>
                    {bothSides && <div className="inspector__label">After</div>}
                    <RunAfterList entries={runAfterEntries(afterNode)} />
                  </div>
                )}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** Floating "Changes" window: counts + prev/next + expandable list. Jumps center both panes. */
function ChangeNavigator({
  changes,
  index,
  onJump,
  onUnset,
}: {
  changes: Change[];
  index: number;
  onJump: (i: number) => void;
  onUnset: () => void;
}) {
  const [open, setOpen] = useState(false);
  const scr = useScramble();
  const total = changes.length;
  const counts = useMemo(() => {
    const c = { added: 0, removed: 0, changed: 0, renamed: 0 } as Record<string, number>;
    for (const ch of changes) c[ch.status] = (c[ch.status] ?? 0) + 1;
    return c;
  }, [changes]);

  return (
    <div className="wf-diff-nav">
      <div className="wf-diff-nav__bar">
        <button
          className="wf-diff-nav__pos"
          onClick={onUnset}
          disabled={index < 0}
          title={index >= 0 ? 'Clear current change' : undefined}
          aria-label="Clear current change"
        >
          {total === 0 ? 'No changes' : `${index >= 0 ? index + 1 : '–'} / ${total}`}
          {index >= 0 ? ' ✕' : ''}
        </button>
        <button
          className="wf-diff-nav__btn"
          disabled={total === 0}
          onClick={() => onJump(index <= 0 ? total - 1 : index - 1)}
          aria-label="Previous change"
          title="Previous change"
        >
          ‹
        </button>
        <button
          className="wf-diff-nav__btn"
          disabled={total === 0}
          onClick={() => onJump(index >= total - 1 ? 0 : index + 1)}
          aria-label="Next change"
          title="Next change"
        >
          ›
        </button>
        <button
          className="wf-diff-nav__btn"
          disabled={total === 0}
          onClick={() => setOpen((o) => !o)}
          aria-label="Toggle change list"
          title="Toggle change list"
        >
          {open ? '▾' : '☰'}
        </button>
      </div>

      {open &&
        (total === 0 ? (
          <div className="wf-diff-nav__empty">No changes to review.</div>
        ) : (
          <ul className="wf-diff-nav__list">
            {changes.map((ch, i) => (
              <li
                key={`${ch.status}-${ch.aId ?? ''}-${ch.bId ?? ''}`}
                className={`wf-diff-nav__item${i === index ? ' wf-diff-nav__item--active' : ''}`}
                onClick={() => (i === index ? onUnset() : onJump(i))}
              >
                <span className="wf-diff-nav__dot" style={{ background: DIFF_COLORS[ch.status] }} />
                <span className="wf-diff-nav__name">{scr(ch.name)}</span>
                <span className="wf-diff-nav__tag">{ch.status}</span>
              </li>
            ))}
          </ul>
        ))}

      <div className="wf-diff__legend" style={{ borderTop: '1px solid var(--border)', borderBottom: 'none' }}>
        <span>
          <span className="wf-diff__swatch" style={{ background: DIFF_COLORS.added }} />
          <span className="wf-diff__count">{counts.added}</span> added
        </span>
        <span>
          <span className="wf-diff__swatch" style={{ background: DIFF_COLORS.removed }} />
          <span className="wf-diff__count">{counts.removed}</span> removed
        </span>
        <span>
          <span className="wf-diff__swatch" style={{ background: DIFF_COLORS.changed }} />
          <span className="wf-diff__count">{counts.changed}</span> changed
        </span>
        <span>
          <span className="wf-diff__swatch" style={{ background: DIFF_COLORS.renamed }} />
          <span className="wf-diff__count">{counts.renamed}</span> renamed
        </span>
      </div>
    </div>
  );
}

/** Side-by-side before/after diff, with change highlighting, sync, and a change navigator. */
export function WorkflowDiffView({ before, after, theme, scramble = false }: Props) {
  const regionA = useMemo(() => safeRegion(before), [before]);
  const regionB = useMemo(() => safeRegion(after), [after]);
  const diff = useMemo(() => diffRegions(regionA, regionB), [regionA, regionB]);
  const flatA = useMemo(() => flattenRegion(regionA), [regionA]);
  const flatB = useMemo(() => flattenRegion(regionB), [regionB]);
  const changes = useMemo(() => collectChanges(diff, flatA, flatB), [diff, flatA, flatB]);

  const collapseA = useCollapseState();
  const collapseB = useCollapseState();
  const flowA = useMemo(() => buildFlow(regionA, collapseA.collapsed, diff.a), [regionA, collapseA.collapsed, diff.a]);
  const flowB = useMemo(() => buildFlow(regionB, collapseB.collapsed, diff.b), [regionB, collapseB.collapsed, diff.b]);

  const [selected, setSelected] = useState<Selected | null>(null);
  const [index, setIndex] = useState(-1);

  const instA = useRef<ReactFlowInstance | null>(null);
  const instB = useRef<ReactFlowInstance | null>(null);
  const jumping = useRef(false);
  const syncOn = useRef(false);

  // Enable pan/zoom sync shortly after mount, so each pane's initial fit doesn't fight.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      syncOn.current = true;
    }, DIFF_SYNC_ENABLE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, []);

  // Real-time pan/zoom sync: mirror every viewport change onto the other pane. The
  // equality check swallows the echo move, and `jumping` protects navigator jumps.
  const syncFrom = useCallback((side: 'a' | 'b', vp: Viewport) => {
    if (!syncOn.current || jumping.current) return;
    const other = side === 'a' ? instB.current : instA.current;
    if (!other) return;
    const cur = other.getViewport();
    if (cur.x === vp.x && cur.y === vp.y && cur.zoom === vp.zoom) return;
    other.setViewport(vp);
  }, []);

  const focused = index >= 0 ? changes[index] : undefined;

  const jump = useCallback(
    (i: number) => {
      const change = changes[i];
      if (!change) return;
      setIndex(i);
      setSelected(change.bId ? { id: change.bId, side: 'b' } : change.aId ? { id: change.aId, side: 'a' } : null);
      jumping.current = true;
      const opts = { duration: DIFF_JUMP_DURATION_MS, maxZoom: 1.25, padding: 0.4 } as const;
      if (change.bId) instB.current?.fitView({ nodes: [{ id: change.bId }], ...opts });
      if (change.aId) instA.current?.fitView({ nodes: [{ id: change.aId }], ...opts });
      window.setTimeout(() => {
        jumping.current = false;
      }, DIFF_JUMP_DURATION_MS + 50);
    },
    [changes],
  );

  const unsetChange = useCallback(() => setIndex(-1), []);

  const nodesA = useMemo(() => withFocus(flowA.nodes, focused?.aId), [flowA.nodes, focused?.aId]);
  const nodesB = useMemo(() => withFocus(flowB.nodes, focused?.bId), [flowB.nodes, focused?.bId]);

  return (
    <ScrambleContext.Provider value={scramble}>
      <div className="wf-diff">
        <div className="wf-diff__panes">
          <DiffPane
            title="Before (target)"
            nodes={nodesA}
            edges={flowA.edges}
            collapseValue={collapseA}
            theme={theme}
            onSelect={(id) => setSelected(id ? { id, side: 'a' } : null)}
            onInit={(inst) => (instA.current = inst)}
            onMove={(vp) => syncFrom('a', vp)}
          />
          <DiffPane
            title="After (PR)"
            nodes={nodesB}
            edges={flowB.edges}
            collapseValue={collapseB}
            theme={theme}
            onSelect={(id) => setSelected(id ? { id, side: 'b' } : null)}
            onInit={(inst) => (instB.current = inst)}
            onMove={(vp) => syncFrom('b', vp)}
          />
        </div>

        <ChangeNavigator changes={changes} index={index} onJump={jump} onUnset={unsetChange} />
        <DiffInspector selected={selected} diff={diff} flatA={flatA} flatB={flatB} onClose={() => setSelected(null)} />
      </div>
    </ScrambleContext.Provider>
  );
}
