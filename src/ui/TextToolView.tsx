/**
 * The generic screen for every text tool: options, an input pane (text or a
 * dropped file), and a result made of text, a preview and labelled fields.
 */
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { useSettings } from '../app/store';
import { byteLength, formatBytes } from '../lib/bytes';
import { errorMessage, ToolError } from '../lib/errors';
import { copyText, pickFile, readBinaryFile, readClipboardText, readTextFile, saveFile } from '../platform';
import type { BinaryFile, OptionDef, PaneSpec, TextResult, TextToolSpec, ToolEntry } from '../tools/types';
import { runTextTool, Superseded } from '../worker/client';
import { CodeEditor } from './CodeEditor';
import { ControlsForm } from './Controls';
import { FieldList } from './FieldList';
import { useDelayedFlag, useToolValues } from './hooks';
import { Icon, type IconName } from './icons';
import { PreviewView } from './Preview';
import { attempt, notify } from './toast';

type Outcome =
  | { readonly state: 'idle' }
  | { readonly state: 'done'; readonly result: TextResult }
  | { readonly state: 'error'; readonly message: string; readonly line?: number; readonly column?: number };

function ActionButton({ icon, label, onClick, disabled, primary }: { icon: IconName; label: string; onClick: () => void; disabled?: boolean; primary?: boolean }) {
  return (
    <button type="button" class={`button button-small${primary ? ' button-primary' : ''}`} disabled={disabled} onClick={onClick}>
      <Icon name={icon} size={14} />
      {label}
    </button>
  );
}

interface InputPaneProps {
  readonly pane: PaneSpec;
  readonly fallbackLabel: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly file: BinaryFile | null;
  readonly onFile: (file: BinaryFile | null) => void;
  readonly wrap: boolean;
  readonly errorLine?: number;
  readonly testId: string;
}

