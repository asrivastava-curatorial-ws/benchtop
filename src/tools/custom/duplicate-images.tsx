/**
 * Finds identical and similar pictures among many files with a perceptual
 * hash (dHash), in the page.  It reports groups; it never deletes anything.
 */
import { sha256 } from '@noble/hashes/sha2.js';
import { useMemo, useState } from 'preact/hooks';
import { formatBytes } from '../../lib/bytes';
import { pickFiles, saveFile } from '../../platform';
import { context2d, createCanvas } from '../../ui/canvas';
import { Icon } from '../../ui/icons';
import { attempt, notify } from '../../ui/toast';
import { defineCustomTool } from '../types';

export interface Fingerprint {
  readonly name: string;
  readonly size: number;
  readonly width: number;
  readonly height: number;
  /** 64-bit difference hash as two 32-bit halves. */
  readonly hash: readonly [number, number];
  readonly digest: string;
  readonly thumb: string;
}

const popcount = (n: number) => {
  let v = n - ((n >>> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
};

export const distance = (a: readonly [number, number], b: readonly [number, number]) => popcount(a[0] ^ b[0]) + popcount(a[1] ^ b[1]);

/** Difference hash of a 9 × 8 greyscale picture: one bit per neighbouring pair, brighter or not. */
export function dHash(grey: ArrayLike<number>): [number, number] {
  let hi = 0;
  let lo = 0;
  let bit = 0;
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++) {
      const brighter = grey[y * 9 + x] > grey[y * 9 + x + 1] ? 1 : 0;
      if (bit < 32) hi = (hi | (brighter << (31 - bit))) >>> 0;
      else lo = (lo | (brighter << (63 - bit))) >>> 0;
      bit++;
    }
  return [hi, lo];
}

async function fingerprint(file: File): Promise<Fingerprint> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type: file.type }));
  try {
    // Two steps down, so the tiny picture averages the whole image instead of sampling a few pixels.
    const mid = createCanvas(64, 64);
    const m = context2d(mid);
    m.imageSmoothingQuality = 'high';
    m.drawImage(bitmap, 0, 0, 64, 64);
    const tiny = createCanvas(9, 8);
    const t = context2d(tiny, true);
    t.imageSmoothingQuality = 'high';
    t.drawImage(mid, 0, 0, 9, 8);
    const rgba = t.getImageData(0, 0, 9, 8).data;
    const grey = new Float32Array(72);
    for (let i = 0; i < 72; i++) grey[i] = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
    const scale = 120 / Math.max(bitmap.width, bitmap.height);
    const thumb = createCanvas(Math.max(1, bitmap.width * scale), Math.max(1, bitmap.height * scale));
    context2d(thumb).drawImage(bitmap, 0, 0, thumb.width, thumb.height);
    const digest = Array.from(sha256(bytes).subarray(0, 16), (b) => b.toString(16).padStart(2, '0')).join('');
    return { name: file.webkitRelativePath || file.name, size: file.size, width: bitmap.width, height: bitmap.height, hash: dHash(grey), digest, thumb: thumb.toDataURL('image/jpeg', 0.7) };
  } finally {
    bitmap.close();
  }
}

export interface Group {
  readonly items: readonly Fingerprint[];
  readonly identical: boolean;
}

/** Groups pictures whose hashes differ in at most `threshold` of 64 bits (union-find). */
export function groupSimilar(prints: readonly Fingerprint[], threshold: number): Group[] {
  const parent = prints.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  for (let i = 0; i < prints.length; i++)
    for (let j = i + 1; j < prints.length; j++) {
      if (prints[i].digest === prints[j].digest || distance(prints[i].hash, prints[j].hash) <= threshold) {
        const a = find(i);
        const b = find(j);
        if (a !== b) parent[b] = a;
      }
    }
  const groups = new Map<number, Fingerprint[]>();
  prints.forEach((p, i) => {
    const root = find(i);
    groups.set(root, [...(groups.get(root) ?? []), p]);
  });
  return [...groups.values()]
    .filter((items) => items.length > 1)
    .map((items) => {
      // Best first: most pixels, then the largest file.
      const sorted = [...items].sort((a, b) => b.width * b.height - a.width * a.height || b.size - a.size);
      return { items: sorted, identical: sorted.every((p) => p.digest === sorted[0].digest) };
    })
    .sort((a, b) => Number(b.identical) - Number(a.identical) || b.items.length - a.items.length);
}

const LEVELS = [
  { value: 0, label: 'Identical or re-saved copies' },
  { value: 4, label: 'Very similar (resized, recompressed)' },
  { value: 8, label: 'Similar (small edits, filters)' },
  { value: 12, label: 'Loosely similar (bursts, crops)' },
];

