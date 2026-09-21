import { useRef, useState, type JSX } from 'react';
import { parseIfWorkflow } from '../extension/detectWorkflow';
import { parseImport } from '../export';
import { interpretImport, type HarnessImport, type InterpretResult } from './importInput';
import { UploadIcon } from './UploadIcon';

type Mode = 'single' | 'pr';
type Source = 'paste' | 'workflow' | 'export';
type Step = 1 | 2 | 3;
type Picked = { name: string; text: string };

const svg = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true } as const;

/** Step 1 — what to import (branch/versions). */
function TypeIcon() {
  return (
    <svg {...svg}>
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="6" cy="18" r="2.5" />
      <circle cx="18" cy="8" r="2.5" />
      <path d="M6 8.5v7" />
      <path d="M18 10.5c0 4-4 4.5-7 4.5" />
    </svg>
  );
}

/** Step 2 — data source (clipboard). */
function SourceIcon() {
  return (
    <svg {...svg}>
      <rect x="8" y="3" width="8" height="4" rx="1" />
      <path d="M9 5H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-3" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg {...svg}>
      <path d="M5 12.5l4 4 10-10.5" />
    </svg>
  );
}

/** Back chevron for the wizard's Back button. */
function BackIcon() {
  return (
    <svg {...svg}>
      <path d="M15 6l-6 6 6 6" />
    </svg>
  );
}

/** Document icon (single workflow / plain workflow file). */
function FileIcon() {
  return (
    <svg {...svg}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
    </svg>
  );
}

/** Box icon (an exported bundle). */
function PackageIcon() {
  return (
    <svg {...svg}>
      <path d="M3 7l9-4 9 4-9 4-9-4z" />
      <path d="M3 7v10l9 4 9-4V7" />
      <path d="M12 11v10" />
    </svg>
  );
}

const STEPS: { label: string; Icon: () => JSX.Element }[] = [
  { label: 'Type', Icon: TypeIcon },
  { label: 'Source', Icon: SourceIcon },
  { label: 'Input', Icon: () => <UploadIcon /> },
];

/** Message when an export's own type doesn't match the type chosen in step 1. */
function exportTypeMismatch(want: Mode, got: Mode): string | null {
  if (want === got) return null;
  return got === 'single'
    ? 'That’s a single-workflow export, but you chose “Before & after”. Go back and pick “Single workflow”, or choose a before/after export.'
    : 'That’s a before/after export, but you chose “Single workflow”. Go back and pick “Before & after”, or choose a single-workflow export.';
}

/**
 * Validate a picked/dropped file against the expected kind; null when it's acceptable. For an
 * export, `mode` (the step-1 choice) must match the bundle's own type.
 */
function fileError(text: string, kind: 'workflow' | 'export', mode?: Mode): string | null {
  const bundle = parseImport(text); // a Workflow Visualizer export
  const workflow = parseIfWorkflow(text); // a raw Logic App workflow
  if (kind === 'export') {
    if (bundle) return mode ? exportTypeMismatch(mode, bundle.type) : null;
    if (workflow) return 'That’s a plain workflow file — choose “Upload workflow” instead.';
  } else {
    if (workflow) return null;
    if (bundle) return 'That’s an export file — choose “Upload export” instead.';
  }
  try {
    JSON.parse(text);
  } catch {
    return 'That file isn’t valid JSON.';
  }
  return kind === 'export' ? 'That isn’t a Workflow Visualizer export.' : 'That isn’t a Logic App workflow.';
}

/** A single drag/drop-or-click file zone with its own hover state. */
function FileDrop({
  file,
  onPick,
  onRemove,
}: {
  file: Picked | null;
  onPick: (f: File | undefined) => void;
  onRemove: () => void;
}) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  return (
    <div
      className={`imp-drop${over ? ' imp-drop--over' : ''}`}
      role="button"
      tabIndex={0}
      onClick={() => input.current?.click()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') input.current?.click();
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        onPick(e.dataTransfer.files?.[0]);
      }}
    >
      {file ? (
        <span className="imp-drop__file">
          📄 {file.name}
          <button
            className="imp-drop__remove"
            aria-label="Remove file"
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
          >
            ✕
          </button>
        </span>
      ) : (
        <>
          <span className="imp-drop__icon">
            <UploadIcon size={26} />
          </span>
          <span className="imp-drop__title">Drag &amp; drop a file here</span>
          <span className="imp-drop__sub">or click to browse — .json</span>
        </>
      )}
      <input
        ref={input}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(e) => {
          onPick(e.target.files?.[0]);
          e.currentTarget.value = '';
        }}
      />
    </div>
  );
}

