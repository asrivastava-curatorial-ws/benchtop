/**
 * Asset Finder's engine: asks the libraries (through their connectors), keeps
 * what passes the kind and licence filters, merges the lists without
 * duplicates, lists an asset's files, and writes the record and licence notes
 * kept beside every download.
 */
import { allowedBy, checkUse, creditLine, explain, indiaCheck, type Licence, shortCredit } from './licences';
import { type AssetFile, type AssetItem, type AssetQuery, type AssetType, assetFolder, cleanFiles, cleanItem, humanSize, sameWorkKey } from './model';
import { allowedHosts, type CallContext, type ConnectorMeta, ConnectorRunner, hostAllowed, type KeySpec, leaksKey, type RequestEntry, type Transport } from './runtime';

export interface SearchSource {
  readonly id: string;
  readonly code: string;
  readonly settings: Readonly<Record<string, string>>;
}

export type SourceState = 'waiting' | 'running' | 'done' | 'error' | 'skipped';

export interface SourceResult {
  readonly id: string;
  readonly name: string;
  readonly state: SourceState;
  readonly items: readonly AssetItem[];
  readonly page: number;
  readonly more: boolean;
  readonly total?: number;
  /** Results left out by the kind or licence filter. */
  readonly dropped: number;
  readonly message: string;
  readonly ms: number;
}

const SOURCES_AT_ONCE = 6;

/** Keeps one worker per connector and asks it for searches, file lists and last-minute links. */
export class AssetEngine {
  private readonly runners = new Map<string, { code: string; runner: ConnectorRunner }>();
  log: (source: string, entry: RequestEntry) => void = () => {};
  note: (source: string, text: string) => void = () => {};

  constructor(
    private readonly transport: () => Transport,
    private readonly keysOf: (source: string) => Readonly<Record<string, string>>,
  ) {}

  runner(id: string, code: string): ConnectorRunner {
    const kept = this.runners.get(id);
    if (kept && kept.code === code) return kept.runner;
    kept?.runner.stop();
    const runner = new ConnectorRunner(code, this.transport);
    runner.log = (entry) => this.log(id, entry);
    runner.note = (text) => this.note(id, text);
    this.runners.set(id, { code, runner });
    return runner;
  }

  describe(source: Pick<SearchSource, 'id' | 'code'>): Promise<ConnectorMeta> {
    return this.runner(source.id, source.code).describe();
  }

  context(meta: ConnectorMeta, settings: Readonly<Record<string, string>>): CallContext {
    return { keys: this.keysOf(meta.id), settings: { ...meta.settings, ...settings } };
  }

  missingKeys(meta: ConnectorMeta): KeySpec[] {
    const keys = this.keysOf(meta.id);
    return meta.keys.filter((k) => !k.optional && !keys[k.id]);
  }

  hosts(meta: ConnectorMeta, settings: Readonly<Record<string, string>>): string[] {
    return allowedHosts(meta, settings);
  }

  /** One page from one library, cleaned and filtered. */
  async searchSource(source: SearchSource, query: AssetQuery): Promise<{ items: AssetItem[]; total?: number; more: boolean; dropped: number }> {
    const meta = await this.describe(source);
    const types = query.types.filter((t) => meta.types.includes(t));
    const reply = await this.runner(source.id, source.code).search({ ...query, types }, this.context(meta, source.settings));
    const keys = this.keysOf(meta.id);
    const hosts = this.hosts(meta, source.settings);
    const safe = (url: string) => (url && leaksKey(url, keys, hosts) ? '' : url);
    let dropped = 0;
    const items: AssetItem[] = [];
    for (const raw of reply.items) {
      const item = cleanItem(raw, meta.id, types[0] ?? meta.types[0] ?? 'image');
      if (!item) continue;
      if (!query.types.includes(item.type) || !allowed(item.licence, query)) {
        dropped++;
        continue;
      }
      if (items.some((i) => i.id === item.id)) continue;
      items.push({ ...item, thumb: safe(item.thumb), preview: safe(item.preview), page: safe(item.page), creatorUrl: safe(item.creatorUrl) });
    }
    return { items, ...(reply.total !== undefined ? { total: reply.total } : {}), more: reply.more, dropped };
  }

  /** An asset's files, with links that would carry a key elsewhere taken out, and headers kept only for the library's own hosts. */
  async files(source: SearchSource, item: AssetItem): Promise<{ files: AssetFile[]; notes: string[] }> {
    const meta = await this.describe(source);
    const raw = item.files ?? (await this.runner(source.id, source.code).files(item, this.context(meta, source.settings)));
    return this.vet(meta, source.settings, cleanFiles(raw));
  }

  /** The connector's last word on a file just before it is downloaded. */
  async prepare(source: SearchSource, item: AssetItem, file: AssetFile): Promise<AssetFile> {
    const meta = await this.describe(source);
    const raw = await this.runner(source.id, source.code).prepare(item, file, this.context(meta, source.settings));
    const vetted = this.vet(meta, source.settings, cleanFiles([raw]));
    if (vetted.notes.length) throw new Error(vetted.notes[0]);
    return vetted.files[0] ?? file;
  }

