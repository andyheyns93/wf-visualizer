import { parseImport } from '../export';

/**
 * Interprets the harness Import dialog. Auto-detects whether the pasted/loaded text is an
 * **exported bundle** (from the panel's Export) or the **raw contents of a workflow**, and
 * resolves to what the harness should render — a single graph or a before/after diff.
 */
export type HarnessImport =
  | { kind: 'single'; json: string }
  | { kind: 'pr'; before: string | null; after: string | null; path?: string };

export interface InterpretInput {
  /** 'single' = one workflow/bundle; 'pr' = a raw before/after pair (two boxes). */
  mode: 'single' | 'pr';
  /** The main box (single mode) or the "before" box (pr mode) — also the file's contents. */
  primary?: string;
  /** The "after" box (pr mode only). */
  secondary?: string;
}

export type InterpretResult = { ok: HarnessImport } | { error: string };

const pretty = (value: unknown): string | null => (value == null ? null : JSON.stringify(value, null, 2));

function isJson(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

/** A before/after box: a single bundle, a raw workflow, or blank. */
function side(text: string): { json: string | null } | { error: string } {
  if (!text.trim()) return { json: null };
  const bundle = parseImport(text);
  if (bundle) {
    if (bundle.type === 'single') return { json: pretty(bundle.workflow) };
    return { error: 'A before/after box takes a single workflow, not a before/after bundle.' };
  }
  if (!isJson(text)) return { error: 'A before/after box contains invalid JSON.' };
  return { json: text };
}

export function interpretImport({ mode, primary = '', secondary = '' }: InterpretInput): InterpretResult {
  // 1. Auto-detect an exported bundle in the primary content — this wins over `mode`, so a
  //    before/after bundle opens as a diff even when the dialog is set to "single".
  if (primary.trim()) {
    const bundle = parseImport(primary);
    if (bundle) {
      return bundle.type === 'single'
        ? { ok: { kind: 'single', json: pretty(bundle.workflow) ?? 'null' } }
        : { ok: { kind: 'pr', before: pretty(bundle.before), after: pretty(bundle.after), path: bundle.path } };
    }
  }

  // 2. Raw content, interpreted per the chosen mode.
  if (mode === 'single') {
    if (!primary.trim()) return { error: 'Paste a workflow or choose a file.' };
    if (!isJson(primary)) return { error: 'That doesn’t look like valid JSON.' };
    return { ok: { kind: 'single', json: primary } };
  }

  const before = side(primary);
  if ('error' in before) return before;
  const after = side(secondary);
  if ('error' in after) return after;
  if (before.json === null && after.json === null) {
    return { error: 'Paste a before and/or after workflow.' };
  }
  return { ok: { kind: 'pr', before: before.json, after: after.json } };
}
