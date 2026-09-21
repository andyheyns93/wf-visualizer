import type { ReactNode } from 'react';
import {
  EXPRESSION_HEAVY_RATIO,
  EXPRESSION_PREFIX,
  FIELDS_LONG_TEXT_CHARS,
  FIELDS_MAX_DEPTH,
} from '../config';

type Json = unknown;

function isObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function isComplex(v: unknown): v is Record<string, unknown> | unknown[] {
  return isObject(v) || Array.isArray(v);
}

function entriesOf(v: Record<string, unknown> | unknown[]): [string, unknown][] {
  return Array.isArray(v) ? v.map((x, i) => [String(i), x]) : Object.entries(v);
}

/** A single-element array is displayed transparently (no `0` index), unwrapping nested singles. */
function unwrapSingle(v: unknown): unknown {
  let current = v;
  while (Array.isArray(current) && current.length === 1) current = current[0];
  return current;
}

function scalarText(v: unknown): string {
  if (v === null) return 'null';
  if (v === undefined) return '—';
  if (typeof v === 'string') return v;
  return String(v);
}

function preview(v: Json): string {
  return isComplex(v) ? JSON.stringify(v) : scalarText(v);
}

/** A read-only string field, auto-styled for Logic App expressions, URLs, and long text. */
function StringField({ text, cls }: { text: string; cls: string }) {
  const isExpression = text.trimStart().startsWith(EXPRESSION_PREFIX);
  const isUrl = !isExpression && !text.includes('@') && /^https?:\/\/\S+$/i.test(text.trim());
  const isLong = text.length > FIELDS_LONG_TEXT_CHARS || text.includes('\n');
  const display = text === '' ? '""' : text;

  if (isUrl) {
    return (
      <a
        className={`jf-field jf-link${cls}`}
        href={text.trim()}
        target="_blank"
        rel="noopener noreferrer"
      >
        {display}
      </a>
    );
  }

  const classes = ['jf-field', isExpression && 'jf-field--expr', isLong && 'jf-field--long', cls.trim()]
    .filter(Boolean)
    .join(' ');
  return (
    <span className={classes}>
      {isExpression && <span className="jf-expr-badge">ƒx</span>}
      {display}
    </span>
  );
}

/** A single scalar value rendered by type: boolean → toggle, string → smart field, etc. */
function FieldValue({ value, cls = '' }: { value: unknown; cls?: string }) {
  const suffix = cls ? ` ${cls}` : '';
  if (typeof value === 'boolean') {
    return (
      <span
        className={`jf-toggle${value ? ' jf-toggle--on' : ''}${suffix}`}
        role="switch"
        aria-checked={value}
        aria-readonly="true"
        title={String(value)}
      >
        <span className="jf-toggle__knob" />
      </span>
    );
  }
  if (value === null || value === undefined) {
    return <span className={`jf-null${suffix}`}>{scalarText(value)}</span>;
  }
  if (typeof value === 'string') {
    return <StringField text={value} cls={suffix} />;
  }
  return <span className={`jf-field${suffix}`}>{scalarText(value)}</span>;
}

function collectStringLeaves(v: unknown, acc: string[]): void {
  if (typeof v === 'string') acc.push(v);
  else if (Array.isArray(v)) for (const x of v) collectStringLeaves(x, acc);
  else if (isObject(v)) for (const x of Object.values(v)) collectStringLeaves(x, acc);
}

/**
 * True when a nested value is mostly Logic App expressions (e.g. an If `expression` tree).
 * Such structures stay as fields (so each expression shows as a highlighted chip) rather
 * than being pretty-printed as raw JSON.
 */
function isExpressionHeavy(v: unknown): boolean {
  const strings: string[] = [];
  collectStringLeaves(v, strings);
  if (strings.length === 0) return false;
  const expressions = strings.filter((s) => s.trimStart().startsWith(EXPRESSION_PREFIX));
  return expressions.length > 0 && expressions.length >= strings.length * EXPRESSION_HEAVY_RATIO;
}

/**
 * Render a value as an indented field tree. Shallow structures become labeled fields; deeper
 * arbitrary objects/arrays (e.g. a Compose payload) are pretty-printed as JSON — unless they
 * are expression-heavy (conditions), which stay as fields so expressions render as chips.
 */
