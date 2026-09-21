import { load } from 'cheerio';
import { describe, expect, it } from 'vitest';
import { ADO_COMPARE_PATH_SELECTOR, ADO_SURFACE_UI } from '../config';
import type { AdoSurface } from './adoContext';

// Surface stubs (minimal, faithful copies of each surface's container + toolbar anchor).
import fileStub from '../../tests/data/html/stubs/file.html?raw';
import prActiveStub from '../../tests/data/html/stubs/pullrequest-active.html?raw';
import prCompletedStub from '../../tests/data/html/stubs/pullrequest-completed.html?raw';
import prCreateStub from '../../tests/data/html/stubs/pullrequest-create.html?raw';
import commitStub from '../../tests/data/html/stubs/commit.html?raw';

/**
 * Guards the DOM selectors in `ADO_SURFACE_UI` against the Azure DevOps markup they target.
 * Each stub under `tests/data/html/stubs/` is a minimal, faithful copy of the container and
 * toolbar anchor for one surface, structured like the real ADO page. If a config selector
 * ever stops matching its surface — the failure mode that silently hides the ⬡ button — one
 * of these assertions breaks.
 */

/** First candidate selector (in order) that matches, or null — mirrors the panel's lookup. */
function firstMatch($: ReturnType<typeof load>, selectors: string[]): string | null {
  return selectors.find((sel) => $(sel).length > 0) ?? null;
}

interface Case {
  html: string;
  surface: AdoSurface;
  /** Which anchor candidate is expected to be the first match for this variant. */
  expectedAnchor: string;
  /** Compare surfaces expose the open file's path in the compare toolbar. */
  compareToolbar: boolean;
}

const STUB_CASES: Case[] = [
  { html: fileStub, surface: 'file', expectedAnchor: '#__bolt-edit', compareToolbar: false },
  {
    html: prActiveStub,
    surface: 'pullrequest',
    expectedAnchor: '.repos-pr-header-vote-button',
    compareToolbar: true,
  },
  {
    html: prCompletedStub,
    surface: 'pullrequest',
    expectedAnchor: '.repos-compare-toolbar .bolt-split-button',
    compareToolbar: true,
  },
  {
    html: prCreateStub,
    surface: 'pullrequestcreate',
    expectedAnchor: '.repos-compare-toolbar .bolt-split-button',
    compareToolbar: true,
  },
  {
    html: commitStub,
    surface: 'commit',
    expectedAnchor: '.repos-compare-toolbar .bolt-split-button',
    compareToolbar: true,
  },
];

describe('ADO surface selectors resolve against the surface stubs', () => {
  STUB_CASES.forEach((c, i) => {
    describe(`stub #${i} (surface: ${c.surface}, anchor: ${c.expectedAnchor})`, () => {
      const $ = load(c.html);
      const ui = ADO_SURFACE_UI[c.surface];

      it('finds a container element', () => {
        expect(firstMatch($, ui.container)).not.toBeNull();
      });

      it('finds the toolbar anchor (first matching candidate)', () => {
        expect(firstMatch($, ui.anchor)).toBe(c.expectedAnchor);
      });

      if (c.compareToolbar) {
        it('exposes the open workflow path in the compare toolbar', () => {
          const el = $(ADO_COMPARE_PATH_SELECTOR);
          expect(el.length).toBeGreaterThan(0);
          expect(el.first().text().trim()).toMatch(/\.json$/i);
        });
      }
    });
  });
});

describe('every configured surface has a stub covering it', () => {
  it('leaves no surface in ADO_SURFACE_UI untested', () => {
    const configured = Object.keys(ADO_SURFACE_UI).sort();
    const covered = [...new Set(STUB_CASES.map((c) => c.surface))].sort();
    expect(covered).toEqual(configured);
  });
});
