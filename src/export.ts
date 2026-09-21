/**
 * Export / import of workflow(s) for support cases.
 *
 * An export bundle carries a single workflow or a PR's before/after pair, optionally
 * **scrambled** so it can be attached to a public GitHub issue without leaking private data.
 * The scramble is *structure-preserving*: the parsed graph (node types, containers, runAfter
 * topology + statuses, nesting) is identical to the original — only names and string values
 * are replaced with deterministic gibberish — so a maintainer can reproduce a visualization
 * issue from the scrubbed JSON.
 */
import { scrambleText, scrambleWorkflow } from './graph/scramble';

export { scrambleWorkflow } from './graph/scramble';

export const EXPORT_FORMAT = 'wf-visualizer-export';
export type ExportType = 'single' | 'pr';

export interface WorkflowExport {
  format: typeof EXPORT_FORMAT;
  formatVersion: 1;
  /** 'single' = one workflow; 'pr' = before/after pair. */
  type: ExportType;
  /** Whether names/values were scrambled. */
  scrambled: boolean;
  /** ISO timestamp of the export. */
  exportedAt: string;
  /** File path (scrambled when `scrambled`). */
  path?: string;
  /** Single-workflow payload. */
  workflow?: unknown;
  /** PR payloads (either side may be null when the file was added/removed). */
  before?: unknown | null;
  after?: unknown | null;
}

export interface BuildExportInput {
  type: ExportType;
  scramble: boolean;
  now: string;
  path?: string;
  /** Raw JSON text of the single workflow. */
  workflow?: string | null;
  /** Raw JSON text of the PR before/after sides. */
  before?: string | null;
  after?: string | null;
}

function parseJson(text: string | null | undefined): unknown {
  if (text == null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Build an export bundle (pure — the caller supplies `now`). */
export function buildExport(input: BuildExportInput): WorkflowExport {
  const scrub = (obj: unknown) => (input.scramble ? scrambleWorkflow(obj) : obj);
  const bundle: WorkflowExport = {
    format: EXPORT_FORMAT,
    formatVersion: 1,
    type: input.type,
    scrambled: input.scramble,
    exportedAt: input.now,
  };
  if (input.path != null) {
    bundle.path = input.scramble ? scrambleText(input.path) : input.path;
  }
  if (input.type === 'single') {
    bundle.workflow = scrub(parseJson(input.workflow));
  } else {
    bundle.before = scrub(parseJson(input.before));
    bundle.after = scrub(parseJson(input.after));
  }
  return bundle;
}

/** A filesystem-friendly filename for a bundle (no private data — timestamp + type). */
export function exportFilename(bundle: WorkflowExport): string {
  const stamp = bundle.exportedAt.replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
  return `wf-visualizer-${bundle.type}${bundle.scrambled ? '-scrambled' : ''}-${stamp}.json`;
}

/** Parse + validate an imported file; null if it isn't a recognized export bundle. */
export function parseImport(text: string): WorkflowExport | null {
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    return null;
  }
  if (
    obj &&
    typeof obj === 'object' &&
    (obj as { format?: unknown }).format === EXPORT_FORMAT &&
    ((obj as { type?: unknown }).type === 'single' || (obj as { type?: unknown }).type === 'pr')
  ) {
    return obj as WorkflowExport;
  }
  return null;
}
