import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STATUS_COLOR,
  DEFAULT_TYPE_COLOR,
  STATUS_COLORS,
  STATUS_LEGEND,
  colorFor,
  colorForStatus,
  monogram,
} from './palette';

describe('colorForStatus', () => {
  it('maps the four run-after statuses to their colors', () => {
    expect(colorForStatus('Succeeded')).toBe(STATUS_COLORS.succeeded);
    expect(colorForStatus('TimedOut')).toBe(STATUS_COLORS.timedout);
    expect(colorForStatus('Skipped')).toBe(STATUS_COLORS.skipped);
    expect(colorForStatus('Failed')).toBe(STATUS_COLORS.failed);
  });

  it('is case-insensitive (Azure emits UPPERCASE statuses)', () => {
    expect(colorForStatus('SUCCEEDED')).toBe(STATUS_COLORS.succeeded);
    expect(colorForStatus('TIMEDOUT')).toBe(STATUS_COLORS.timedout);
    expect(colorForStatus('FAILED')).toBe(STATUS_COLORS.failed);
  });

  it('ignores punctuation/whitespace when normalizing', () => {
    expect(colorForStatus(' Timed-Out ')).toBe(STATUS_COLORS.timedout);
  });

  it('falls back to the default color for unknown statuses', () => {
    expect(colorForStatus('Bogus')).toBe(DEFAULT_STATUS_COLOR);
    expect(colorForStatus('')).toBe(DEFAULT_STATUS_COLOR);
  });

  it('uses distinct colors per status (green/yellow/gray/red)', () => {
    const colors = new Set(Object.values(STATUS_COLORS));
    expect(colors.size).toBe(4);
  });
});

describe('STATUS_LEGEND', () => {
  it('lists the four statuses in order with matching colors', () => {
    expect(STATUS_LEGEND.map((s) => s.label)).toEqual([
      'Succeeded',
      'TimedOut',
      'Skipped',
      'Failed',
    ]);
    for (const entry of STATUS_LEGEND) {
      expect(entry.color).toBe(colorForStatus(entry.label));
    }
  });
});

describe('colorFor (node accent)', () => {
  it('always colors triggers green regardless of type', () => {
    expect(colorFor('ServiceProvider', 'trigger')).toBe('#22c55e');
    expect(colorFor('Recurrence', 'trigger')).toBe('#22c55e');
  });

  it('keys actions by their WDL type, case-insensitively', () => {
    expect(colorFor('Http', 'action')).toBe('#6366f1');
    expect(colorFor('HTTP', 'action')).toBe('#6366f1');
    expect(colorFor('InitializeVariable', 'action')).toBe('#3b82f6');
  });

  it('colors scope containers with the container accent', () => {
    expect(colorFor('If', 'scope')).toBe('#a855f7');
    expect(colorFor('Foreach', 'scope')).toBe('#a855f7');
  });

  it('falls back to the default for unknown types', () => {
    expect(colorFor('SomethingNew', 'action')).toBe(DEFAULT_TYPE_COLOR);
    expect(colorFor(undefined, 'action')).toBe(DEFAULT_TYPE_COLOR);
  });
});

describe('monogram', () => {
  it('returns the uppercased first letter of the type', () => {
    expect(monogram('Compose')).toBe('C');
    expect(monogram('http')).toBe('H');
  });

  it('falls back to "?" when the type is missing', () => {
    expect(monogram(undefined)).toBe('?');
  });
});
