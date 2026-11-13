/**
 * Core contracts shared by every tool.
 *
 * A tool is described declaratively wherever possible: a list of option
 * definitions plus a pure `run`/`render` function.  The generic views in
 * `src/ui` turn that description into a complete, consistent UI, and the pure
 * functions are what the unit tests exercise.
 */
import type { ComponentChildren, ComponentType } from 'preact';

export type Lang = 'text' | 'json' | 'javascript' | 'typescript' | 'jsx' | 'html' | 'css' | 'xml' | 'markdown' | 'yaml';

/* ----------------------------------------------------------------------------
 * Option definitions (declarative form controls)
 * ------------------------------------------------------------------------- */

export type Values = Record<string, unknown>;

export interface Choice {
  readonly value: string;
  readonly label: string;
}

interface OptionBase {
  readonly key: string;
  readonly label: string;
  /** Short helper text rendered under the control (panel layout) or as a tooltip. */
  readonly help?: string;
  /** Hide the control unless the predicate holds for the current values. */
  readonly showIf?: (values: Values) => boolean;
}

export interface SelectOption extends OptionBase {
  readonly type: 'select' | 'segmented';
  readonly choices: readonly (string | Choice)[] | (() => readonly (string | Choice)[]);
  readonly default: string;
}

export interface ToggleOption extends OptionBase {
  readonly type: 'toggle';
  readonly default: boolean;
}

export interface NumberOption extends OptionBase {
  readonly type: 'number' | 'range';
  readonly default: number;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly unit?: string;
}

export interface TextOption extends OptionBase {
  readonly type: 'text';
  readonly default: string;
  readonly placeholder?: string;
  /** Secrets are masked and never written to persistent storage. */
  readonly secret?: boolean;
  readonly multiline?: boolean;
  readonly mono?: boolean;
  readonly wide?: boolean;
}

export interface ColorOption extends OptionBase {
  readonly type: 'color';
  readonly default: string;
  /** Show an opacity slider next to the picker. */
  readonly alpha?: boolean;
}

export interface ListOption extends OptionBase {
  readonly type: 'list';
  readonly item: readonly OptionDef[];
  readonly default: readonly Values[];
  readonly min?: number;
  readonly max?: number;
  /** Label used for each row, e.g. "Layer" -> "Layer 1". */
  readonly itemLabel?: string;
}

export interface HeadingOption {
  readonly type: 'heading';
  readonly key: string;
  readonly label: string;
  readonly showIf?: (values: Values) => boolean;
}

export type OptionDef = SelectOption | ToggleOption | NumberOption | TextOption | ColorOption | ListOption | HeadingOption;

type ValueOf<D> = D extends { type: 'toggle' }
  ? boolean
  : D extends { type: 'number' | 'range' }
    ? number
    : D extends { type: 'list'; item: infer I extends readonly OptionDef[] }
      ? ValuesOf<I>[]
      : D extends { type: 'heading' }
        ? never
        : string;

/** Maps a tuple of option definitions to the object of values it produces. */
export type ValuesOf<T extends readonly OptionDef[]> = 0 extends 1 & T ? Values : { [D in T[number] as D extends { type: 'heading' } ? never : D['key']]: ValueOf<D> };

export interface Preset<V = Values> {
  readonly name: string;
  readonly values: Partial<V>;
}

/* ----------------------------------------------------------------------------
 * Text tools: string (and/or bytes) in, structured result out
 * ------------------------------------------------------------------------- */

export interface BinaryFile {
  readonly name: string;
  readonly mime: string;
  readonly bytes: Uint8Array;
}

export interface Field {
  readonly label: string;
  readonly value: string;
  readonly mono?: boolean;
  readonly tone?: 'ok' | 'warn' | 'bad' | 'muted';
  /** CSS colour rendered as a chip next to the value. */
  readonly swatch?: string;
}

export interface DiffRow {
  readonly type: 'same' | 'add' | 'del';
  readonly left?: number;
  readonly right?: number;
  readonly text: string;
  /** Character ranges inside `text` that changed within the line. */
  readonly spans?: readonly (readonly [number, number])[];
}

export type Preview =
  /** Rendered as an <img> from a blob URL: scripts inside can never run. */
  | { readonly kind: 'svg'; readonly svg: string; readonly checker?: boolean }
  /** Sanitised with DOMPurify on the main thread before it touches the DOM. */
  | { readonly kind: 'html'; readonly html: string }
  | { readonly kind: 'image'; readonly bytes: Uint8Array; readonly mime: string }
  | { readonly kind: 'diff'; readonly rows: readonly DiffRow[] };

export interface TextResult {
  readonly output?: string;
  readonly language?: Lang;
  readonly fields?: readonly Field[];
  /** One-line status such as "1.2 kB -> 640 B (47% smaller)". */
  readonly info?: string;
  readonly warnings?: readonly string[];
  readonly preview?: Preview;
  /** Binary payload the user can save (for example a decoded Base64 file). */
  readonly binary?: BinaryFile;
  /** Suggested file name for saving `output`. */
  readonly filename?: string;
}

export interface RunContext {
  /** Second text pane (diff). */
  readonly input2: string;
  /** Binary file chosen instead of typed input, when the tool accepts one. */
  readonly file: BinaryFile | null;
  /** Changes on every explicit "Regenerate" so generators can ignore caches. */
  readonly nonce: number;
}

export interface PaneSpec {
  readonly label?: string;
  readonly language?: Lang;
  readonly placeholder?: string;
  readonly sample?: string;
  /** `accept` attribute for the file picker. */
  readonly accept?: string;
  /** Allow opening any file as raw bytes instead of text. */
  readonly binary?: boolean;
}