/**
 * Step-by-step import wizard: (1) what to import, (2) data source, (3) the inputs — reused both
 * inline (empty canvas) and inside the Dialog. Auto-detects an exported bundle vs. raw workflow
 * JSON. You can step back at any point.
 */
export function ImportForm({ onImport }: { onImport: (result: HarnessImport) => void }) {
  const [step, setStep] = useState<Step>(1);
  const [mode, setMode] = useState<Mode>('single');
  const [source, setSource] = useState<Source>('paste');
  const [primary, setPrimary] = useState('');
  const [secondary, setSecondary] = useState('');
  const [fileA, setFileA] = useState<Picked | null>(null);
  const [fileB, setFileB] = useState<Picked | null>(null);
  const [error, setError] = useState<string | null>(null);

  const goto = (s: Step) => {
    setError(null);
    setStep(s);
  };

  const chooseSource = (src: Source) => {
    setSource(src);
    setFileA(null);
    setFileB(null);
    goto(3);
  };

  const pick = async (slot: 'a' | 'b', f: File | undefined) => {
    if (!f) return;
    const text = await f.text();
    const err = fileError(text, source === 'export' ? 'export' : 'workflow', mode);
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    const entry = { name: f.name, text };
    if (slot === 'a') setFileA(entry);
    else setFileB(entry);
  };

  const submit = () => {
    let result: InterpretResult;
    if (source === 'paste') {
      result = interpretImport({ mode, primary, secondary });
    } else if (source === 'export') {
      // The export's own type must match the type chosen in step 1.
      const bundle = parseImport(fileA?.text ?? '');
      if (!bundle) {
        setError('Choose an export file.');
        return;
      }
      const mismatch = exportTypeMismatch(mode, bundle.type);
      if (mismatch) {
        setError(mismatch);
        return;
      }
      result = interpretImport({ mode: 'single', primary: fileA!.text });
    } else {
      result = interpretImport({ mode, primary: fileA?.text ?? '', secondary: fileB?.text ?? '' });
    }
    if ('error' in result) {
      setError(result.error);
      return;
    }
    onImport(result.ok);
  };

  const stepTitle =
    step === 1
      ? 'What do you want to import?'
      : step === 2
        ? 'What is your data source?'
        : source === 'export'
          ? 'Upload the export file'
          : source === 'workflow'
            ? mode === 'pr'
              ? 'Upload the two workflow files'
              : 'Upload the workflow file'
            : mode === 'pr'
              ? 'Paste both versions'
              : 'Paste the workflow';

  return (
    <div className="imp-form">
      <div className="imp-title imp-wiz__title">Import workflow</div>

      <ol className="imp-steps">
        {STEPS.map((s, i) => {
          const n = (i + 1) as Step;
          const state = n < step ? 'done' : n === step ? 'current' : 'todo';
          const canGo = n < step;
          return (
            <li
              key={s.label}
              className={`imp-step imp-step--${state}${canGo ? ' imp-step--clickable' : ''}`}
              onClick={() => canGo && goto(n)}
            >
              <span className="imp-step__dot">{state === 'done' ? <CheckIcon /> : <s.Icon />}</span>
              <span className="imp-step__label">{s.label}</span>
            </li>
          );
        })}
      </ol>

      <div className="imp-wiz__question">{stepTitle}</div>

      <div className="imp-wiz__body">
        {step === 1 && (
          <div className="imp-choices">
            <button
              className={`imp-choice${mode === 'single' ? ' is-active' : ''}`}
              onClick={() => {
                setMode('single');
                goto(2);
              }}
            >
              <span className="imp-choice__icon">
                <FileIcon />
              </span>
              <span className="imp-choice__text">
                <span className="imp-choice__title">Single workflow</span>
                <span className="imp-choice__sub">Visualize one workflow.json</span>
              </span>
            </button>
            <button
              className={`imp-choice${mode === 'pr' ? ' is-active' : ''}`}
              onClick={() => {
                setMode('pr');
                goto(2);
              }}
            >
              <span className="imp-choice__icon">
                <TypeIcon />
              </span>
              <span className="imp-choice__text">
                <span className="imp-choice__title">Before &amp; after (PR)</span>
                <span className="imp-choice__sub">Diff two versions of a workflow</span>
              </span>
            </button>
          </div>
        )}

        {step === 2 && (
          <div className="imp-choices">
            <button
              className={`imp-choice${source === 'paste' ? ' is-active' : ''}`}
              onClick={() => chooseSource('paste')}
            >
              <span className="imp-choice__icon">
                <SourceIcon />
              </span>
              <span className="imp-choice__text">
                <span className="imp-choice__title">Paste JSON</span>
                <span className="imp-choice__sub">Copy &amp; paste the workflow text</span>
              </span>
            </button>
            <button
              className={`imp-choice${source === 'workflow' ? ' is-active' : ''}`}
              onClick={() => chooseSource('workflow')}
            >
              <span className="imp-choice__icon">
                <FileIcon />
              </span>
              <span className="imp-choice__text">
                <span className="imp-choice__title">Upload workflow</span>
                <span className="imp-choice__sub">A plain workflow.json file</span>
              </span>
            </button>
            <button
              className={`imp-choice${source === 'export' ? ' is-active' : ''}`}
              onClick={() => chooseSource('export')}
            >
              <span className="imp-choice__icon">
                <PackageIcon />
              </span>
              <span className="imp-choice__text">
                <span className="imp-choice__title">Upload export</span>
                <span className="imp-choice__sub">An export.json from this extension</span>
              </span>
            </button>
          </div>
        )}

        {step === 3 &&
          // An export bundle carries both sides, so it's always a single drop zone.
          (source === 'export' ? (
            <FileDrop file={fileA} onPick={(f) => void pick('a', f)} onRemove={() => setFileA(null)} />
          ) : mode === 'single' ? (
            source === 'paste' ? (
              <textarea
                className="imp-area"
                spellCheck={false}
                placeholder="Workflow JSON"
                value={primary}
                onChange={(e) => setPrimary(e.target.value)}
              />
            ) : (
              <FileDrop file={fileA} onPick={(f) => void pick('a', f)} onRemove={() => setFileA(null)} />
            )
          ) : (
            <div className="imp-cols">
              <div className="imp-cols__left">
                <div className="imp-field__label">Before</div>
                {source === 'paste' ? (
                  <textarea
                    className="imp-area"
                    spellCheck={false}
                    placeholder="Before — workflow JSON"
                    value={primary}
                    onChange={(e) => setPrimary(e.target.value)}
                  />
                ) : (
                  <FileDrop file={fileA} onPick={(f) => void pick('a', f)} onRemove={() => setFileA(null)} />
                )}
              </div>
              <div className="imp-cols__right">
                <div className="imp-field__label">After</div>
                {source === 'paste' ? (
                  <textarea
                    className="imp-area"
                    spellCheck={false}
                    placeholder="After — workflow JSON"
                    value={secondary}
                    onChange={(e) => setSecondary(e.target.value)}
                  />
                ) : (
                  <FileDrop file={fileB} onPick={(f) => void pick('b', f)} onRemove={() => setFileB(null)} />
                )}
              </div>
            </div>
          ))}
      </div>

      {error && <div className="imp-error">⚠ {error}</div>}

      <div className="imp-actions">
        <div>
          {step > 1 && (
            <button
              className="imp-btn imp-btn--icon"
              onClick={() => goto((step - 1) as Step)}
              aria-label="Back"
              title="Back"
            >
              <BackIcon />
            </button>
          )}
        </div>
        <div>
          {step === 3 && (
            <button className="imp-btn imp-btn--primary" onClick={submit}>
              <UploadIcon /> Import
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
