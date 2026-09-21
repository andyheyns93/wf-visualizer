import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import {
  ADO_COMPARE_PATH_SELECTOR,
  ADO_SURFACE_UI,
  FETCH_WARMUP_ATTEMPTS,
  FETCH_WARMUP_DELAY_MS,
  PANEL_HIDE_DEBOUNCE_MS,
} from '../config';
import { WorkflowDiffView } from '../graph/WorkflowDiffView';
import { WorkflowView } from '../graph/WorkflowView';
import { scrambleText } from '../graph/scramble';
import { buildExport, exportFilename, type ExportType } from '../export';
import { fetchWorkflowViaCookie } from './adoApi';
import { detectAdoContext, type AdoContext, type AdoRef } from './adoContext';
import { detectAdoTheme, subscribeAdoTheme, type Theme } from './adoTheme';
import { isLikelyWorkflowPath, parseIfWorkflow } from './detectWorkflow';
import { subscribeLocation } from './location';
import type { ContentMessage, FetchPrDiffResponse, FetchWorkflowResponse } from './messaging';
import { DEFAULT_SETTINGS, getSettings, onSettingsChanged, type Settings } from './settings';
import { useElement, useElementText, useInsertBefore, useRect } from './useDomTarget';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const iconSvg = {
  width: 16,
  height: 16,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
} as const;

/** Three vertical dots — the actions menu toggle. */
function KebabIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="12" cy="5" r="1.7" />
      <circle cx="12" cy="12" r="1.7" />
      <circle cx="12" cy="19" r="1.7" />
    </svg>
  );
}

/** Download-to-tray — export. */
function DownloadIcon() {
  return (
    <svg {...iconSvg}>
      <path d="M12 3v12" />
      <path d="M8 11l4 4 4-4" />
      <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
    </svg>
  );
}

/** Gear — settings. */
function CogIcon() {
  return (
    <svg {...iconSvg}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

/** Trigger a client-side download of `data` as pretty-printed JSON. */
function downloadJson(data: unknown, filename: string): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Resolves the effective theme: an explicit setting, or the ADO page theme when `auto`. */
function useResolvedTheme(setting: Settings['theme']): Theme {
  const [adoTheme, setAdoTheme] = useState<Theme>(() => detectAdoTheme());
  useEffect(() => subscribeAdoTheme(() => setAdoTheme(detectAdoTheme())), []);
  return setting === 'auto' ? adoTheme : setting;
}

/** Reads the user settings and keeps them in sync when edited on the options page. */
function useSettings(): Settings {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  useEffect(() => {
    let active = true;
    getSettings().then((s) => {
      if (active) setSettings(s);
    });
    const unsub = onSettingsChanged(setSettings);
    return () => {
      active = false;
      unsub();
    };
  }, []);
  return settings;
}

/** Bumps a counter whenever the background reports the ADO app fetched a workflow file. */
function useWorkflowChangedSignal(): number {
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    const listener = (message: ContentMessage) => {
      if (message?.type === 'wf/workflowChanged') setNonce((n) => n + 1);
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }, []);
  return nonce;
}

type Loaded =
  | { kind: 'single'; path: string; json: string; ref?: AdoRef }
  | { kind: 'diff'; path: string; before: string | null; after: string | null };

type Load =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; loaded: Loaded }
  | { status: 'unavailable' };

/** Tracks the current URL, re-reading it on SPA navigation. */
function useLocationHref(): string {
  const [href, setHref] = useState(() => window.location.href);
  useEffect(() => subscribeLocation(() => setHref(window.location.href)), []);
  return href;
}

/**
 * A stable identity for the workflow a context points at (drives re-fetch). Returns null when
 * there's nothing to show — for PR / create-PR that means the compare toolbar isn't showing an
 * open workflow file (`comparePath`), so the button stays hidden until one is opened.
 */
