/**
 * A toolkit screen for one family of jobs (video, audio, PDF security): pick an
 * operation, pick files, set its options and run it on each file in turn.
 * Operations are data, so the video and audio toolkits share this screen.
 */
import { useEffect, useMemo, useState } from 'preact/hooks';
import { extensionOf, useHandoff } from '../../app/handoff';
import { type PickedFile, stageFile } from '../../platform/ai';
import { type MediaInfo, type ProgramId, probeMedia } from '../../platform/convert';
import { attempt } from '../../ui/toast';
import type { Values } from '../types';
import { chooseFiles, clock, DestinationControl, has, InstallHint, ProgramGate, QueueList, useDestination, usePrograms, useQueue } from './_convert';
import { CropPreview, TrimPreview } from './_frame-preview';
import { usePersistentState } from './_shared';

export interface Choice {
  readonly value: string;
  readonly label: string;
}

export type Field =
  | {
      readonly key: string;
      readonly label: string;
      readonly type: 'number';
      readonly min: number;
      readonly max: number;
      readonly step?: number;
      readonly value: number;
      readonly unit?: string;
      readonly hint?: string;
    }
  | { readonly key: string; readonly label: string; readonly type: 'time'; readonly value: string; readonly hint?: string }
  | { readonly key: string; readonly label: string; readonly type: 'select'; readonly choices: readonly Choice[]; readonly value: string; readonly hint?: string }
  | { readonly key: string; readonly label: string; readonly type: 'toggle'; readonly value: boolean; readonly hint?: string }
  | { readonly key: string; readonly label: string; readonly type: 'colour'; readonly value: string; readonly hint?: string }
  | { readonly key: string; readonly label: string; readonly type: 'password'; readonly value: string; readonly hint?: string };

export interface Operation {
  /** The recipe name in convert.rs. */
  readonly id: string;
  readonly label: string;
  readonly group: string;
  readonly description: string;
  readonly fields: readonly Field[];
  /** Program needed, when not the toolkit's main one. */
  readonly program?: Exclude<ProgramId, 'ffprobe'>;
  /** All chosen files go into one job (joining). */
  readonly combine?: boolean;
  /** A second file used with every input (subtitles, a logo). */
  readonly extra?: { readonly label: string; readonly name: string; readonly extensions: readonly string[] };
  /** Verb for the run button. */
  readonly verb: string;
}

export interface KitSpec {
  readonly what: string;
  readonly noun: [string, string];
  readonly program: Exclude<ProgramId, 'ffprobe'>;
  /** Show the toolkit when any of these is installed (operations name their own program). */
  readonly anyOf?: readonly Exclude<ProgramId, 'ffprobe'>[];
  readonly extensions: readonly string[];
  readonly operations: readonly Operation[];
  /** Read media details for each chosen file (video and audio). */
  readonly probe?: boolean;
}

type Settings = { readonly op: string; readonly values: Readonly<Record<string, Values>> };

function fieldValue(field: Field, stored: unknown): unknown {
  switch (field.type) {
    case 'number':
      return typeof stored === 'number' && Number.isFinite(stored) ? Math.min(field.max, Math.max(field.min, stored)) : field.value;
    case 'toggle':
      return typeof stored === 'boolean' ? stored : field.value;
    case 'select':
      return field.choices.some((c) => c.value === stored) ? stored : field.value;
    case 'password':
      return '';
    default:
      return typeof stored === 'string' ? stored : field.value;
  }
}

