/** Shows the metadata hidden in photos (camera, dates, GPS location) and saves a copy without it. */
import { useEffect, useMemo, useState } from 'preact/hooks';
import { formatBytes } from '../../lib/bytes';
import { errorMessage } from '../../lib/errors';
import { imageKind, readWebpMetadata, stripMetadata } from '../../lib/metadata';
import { copyText, pickFile, readBinaryFile, saveFile } from '../../platform';
import { replaceExtension } from '../../ui/canvas';
import { Icon } from '../../ui/icons';
import { attempt, notify } from '../../ui/toast';
import { defineCustomTool, type Values } from '../types';
import { usePersistentState } from './_shared';

interface Loaded {
  readonly name: string;
  readonly bytes: Uint8Array;
  readonly url: string;
}

interface Group {
  readonly id: string;
  readonly title: string;
  readonly rows: readonly (readonly [string, string])[];
}

interface Parsed {
  readonly groups: readonly Group[];
  readonly gps: { readonly latitude: number; readonly longitude: number } | null;
}

interface Settings {
  readonly keepColorProfile: boolean;
  readonly keepOrientation: boolean;
}

const TITLES: Record<string, string> = {
  ifd0: 'Camera and software',
  exif: 'Exposure and dates',
  gps: 'Location (GPS)',
  ifd1: 'Embedded thumbnail',
  interop: 'Interoperability',
  iptc: 'IPTC: captions, credits and keywords',
  icc: 'Colour profile (ICC)',
  jfif: 'JFIF header',
  ihdr: 'PNG header',
};
const ORDER = ['gps', 'ifd0', 'exif', 'iptc', 'icc', 'ifd1', 'interop', 'jfif', 'ihdr'];

const OPTIONS = {
  tiff: true,
  ifd1: true,
  exif: true,
  gps: true,
  interop: true,
  xmp: true,
  icc: true,
  iptc: true,
  jfif: true,
  ihdr: true,
  makerNote: false,
  userComment: true,
  mergeOutput: false,
  translateKeys: true,
  translateValues: true,
  reviveValues: true,
  sanitize: true,
};

const pad = (n: number) => String(n).padStart(2, '0');