function renderFields(value: Record<string, unknown> | unknown[], cls: string, depth = 0): ReactNode {
  const suffix = cls ? ` ${cls}` : '';
  return entriesOf(value).map(([k, raw]) => {
    const v = unwrapSingle(raw);
    return (
      <div className="jf-row" key={k}>
        <span className={`jf-key${suffix}`}>{k}</span>
        {isComplex(v) ? (
          depth < FIELDS_MAX_DEPTH || isExpressionHeavy(v) ? (
            <div className="jf-nest">{renderFields(v, cls, depth + 1)}</div>
          ) : (
            <pre className={`jf-json${suffix}`}>{JSON.stringify(v, null, 2)}</pre>
          )
        ) : (
          <FieldValue value={v} cls={cls} />
        )}
      </div>
    );
  });
}

/** A JSON value shown as designer-style fields (falls back to a scalar for primitives). */
export function JsonFields({ value }: { value: Json }) {
  const v = unwrapSingle(value);
  return <div className="jf">{isComplex(v) ? renderFields(v, '') : <FieldValue value={v} />}</div>;
}

function leafSide(v: Json, cls: string): ReactNode {
  return isComplex(v) ? <span className={`jf-field ${cls}`}>{preview(v)}</span> : <FieldValue value={v} cls={cls} />;
}

function renderLeafDiff(before: Json, after: Json): ReactNode {
  if (JSON.stringify(before) === JSON.stringify(after)) return <FieldValue value={after} />;
  return (
    <span className="jf-change">
      {leafSide(before, 'jf--del')}
      <span className="jf-arrow">→</span>
      {leafSide(after, 'jf--add')}
    </span>
  );
}

function renderDiffRow(key: string, beforeRaw: Json, afterRaw: Json): ReactNode {
  const before = unwrapSingle(beforeRaw);
  const after = unwrapSingle(afterRaw);
  const bHas = before !== undefined;
  const aHas = after !== undefined;

  if (bHas && !aHas) {
    return (
      <div className="jf-row" key={key}>
        <span className="jf-key jf--del">{key}</span>
        {isComplex(before) ? (
          <div className="jf-nest">{renderFields(before, 'jf--del')}</div>
        ) : (
          <FieldValue value={before} cls="jf--del" />
        )}
      </div>
    );
  }
  if (!bHas && aHas) {
    return (
      <div className="jf-row" key={key}>
        <span className="jf-key jf--add">{key}</span>
        {isComplex(after) ? (
          <div className="jf-nest">{renderFields(after, 'jf--add')}</div>
        ) : (
          <FieldValue value={after} cls="jf--add" />
        )}
      </div>
    );
  }
  const sameContainer =
    isComplex(before) && isComplex(after) && Array.isArray(before) === Array.isArray(after);
  return (
    <div className="jf-row" key={key}>
      <span className="jf-key">{key}</span>
      {sameContainer ? (
        <div className="jf-nest">{renderDiffTree(before, after)}</div>
      ) : (
        renderLeafDiff(before, after)
      )}
    </div>
  );
}

function renderDiffTree(before: Json, after: Json): ReactNode {
  if (before === undefined && after !== undefined) {
    return isComplex(after) ? renderFields(after, 'jf--add') : <FieldValue value={after} cls="jf--add" />;
  }
  if (after === undefined && before !== undefined) {
    return isComplex(before) ? renderFields(before, 'jf--del') : <FieldValue value={before} cls="jf--del" />;
  }
  if (isObject(before) && isObject(after)) {
    const keys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)]));
    return keys.map((k) => renderDiffRow(k, before[k], after[k]));
  }
  if (Array.isArray(before) && Array.isArray(after)) {
    const len = Math.max(before.length, after.length);
    const rows: ReactNode[] = [];
    for (let i = 0; i < len; i++) rows.push(renderDiffRow(String(i), before[i], after[i]));
    return rows;
  }
  return renderLeafDiff(before, after);
}

/** A before/after diff shown as designer-style fields with add/remove/change highlighting. */
export function JsonFieldsDiff({ before, after }: { before: Json; after: Json }) {
  return <div className="jf">{renderDiffTree(before, after)}</div>;
}
