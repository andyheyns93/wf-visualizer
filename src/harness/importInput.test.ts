import { describe, expect, it } from 'vitest';
import branching from '../../tests/data/branching.json';
import nested from '../../tests/data/nested.json';
import { buildExport } from '../export';
import { interpretImport } from './importInput';

const NOW = '2026-08-07T09:30:00.000Z';
const singleBundle = JSON.stringify(
  buildExport({ type: 'single', scramble: false, now: NOW, workflow: JSON.stringify(nested) }),
);
const prBundle = JSON.stringify(
  buildExport({
    type: 'pr',
    scramble: false,
    now: NOW,
    before: JSON.stringify(branching),
    after: JSON.stringify(nested),
  }),
);

describe('interpretImport', () => {
  it('auto-detects a single export bundle regardless of mode', () => {
    const r = interpretImport({ mode: 'single', primary: singleBundle });
    expect(r).toEqual({ ok: expect.objectContaining({ kind: 'single' }) });
    if ('ok' in r && r.ok.kind === 'single') {
      expect(JSON.parse(r.ok.json)).toEqual(nested);
    }
  });

  it('auto-detects a PR bundle as a diff even when mode is "single"', () => {
    const r = interpretImport({ mode: 'single', primary: prBundle });
    expect('ok' in r && r.ok.kind).toBe('pr');
    if ('ok' in r && r.ok.kind === 'pr') {
      expect(JSON.parse(r.ok.before!)).toEqual(branching);
      expect(JSON.parse(r.ok.after!)).toEqual(nested);
    }
  });

  it('treats raw workflow JSON as a single import', () => {
    const raw = JSON.stringify(branching);
    const r = interpretImport({ mode: 'single', primary: raw });
    expect(r).toEqual({ ok: { kind: 'single', json: raw } });
  });

  it('builds a diff from two raw pasted workflows (pr mode)', () => {
    const r = interpretImport({
      mode: 'pr',
      primary: JSON.stringify(branching),
      secondary: JSON.stringify(nested),
    });
    expect('ok' in r && r.ok.kind).toBe('pr');
    if ('ok' in r && r.ok.kind === 'pr') {
      expect(JSON.parse(r.ok.before!)).toEqual(branching);
      expect(JSON.parse(r.ok.after!)).toEqual(nested);
    }
  });

  it('allows one empty side in pr mode (added/removed)', () => {
    const r = interpretImport({ mode: 'pr', primary: '', secondary: JSON.stringify(nested) });
    expect(r).toEqual({ ok: { kind: 'pr', before: null, after: JSON.stringify(nested) } });
  });

  it('errors on empty single input', () => {
    expect(interpretImport({ mode: 'single', primary: '  ' })).toEqual({
      error: expect.stringContaining('Paste a workflow'),
    });
  });

  it('errors on invalid JSON', () => {
    expect(interpretImport({ mode: 'single', primary: 'not json' })).toEqual({
      error: expect.stringContaining('valid JSON'),
    });
  });

  it('errors when both pr sides are empty', () => {
    expect(interpretImport({ mode: 'pr', primary: '', secondary: '' })).toEqual({
      error: expect.stringContaining('before and/or after'),
    });
  });
});