function InputPane({ pane, fallbackLabel, value, onChange, file, onFile, wrap, errorLine, testId }: InputPaneProps) {
  const [dragging, setDragging] = useState(false);
  const label = pane.label ?? fallbackLabel;

  const accept = (chosen: File) =>
    attempt(async () => {
      if (pane.binary) {
        onFile(await readBinaryFile(chosen));
        onChange('');
      } else {
        onChange(await readTextFile(chosen));
      }
    });

  return (
    <div
      class={`pane pane-input${dragging ? ' is-dragging' : ''}`}
      onDragOver={(event) => {
        if (event.dataTransfer?.types.includes('Files')) {
          event.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        setDragging(false);
        const dropped = event.dataTransfer?.files[0];
        if (dropped) {
          event.preventDefault();
          void accept(dropped);
        }
      }}
    >
      <div class="pane-header">
        <span class="pane-title">{label}</span>
        <span class="pane-meta">{file ? '' : value === '' ? '' : `${value.length.toLocaleString('en-US')} chars`}</span>
        <div class="pane-actions">
          <ActionButton
            icon="paste"
            label="Paste"
            onClick={() =>
              attempt(async () => {
                onFile(null);
                onChange(await readClipboardText());
              })
            }
          />
          <ActionButton
            icon="open"
            label="Open"
            onClick={() =>
              attempt(async () => {
                const chosen = await pickFile(pane.accept);
                if (chosen) await accept(chosen);
              })
            }
          />
          {pane.sample !== undefined && (
            <ActionButton
              icon="sample"
              label="Sample"
              onClick={() => {
                onFile(null);
                onChange(pane.sample ?? '');
              }}
            />
          )}
          <ActionButton
            icon="clear"
            label="Clear"
            disabled={value === '' && file === null}
            onClick={() => {
              onFile(null);
              onChange('');
            }}
          />
        </div>
      </div>
      <div class="pane-body">
        {file ? (
          <div class="file-card" data-testid={`${testId}-file`}>
            <Icon name="file" size={28} />
            <div>
              <div class="file-name">{file.name}</div>
              <div class="file-meta">
                {formatBytes(file.bytes.length)}
                {file.mime ? `, ${file.mime}` : ''}
              </div>
            </div>
            <button type="button" class="button button-small" onClick={() => onFile(null)}>
              Remove file
            </button>
          </div>
        ) : (
          <CodeEditor
            value={value}
            onChange={onChange}
            language={pane.language ?? 'text'}
            placeholder={pane.placeholder ?? (pane.binary ? 'Type or paste text, or drop a file here' : 'Type, paste or drop a file here')}
            wrap={wrap}
            label={label}
            errorLine={errorLine}
            testId={testId}
          />
        )}
      </div>
    </div>
  );
}

// biome-ignore lint/suspicious/noExplicitAny: the view accepts every text tool
export function TextToolView({ entry, spec }: { entry: ToolEntry; spec: TextToolSpec<any> }) {
  const wrap = useSettings((settings) => settings.wrapLines);
  const [values, patchValues, resetValues] = useToolValues(entry.id, spec.options);
  const [input, setInput] = useState('');
  const [input2, setInput2] = useState('');
  const [file, setFile] = useState<BinaryFile | null>(null);
  const [nonce, setNonce] = useState(0);
  const [outcome, setOutcome] = useState<Outcome>({ state: 'idle' });
  const [running, setRunning] = useState(false);
  const [stale, setStale] = useState(false);
  const [tab, setTab] = useState<'preview' | 'code'>('preview');
  const sequence = useRef(0);
  const busy = useDelayedFlag(running);

  const pane = spec.input === false ? null : spec.input;
  const live = spec.live !== false;
  const hasOptions = spec.options.length > 0;
  const sidePanel = pane === null || spec.options.some((option: OptionDef) => option.type === 'list' || (option.type === 'text' && option.multiline));
  const layout = spec.input2 ? 'compare' : pane === null ? 'form' : sidePanel ? 'side' : 'bar';
  const empty = pane !== null && input === '' && file === null && (spec.input2 === undefined || input2 === '');

  const execute = useCallback(async () => {
    const token = ++sequence.current;
    setStale(false);
    if (empty && !spec.runOnEmpty) {
      setOutcome({ state: 'idle' });
      setRunning(false);
      return;
    }
    setRunning(true);
    try {
      const result = await runTextTool(entry.id, spec, { input, input2, file, values, nonce });
      if (sequence.current === token) setOutcome({ state: 'done', result });
    } catch (error) {
      if (error instanceof Superseded || sequence.current !== token) return;
      setOutcome(
        error instanceof ToolError ? { state: 'error', message: error.message, line: error.line, column: error.column } : { state: 'error', message: `Something went wrong: ${errorMessage(error)}` },
      );
    } finally {
      if (sequence.current === token) setRunning(false);
    }
  }, [entry.id, spec, input, input2, file, values, nonce, empty]);

  useEffect(() => {
    if (!live) {
      setStale(true);
      return;
    }
    // Typing is debounced; tools without an input pane respond to their controls at once.
    const timer = setTimeout(() => void execute(), pane === null ? 60 : 160);
    return () => clearTimeout(timer);
  }, [execute, live, pane]);

  // A new explicit run request for on-demand tools.
  const runNow = () => {
    if (live) setNonce((value) => value + 1);
    else void execute();
  };

  const result = outcome.state === 'done' ? outcome.result : null;
  const output = result?.output;
  const preview = result?.preview;
  const fields = result?.fields ?? [];
  const warnings = result?.warnings ?? [];
  const showsOutput = spec.output !== false;
  const hasBoth = preview !== undefined && output !== undefined && showsOutput;
  const outputLabel = (spec.output !== false && spec.output?.label) || 'Result';
  const outputLanguage = result?.language ?? (spec.output !== false ? spec.output?.language : undefined) ?? 'text';
  const filename = result?.filename ?? `${entry.id}.txt`;
  const showPreview = preview !== undefined && (!hasBoth || tab === 'preview');

  const copyOutput = () =>
    attempt(async () => {
      if (output === undefined) return;
      await copyText(output);
      notify('Copied');
    });
  const saveOutput = () =>
    attempt(async () => {
      if (output === undefined) return;
      const saved = await saveFile(filename, output, 'text/plain;charset=utf-8');
      if (saved.saved) notify(`Saved to ${saved.location}`);
    });
  const saveBinary = () =>
    attempt(async () => {
      if (!result?.binary) return;
      const saved = await saveFile(result.binary.name, result.binary.bytes, result.binary.mime);
      if (saved.saved) notify(`Saved to ${saved.location}`);
    });
  const swap = () => {
    if (!spec.swap || output === undefined) return;
    setFile(null);
    setInput(output);
    patchValues(spec.swap(values));
  };

  const options = (
    <div class="tool-options" data-testid="options">
      {spec.presets && spec.presets.length > 0 && (
        <div class="presets" role="group" aria-label="Presets">
          {spec.presets.map((preset) => (
            <button key={preset.name} type="button" class="chip" onClick={() => patchValues(preset.values)}>
              {preset.name}
            </button>
          ))}
        </div>
      )}
      {hasOptions && <ControlsForm defs={spec.options} values={values} onChange={patchValues} layout={layout === 'bar' || layout === 'compare' ? 'bar' : 'panel'} idPrefix={entry.id} />}
      <div class="tool-options-actions">
        {(spec.action !== undefined || !live) && (
          <button type="button" class="button button-primary" data-testid="run" onClick={runNow}>
            <Icon name={live ? 'refresh' : 'play'} size={14} />
            {spec.action ?? 'Run'}
          </button>
        )}
        {hasOptions && (
          <button type="button" class="button button-quiet" onClick={resetValues} title="Restore the default options">
            Reset options
          </button>
        )}
      </div>
    </div>
  );

  const outputPane = (showsOutput || preview !== undefined) && (
    <div class="pane pane-output">
      <div class="pane-header">
        {hasBoth ? (
          <div class="tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === 'preview'} class={tab === 'preview' ? 'is-active' : ''} onClick={() => setTab('preview')}>
              Preview
            </button>
            <button type="button" role="tab" aria-selected={tab === 'code'} class={tab === 'code' ? 'is-active' : ''} onClick={() => setTab('code')}>
              {outputLabel}
            </button>
          </div>
        ) : (
          <span class="pane-title">{showPreview ? 'Preview' : outputLabel}</span>
        )}
        <span class="pane-meta">{output !== undefined && output !== '' && !showPreview ? formatBytes(byteLength(output)) : ''}</span>
        <div class="pane-actions">
          {spec.swap && <ActionButton icon="swap" label="Use as input" disabled={!output} onClick={swap} />}
          {result?.binary && <ActionButton icon="save" label={`Save ${result.binary.name}`} onClick={saveBinary} primary />}
          {showsOutput && <ActionButton icon="copy" label="Copy" disabled={!output} onClick={copyOutput} />}
          {showsOutput && <ActionButton icon="save" label="Save" disabled={!output} onClick={saveOutput} />}
        </div>
      </div>
      <div class="pane-body">
        {showPreview && preview ? (
          <PreviewView preview={preview} name={filename} />
        ) : (
          <CodeEditor
            value={output ?? ''}
            language={outputLanguage}
            readOnly
            wrap={wrap}
            label={outputLabel}
            placeholder={outcome.state === 'error' ? '' : live ? 'The result appears here' : `Press ${spec.action ?? 'Run'} to see the result`}
            testId="output-editor"
          />
        )}
      </div>
    </div>
  );

  const status = (
    <div class="tool-status" data-testid="status" aria-live="polite">
      {outcome.state === 'error' && (
        <p class="status status-error" role="alert">
          <Icon name="alert" size={15} />
          <span>{outcome.message}</span>
        </p>
      )}
      {warnings.map((warning) => (
        <p key={warning} class="status status-warn">
          <Icon name="info" size={15} />
          <span>{warning}</span>
        </p>
      ))}
      {outcome.state !== 'error' && (
        <p class="status status-info">
          {busy ? (
            <>
              <span class="spinner" aria-hidden="true" /> Working…
            </>
          ) : !live && stale && outcome.state === 'done' ? (
            `Inputs changed. Press ${spec.action ?? 'Run'} to update.`
          ) : (
            (result?.info ?? '')
          )}
        </p>
      )}
    </div>
  );

  const state = outcome.state === 'error' ? 'error' : running ? 'busy' : outcome.state;
  const details = fields.length > 0 && (
    <div class="tool-details">
      <FieldList fields={fields} />
    </div>
  );

  return (
    <section
      class={`tool tool-text layout-${layout}`}
      data-testid="tool"
      data-state={state}
      data-output-length={output?.length ?? 0}
      data-fields={fields.length}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
          event.preventDefault();
          runNow();
        }
      }}
    >
      {layout === 'bar' || layout === 'compare' ? (
        <>
          {(hasOptions || spec.action !== undefined || !live) && options}
          <div class="tool-work">
            {pane && (
              <InputPane
                pane={pane}
                fallbackLabel="Input"
                value={input}
                onChange={setInput}
                file={file}
                onFile={setFile}
                wrap={wrap}
                errorLine={outcome.state === 'error' ? outcome.line : undefined}
                testId="input-editor"
              />
            )}
            {spec.input2 && <InputPane pane={spec.input2} fallbackLabel="Second input" value={input2} onChange={setInput2} file={null} onFile={() => undefined} wrap={wrap} testId="input2-editor" />}
            {outputPane}
          </div>
          {details}
          {status}
        </>
      ) : (
        <>
          <aside class="tool-side">{options}</aside>
          <div class="tool-main">
            <div class="tool-work">
              {pane && (
                <InputPane
                  pane={pane}
                  fallbackLabel="Input"
                  value={input}
                  onChange={setInput}
                  file={file}
                  onFile={setFile}
                  wrap={wrap}
                  errorLine={outcome.state === 'error' ? outcome.line : undefined}
                  testId="input-editor"
                />
              )}
              {outputPane}
            </div>
            {details}
            {status}
          </div>
        </>
      )}
    </section>
  );
}
