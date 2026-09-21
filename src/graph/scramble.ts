import { createContext, useContext } from 'react';

/**
 * Deterministic, structure-preserving text scramble — for screenshots only.
 *
 * Replaces letters with letters and digits with digits (preserving case), and leaves every
 * other character (`/`, `.`, `-`, `_`, spaces …) untouched, so a path still reads as a path
 * and an identifier keeps its word boundaries — but the real names are gone. The mapping is
 * seeded from the input, so the same string always scrambles to the same output: an action
 * shown as a node and referenced in a `runAfter` list stay consistent across the diagram.
 */
export function scrambleText(input: string): string {
  // FNV-1a hash of the whole string → PRNG seed.
  let h = 2166136261 >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  // mulberry32 PRNG.
  const rand = () => {
    h = (h + 0x6d2b79f5) >>> 0;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  let out = '';
  for (const ch of input) {
    if (ch >= 'a' && ch <= 'z') out += String.fromCharCode(97 + Math.floor(rand() * 26));
    else if (ch >= 'A' && ch <= 'Z') out += String.fromCharCode(65 + Math.floor(rand() * 26));
    else if (ch >= '0' && ch <= '9') out += String.fromCharCode(48 + Math.floor(rand() * 10));
    else out += ch;
  }
  return out;
}

// Object keys whose direct children are action/trigger *names* (to be scrambled).
const NAME_PARENTS = new Set(['actions', 'triggers']);

/**
 * Deep, structure-preserving scramble of a WDL object (a whole workflow, or a single action's
 * definition). Action/trigger names and `runAfter` dependency keys are scrambled the same way
 * (so edges still connect), `type` values are kept verbatim (the parser classifies by them),
 * `runAfter` status arrays are kept (edge colors), and every other string leaf is scrambled.
 * The graph it produces is structurally identical to the original — only names/values change.
 */
export function scrambleWorkflow(value: unknown): unknown {
  return walk(value, undefined);
}

function walk(value: unknown, parentKey: string | undefined): unknown {
  if (Array.isArray(value)) return value.map((v) => walk(v, parentKey));
  if (value && typeof value === 'object') {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    const renameKeys = parentKey !== undefined && NAME_PARENTS.has(parentKey);
    for (const [k, v] of Object.entries(src)) {
      if (k === 'runAfter' && v && typeof v === 'object' && !Array.isArray(v)) {
        const ra: Record<string, unknown> = {};
        for (const [dep, statuses] of Object.entries(v as Record<string, unknown>)) {
          ra[scrambleText(dep)] = statuses;
        }
        out[k] = ra;
        continue;
      }
      const key = renameKeys ? scrambleText(k) : k;
      out[key] = k === 'type' ? v : walk(v, k);
    }
    return out;
  }
  if (typeof value === 'string') return scrambleText(value);
  return value;
}

/** Whether scramble mode is on for the current subtree (developer setting, screenshots). */
export const ScrambleContext = createContext<boolean>(false);

/** Returns a scrambler: `scrambleText` when scramble mode is on, identity otherwise. */
export function useScramble(): (text: string) => string {
  const on = useContext(ScrambleContext);
  return (text: string) => (on ? scrambleText(text) : text);
}

/** Returns an object scrambler: `scrambleWorkflow` when scramble mode is on, identity otherwise. */
export function useScrambleObject(): (value: unknown) => unknown {
  const on = useContext(ScrambleContext);
  return (value: unknown) => (on ? scrambleWorkflow(value) : value);
}
