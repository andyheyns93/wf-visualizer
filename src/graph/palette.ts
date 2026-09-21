import type { NodeCategory } from '../parser/types';

// ---- Node palette (Azure designer look) ----

/** WDL type (lower-cased) → accent color. */
export const TYPE_COLORS: Record<string, string> = {
  request: '#22c55e',
  recurrence: '#22c55e',
  serviceprovider: '#22c55e',
  initializevariable: '#3b82f6',
  setvariable: '#3b82f6',
  incrementvariable: '#3b82f6',
  parsejson: '#8b5cf6',
  compose: '#0ea5e9',
  liquid: '#f43f5e',
  apiconnection: '#14b8a6',
  apiconnectionwebhook: '#14b8a6',
  http: '#6366f1',
  response: '#10b981',
  terminate: '#ef4444',
  if: '#a855f7',
  switch: '#a855f7',
  foreach: '#a855f7',
  until: '#a855f7',
  scope: '#a855f7',
};

/** Fallback accent for unknown types. */
export const DEFAULT_TYPE_COLOR = '#64748b';

/** Accent color for a node; triggers are always green, otherwise keyed by type. */
export function colorFor(type: string | undefined, category: NodeCategory | undefined): string {
  if (category === 'trigger') return '#22c55e';
  return TYPE_COLORS[(type ?? '').toLowerCase()] ?? DEFAULT_TYPE_COLOR;
}

/** Single-letter icon glyph derived from the type. */
export function monogram(type: string | undefined): string {
  return (type ?? '?').charAt(0).toUpperCase();
}

// ---- Run-after status palette ----

/** Run-after status (normalized) → edge color. */
export const STATUS_COLORS: Record<string, string> = {
  succeeded: '#22c55e',
  timedout: '#eab308',
  skipped: '#94a3b8',
  failed: '#ef4444',
};

/** Fallback for statuses we don't recognize (and status-less edges). */
export const DEFAULT_STATUS_COLOR = '#3d4763';

/** Color for a run-after status; case- and punctuation-insensitive (e.g. "TIMEDOUT"). */
export function colorForStatus(status: string): string {
  return STATUS_COLORS[status.toLowerCase().replace(/[^a-z]/g, '')] ?? DEFAULT_STATUS_COLOR;
}

/** Ordered legend of the run-after statuses and their colors. */
export const STATUS_LEGEND: { label: string; color: string }[] = [
  { label: 'Succeeded', color: STATUS_COLORS.succeeded },
  { label: 'TimedOut', color: STATUS_COLORS.timedout },
  { label: 'Skipped', color: STATUS_COLORS.skipped },
  { label: 'Failed', color: STATUS_COLORS.failed },
];

// ---- Diff palette (PR before/after) ----

export const DIFF_COLORS: Record<string, string> = {
  added: '#22c55e',
  removed: '#ef4444',
  changed: '#eab308',
  renamed: '#a855f7',
  unchanged: '#64748b',
};

export const DIFF_LEGEND: { label: string; key: string; color: string }[] = [
  { label: 'Added', key: 'added', color: DIFF_COLORS.added },
  { label: 'Removed', key: 'removed', color: DIFF_COLORS.removed },
  { label: 'Changed', key: 'changed', color: DIFF_COLORS.changed },
  { label: 'Renamed / moved', key: 'renamed', color: DIFF_COLORS.renamed },
];
