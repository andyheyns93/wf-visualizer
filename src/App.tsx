import { useState } from 'react';
import { STATUS_LEGEND } from './graph/palette';
import { WorkflowDiffView } from './graph/WorkflowDiffView';
import { WorkflowView } from './graph/WorkflowView';
import { Dialog } from './harness/Dialog';
import { ImportForm } from './harness/ImportForm';
import { fixtures } from './harness/fixtures';
import type { HarnessImport } from './harness/importInput';

/** `npm run dev:sample` sets this (via .env.sample); plain `npm run dev` starts empty. */
const SHOW_SAMPLES = import.meta.env.VITE_SAMPLES === 'true';

type Diff = { before: string | null; after: string | null; path?: string };

export default function App() {
  const [selectedId, setSelectedId] = useState(SHOW_SAMPLES ? fixtures[0].id : '');
  const [text, setText] = useState(SHOW_SAMPLES ? fixtures[0].json : '');
  const [diff, setDiff] = useState<Diff | null>(null);
  const [showImport, setShowImport] = useState(false);

  const selectFixture = (id: string) => {
    const fixture = fixtures.find((f) => f.id === id);
    if (!fixture) return;
    setDiff(null);
    setSelectedId(id);
    setText(fixture.json);
  };

  const applyImport = (result: HarnessImport) => {
    setSelectedId('');
    if (result.kind === 'single') {
      setDiff(null);
      setText(result.json);
    } else {
      setText('');
      setDiff({ before: result.before, after: result.after, path: result.path });
    }
  };

  /** Close the current graph/diff and return to the empty step-by-step importer. */
  const reset = () => {
    setDiff(null);
    setSelectedId('');
    setText('');
  };

  const hasGraph = !!diff || text.trim().length > 0;
  // What's currently open — shown in the context row under the header.
  const openLabel = diff
    ? (diff.path ?? 'Imported before/after diff')
    : selectedId
      ? (fixtures.find((f) => f.id === selectedId)?.name ?? 'Sample workflow')
      : 'Imported workflow';

  return (
    <div className="app">
      <header className="hz-header">
        <div className="hz-titles">
          <div className="hz-title">Workflow Visualizer</div>
          <div className="hz-sub">standalone dev harness</div>
        </div>
        <div className="hz-actions">
          {SHOW_SAMPLES && (
            <select
              className="hz-select"
              value={selectedId}
              onChange={(e) => selectFixture(e.target.value)}
            >
              <option value="" disabled>
                Samples…
              </option>
              {fixtures.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          )}
          {hasGraph && (
            <button className="hz-icon-btn" onClick={reset} title="Close workflow" aria-label="Close workflow">
              ✕
            </button>
          )}
        </div>
      </header>

      {hasGraph && (
        <div className="wf-ext-context">
          <span className="wf-ext-surface">{openLabel}</span>
        </div>
      )}

      <main className="hz-canvas">
        {diff ? (
          <WorkflowDiffView before={diff.before} after={diff.after} theme="dark" />
        ) : text.trim() ? (
          <WorkflowView key={selectedId || 'custom'} json={text} />
        ) : (
          <div className="hz-empty">
            <div className="hz-import-inline">
              <ImportForm onImport={applyImport} />
              {SHOW_SAMPLES && (
                <div className="hz-empty__samples">
                  <div className="hz-empty__label">or open a sample</div>
                  <div className="fixture-list">
                    {fixtures.map((f) => (
                      <button key={f.id} className="fixture" onClick={() => selectFixture(f.id)}>
                        {f.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {!diff && text.trim() && (
          <div className="hz-legend">
            <div className="hz-legend__title">Run-after status</div>
            {STATUS_LEGEND.map((s) => (
              <div key={s.label} className="legend__item">
                <span className="legend__swatch" style={{ background: s.color }} />
                {s.label}
              </div>
            ))}
          </div>
        )}
      </main>

      <Dialog open={showImport} onClose={() => setShowImport(false)} label="Import workflow">
        <ImportForm
          onImport={(r) => {
            applyImport(r);
            setShowImport(false);
          }}
        />
      </Dialog>
    </div>
  );
}
