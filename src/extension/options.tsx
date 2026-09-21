import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@xyflow/react/dist/style.css';
import '../styles.css';
import { ADO_SURFACE_UI } from '../config';
import { WorkflowDiffView } from '../graph/WorkflowDiffView';
import { WorkflowView } from '../graph/WorkflowView';
import { Dialog } from '../harness/Dialog';
import { ImportForm } from '../harness/ImportForm';
import { UploadIcon } from '../harness/UploadIcon';
import type { HarnessImport } from '../harness/importInput';
import type { AdoSurface } from './adoContext';
import './options.css';
import { DEFAULT_SETTINGS, getSettings, updateSettings, type Settings } from './settings';

/** Full-screen viewer for an imported workflow / diff, opened from the options page. */
function ImportViewer({
  result,
  theme,
  onClose,
}: {
  result: HarnessImport;
  theme: 'light' | 'dark';
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="opt-viewer">
      <header className="opt-viewer__header">
        <div className="opt-viewer__title">
          Imported {result.kind === 'pr' ? 'before/after diff' : 'workflow'}
        </div>
        <button className="opt-viewer__close" onClick={onClose} aria-label="Close viewer">
          ✕
        </button>
      </header>
      <div className="opt-viewer__canvas">
        {result.kind === 'single' ? (
          <WorkflowView json={result.json} theme={theme} />
        ) : (
          <WorkflowDiffView before={result.before} after={result.after} theme={theme} />
        )}
      </div>
    </div>
  );
}

const SURFACE_LABELS: Record<AdoSurface, string> = {
  file: 'File view',
  pullrequest: 'Pull request',
  pullrequestcreate: 'Create pull request',
  commit: 'Commit',
};

/** Apply the selected theme to the page. "auto" follows the OS, tracked live. */
function useThemedPage(theme: Settings['theme']) {
  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: dark)');
    const apply = () => {
      const resolved = theme === 'auto' ? (media?.matches ? 'dark' : 'light') : theme;
      document.documentElement.dataset.theme = resolved;
    };
    apply();
    if (theme === 'auto' && media) {
      media.addEventListener('change', apply);
      return () => media.removeEventListener('change', apply);
    }
  }, [theme]);
}

function Options() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [saved, setSaved] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [imported, setImported] = useState<HarnessImport | null>(null);

  useEffect(() => {
    getSettings().then(setSettings);
  }, []);

  useThemedPage(settings.theme);

  const viewerTheme: 'light' | 'dark' =
    settings.theme === 'auto'
      ? window.matchMedia?.('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : settings.theme;

  const change = (patch: Partial<Settings>) => {
    setSettings((s) => ({ ...s, ...patch }));
    void updateSettings(patch).then(() => {
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1500);
    });
  };

  const changeSelector = (surface: AdoSurface, field: 'container' | 'anchor', value: string) => {
    const next = { ...settings.devSelectors };
    const entry = { ...next[surface], [field]: value.trim() || undefined };
    if (!entry.container && !entry.anchor) delete next[surface];
    else next[surface] = entry;
    change({ devSelectors: next });
  };

  return (
    <div className="opt">
      <h1 className="opt__title">Workflow Visualizer</h1>
      <p className="opt__subtitle">Settings</p>

      <div className="opt__group">
        <button className="opt__import" onClick={() => setShowImport(true)}>
          <UploadIcon /> Import &amp; visualize a workflow…
        </button>
        <p className="opt__hint">
          Step through importing a workflow, a plain <code>workflow.json</code>, or an exported
          bundle — then view it as a graph or a before/after diff.
        </p>
      </div>

      <div className="opt__group">
        <label className="opt__row opt__row--select">
          <span>
            <span className="opt__label">Theme</span>
            <span className="opt__hint">“Automatic” follows the Azure DevOps page theme.</span>
          </span>
          <select
            value={settings.theme}
            onChange={(e) => change({ theme: e.target.value as Settings['theme'] })}
          >
            <option value="auto">Automatic</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>

        <label className="opt__row">
          <input
            type="checkbox"
            checked={settings.matchContentAreaFile}
            onChange={(e) => change({ matchContentAreaFile: e.target.checked })}
          />
          <span>
            <span className="opt__label">Match content area width — file view</span>
            <span className="opt__hint">
              Size the panel to the file content area instead of the full page.
            </span>
          </span>
        </label>

        <label className="opt__row">
          <input
            type="checkbox"
            checked={settings.matchContentAreaPr}
            onChange={(e) => change({ matchContentAreaPr: e.target.checked })}
          />
          <span>
            <span className="opt__label">Match content area width — pull request</span>
            <span className="opt__hint">
              Size the panel to the PR content area instead of the full page.
            </span>
          </span>
        </label>

      </div>

      <details className="opt__group opt__dev">
        <summary className="opt__label">Developer settings</summary>

        <label className="opt__row">
          <input
            type="checkbox"
            checked={settings.scramble}
            onChange={(e) => change({ scramble: e.target.checked })}
          />
          <span>
            <span className="opt__label">Scramble names &amp; paths (for screenshots)</span>
            <span className="opt__hint">
              Replace the org/project/repo, file path, and node names shown in the panel with
              deterministic gibberish so screenshots don’t leak private information. Display
              only — the underlying workflow is untouched.
            </span>
          </span>
        </label>

        <p className="opt__hint">
          Override the Azure DevOps DOM selectors used to place the panel and the ⬡ button.
          Leave blank to use the built-in defaults (shown as placeholders). Multiple built-in
          candidates are tried in order; an override replaces them.
        </p>
        {(Object.keys(ADO_SURFACE_UI) as AdoSurface[]).map((surface) => (
          <div className="opt__dev-surface" key={surface}>
            <div className="opt__label">{SURFACE_LABELS[surface]}</div>
            <label className="opt__dev-field">
              <span>Container</span>
              <input
                type="text"
                spellCheck={false}
                value={settings.devSelectors[surface]?.container ?? ''}
                placeholder={ADO_SURFACE_UI[surface].container.join(', ')}
                onChange={(e) => changeSelector(surface, 'container', e.target.value)}
              />
            </label>
            <label className="opt__dev-field">
              <span>Button anchor</span>
              <input
                type="text"
                spellCheck={false}
                value={settings.devSelectors[surface]?.anchor ?? ''}
                placeholder={ADO_SURFACE_UI[surface].anchor.join(', ')}
                onChange={(e) => changeSelector(surface, 'anchor', e.target.value)}
              />
            </label>
          </div>
        ))}
      </details>

      <div className="opt__saved">{saved ? '✓ Saved' : ''}</div>

      <Dialog open={showImport} onClose={() => setShowImport(false)} label="Import workflow">
        <ImportForm
          onImport={(r) => {
            setImported(r);
            setShowImport(false);
          }}
        />
      </Dialog>

      {imported && (
        <ImportViewer result={imported} theme={viewerTheme} onClose={() => setImported(null)} />
      )}
    </div>
  );
}

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <Options />
    </StrictMode>,
  );
}
