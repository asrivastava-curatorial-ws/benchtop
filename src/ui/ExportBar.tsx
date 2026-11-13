/** Format, quality and "Save" for a canvas, with an estimate of the encoded size. */
import { useEffect, useRef, useState } from 'preact/hooks';
import { formatBytes } from '../lib/bytes';
import { saveFile } from '../platform';
import type { ImageFormat } from '../tools/types';
import { Superseded } from '../worker/client';
import { encodeCanvas, FORMAT_INFO, replaceExtension } from './canvas';
import { Icon } from './icons';
import { attempt, notify } from './toast';

const ALL_FORMATS: readonly ImageFormat[] = ['png', 'jpeg', 'webp', 'avif'];
/** Above this size the estimate is only computed on request, to avoid long encodes while adjusting. */
const AUTO_ESTIMATE_PIXELS = 4_000_000;

interface Props {
  /** Produces the full-resolution result on demand. */
  readonly render: () => Promise<HTMLCanvasElement> | HTMLCanvasElement;
  /** Changes whenever the rendered result would change. */
  readonly revision: unknown;
  readonly pixels: number;
  readonly baseName: string;
  readonly formats?: readonly ImageFormat[];
  readonly originalSize?: number;
  readonly defaultFormat?: ImageFormat;
  readonly label?: string;
}

export function ExportBar({ render, revision, pixels, baseName, formats = ALL_FORMATS, originalSize, defaultFormat, label = 'Save image' }: Props) {
  const [format, setFormat] = useState<ImageFormat>(defaultFormat && formats.includes(defaultFormat) ? defaultFormat : (formats[0] ?? 'png'));
  const [quality, setQuality] = useState(80);
  const [lossless, setLossless] = useState(false);
  const [estimate, setEstimate] = useState<{ size: number } | 'pending' | 'manual' | { error: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const token = useRef(0);
  const info = FORMAT_INFO[format];
  const canBeLossless = format === 'webp' || format === 'avif';

  const encode = async (): Promise<Blob> => encodeCanvas(await render(), { format, quality, lossless: canBeLossless && lossless });

  const runEstimate = () => {
    const current = ++token.current;
    setEstimate('pending');
    encode().then(
      (blob) => {
        if (token.current === current) setEstimate({ size: blob.size });
      },
      (error: unknown) => {
        if (token.current !== current || error instanceof Superseded) return;
        setEstimate({ error: error instanceof Error ? error.message : 'Encoding failed' });
      },
    );
  };

  useEffect(() => {
    token.current++;
    if (pixels > AUTO_ESTIMATE_PIXELS) {
      setEstimate('manual');
      return;
    }
    const timer = setTimeout(runEstimate, 350);
    return () => clearTimeout(timer);
  }, [revision, format, quality, lossless, pixels]);

  const save = () => {
    setSaving(true);
    void attempt(async () => {
      const blob = await encode();
      setEstimate({ size: blob.size });
      const saved = await saveFile(replaceExtension(baseName, info.ext), blob, info.mime);
      if (saved.saved) notify(`Saved to ${saved.location}`);
    }).finally(() => setSaving(false));
  };

  return (
    <div class="export-bar" data-testid="export-bar">
      <div class="control">
        <label class="control-label" for="export-format">
          Format
        </label>
        <select id="export-format" class="input" value={format} onChange={(event) => setFormat(event.currentTarget.value as ImageFormat)}>
          {formats.map((item) => (
            <option key={item} value={item}>
              {FORMAT_INFO[item].label}
            </option>
          ))}
        </select>
      </div>
      {info.lossy && !(canBeLossless && lossless) && (
        <div class="control">
          <label class="control-label" for="export-quality">
            Quality
          </label>
          <div class="range">
            <input id="export-quality" type="range" min={1} max={100} step={1} value={quality} onInput={(event) => setQuality(Number(event.currentTarget.value))} />
            <span class="unit">{quality}</span>
          </div>
        </div>
      )}
      {canBeLossless && (
        <label class="toggle" for="export-lossless">
          <input id="export-lossless" type="checkbox" role="switch" aria-checked={lossless} checked={lossless} onChange={(event) => setLossless(event.currentTarget.checked)} />
          <span class="toggle-track" aria-hidden="true" />
          <span class="toggle-text">Lossless</span>
        </label>
      )}
      <p class="export-size" data-testid="export-size" aria-live="polite">
        {estimate === 'pending' && (
          <>
            <span class="spinner" aria-hidden="true" /> Measuring…
          </>
        )}
        {estimate === 'manual' && (
          <button type="button" class="button button-small button-quiet" onClick={runEstimate}>
            Measure output size
          </button>
        )}
        {estimate !== null && typeof estimate === 'object' && 'size' in estimate && (
          <>
            <strong>{formatBytes(estimate.size)}</strong>
            {originalSize
              ? ` (${estimate.size <= originalSize ? `${Math.round((1 - estimate.size / originalSize) * 100)}% smaller` : `${Math.round((estimate.size / originalSize - 1) * 100)}% larger`} than the original)`
              : ''}
          </>
        )}
        {estimate !== null && typeof estimate === 'object' && 'error' in estimate && <span class="tone-bad">{estimate.error}</span>}
      </p>
      <button type="button" class="button button-primary" onClick={save} disabled={saving} data-testid="export-save">
        <Icon name="save" size={14} />
        {saving ? 'Encoding…' : label}
      </button>
    </div>
  );
}
