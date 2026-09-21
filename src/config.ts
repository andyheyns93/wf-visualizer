/**
 * Central configuration.
 *
 * The fragile Azure DevOps coupling (DOM selectors, REST version) and the tunable "magic
 * numbers" scattered across the code live here, so they can be audited and adjusted in one
 * place — and later surfaced as user settings where it makes sense.
 */

// ---- Azure DevOps coupling ----

import type { AdoSurface } from './extension/adoContext';

/** REST API version used for all Git calls. */
export const ADO_API_VERSION = '7.1';

export interface SurfaceSelectors {
  /** Elements the panel can size to — first match wins. */
  container: string[];
  /** Toolbar elements the ⬡ button is inserted before — first match wins. */
  anchor: string[];
}

/**
 * Per-surface DOM hooks — the MOST breakage-prone config (ADO markup changes without notice).
 * Each is a list of candidate selectors tried in order, so one surface can cover UI variants
 * (e.g. an active PR shows a vote button; a completed PR shows the compare toolbar). Users can
 * override these from the options page's Developer settings.
 */
export const ADO_SURFACE_UI: Record<AdoSurface, SurfaceSelectors> = {
  file: {
    container: ['.repos-files-hub-page'],
    anchor: ['#__bolt-edit'],
  },
  pullrequest: {
    container: ['.repos-pr-details-page'],
    anchor: ['.repos-pr-header-vote-button', '.repos-compare-toolbar .bolt-split-button'],
  },
  pullrequestcreate: {
    container: ['.repos-pr-create-page'],
    anchor: ['.repos-compare-toolbar .bolt-split-button'],
  },
  commit: {
    container: ['.repos-changes-viewer'],
    anchor: ['.repos-compare-toolbar .bolt-split-button'],
  },
};

/**
 * On PR / create-PR compare views, the currently-open file's path lives in the compare
 * toolbar and changes as you click files. We read it to know whether a workflow is open
 * (and which one), rather than trusting the last captured fetch.
 */
export const ADO_COMPARE_PATH_SELECTOR = '.repos-compare-toolbar .secondary-text';

// ---- Fetch / auth ----

/** Warm-up retries while the Bearer token is still being captured. */
export const FETCH_WARMUP_ATTEMPTS = 4;
export const FETCH_WARMUP_DELAY_MS = 600;

// ---- Panel + diff behavior (ms) ----

/** How long the panel keeps the last workflow shown before hiding (anti-flicker on SPA nav). */
export const PANEL_HIDE_DEBOUNCE_MS = 200;
/** Delay before enabling pane pan/zoom sync, so each pane's initial fit settles first. */
export const DIFF_SYNC_ENABLE_DELAY_MS = 800;
/** Animation duration when the change navigator centers a change. */
export const DIFF_JUMP_DURATION_MS = 400;

// ---- Diff detection ----

/** Minimum body similarity (0..1) to treat an add+remove pair as a rename/move. */
export const RENAME_THRESHOLD = 0.5;

// ---- Fields (designer-style JSON) view ----

/** Nesting depth beyond which objects/arrays are pretty-printed instead of exploded to fields. */
export const FIELDS_MAX_DEPTH = 2;
/** Strings at/above this length render as a scrollable field. */
export const FIELDS_LONG_TEXT_CHARS = 200;
/** Prefix that marks a Logic App expression string. */
export const EXPRESSION_PREFIX = '@';
/** Fraction of string leaves that must be expressions to keep a subtree as fields. */
export const EXPRESSION_HEAVY_RATIO = 0.5;