  private vet(meta: ConnectorMeta, settings: Readonly<Record<string, string>>, files: AssetFile[]): { files: AssetFile[]; notes: string[] } {
    const keys = this.keysOf(meta.id);
    const hosts = this.hosts(meta, settings);
    const notes: string[] = [];
    const out: AssetFile[] = [];
    for (const file of files) {
      const links = [file.url ?? '', ...(file.parts ?? []).map((p) => p.url)].filter(Boolean);
      if (links.some((url) => leaksKey(url, keys, hosts))) {
        notes.push(`“${file.label}” was left out: its link would send one of ${meta.name}’s keys to a host the connector does not list.`);
        continue;
      }
      const ownHost = !!file.url && hostAllowed(file.url, hosts);
      const { headers, ...rest } = file;
      out.push(headers?.length && ownHost ? file : rest);
    }
    return { files: out, notes };
  }

  stopAll(): void {
    for (const { runner } of this.runners.values()) runner.stop();
  }
}

/** Whether an asset's licence passes the search's licence filter and stock setting. */
export const allowed = (licence: Licence, query: Pick<AssetQuery, 'licence' | 'stock'>): boolean => allowedBy(licence, query.licence, query.stock);

/** A search across libraries: the first page from each, then more from those that have more. */
export class AssetSearch {
  results: SourceResult[];
  private generation = 0;

  constructor(
    private readonly engine: AssetEngine,
    readonly query: AssetQuery,
    private readonly sources: readonly SearchSource[],
    private readonly metas: ReadonlyMap<string, ConnectorMeta>,
  ) {
    this.results = sources.map((s) => ({ id: s.id, name: metas.get(s.id)?.name ?? s.id, state: 'waiting', items: [], page: 0, more: true, dropped: 0, message: '', ms: 0 }));
  }

  /** Stops caring about answers still on their way. */
  stop(): void {
    this.generation++;
  }

  /** Asks every library still with more (all of them the first time); `onChange` sees each answer as it lands. */
  async next(onChange: () => void): Promise<void> {
    const generation = ++this.generation;
    const ask = this.results.filter((r) => r.more && r.state !== 'error' && r.state !== 'skipped').map((r) => r.id);
    let index = 0;
    const work = async () => {
      while (index < ask.length) {
        const id = ask[index++] as string;
        const source = this.sources.find((s) => s.id === id);
        const meta = this.metas.get(id);
        if (!source) continue;
        if (!meta) {
          this.set(id, { state: 'error', more: false, message: 'The connector did not load (see Sources).' });
          onChange();
          continue;
        }
        const missing = this.engine.missingKeys(meta);
        if (missing.length) {
          this.set(id, { state: 'skipped', more: false, message: `Needs ${missing.map((k) => k.label).join(' and ')} (Sources › ${meta.name})` });
          onChange();
          continue;
        }
        const current = this.results.find((r) => r.id === id);
        const page = (current?.page ?? 0) + 1;
        this.set(id, { state: 'running', message: '' });
        onChange();
        const started = performance.now();
        try {
          const reply = await this.engine.searchSource(source, { ...this.query, page });
          if (generation !== this.generation) return;
          const before = this.results.find((r) => r.id === id);
          const items = [...(before?.items ?? [])];
          for (const item of reply.items) if (!items.some((i) => i.id === item.id)) items.push(item);
          this.set(id, {
            state: 'done',
            items,
            page,
            more: reply.more && reply.items.length + reply.dropped > 0,
            ...(reply.total !== undefined ? { total: reply.total } : {}),
            dropped: (before?.dropped ?? 0) + reply.dropped,
            ms: Math.round(performance.now() - started),
            message: '',
          });
        } catch (error) {
          if (generation !== this.generation) return;
          this.set(id, { state: 'error', more: false, message: error instanceof Error ? error.message : String(error), ms: Math.round(performance.now() - started) });
        }
        onChange();
      }
    };
    await Promise.all(Array.from({ length: Math.min(SOURCES_AT_ONCE, ask.length) }, work));
  }

  get hasMore(): boolean {
    return this.results.some((r) => r.more && r.state === 'done');
  }

  get busy(): boolean {
    return this.results.some((r) => r.state === 'running' || r.state === 'waiting');
  }

  /** Every library's results taken in turn (first of each, then second of each…), without the same work twice. */
  merged(): AssetItem[] {
    const seen = new Set<string>();
    const out: AssetItem[] = [];
    const longest = Math.max(0, ...this.results.map((r) => r.items.length));
    for (let i = 0; i < longest; i++) {
      for (const r of this.results) {
        const item = r.items[i];
        if (!item) continue;
        const key = sameWorkKey(item);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(item);
      }
    }
    return out;
  }

  private set(id: string, change: Partial<SourceResult>): void {
    this.results = this.results.map((r) => (r.id === id ? { ...r, ...change } : r));
  }
}

/* ------------------------------------------------------- records -- */

