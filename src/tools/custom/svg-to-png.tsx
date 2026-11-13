/** Rasterise SVG at any size, with or without a background. */
import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';
import { trimNumber } from '../../lib/color';
import { errorMessage } from '../../lib/errors';
import { readSvg, svgIntrinsicSize } from '../../lib/xml-scan';
import { pickFile, readTextFile } from '../../platform';
import { CodeEditor } from '../../ui/CodeEditor';
import { ControlsForm } from '../../ui/Controls';
import { rasterizeSvg } from '../../ui/canvas';
import { ExportBar } from '../../ui/ExportBar';
import { useToolValues } from '../../ui/hooks';
import { CanvasView } from '../../ui/ImageToolView';
import { Icon } from '../../ui/icons';
import { attempt } from '../../ui/toast';
import { SVG_SAMPLE } from '../text/svg-minifier';
import { defineCustomTool, type OptionDef, type Values } from '../types';

const DEFS: readonly OptionDef[] = [
  {
    key: 'sizing',
    label: 'Size',
    type: 'segmented',
    choices: [
      { value: 'scale', label: 'Scale' },
      { value: 'width', label: 'Width' },
      { value: 'exact', label: 'Exact' },
    ],
    default: 'scale',
  },
  {
    key: 'scale',
    label: 'Scale',
    type: 'select',
    choices: ['0.5', '1', '1.5', '2', '3', '4', '8'].map((value) => ({ value, label: `${value}×` })),
    default: '2',
    showIf: (v: Values) => v.sizing === 'scale',
  },
  { key: 'width', label: 'Width', type: 'number', min: 1, max: 16384, step: 1, unit: 'px', default: 1024, showIf: (v: Values) => v.sizing !== 'scale' },
  {
    key: 'height',
    label: 'Height',
    type: 'number',
    min: 1,
    max: 16384,
    step: 1,
    unit: 'px',
    default: 1024,
    showIf: (v: Values) => v.sizing === 'exact',
    help: 'The SVG is stretched unless its preserveAspectRatio says otherwise.',
  },
  {
    key: 'background',
    label: 'Background',
    type: 'segmented',
    choices: [
      { value: 'none', label: 'Transparent' },
      { value: 'color', label: 'Colour' },
    ],
    default: 'none',
  },
  { key: 'color', label: 'Background colour', type: 'color', default: '#ffffff', showIf: (v: Values) => v.background === 'color' },
];

/** Output size in pixels for the chosen sizing mode. */
export function outputSize(intrinsic: { width: number; height: number }, v: Values): { width: number; height: number } {
  const ratio = intrinsic.height > 0 ? intrinsic.width / intrinsic.height : 1;
  if (v.sizing === 'width') return { width: Math.round(Number(v.width)), height: Math.max(1, Math.round(Number(v.width) / ratio)) };
  if (v.sizing === 'exact') return { width: Math.round(Number(v.width)), height: Math.round(Number(v.height)) };
  const scale = Number(v.scale) || 1;
  return { width: Math.max(1, Math.round(intrinsic.width * scale)), height: Math.max(1, Math.round(intrinsic.height * scale)) };
}

let lastSource = SVG_SAMPLE;

function SvgToPng({ toolId }: { toolId: string }) {
  const [values, patch] = useToolValues(toolId, DEFS);
  const [source, setSource] = useState(lastSource);
  const [name, setName] = useState('image.svg');
  const [preview, setPreview] = useState<{ canvas: HTMLCanvasElement } | { error: string } | null>(null);

  useEffect(() => {
    lastSource = source;
  }, [source]);

  const parsed = useMemo((): { size: { width: number; height: number } } | { error: string } => {
    try {
      return { size: svgIntrinsicSize(readSvg(source)) };
    } catch (error) {
      return { error: errorMessage(error) };
    }
  }, [source]);

  const size = 'size' in parsed ? outputSize(parsed.size, values) : null;
  const background = values.background === 'color' ? String(values.color) : undefined;

  const render = useCallback(async () => {
    if (!size) throw new Error('Fix the SVG first.');
    return rasterizeSvg(source, size.width, size.height, background);
  }, [source, size?.width, size?.height, background]);

  useEffect(() => {
    if (!size) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      // The preview is limited to 1200 px on its longest side; saving uses the full size.
      const scale = Math.min(1, 1200 / Math.max(size.width, size.height));
      rasterizeSvg(source, Math.max(1, size.width * scale), Math.max(1, size.height * scale), background).then(
        (canvas) => !cancelled && setPreview({ canvas }),
        (error: unknown) => !cancelled && setPreview({ error: errorMessage(error) }),
      );
    }, 120);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [source, size?.width, size?.height, background]);

  const open = () =>
    attempt(async () => {
      const file = await pickFile('.svg,image/svg+xml');
      if (!file) return;
      setSource(await readTextFile(file));
      setName(file.name);
    });

  const error = 'error' in parsed ? parsed.error : preview && 'error' in preview ? preview.error : null;

  return (
    <section class="tool layout-form" data-testid="tool" data-state={error ? 'error' : preview && 'canvas' in preview ? 'done' : 'busy'}>
      <aside class="tool-side">
        <div class="tool-options">
          <ControlsForm defs={DEFS} values={values} onChange={patch} layout="panel" idPrefix="svg2png" />
          {'size' in parsed && size && (
            <p class="control-help">
              The SVG's own size is {trimNumber(parsed.size.width, 2)} × {trimNumber(parsed.size.height, 2)} px. Output: {size.width} × {size.height} px.
            </p>
          )}
        </div>
        {size && preview && 'canvas' in preview && (
          <ExportBar render={render} revision={`${source.length}|${size.width}x${size.height}|${background}`} pixels={size.width * size.height} baseName={name} label="Save image" />
        )}
      </aside>
      <div class="tool-main">
        <div class="pane svg-source">
          <div class="pane-header">
            <span class="pane-title">SVG</span>
            <div class="pane-actions">
              <button type="button" class="button button-small" onClick={open}>
                <Icon name="open" size={14} />
                Open
              </button>
              <button type="button" class="button button-small" onClick={() => setSource(SVG_SAMPLE)}>
                <Icon name="sample" size={14} />
                Sample
              </button>
            </div>
          </div>
          <div class="pane-body">
            <CodeEditor value={source} onChange={setSource} language="xml" label="SVG source" testId="input-editor" />
          </div>
        </div>
        {error && (
          <p class="status status-error" role="alert">
            <Icon name="alert" size={15} />
            <span>{error}</span>
          </p>
        )}
        {preview && 'canvas' in preview && (
          <div class="image-results">
            <CanvasView canvas={preview.canvas} label={size ? `${size.width} × ${size.height} px` : undefined} checker={values.background !== 'color'} />
          </div>
        )}
      </div>
    </section>
  );
}

export default defineCustomTool(SvgToPng);