function DuplicateImages() {
  const [prints, setPrints] = useState<Fingerprint[]>([]);
  const [failed, setFailed] = useState<string[]>([]);
  const [threshold, setThreshold] = useState(4);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const groups = useMemo(() => groupSimilar(prints, threshold), [prints, threshold]);
  const spare = groups.reduce((sum, g) => sum + g.items.slice(1).reduce((s, p) => s + p.size, 0), 0);

  const add = (files: File[]) =>
    void attempt(async () => {
      const images = files.filter((f) => f.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(f.name));
      setProgress({ done: 0, total: images.length });
      const found: Fingerprint[] = [];
      const bad: string[] = [];
      for (const [i, file] of images.entries()) {
        try {
          found.push(await fingerprint(file));
        } catch {
          bad.push(file.name);
        }
        if (i % 8 === 7 || i === images.length - 1) setProgress({ done: i + 1, total: images.length });
      }
      setPrints((list) => [...list, ...found]);
      setFailed((list) => [...list, ...bad]);
      setProgress(null);
    });

  const report = () =>
    void attempt(async () => {
      const rows = [['group', 'suggestion', 'file', 'width', 'height', 'bytes', 'identical']];
      groups.forEach((g, i) => {
        g.items.forEach((p, j) => {
          rows.push([String(i + 1), j === 0 ? 'keep' : 'duplicate', p.name, String(p.width), String(p.height), String(p.size), g.identical ? 'yes' : 'no']);
        });
      });
      const csv = rows.map((r) => r.map((c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(',')).join('\n');
      const saved = await saveFile('duplicate-pictures.csv', `${csv}\n`, 'text/csv');
      if (saved.saved) notify(`Saved to ${saved.location}`);
    });

  return (
    <div data-testid="tool" class="tool ai-tool">
      <div class="ai-controls">
        <button
          type="button"
          class="dropzone dropzone-compact"
          onClick={() => attempt(async () => add(await pickFiles('image/*')))}
          onDragOver={(e) => {
            if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
          }}
          onDrop={(e) => {
            const files = Array.from(e.dataTransfer?.files ?? []);
            if (files.length) {
              e.preventDefault();
              add(files);
            }
          }}
          disabled={Boolean(progress)}
          data-testid="dup-drop"
        >
          <Icon name="image" size={20} />
          <span class="dropzone-title">{progress ? `Reading ${progress.done} of ${progress.total}…` : prints.length ? 'Add more pictures' : 'Choose or drop pictures'}</span>
        </button>
        <div class="control">
          <label class="control-label" for="dup-level">
            Treat as duplicates
          </label>
          <select id="dup-level" class="input" value={threshold} onChange={(e) => setThreshold(Number(e.currentTarget.value))}>
            {LEVELS.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
        </div>
        {prints.length > 0 && (
          <p class="tone-muted pdf-note" data-testid="dup-summary">
            {prints.length} pictures checked.{' '}
            {groups.length ? `${groups.length} group${groups.length === 1 ? '' : 's'} of duplicates; removing the extra copies would free ${formatBytes(spare)}.` : 'No duplicates found.'}
            {failed.length ? ` ${failed.length} could not be read.` : ''}
          </p>
        )}
        <div class="button-row">
          <button type="button" class="button" disabled={!groups.length} onClick={report}>
            Save report (CSV)
          </button>
          <button
            type="button"
            class="button button-quiet"
            disabled={!prints.length}
            onClick={() => {
              setPrints([]);
              setFailed([]);
            }}
          >
            Clear
          </button>
        </div>
        <p class="tone-muted pdf-note">Pictures are compared on this computer. Nothing is deleted; use the report to tidy up.</p>
      </div>
      <div class="ai-work">
        {groups.map((group, i) => (
          <section key={group.items[0].digest + i} class="dup-group" data-testid="dup-group">
            <h3>
              {group.identical ? 'Identical files' : 'Similar pictures'} <span class="tone-muted">({group.items.length})</span>
            </h3>
            <ul>
              {group.items.map((p, j) => (
                <li key={`${p.name}-${j}`} class={j === 0 ? 'is-keeper' : ''}>
                  <img src={p.thumb} alt="" />
                  <span class="dup-name" title={p.name}>
                    {p.name}
                  </span>
                  <span class="tone-muted">
                    {p.width} × {p.height}, {formatBytes(p.size)}
                  </span>
                  {j === 0 && <span class="dup-keep">Best copy</span>}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

export default defineCustomTool(DuplicateImages);