function loadKey(context: AdoContext | null, comparePath: string | null): string | null {
  if (!context) return null;
  if (context.surface === 'file') {
    return isLikelyWorkflowPath(context.path)
      ? ['file', context.host, context.org, context.project, context.repo, context.path, context.version ?? ''].join('|')
      : null;
  }
  // Compare surfaces (PR / create-PR / commit): require an open workflow file (from the
  // compare toolbar).
  if (!isLikelyWorkflowPath(comparePath ?? undefined)) return null;
  return [
    'diff',
    context.host,
    context.org,
    context.project,
    context.repo,
    context.pullRequestId ?? '',
    context.sourceRef ?? '',
    context.targetRef ?? '',
    context.commit ?? '',
    comparePath ?? '',
  ].join('|');
}

async function loadWorkflow(context: AdoContext, comparePath: string | null): Promise<Loaded | null> {
  return context.surface === 'file' ? loadSingle(context) : loadPrDiff(context, comparePath);
}

async function loadSingle(context: AdoContext): Promise<Loaded | null> {
  const contextPath = context.path ?? '';

  for (let attempt = 0; attempt < FETCH_WARMUP_ATTEMPTS; attempt++) {
    let resp: FetchWorkflowResponse | undefined;
    try {
      resp = (await chrome.runtime.sendMessage({ type: 'wf/fetchWorkflow', context })) as FetchWorkflowResponse;
    } catch {
      resp = undefined;
    }
    if (resp?.ok) {
      const json = parseIfWorkflow(resp.text);
      return json
        ? { kind: 'single', json, path: resp.path || contextPath, ref: resp.ref ?? context.ref }
        : null;
    }
    if (resp?.reason === 'no-token') {
      await delay(FETCH_WARMUP_DELAY_MS); // token arrives once the ADO app makes its first API call
      continue;
    }
    break; // unauthorized / not-found / error → try the cookie fallback
  }

  // Cookie fallback needs a concrete path to build the URL, so file surface only.
  if (context.surface === 'file' && isLikelyWorkflowPath(context.path)) {
    try {
      const json = parseIfWorkflow(await fetchWorkflowViaCookie(context));
      return json ? { kind: 'single', json, path: contextPath, ref: context.ref } : null;
    } catch {
      return null;
    }
  }
  return null;
}

async function loadPrDiff(context: AdoContext, path: string | null): Promise<Loaded | null> {
  for (let attempt = 0; attempt < FETCH_WARMUP_ATTEMPTS; attempt++) {
    let resp: FetchPrDiffResponse | undefined;
    try {
      resp = (await chrome.runtime.sendMessage({
        type: 'wf/fetchPrDiff',
        context,
        path: path ?? undefined,
      })) as FetchPrDiffResponse;
    } catch {
      resp = undefined;
    }
    if (resp?.ok) {
      const before = resp.before && parseIfWorkflow(resp.before) ? resp.before : null;
      const after = resp.after && parseIfWorkflow(resp.after) ? resp.after : null;
      if (!before && !after) return null; // neither side is a workflow
      return { kind: 'diff', path: resp.path, before, after };
    }
    if (resp?.reason === 'no-token') {
      await delay(FETCH_WARMUP_DELAY_MS);
      continue;
    }
    break;
  }
  return null;
}

