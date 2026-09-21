import simple from '../../tests/data/simple.json';
import branching from '../../tests/data/branching.json';
import nested from '../../tests/data/nested.json';

export interface Fixture {
  id: string;
  name: string;
  json: string;
}

const pretty = (value: unknown) => JSON.stringify(value, null, 2);

// Sample workflows live in `tests/data/`. Only the ones referenced here are imported by
// the harness (and therefore bundled); the rest are used solely by the test suite.
export const fixtures: Fixture[] = [
  { id: 'simple', name: 'Simple — trigger + three actions', json: pretty(simple) },
  { id: 'branching', name: 'Branching — If/else with status routing', json: pretty(branching) },
  { id: 'nested', name: 'Nested — Foreach + Switch + Scope', json: pretty(nested) },
];
