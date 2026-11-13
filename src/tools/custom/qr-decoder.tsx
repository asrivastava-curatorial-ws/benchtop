/** Reads QR codes from screenshots and photos, and explains what they contain. */
import { useEffect, useMemo, useState } from 'preact/hooks';
import { errorMessage } from '../../lib/errors';
import { describeQrContent } from '../../lib/qr-content';
import { CodeOutput } from '../../ui/CodeOutput';
import { context2d, createCanvas, downscale } from '../../ui/canvas';
import { ImageDrop, type LoadedImage } from '../../ui/ImageDrop';
import { CanvasView } from '../../ui/ImageToolView';
import { Icon } from '../../ui/icons';
import { defineCustomTool } from '../types';

interface Point {
  readonly x: number;
  readonly y: number;
}

interface Found {
  readonly text: string;
  readonly version: number;
  readonly bytes: number;
  readonly corners: readonly Point[];
}

/** Adds a white margin: codes cropped tight to their edge have no "quiet zone" and often fail to read. */
function withMargin(canvas: HTMLCanvasElement): { canvas: HTMLCanvasElement; offset: number } {
  const offset = Math.round(Math.max(canvas.width, canvas.height) * 0.1) + 8;
  const padded = createCanvas(canvas.width + offset * 2, canvas.height + offset * 2);
  const context = context2d(padded);
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, padded.width, padded.height);
  context.drawImage(canvas, offset, offset);
  return { canvas: padded, offset };
}

async function decode(source: HTMLCanvasElement): Promise<Found | null> {
  const { default: jsQR } = await import('jsqr');
  for (const padded of [false, true]) {
    const { canvas: base, offset } = padded ? withMargin(source) : { canvas: source, offset: 0 };
    const tried = new Set<number>();
    // Large photos read better scaled down; small screenshots need their full size.
    for (const edge of [1400, 900, 600, 360]) {
      const { canvas, scale } = downscale(base, edge);
      if (tried.has(canvas.width)) continue;
      tried.add(canvas.width);
      const image = context2d(canvas, true).getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(image.data, image.width, image.height, { inversionAttempts: 'attemptBoth' });
      if (code) {
        const { topLeftCorner, topRightCorner, bottomRightCorner, bottomLeftCorner } = code.location;
        return {
          text: code.data,
          version: code.version,
          bytes: code.binaryData.length,
          corners: [topLeftCorner, topRightCorner, bottomRightCorner, bottomLeftCorner].map((p) => ({ x: p.x / scale - offset, y: p.y / scale - offset })),
        };
      }
      // Yield so the window stays responsive between attempts.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  return null;
}

function QrDecoder() {
  const [image, setImage] = useState<LoadedImage | null>(null);
  const [result, setResult] = useState<Found | 'none' | 'busy' | { error: string } | null>(null);
  const preview = useMemo(() => (image ? downscale(image.canvas, 1200).canvas : null), [image]);

  useEffect(() => {
    if (!image) {
      setResult(null);
      return;
    }
    let cancelled = false;
    setResult('busy');
    decode(image.canvas).then(
      (found) => !cancelled && setResult(found ?? 'none'),
      (error: unknown) => !cancelled && setResult({ error: errorMessage(error) }),
    );
    return () => {
      cancelled = true;
    };
  }, [image]);

  const found = result && typeof result === 'object' && 'text' in result ? result : null;
  const content = found ? describeQrContent(found.text) : null;
  // Decoding starts in an effect, so an image without a result yet is still busy.
  const state = !image ? 'idle' : result === null || result === 'busy' ? 'busy' : typeof result === 'object' && 'error' in result ? 'error' : 'done';

  return (
    <section class="tool tool-image tool-qr layout-form" data-testid="tool" data-state={state}>
      <aside class="tool-side">
        <div class="tool-options">
          {!image && <p class="control-help">Drop a screenshot or photo that contains a QR code. Codes are read on this computer; links are shown, never opened.</p>}
          {result === 'busy' && <p class="control-help">Looking for a QR code…</p>}
          {result === 'none' && (
            <div class="qr-none" data-testid="qr-none">
              <div class="pane-title">No QR code found</div>
              <p class="control-help">Crop closer to the code, make sure it is in focus and fully visible, and avoid strong reflections. Barcodes other than QR are not read.</p>
            </div>
          )}
          {result && typeof result === 'object' && 'error' in result && <p class="control-help tone-bad">{result.error}</p>}
          {found && content && (
            <div class="qr-summary" data-testid="qr-kind">
              <div class="pane-title">{content.kind}</div>
              <div class="pane-meta">
                QR version {found.version}, {found.bytes} bytes
              </div>
              {content.warnings.map((warning) => (
                <p key={warning} class="qr-warning">
                  <Icon name="alert" size={14} />
                  {warning}
                </p>
              ))}
              {content.fields.length > 0 && (
                <dl class="fields qr-fields">
                  {content.fields.map(([label, value]) => (
                    <div key={label} class="field">
                      <dt>{label}</dt>
                      <dd>
                        <span class="field-value">{value}</span>
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
          )}
        </div>
      </aside>
      <div class="tool-main">
        <ImageDrop image={image} onImage={setImage} />
        {found && <CodeOutput baseName="qr-code" outputs={[{ label: 'Decoded text', language: 'text', code: found.text }]} />}
        {image && preview && (
          <div class="qr-stage">
            <div
              class="qr-frame"
              // Never enlarge small screenshots, and keep tall photos within the window.
              style={`aspect-ratio: ${image.canvas.width} / ${image.canvas.height}; width: min(100%, ${Math.min(640, image.canvas.width)}px, calc(62vh * ${(image.canvas.width / image.canvas.height).toFixed(4)}));`}
            >
              <CanvasView canvas={preview} checker />
              {found && (
                <svg class="qr-outline" viewBox={`0 0 ${image.canvas.width} ${image.canvas.height}`} preserveAspectRatio="none" aria-hidden="true">
                  <polygon points={found.corners.map((p) => `${p.x},${p.y}`).join(' ')} vector-effect="non-scaling-stroke" />
                </svg>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

export default defineCustomTool(QrDecoder);
