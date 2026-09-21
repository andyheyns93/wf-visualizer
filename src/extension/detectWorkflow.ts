import { findDefinition } from '../parser/parseWorkflow';

/** A path worth attempting to load — any `.json` file (content is validated separately). */
export function isLikelyWorkflowPath(path: string | undefined): boolean {
  return !!path && /\.json$/i.test(path);
}

/**
 * Return the text unchanged if it parses as a Logic App workflow (has a locatable
 * definition with triggers/actions), otherwise null. Used to gate the toggle button so it
 * only shows when the current file can actually be visualized.
 */
export function parseIfWorkflow(text: string): string | null {
  try {
    findDefinition(JSON.parse(text));
    return text;
  } catch {
    return null;
  }
}
