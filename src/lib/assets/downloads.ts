/**
 * Asset Finder's downloads: a queue that keeps running while you search or
 * leave the tool, three files at a time, each into its asset's folder in the
 * library with the record (asset.json) and licence note (LICENCE.txt) beside it.
 * Stopped or broken downloads carry on from where they stopped.
 */
import { isDesktop, saveFile } from '../../platform';
import * as shell from '../../platform/assets';
import { type AssetEngine, assetRecord, downloadTargets, licenceText, type SavedFile, type SearchSource } from './engine';
import type { AssetFile, AssetItem } from './model';
import { fetchMedia } from './transport';

export type JobState = 'queued' | 'preparing' | 'downloading' | 'checking' | 'unpacking' | 'saving' | 'done' | 'error' | 'stopped';

export interface SourceInfo {
  readonly id: string;
  readonly name: string;
  readonly homepage: string;
}

export interface DownloadJob {
  readonly id: string;
  readonly item: AssetItem;
  readonly file: AssetFile;
  readonly source: SourceInfo;
  readonly state: JobState;
  readonly received: number;
  readonly total: number | null;
  /** The file being fetched: 0 is the main file, then its parts. */
  readonly part: number;
  readonly parts: number;
  readonly message: string;
  readonly dir: readonly string[];
  readonly path?: string;
  readonly verified?: string | null;
}

const BROWSER_LIMIT = 8 * 1024 * 1024;
const ACTIVE: readonly JobState[] = ['preparing', 'downloading', 'checking', 'unpacking', 'saving'];

export class DownloadManager {
  jobs: readonly DownloadJob[] = [];
  private readonly listeners = new Set<() => void>();
  private readonly stopped = new Set<string>();
  private counter = 0;

  constructor(
    private readonly engine: () => AssetEngine,
    private readonly sourceFor: (id: string) => SearchSource | undefined,
    private readonly parallel = 3,
  ) {}

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get active(): number {
    return this.jobs.filter((j) => ACTIVE.includes(j.state)).length;
  }

  /** Queues a file; returns the job's id. */
  add(item: AssetItem, file: AssetFile, source: SourceInfo): string {
    const id = `dl-${Date.now().toString(36)}-${++this.counter}`;
    const { dir } = downloadTargets(item, file, source.name);
    this.jobs = [...this.jobs, { id, item, file, source, state: 'queued', received: 0, total: file.size ?? null, part: 0, parts: 1 + (file.parts?.length ?? 0), message: '', dir }];
    this.changed();
    this.pump();
    return id;
  }

  stop(id: string): void {
    const job = this.jobs.find((j) => j.id === id);
    if (!job) return;
    this.stopped.add(id);
    if (job.state === 'queued') this.update(id, { state: 'stopped', message: 'Stopped before it started.' });
    else void shell.cancelDownload(`${id}#${job.part}`);
  }

  retry(id: string): void {
    const job = this.jobs.find((j) => j.id === id);
    if (!job || ACTIVE.includes(job.state) || job.state === 'queued') return;
    this.stopped.delete(id);
    this.update(id, { state: 'queued', message: '', part: 0 });
    this.pump();
  }

  remove(id: string): void {
    const job = this.jobs.find((j) => j.id === id);
    if (job && (ACTIVE.includes(job.state) || job.state === 'queued')) this.stop(id);
    this.jobs = this.jobs.filter((j) => j.id !== id);
    this.changed();
  }

  clearFinished(): void {
    this.jobs = this.jobs.filter((j) => j.state !== 'done' && j.state !== 'error' && j.state !== 'stopped');
    this.changed();
  }

  private changed(): void {
    for (const listener of this.listeners) listener();
  }

  private update(id: string, change: Partial<DownloadJob>): void {
    this.jobs = this.jobs.map((j) => (j.id === id ? { ...j, ...change } : j));
    this.changed();
  }

  private pump(): void {
    while (this.active < this.parallel) {
      const next = this.jobs.find((j) => j.state === 'queued');
      if (!next) return;
      this.update(next.id, { state: 'preparing' });
      void this.run(next.id);
    }
  }