function useWorkflow(
  context: AdoContext | null,
  reloadNonce: number,
  comparePath: string | null,
): Load {
  const key = loadKey(context, comparePath);
  const [state, setState] = useState<Load>({ status: 'idle' });

  useEffect(() => {
    if (!context || !key) {
      setState({ status: 'idle' });
      return;
    }
    let cancelled = false;
    setState({ status: 'loading' });
    loadWorkflow(context, comparePath).then((loaded) => {
      if (cancelled) return;
      setState(loaded ? { status: 'ready', loaded } : { status: 'unavailable' });
    });
    return () => {
      cancelled = true;
    };
    // Re-run when the target (or open file) changes, or the background signals a fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, reloadNonce]);

  return state;
}

/**
 * In-page UI. Appears only when the file open on the current Azure DevOps page is a workflow
 * we can render. The ⬡ button is placed into ADO's own toolbar via a portal (next to Edit on
 * a file view; next to the diff view-mode button on a PR / create-PR). There is no floating
 * fallback — if the toolbar anchor isn't found, no button is shown.
 */
export function ExtensionPanel({ rootEl }: { rootEl: HTMLElement }) {
  const href = useLocationHref();
  const context = useMemo(() => detectAdoContext(href), [href]);
  const reloadNonce = useWorkflowChangedSignal();
  // On compare views (PR / create-PR / commit), which file is open (a workflow?) comes from
  // the compare toolbar.
  const isCompareSurface =
    context?.surface === 'pullrequest' ||
    context?.surface === 'pullrequestcreate' ||
    context?.surface === 'commit';
  const comparePath = useElementText(isCompareSurface ? ADO_COMPARE_PATH_SELECTOR : null);
  const load = useWorkflow(context, reloadNonce, comparePath);
  const settings = useSettings();
  const theme = useResolvedTheme(settings.theme);
  const [open, setOpen] = useState(false);
  // Export dialog: its own scramble choice, defaulting to the developer setting (or on).
  const [showExport, setShowExport] = useState(false);
  const [exportScramble, setExportScramble] = useState(true);
  // Header actions "⋮" dropdown.
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Drive the CSS variable theme by stamping the resolved theme on the shadow-root wrapper.
  useEffect(() => {
    rootEl.dataset.theme = theme;
  }, [rootEl, theme]);

  // Keep the last successfully-loaded workflow "shown" through brief reloads so the toolbar
  // button and panel don't flicker when navigating between workflows in the SPA. Only hide
  // after the not-ready state persists (a real navigation away / non-workflow file).
  const [shown, setShown] = useState<Loaded | null>(null);
  useEffect(() => {
    if (load.status === 'ready') {
      setShown(load.loaded);
      return;
    }
    if (load.status === 'loading') return; // keep whatever is shown while re-fetching
    const timer = window.setTimeout(() => setShown(null), PANEL_HIDE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [load]);

  const visible = shown !== null;
  // Selectors: developer override (if set) wins over the built-in candidate list.
  const surface = context?.surface;
  const ui = surface ? ADO_SURFACE_UI[surface] : null;
  const override = surface ? settings.devSelectors[surface] : undefined;
  const anchorSelectors = override?.anchor ? [override.anchor] : (ui?.anchor ?? null);
  const containerSelectors = override?.container ? [override.container] : (ui?.container ?? null);

  const anchor = useElement(visible && anchorSelectors ? anchorSelectors : null);
  const mount = useInsertBefore(anchor);
  // Container sizing is opt-in, configurable per surface (full page viewport by default).
  const matchContentArea =
    surface === 'file' ? settings.matchContentAreaFile : settings.matchContentAreaPr;
  const container = useElement(open && matchContentArea && containerSelectors ? containerSelectors : null);
  const rect = useRect(open && matchContentArea ? container : null);

  // Escape closes the actions menu first, then the panel. (Events from the shadow root bubble.)
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (menuOpen) setMenuOpen(false);
      else setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, menuOpen]);

  // Close the actions menu on a click outside it (composedPath crosses the shadow boundary).
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !e.composedPath().includes(menuRef.current)) setMenuOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [menuOpen]);

  if (!context || !shown) return null;

  // Developer "scramble" mode: mask names/paths in the panel for screenshots. Identity when off.
  const s = settings.scramble ? scrambleText : (text: string) => text;

  // Prefer the ref the file was actually fetched at (from the ADO app's request) over the
  // page URL's ref, so branch-only workflows label the branch they really came from.
  const ref = (shown.kind === 'single' && shown.ref) || context.ref;
  const refLabel = ref ? `${ref.type}: ${s(ref.value)}` : null;
  const panelStyle: CSSProperties | undefined =
    matchContentArea && rect
      ? { top: rect.top, left: rect.left, width: rect.width, height: rect.height, right: 'auto', bottom: 'auto' }
      : undefined;

  const toggle = () => setOpen((o) => !o);

  const exportType: ExportType = shown.kind === 'single' ? 'single' : 'pr';
  const doExport = () => {
    const bundle = buildExport({
      type: exportType,
      scramble: exportScramble,
      now: new Date().toISOString(),
      path: shown.path,
      workflow: shown.kind === 'single' ? shown.json : undefined,
      before: shown.kind === 'diff' ? shown.before : undefined,
      after: shown.kind === 'diff' ? shown.after : undefined,
    });
    downloadJson(bundle, exportFilename(bundle));
    setShowExport(false);
  };

  const toolbarButton = (
    <button
      type="button"
      className="wf-ext-toolbar-btn bolt-header-command-item-button bolt-button bolt-icon-button enabled bolt-focus-treatment"
      title="Toggle Workflow Visualizer"
      aria-pressed={open}
      onClick={toggle}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        height: '32px',
        padding: '0 10px',
        border: 'none',
        background: 'transparent',
        color: 'inherit',
        font: 'inherit',
        cursor: 'pointer',
      }}
    >
      <span aria-hidden="true" style={{ color: '#5b9dff', fontSize: '16px', lineHeight: 1 }}>
        ⬡
      </span>
      <span>Visualize</span>
    </button>
  );

  return (
    <>
      {/* The ⬡ button lives in ADO's toolbar; no floating fallback. */}
      {mount && createPortal(toolbarButton, mount)}

      {open && (
        <section className="wf-ext-panel" style={panelStyle} role="dialog" aria-label="Workflow Visualizer">
          <header className="wf-ext-header">
            <div className="wf-ext-titles">
              <div className="wf-ext-title">Workflow Visualizer</div>
              <div className="wf-ext-crumbs">
                {s(context.org)} / {s(context.project)} / {s(context.repo)}
              </div>
            </div>
            <div className="wf-ext-actions">
              <div className="wf-ext-menu" ref={menuRef}>
                <button
                  className="wf-ext-close"
                  onClick={() => setMenuOpen((o) => !o)}
                  title="More actions"
                  aria-label="More actions"
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                >
                  <KebabIcon />
                </button>
                {menuOpen && (
                  <div className="wf-ext-menu__list" role="menu">
                    <button
                      className="wf-ext-menu__item"
                      role="menuitem"
                      onClick={() => {
                        setMenuOpen(false);
                        setShowExport(true);
                      }}
                    >
                      <DownloadIcon />
                      Export
                    </button>
                    <button
                      className="wf-ext-menu__item"
                      role="menuitem"
                      onClick={() => {
                        setMenuOpen(false);
                        chrome.runtime.sendMessage({ type: 'wf/openOptions' });
                      }}
                    >
                      <CogIcon />
                      Settings
                    </button>
                  </div>
                )}
              </div>
              <button className="wf-ext-close" onClick={() => setOpen(false)} aria-label="Close">
                ✕
              </button>
            </div>
          </header>

          <div className="wf-ext-context">
            <span className="wf-ext-surface">{s(shown.path)}</span>
            {refLabel && <span className="wf-ext-ref">{refLabel}</span>}
          </div>

          <div className="wf-ext-graph">
            {shown.kind === 'single' ? (
              <WorkflowView
                key={shown.path}
                json={shown.json}
                theme={theme}
                scramble={settings.scramble}
              />
            ) : (
              <WorkflowDiffView
                key={shown.path}
                before={shown.before}
                after={shown.after}
                theme={theme}
                scramble={settings.scramble}
              />
            )}
          </div>

          {showExport && (
            <div
              className="wf-ext-dialog"
              role="dialog"
              aria-modal="true"
              aria-label="Export workflow"
              onClick={() => setShowExport(false)}
            >
              <div className="wf-ext-dialog__box" onClick={(e) => e.stopPropagation()}>
                <div className="wf-ext-dialog__title">
                  Export Workflow
                </div>
                <p className="wf-ext-dialog__hint">
                  Saves {exportType === 'pr' ? 'both sides of the diff' : 'the workflow'} as a JSON
                  file. Scramble it to share on a public issue without leaking private data — the
                  graph still reproduces, only names and values become gibberish.
                </p>
                <label className="wf-ext-dialog__row">
                  <input
                    type="checkbox"
                    checked={exportScramble}
                    onChange={(e) => setExportScramble(e.target.checked)}
                  />
                  <span>Scramble</span>
                </label>
                <div className="wf-ext-dialog__actions">
                  <button className="wf-ext-btn" onClick={() => setShowExport(false)}>
                    Cancel
                  </button>
                  <button className="wf-ext-btn wf-ext-btn--primary" onClick={doExport}>
                    <DownloadIcon /> Export
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>
      )}
    </>
  );
}