/** A name at most `max` characters long that keeps its extension. */
export function shortName(name: string, max = 100): string {
  const clean =
    Array.from(name)
      .filter((c) => c.charCodeAt(0) >= 32)
      .join('')
      .trim() || 'file';
  if (clean.length <= max) return clean;
  const dot = clean.lastIndexOf('.');
  const ext = dot > 0 && clean.length - dot <= 10 ? clean.slice(dot) : '';
  return `${clean.slice(0, max - ext.length).trimEnd()}${ext}`;
}

/** Where a file and the files that go with it are saved, inside the library. */
export function downloadTargets(
  item: AssetItem,
  file: AssetFile,
  sourceName: string,
): { dir: string[]; name: string; parts: { dir: string[]; name: string; url: string; size?: number; md5?: string }[] } {
  const dir = assetFolder(item, sourceName);
  const name = shortName(file.name);
  const parts = (file.parts ?? []).map((p) => {
    const segments = p.name.split('/').filter(Boolean);
    const last = segments.pop() ?? 'file';
    // The library keeps assets at most six folders deep: deeper folders go into the name.
    const folders = segments.slice(0, 6 - dir.length);
    const rest = segments.slice(6 - dir.length);
    return {
      dir: [...dir, ...folders.map((s) => shortName(s, 80))],
      name: shortName([...rest, last].join(' - ')),
      url: p.url,
      ...(p.size !== undefined ? { size: p.size } : {}),
      ...(p.md5 ? { md5: p.md5 } : {}),
    };
  });
  return { dir, name, parts };
}

export interface SavedFile {
  readonly name: string;
  readonly label: string;
  readonly url: string;
  readonly size: number;
  readonly verified: string | null;
  readonly parts: number;
  readonly unpacked: number;
}

const kindFor = (type: AssetType): 'film' | 'sound' | 'other' => (type === 'video' || type === 'video3d' ? 'film' : type === 'audio' ? 'sound' : 'other');

/** The record kept as asset.json beside the files, merged with one already there. */
export function assetRecord(item: AssetItem, source: { id: string; name: string; homepage: string }, saved: SavedFile, previous?: unknown, now = new Date()): Record<string, unknown> {
  const before = previous && typeof previous === 'object' ? (previous as Record<string, unknown>) : {};
  const files = (Array.isArray(before.files) ? (before.files as SavedFile[]) : []).filter((f) => f && f.name !== saved.name);
  const credit = { title: item.title, creator: item.creator, page: item.page, sourceName: source.name, licence: item.licence };
  return {
    benchtopAsset: 1,
    source,
    id: item.id,
    type: item.type,
    title: item.title,
    creator: item.creator,
    creatorUrl: item.creatorUrl,
    page: item.page,
    description: item.description,
    date: item.date,
    ...(item.year ? { year: item.year } : {}),
    ...(item.deathYear ? { deathYear: item.deathYear } : {}),
    licence: item.licence,
    credit: creditLine(credit),
    shortCredit: shortCredit(credit),
    ...(item.width ? { width: item.width, height: item.height } : {}),
    ...(item.duration ? { duration: item.duration } : {}),
    ...(item.stereo ? { stereo: item.stereo } : {}),
    tags: item.tags,
    provider: item.provider,
    files: [...files, saved],
    downloaded: now.toISOString(),
  };
}

/** The plain-language licence note kept as LICENCE.txt beside the files. */
export function licenceText(item: AssetItem, sourceName: string, now = new Date()): string {
  const credit = { title: item.title, creator: item.creator, page: item.page, sourceName, licence: item.licence };
  const india = indiaCheck(item.licence, kindFor(item.type), item.deathYear, item.year, now.getFullYear());
  const uses = (['free', 'ticketed', 'print', 'web'] as const).map((use) => {
    const worst = checkUse(item.licence, use)[0];
    return `  ${{ free: 'Free exhibit or event', ticketed: 'Ticketed show', print: 'Print or products for sale', web: 'Website or social media' }[use]}: ${worst?.text ?? ''}`;
  });
  return [
    item.title,
    item.creator ? `by ${item.creator}` : '',
    '',
    `From: ${sourceName}${item.page ? `, ${item.page}` : ''}`,
    `Licence: ${item.licence.name}${item.licence.url ? ` (${item.licence.url})` : ''}`,
    item.licence.note ? `The library says: ${item.licence.note}` : '',
    '',
    explain(item.licence),
    '',
    'Credit line:',
    `  ${creditLine(credit)}`,
    '',
    'By use:',
    ...uses,
    '',
    `In India: ${india.text}`,
    '',
    `Saved by Benchtop Asset Finder on ${now.toISOString().slice(0, 10)}. This is guidance, not legal advice: the source page is what counts.`,
    '',
  ]
    .filter((line, i, all) => line !== '' || all[i - 1] !== '')
    .join('\n');
}

/** One line about a file for lists: its label, size and size of the parts. */
export function fileSummary(file: AssetFile): string {
  const extra = file.parts?.length ? ` + ${file.parts.length} more file${file.parts.length === 1 ? '' : 's'}` : '';
  return [file.label, humanSize(file.size)].filter(Boolean).join(' · ') + extra;
}