  private async run(id: string): Promise<void> {
    const job = this.jobs.find((j) => j.id === id);
    if (!job) return;
    try {
      let file = job.file;
      const source = this.sourceFor(job.source.id);
      if (source) file = await this.engine().prepare(source, job.item, file);
      if (this.stopped.has(id)) throw new Error('Stopped.');
      const saved = isDesktop ? await this.toLibrary(id, job, file) : await this.toBrowser(id, job, file);
      this.update(id, { state: 'done', message: '', ...saved });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.update(id, { state: this.stopped.has(id) || /^Stopped/.test(message) ? 'stopped' : 'error', message });
    } finally {
      this.stopped.delete(id);
      this.pump();
    }
  }

  private async toLibrary(id: string, job: DownloadJob, file: AssetFile): Promise<Partial<DownloadJob>> {
    const targets = downloadTargets(job.item, file, job.source.name);
    let saved: SavedFile;
    let path = '';
    let verified: string | null = null;
    if (file.text !== undefined) {
      this.update(id, { state: 'saving' });
      path = await shell.writeAssetFile(targets.dir, targets.name, { text: file.text });
      saved = { name: targets.name, label: file.label, url: '', size: new TextEncoder().encode(file.text).length, verified: null, parts: 0, unpacked: 0 };
    } else {
      const main = await shell.download(
        {
          id: `${id}#0`,
          url: file.url ?? '',
          dir: targets.dir,
          name: targets.name,
          ...(file.headers ? { headers: file.headers } : {}),
          ...(file.size !== undefined ? { size: file.size } : {}),
          ...(file.md5 ? { md5: file.md5 } : {}),
          ...(file.sha1 ? { sha1: file.sha1 } : {}),
          ...(file.sha256 ? { sha256: file.sha256 } : {}),
          unzip: file.unzip === true,
        },
        (p) => this.update(id, { state: p.phase, received: p.received, total: p.total }),
      );
      path = main.path;
      verified = main.verified;
      let parts = 0;
      for (const [n, part] of targets.parts.entries()) {
        if (this.stopped.has(id)) throw new Error('Stopped. Download it again to carry on from where it stopped.');
        this.update(id, { part: n + 1, received: 0, total: part.size ?? null });
        await shell.download(
          { id: `${id}#${n + 1}`, url: part.url, dir: part.dir, name: part.name, ...(part.size !== undefined ? { size: part.size } : {}), ...(part.md5 ? { md5: part.md5 } : {}) },
          (p) => this.update(id, { state: p.phase, received: p.received, total: p.total }),
        );
        parts++;
      }
      saved = { name: main.name, label: file.label, url: file.url ?? '', size: main.size, verified, parts, unpacked: main.unpacked.length };
    }
    this.update(id, { state: 'saving' });
    let previous: unknown;
    try {
      const text = await shell.readAssetFile(targets.dir, 'asset.json');
      previous = text ? JSON.parse(text) : undefined;
    } catch {}
    await shell.writeAssetFile(targets.dir, 'asset.json', { text: `${JSON.stringify(assetRecord(job.item, job.source, saved, previous), null, 2)}\n` });
    await shell.writeAssetFile(targets.dir, 'LICENCE.txt', { text: licenceText(job.item, job.source.name) });
    return { path, verified };
  }

  /** In a browser (the tests) each file is saved as a normal download, up to 8 MB. */
  private async toBrowser(id: string, job: DownloadJob, file: AssetFile): Promise<Partial<DownloadJob>> {
    const targets = downloadTargets(job.item, file, job.source.name);
    this.update(id, { state: 'downloading' });
    if (file.text !== undefined) {
      await saveFile(targets.name, file.text, 'text/plain');
      return { path: targets.name };
    }
    const { bytes, type } = await fetchMedia(file.url ?? '', { maxBytes: BROWSER_LIMIT, accept: '*/*', timeoutMs: 60_000 });
    this.update(id, { received: bytes.length, total: bytes.length, state: 'saving' });
    await saveFile(targets.name, bytes, type || 'application/octet-stream');
    return { path: targets.name };
  }
}