export interface TextToolInit<T extends readonly OptionDef[]> {
  /** `false` for pure generators that have no input pane. */
  readonly input: PaneSpec | false;
  readonly input2?: PaneSpec;
  readonly output?: { readonly label?: string; readonly language?: Lang } | false;
  readonly options: T;
  readonly presets?: readonly Preset<ValuesOf<T>>[];
  /** Run automatically while typing (default) or only on demand. */
  readonly live?: boolean;
  /** Label of the action button for generators / on-demand tools. */
  readonly action?: string;
  /** Must run on the main thread (needs the DOM). */
  readonly mainThread?: boolean;
  /** Option patch applied when the user swaps output back into the input. */
  readonly swap?: (values: ValuesOf<T>) => Partial<ValuesOf<T>>;
  /** Whether an empty input should still be processed. */
  readonly runOnEmpty?: boolean;
  readonly run: (input: string, values: ValuesOf<T>, ctx: RunContext) => string | TextResult | Promise<string | TextResult>;
}

export interface TextToolSpec<T extends readonly OptionDef[] = readonly OptionDef[]> extends TextToolInit<T> {
  readonly kind: 'text';
}

export function defineTextTool<const T extends readonly OptionDef[]>(spec: TextToolInit<T>): TextToolSpec<T> {
  return { kind: 'text', ...spec };
}

/* ----------------------------------------------------------------------------
 * Visual generators: controls in, live preview + code out
 * ------------------------------------------------------------------------- */

export interface CodeOutput {
  readonly label: string;
  readonly language: Lang;
  readonly code: string;
  readonly filename?: string;
}

export interface Download {
  readonly label: string;
  readonly filename: string;
  readonly make: () => Promise<Blob | Uint8Array | string> | Blob | Uint8Array | string;
}

export interface VisualRender {
  readonly preview: ComponentChildren;
  /** Extra CSS for the preview (keyframes, :hover rules...). */
  readonly css?: string;
  readonly outputs: readonly CodeOutput[];
  readonly downloads?: readonly Download[];
  readonly note?: string;
}

export interface VisualToolInit<T extends readonly OptionDef[]> {
  readonly controls: T;
  readonly presets?: readonly Preset<ValuesOf<T>>[];
  /** Returns a patch with fresh random values ("Randomise" button). */
  readonly randomize?: (values: ValuesOf<T>) => Partial<ValuesOf<T>>;
  readonly render: (values: ValuesOf<T>) => VisualRender;
}

export interface VisualToolSpec<T extends readonly OptionDef[] = readonly OptionDef[]> extends VisualToolInit<T> {
  readonly kind: 'visual';
}

export function defineVisualTool<const T extends readonly OptionDef[]>(spec: VisualToolInit<T>): VisualToolSpec<T> {
  return { kind: 'visual', ...spec };
}

/* ----------------------------------------------------------------------------
 * Image tools: bitmap in, bitmap(s) out
 * ------------------------------------------------------------------------- */

export interface ImageEnv {
  /** Ratio of the bitmap being processed to the full-resolution source (<= 1 for previews). */
  readonly scale: number;
}

export interface ImageOutput {
  readonly label?: string;
  readonly canvas: HTMLCanvasElement;
}

export interface ImageRender {
  readonly outputs: readonly ImageOutput[];
  readonly info?: string;
}

export interface ImageToolInit<T extends readonly OptionDef[]> {
  readonly controls: T;
  readonly presets?: readonly Preset<ValuesOf<T>>[];
  /** Output formats offered, in order.  Defaults to PNG, JPEG, WebP, AVIF. */
  readonly formats?: readonly ImageFormat[];
  /** Show the source next to the result (default true). */
  readonly showSource?: boolean;
  readonly process: (source: HTMLCanvasElement, values: ValuesOf<T>, env: ImageEnv) => ImageRender | Promise<ImageRender>;
}

export interface ImageToolSpec<T extends readonly OptionDef[] = readonly OptionDef[]> extends ImageToolInit<T> {
  readonly kind: 'image';
}

export type ImageFormat = 'png' | 'jpeg' | 'webp' | 'avif';

export function defineImageTool<const T extends readonly OptionDef[]>(spec: ImageToolInit<T>): ImageToolSpec<T> {
  return { kind: 'image', ...spec };
}

/* ----------------------------------------------------------------------------
 * Bespoke tools and the registry entry
 * ------------------------------------------------------------------------- */

export interface CustomToolSpec {
  readonly kind: 'custom';
  readonly component: ComponentType<{ toolId: string }>;
}

export function defineCustomTool(component: ComponentType<{ toolId: string }>): CustomToolSpec {
  return { kind: 'custom', component };
}

// biome-ignore lint/suspicious/noExplicitAny: the registry stores heterogeneous specs
export type AnyToolSpec = TextToolSpec<any> | VisualToolSpec<any> | ImageToolSpec<any> | CustomToolSpec;

export type CategoryId = 'format' | 'convert' | 'encode' | 'crypto' | 'generate' | 'text' | 'css' | 'color' | 'image' | 'misc';

export interface ToolEntry {
  readonly id: string;
  readonly name: string;
  readonly category: CategoryId;
  readonly description: string;
  /** Extra search terms. */
  readonly keywords?: readonly string[];
  /** Names of the web tools this one replaces (used to build docs/TOOLS.md). */
  readonly covers?: readonly string[];
  readonly kind: AnyToolSpec['kind'];
  readonly load: () => Promise<{ default: AnyToolSpec }>;
}