function formatValue(key: string, value: unknown): string {
  // EXIF times carry no time zone, and exifr reads them as local time, so local getters return them unchanged.
  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? 'Invalid date'
      : `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())} ${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`;
  }
  if (value instanceof Uint8Array) return `${formatBytes(value.length)} of binary data`;
  if (Array.isArray(value)) return value.map((item) => formatValue(key, item)).join(', ');
  if (typeof value === 'number') {
    if (key === 'ExposureTime' && value > 0 && value < 1) return `1/${Math.round(1 / value)} s`;
    if (key === 'ExposureTime') return `${value} s`;
    if (key === 'FNumber') return `f/${value}`;
    if (key === 'FocalLength' || key === 'FocalLengthIn35mmFormat') return `${value} mm`;
    return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(6)));
  }
  if (value !== null && typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function toGroups(output: Record<string, unknown>, extraXmp: Record<string, unknown> | null): Parsed {
  const groups: Group[] = [];
  let gps: Parsed['gps'] = null;
  const all = { ...output, ...(extraXmp ?? {}) };
  const keys = Object.keys(all).sort((a, b) => (ORDER.indexOf(a) === -1 ? 99 : ORDER.indexOf(a)) - (ORDER.indexOf(b) === -1 ? 99 : ORDER.indexOf(b)));
  for (const id of keys) {
    const section = all[id];
    if (id === 'xmlns' || section === null || typeof section !== 'object') continue;
    const entries = Object.entries(section as Record<string, unknown>).filter(([, value]) => value !== undefined && value !== null && value !== '');
    if (id === 'gps') {
      const { latitude, longitude } = section as { latitude?: unknown; longitude?: unknown };
      if (typeof latitude === 'number' && typeof longitude === 'number' && Number.isFinite(latitude) && Number.isFinite(longitude)) gps = { latitude, longitude };
    }
    if (entries.length === 0) continue;
    groups.push({ id, title: TITLES[id] ?? `XMP: ${id}`, rows: entries.map(([key, value]) => [key, formatValue(key, value)] as const) });
  }
  return { groups, gps };
}

async function readMetadata(bytes: Uint8Array): Promise<Parsed> {
  const exifr = await import('exifr');
  if (imageKind(bytes) === 'webp') {
    // exifr does not read WebP containers, so their EXIF (TIFF) and XMP packets are handed over directly.
    const { exif, xmp } = readWebpMetadata(bytes);
    const output = exif ? ((await exifr.parse(exif, OPTIONS)) as Record<string, unknown> | undefined) : undefined;
    const Xmp = exifr.segmentParsers.get('xmp') as { parse?: (text: string) => Record<string, unknown> } | undefined;
    return toGroups(output ?? {}, xmp && Xmp?.parse ? Xmp.parse(xmp) : null);
  }
  const output = (await exifr.parse(bytes, OPTIONS)) as Record<string, unknown> | undefined;
  return toGroups(output ?? {}, null);
}

const MIME: Record<string, string> = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

function ImageMetadata({ toolId }: { toolId: string }) {
  const [settings, setSettings] = usePersistentState<Settings>(
    toolId,
    (stored: Values | undefined) => ({ keepColorProfile: stored?.keepColorProfile !== false, keepOrientation: stored?.keepOrientation !== false }),
    (s) => ({ ...s }),
  );
  const [file, setFile] = useState<Loaded | null>(null);
  const [parsed, setParsed] = useState<Parsed | { error: string } | 'loading' | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(
    () => () => {
      if (file) URL.revokeObjectURL(file.url);
    },
    [file],
  );

  useEffect(() => {
    if (!file) {
      setParsed(null);
      return;
    }
    let cancelled = false;
    setParsed('loading');
    readMetadata(file.bytes).then(
      (result) => !cancelled && setParsed(result),
      (error: unknown) =>
        !cancelled &&
        setParsed({
          error: /unknown file format/i.test(errorMessage(error)) ? 'This file is not an image format that can carry metadata (JPEG, PNG, WebP, TIFF, HEIC or AVIF).' : errorMessage(error),
        }),
    );
    return () => {
      cancelled = true;
    };
  }, [file]);

  const cleaned = useMemo(() => {
    if (!file) return null;
    const kind = imageKind(file.bytes);
    if (!kind) return { error: 'Metadata can be removed from JPEG, PNG and WebP files. Convert other formats with the image converter first.' };
    try {
      return { kind, ...stripMetadata(file.bytes, settings) };
    } catch (error) {
      return { error: errorMessage(error) };
    }
  }, [file, settings]);

  const take = (picked: File | null | undefined) => {
    if (!picked) return;
    void attempt(async () => {
      const { name, bytes } = await readBinaryFile(picked);
      setFile({ name, bytes, url: URL.createObjectURL(new Blob([bytes as BlobPart], { type: picked.type || 'application/octet-stream' })) });
    });
  };

  const save = () =>
    attempt(async () => {
      if (!file || !cleaned || 'error' in cleaned) return;
      const base = file.name.replace(/\.[^.]+$/, '');
      const saved = await saveFile(replaceExtension(`${base}-clean`, cleaned.kind === 'jpeg' ? 'jpg' : cleaned.kind), cleaned.bytes, MIME[cleaned.kind]);
      if (saved.saved) notify(`Saved to ${saved.location}`);
    });

  const copy = (text: string) =>
    attempt(async () => {
      await copyText(text);
      notify(`Copied ${text}`);
    });

  // Reading starts in an effect, so a file without a result yet is still busy.
  const state = !file ? 'idle' : parsed === null || parsed === 'loading' ? 'busy' : 'error' in parsed ? 'error' : 'done';
  const dropHandlers = {
    onDragOver: (event: DragEvent) => {
      if (event.dataTransfer?.types.includes('Files')) {
        event.preventDefault();
        setDragging(true);
      }
    },
    onDragLeave: () => setDragging(false),
    onDrop: (event: DragEvent) => {
      setDragging(false);
      const dropped = event.dataTransfer?.files[0];
      if (dropped) {
        event.preventDefault();
        take(dropped);
      }
    },
  };
  const choose = () => attempt(async () => take(await pickFile('image/*,.heic,.heif,.avif,.tif,.tiff')));

  return (
    <section class="tool tool-image layout-form" data-testid="tool" data-state={state}>
      <aside class="tool-side">
        <div class="tool-options">
          <label class="toggle" for="metadata-keep-icc">
            <input
              id="metadata-keep-icc"
              type="checkbox"
              role="switch"
              aria-checked={settings.keepColorProfile}
              checked={settings.keepColorProfile}
              onChange={(event) => setSettings((s) => ({ ...s, keepColorProfile: event.currentTarget.checked }))}
            />
            <span class="toggle-track" aria-hidden="true" />
            <span>Keep the colour profile</span>
          </label>
          <p class="control-help">Removing it can make wide-gamut photos look dull.</p>
          <label class="toggle" for="metadata-keep-orientation">
            <input
              id="metadata-keep-orientation"
              type="checkbox"
              role="switch"
              aria-checked={settings.keepOrientation}
              checked={settings.keepOrientation}
              onChange={(event) => setSettings((s) => ({ ...s, keepOrientation: event.currentTarget.checked }))}
            />
            <span class="toggle-track" aria-hidden="true" />
            <span>Keep the rotation flag</span>
          </label>
          <p class="control-help">Keeps phone photos upright (JPEG and PNG). Nothing else is kept.</p>
          {cleaned && 'error' in cleaned && <p class="control-help tone-bad">{cleaned.error}</p>}
          {cleaned && !('error' in cleaned) && (
            <div class="metadata-clean" data-testid="metadata-clean">
              <div class="pane-title">{cleaned.removed.length > 0 ? 'Removed from the copy' : 'Nothing to remove'}</div>
              {cleaned.removed.length > 0 ? (
                <ul class="metadata-removed">
                  {cleaned.removed.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              ) : (
                <p class="control-help">This file carries no EXIF, XMP, IPTC, comments or text.</p>
              )}
              <p class="control-help">
                {formatBytes(file?.bytes.length ?? 0)} → {formatBytes(cleaned.bytes.length)}. The image data is copied as it is, so quality does not change.
              </p>
              <button type="button" class="button button-primary" onClick={save} data-testid="metadata-save">
                <Icon name="save" size={15} />
                Save without metadata
              </button>
            </div>
          )}
        </div>
      </aside>
      <div class="tool-main">
        {file ? (
          <div class={`image-source${dragging ? ' is-dragging' : ''}`} {...dropHandlers} data-testid="image-source">
            <img class="metadata-thumb" src={file.url} alt="" onError={(event) => (event.currentTarget.style.display = 'none')} />
            <div class="image-source-text">
              <div class="file-name">{file.name}</div>
              <div class="file-meta">
                {(imageKind(file.bytes) ?? 'other').toUpperCase()}, {formatBytes(file.bytes.length)}
              </div>
            </div>
            <button type="button" class="button button-small" onClick={choose}>
              Replace
            </button>
            <button type="button" class="button button-small button-quiet" onClick={() => setFile(null)}>
              Remove
            </button>
          </div>
        ) : (
          <button type="button" class={`dropzone${dragging ? ' is-dragging' : ''}`} onClick={choose} {...dropHandlers} data-testid="dropzone">
            <Icon name="image" size={30} />
            <span class="dropzone-title">Drop a photo here, or click to choose one</span>
            <span class="dropzone-hint">JPEG, PNG, WebP, TIFF, HEIC and AVIF can be read. Nothing leaves this computer.</span>
          </button>
        )}
        {parsed && parsed !== 'loading' && 'error' in parsed && <p class="control-help tone-bad">{parsed.error}</p>}
        {parsed && parsed !== 'loading' && !('error' in parsed) && (
          <>
            {parsed.gps && (
              <div class="metadata-warning" data-testid="metadata-gps">
                <Icon name="alert" size={18} />
                <div>
                  <strong>This photo records where it was taken.</strong>
                  <p>
                    Anyone you send the file to can read{' '}
                    <button type="button" class="link-button" onClick={() => copy(`${parsed.gps?.latitude.toFixed(6)}, ${parsed.gps?.longitude.toFixed(6)}`)} title="Copy">
                      {parsed.gps.latitude.toFixed(6)}, {parsed.gps.longitude.toFixed(6)}
                    </button>
                    . Save a copy without metadata before sharing it.
                  </p>
                </div>
              </div>
            )}
            {parsed.groups.length === 0 ? (
              <div class="empty-state">
                <Icon name="check" size={20} />
                <p>No EXIF, XMP, IPTC or colour profile data found.</p>
              </div>
            ) : (
              <div class="metadata-groups" data-testid="metadata-groups">
                {parsed.groups.map((group) => (
                  <div key={group.id} class="pane metadata-group">
                    <div class="pane-header">
                      <span class="pane-title">{group.title}</span>
                      <span class="pane-meta">{group.rows.length} fields</span>
                    </div>
                    <dl class="fields">
                      {group.rows.map(([key, value]) => (
                        <div key={key} class="field">
                          <dt>{key}</dt>
                          <dd>
                            <span class="field-value">{value}</span>
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

export default defineCustomTool(ImageMetadata);