function FieldControl({ field, value, onChange, id }: { field: Field; value: unknown; onChange: (value: unknown) => void; id: string }) {
  const label = (
    <label class="control-label" for={id}>
      {field.label}
      {field.type === 'number' && field.unit ? ` (${field.unit})` : ''}
    </label>
  );
  const hint = field.hint ? <span class="control-hint">{field.hint}</span> : null;
  switch (field.type) {
    case 'toggle':
      return (
        <div class="control">
          <label class="toggle" for={id}>
            <input id={id} type="checkbox" role="switch" aria-checked={Boolean(value)} checked={Boolean(value)} onChange={(e) => onChange(e.currentTarget.checked)} />
            <span class="toggle-track" aria-hidden="true" />
            <span>{field.label}</span>
          </label>
          {hint}
        </div>
      );
    case 'select':
      return (
        <div class="control">
          {label}
          <select id={id} class="input" value={String(value)} onChange={(e) => onChange(e.currentTarget.value)}>
            {field.choices.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
          {hint}
        </div>
      );
    case 'number':
      return (
        <div class="control">
          {label}
          <input
            id={id}
            class="input input-number"
            type="number"
            min={field.min}
            max={field.max}
            step={field.step ?? 1}
            value={String(value)}
            onInput={(e) => {
              const n = Number(e.currentTarget.value);
              if (e.currentTarget.value !== '' && Number.isFinite(n)) onChange(n);
            }}
          />
          {hint}
        </div>
      );
    case 'colour':
      return (
        <div class="control">
          {label}
          <input id={id} type="color" value={String(value)} onInput={(e) => onChange(e.currentTarget.value)} />
          {hint}
        </div>
      );
    case 'password':
      return (
        <div class="control">
          {label}
          <input id={id} class="input" type="password" autocomplete="new-password" value={String(value)} onInput={(e) => onChange(e.currentTarget.value)} />
          {hint}
        </div>
      );
    default:
      return (
        <div class="control">
          {label}
          <input id={id} class="input input-mono" type="text" inputMode="decimal" placeholder="0:00" value={String(value)} onInput={(e) => onChange(e.currentTarget.value)} />
          {hint}
        </div>
      );
  }
}

function describeMedia(info: MediaInfo | undefined): string | null {
  if (!info) return null;
  const parts = [clock(info.duration)];
  if (info.video && info.width && info.height) parts.push(`${info.width}×${info.height}`);
  if (info.video) parts.push(info.audio ? 'with sound' : 'no sound');
  return parts.join(', ');
}

function Kit({ toolId, spec }: { toolId: string; spec: KitSpec }) {
  const read = (s: Values | undefined): Settings => {
    const op = spec.operations.find((o) => o.id === s?.op)?.id ?? spec.operations[0].id;
    const values = (s?.values && typeof s.values === 'object' ? s.values : {}) as Record<string, Values>;
    return { op, values };
  };
  const [settings, setSettings] = usePersistentState<Settings>(toolId, read, (s) => ({
    op: s.op,
    // Passwords are never remembered.
    values: Object.fromEntries(
      Object.entries(s.values).map(([op, v]) => [
        op,
        Object.fromEntries(Object.entries(v).filter(([key]) => !spec.operations.find((o) => o.id === op)?.fields.some((f) => f.key === key && f.type === 'password'))),
      ]),
    ),
  }));
  const [passwords, setPasswords] = useState<Record<string, string>>({});
  const op = spec.operations.find((o) => o.id === settings.op) ?? spec.operations[0];
  const queue = useQueue();
  const [target, setTarget] = useDestination();
  const [extra, setExtra] = useState<PickedFile | null>(null);
  const [media, setMedia] = useState<Record<string, MediaInfo>>({});
  const { programs } = usePrograms();

  const values = useMemo(() => {
    const stored = settings.values[op.id] ?? {};
    return Object.fromEntries(op.fields.map((f) => [f.key, f.type === 'password' ? (passwords[`${op.id}.${f.key}`] ?? '') : fieldValue(f, stored[f.key])]));
  }, [settings, op, passwords]);

  const set = (key: string, value: unknown) => {
    const field = op.fields.find((f) => f.key === key);
    if (field?.type === 'password') {
      setPasswords((p) => ({ ...p, [`${op.id}.${key}`]: String(value) }));
      return;
    }
    setSettings((s) => ({ ...s, values: { ...s.values, [op.id]: { ...(s.values[op.id] ?? {}), [key]: value as Values[string] } } }));
  };

  // Files dropped on the window or sent from another tool (Transcription sends a video with its subtitles).
  useHandoff((handoff) => {
    void attempt(async () => {
      const task = handoff.task && spec.operations.some((o) => o.id === handoff.task) ? handoff.task : null;
      if (task) setSettings((s) => ({ ...s, op: task }));
      const picked = [...(handoff.picked ?? [])];
      for (const file of handoff.files ?? []) if (spec.extensions.includes(extensionOf(file.name))) picked.push(await stageFile(file));
      if (picked.length) queue.add(picked);
      if (handoff.extra) setExtra(await stageFile(handoff.extra));
    });
  });

  // Media details for new files.
  useEffect(() => {
    if (!spec.probe) return;
    for (const item of queue.items) {
      const token = item.file.token;
      if (media[token]) continue;
      probeMedia(token).then(
        (info) => setMedia((m) => ({ ...m, [token]: info })),
        () => undefined,
      );
    }
  }, [queue.items, spec.probe]);

  const missingProgram = op.program && programs && !has(programs, op.program) ? op.program : null;
  const waiting = queue.items.filter((i) => i.state !== 'done' && i.state !== 'running');
  const again = waiting.length === 0 && queue.items.length > 0;
  const ready = queue.items.length > 0 && !queue.running && (!op.extra || extra) && !missingProgram && (!op.combine || queue.items.length >= 2);
  const count = op.combine || again ? queue.items.length : waiting.length;

  const run = () =>
    void attempt(async () => {
      if (op.combine) {
        await queue.runCombined({ recipe: op.id, inputs: queue.items.map((i) => i.file.token), options: values }, target);
        return;
      }
      await queue.runAll(() => ({ recipe: op.id, inputs: undefined, options: values, extra: extra?.token }), target, again);
    });

  const groups = [...new Set(spec.operations.map((o) => o.group))];
  // Trim and crop show what they will keep, on the first video in the list.
  const first = queue.items[0]?.file.token;
  const firstInfo = first ? media[first] : undefined;
  const preview =
    first && firstInfo?.video && op.id === 'video-trim' ? (
      <TrimPreview token={first} info={firstInfo} start={String(values.start ?? '')} end={String(values.end ?? '')} />
    ) : first && firstInfo?.video && op.id === 'video-crop' ? (
      <CropPreview
        token={first}
        info={firstInfo}
        box={{ x: Number(values.x), y: Number(values.y), w: Number(values.w), h: Number(values.h) }}
        onChange={(box) => {
          set('x', box.x);
          set('y', box.y);
          set('w', box.w);
          set('h', box.h);
        }}
      />
    ) : null;
  return (
    <div data-testid="tool" class="tool ai-tool conv-tool">
      <div class="ai-controls">
        <div class="control">
          <label class="control-label" for={`${toolId}-op`}>
            Task
          </label>
          <select
            id={`${toolId}-op`}
            class="input"
            value={op.id}
            onChange={(e) => {
              const next = e.currentTarget.value;
              setSettings((s) => ({ ...s, op: next }));
              setExtra(null);
              if (!queue.running) queue.reset();
            }}
            data-testid="kit-op"
          >
            {groups.map((group) => (
              <optgroup key={group} label={group}>
                {spec.operations
                  .filter((o) => o.group === group)
                  .map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
          <span class="control-hint">{op.description}</span>
        </div>
        <div class="button-row">
          <button
            type="button"
            class="button"
            disabled={queue.running}
            onClick={() =>
              attempt(async () => {
                const files = await chooseFiles(true, spec.noun[1], spec.extensions);
                if (files.length) queue.add(files);
              })
            }
            data-testid="kit-choose"
          >
            Choose {spec.noun[1]}
          </button>
          {queue.items.length > 0 && (
            <button type="button" class="button button-quiet" disabled={queue.running} onClick={queue.clear}>
              Clear list
            </button>
          )}
        </div>
        {op.extra && (
          <div class="control">
            <span class="control-label">{op.extra.label}</span>
            <div class="button-row">
              <button
                type="button"
                class="button"
                disabled={queue.running}
                onClick={() =>
                  attempt(async () => {
                    const [file] = await chooseFiles(false, op.extra?.name ?? 'Files', op.extra?.extensions ?? []);
                    if (file) setExtra(file);
                  })
                }
              >
                {extra ? 'Change' : 'Choose'}
              </button>
              {extra && <span class="conv-folder mono">{extra.name}</span>}
            </div>
          </div>
        )}
        {op.fields.map((field) => (
          <FieldControl key={`${op.id}.${field.key}`} id={`${toolId}-${op.id}-${field.key}`} field={field} value={values[field.key]} onChange={(v) => set(field.key, v)} />
        ))}
        <DestinationControl value={target.destination} folderPath={target.folderPath} onChange={setTarget} />
        {missingProgram && programs && <InstallHint id={missingProgram} os={programs.os} />}
        <div class="button-row">
          <button type="button" class="button button-primary" disabled={!ready} onClick={run} data-testid="kit-run">
            {op.verb}
            {count > 1 ? ` ${count} ${spec.noun[1]}` : ''}
            {again && !op.combine ? ' again' : ''}
          </button>
          {queue.running && (
            <button type="button" class="button" onClick={queue.stop}>
              Stop
            </button>
          )}
        </div>
      </div>
      <div class="ai-work">
        {queue.items.length === 0 ? (
          <div class="conv-empty">
            <p>
              Choose one or more {spec.noun[1]} to {op.label.toLowerCase()}. They are processed on this computer by {spec.what}, one after another, and the originals are left unchanged.
            </p>
          </div>
        ) : (
          <>
            {preview}
            <QueueList
              items={queue.items}
              running={queue.running}
              onRemove={queue.remove}
              onMove={op.combine ? queue.move : undefined}
              describe={spec.probe ? (item) => describeMedia(media[item.file.token]) : undefined}
            />
          </>
        )}
      </div>
    </div>
  );
}

/** Wraps a toolkit in the program check. */
export function MediaKit({ toolId, spec }: { toolId: string; spec: KitSpec }) {
  return (
    <ProgramGate needs={spec.anyOf ? undefined : [spec.program]} anyOf={spec.anyOf} what={spec.what === 'FFmpeg' ? `This ${spec.noun[0]} toolkit` : 'This toolkit'}>
      <Kit toolId={toolId} spec={spec} />
    </ProgramGate>
  );
}

/* --------------------------------------------- shared field presets -- */

export const START: Field = { key: 'start', label: 'Start', type: 'time', value: '0:00', hint: 'Seconds or minutes:seconds, such as 1:05.5' };
export const END: Field = { key: 'end', label: 'End', type: 'time', value: '', hint: 'Leave empty to keep everything after the start' };
export const EXACT: Field = { key: 'exact', label: 'Cut exactly (re-encodes, slower)', type: 'toggle', value: false, hint: 'Off: cuts instantly at the nearest keyframe, without any loss' };
type SelectField = Extract<Field, { type: 'select' }>;

export const BITRATE: SelectField = {
  key: 'bitrate',
  label: 'Audio quality',
  type: 'select',
  value: '192',
  choices: [
    { value: '96', label: '96 kbit/s (speech)' },
    { value: '128', label: '128 kbit/s' },
    { value: '192', label: '192 kbit/s' },
    { value: '256', label: '256 kbit/s' },
    { value: '320', label: '320 kbit/s' },
  ],
};
export const DB: Field = { key: 'db', label: 'Change', type: 'number', min: -30, max: 30, step: 0.5, value: 6, unit: 'dB', hint: '+6 dB is about twice as loud; negative values make it quieter' };
export const SPEED: Field = { key: 'factor', label: 'Speed', type: 'number', min: 0.25, max: 4, step: 0.05, value: 1.5, unit: '×', hint: 'Pitch is kept' };
export const AUDIO_TO: SelectField = {
  key: 'to',
  label: 'Format',
  type: 'select',
  value: 'mp3',
  choices: [
    { value: 'mp3', label: 'MP3' },
    { value: 'm4a', label: 'M4A (AAC)' },
    { value: 'wav', label: 'WAV' },
    { value: 'flac', label: 'FLAC (lossless)' },
    { value: 'ogg', label: 'Ogg Vorbis' },
    { value: 'opus', label: 'Opus' },
  ],
};
