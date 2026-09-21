import type { Node } from '@xyflow/react';
import { useState } from 'react';
import { JsonFields } from './JsonView';
import type { WfNodeData } from './layout';
import { colorFor, colorForStatus, monogram } from './palette';
import { useScramble, useScrambleObject } from './scramble';

interface Props {
  node: Node | null;
  onClose: () => void;
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

type TabId = 'definition' | 'runafter';

export function Inspector({ node, onClose }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const [view, setView] = useState<'fields' | 'raw'>('fields');
  const [tab, setTab] = useState<TabId>('definition');
  const s = useScramble();
  const scrambleObj = useScrambleObject();
  if (!node) return null;

  const data = node.data as WfNodeData;
  const raw = asObject(data.raw);
  // Definition body honors scramble mode (names + all values); runAfter tab uses `s(dep)`.
  const defRaw = asObject(scrambleObj(raw));
  const runAfter = asObject(raw.runAfter);
  const runAfterEntries = Object.entries(runAfter);
  const color = colorFor(data.wfType, data.category);

  // Definition (default, full action) and Runs after.
  const tabs: { id: TabId; label: string }[] = [
    { id: 'definition', label: 'Definition' },
    { id: 'runafter', label: 'Runs after' },
  ];

  const activeTab: TabId = tabs.some((t) => t.id === tab) ? tab : 'definition';
  const showViewToggle = activeTab === 'definition';

  return (
    <div className={`inspector${collapsed ? ' inspector--collapsed' : ''}`}>
      <div className="inspector__header">
        <span className="inspector__icon" style={{ background: color }}>
          {monogram(data.wfType)}
        </span>
        <div className="inspector__titles">
          <div className="inspector__name">{s(data.label)}</div>
          <div className="inspector__type">
            {data.wfType}
            {data.category ? ` · ${data.category}` : ''}
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
              {tabs.map((t) => (
                <button
                  key={t.id}
                  className={`inspector__tab${t.id === activeTab ? ' inspector__tab--active' : ''}`}
                  onClick={() => setTab(t.id)}
                >
                  {t.label}
                </button>
              ))}
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
            {activeTab === 'runafter' ? (
              runAfterEntries.length === 0 ? (
                <div className="inspector__muted">Start — no dependencies</div>
              ) : (
                <ul className="inspector__deps">
                  {runAfterEntries.map(([dep, statuses]) => {
                    const list = Array.isArray(statuses) ? statuses.map(String) : ['Succeeded'];
                    return (
                      <li key={dep}>
                        <span className="inspector__dep-name">{s(dep)}</span>
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
              )
            ) : view === 'fields' ? (
              <JsonFields value={defRaw} />
            ) : (
              <pre className="inspector__code">{JSON.stringify(defRaw, null, 2)}</pre>
            )}
          </div>
        </>
      )}
    </div>
  );
}
