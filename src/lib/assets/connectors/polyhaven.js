/**
 * Poly Haven: CC0 HDRIs (360° lighting environments), PBR textures and 3D models.
 * API: https://api.polyhaven.com (no key).  The whole asset list is read once and searched here.
 */
export const source = {
  id: 'polyhaven',
  name: 'Poly Haven',
  about: 'CC0 HDRIs, PBR textures and 3D models, up to 16K.',
  homepage: 'https://polyhaven.com',
  terms: 'https://polyhaven.com/license',
  types: ['texture', 'model'],
  hosts: ['api.polyhaven.com'],
  settings: { api: 'https://api.polyhaven.com' },
  keys: [],
  signup: '',
};

const TYPE_NAMES = ['HDRI', 'Texture', 'Model'];

export async function search(q, ctx) {
  const all = await ctx.get(`${ctx.setting('api')}/assets`, { cache: 12 * 3600 });
  const words = q.text.toLowerCase().split(/\s+/).filter(Boolean);
  const found = Object.entries(all)
    .filter(([, a]) => q.types.includes(a.type === 2 ? 'model' : 'texture'))
    .filter(([id, a]) => words.every((w) => `${id} ${a.name} ${(a.tags || []).join(' ')} ${(a.categories || []).join(' ')}`.toLowerCase().includes(w)))
    .sort((a, b) => (b[1].download_count || 0) - (a[1].download_count || 0));
  const start = (q.page - 1) * q.pageSize;
  const items = found.slice(start, start + q.pageSize).map(([id, a]) => ({
    id,
    type: a.type === 2 ? 'model' : 'texture',
    title: a.name || id,
    creator: Object.keys(a.authors || {}).join(', '),
    page: `https://polyhaven.com/a/${id}`,
    thumb: a.thumbnail_url || `https://cdn.polyhaven.com/asset_img/thumbs/${id}.png?width=256&height=256`,
    description: `${TYPE_NAMES[a.type] || 'Asset'}${a.polycount ? `, ${a.polycount} polygons` : ''}${a.max_resolution ? `, up to ${a.max_resolution[0]}×${a.max_resolution[1]}` : ''}`,
    date: a.date_published ? new Date(a.date_published * 1000).toISOString().slice(0, 10) : '',
    licence: 'CC0',
    licenceNote: 'Poly Haven: credit is not required but appreciated.',
    width: a.max_resolution?.[0],
    height: a.max_resolution?.[1],
    tags: [...(a.tags || []), ...(a.categories || [])].slice(0, 15),
    stereo: a.type === 0 ? '360' : undefined,
    extra: { kind: a.type },
  }));
  return { items, total: found.length, more: start + items.length < found.length };
}

const resolutions = (obj) => Object.keys(obj || {}).sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
const entry = (label, e, extra = {}) =>
  e?.url
    ? {
        label,
        url: e.url,
        name: e.url.split('/').pop(),
        size: e.size,
        md5: e.md5,
        parts: Object.entries(e.include || {}).map(([path, inc]) => ({ url: inc.url, name: path, size: inc.size, md5: inc.md5 })),
        ...extra,
      }
    : null;

export async function files(item, ctx) {
  const reply = await ctx.get(`${ctx.setting('api')}/files/${encodeURIComponent(item.id)}`);
  const out = [];
  if (reply.hdri) {
    for (const res of resolutions(reply.hdri)) for (const [fmt, e] of Object.entries(reply.hdri[res])) out.push(entry(`HDRI ${res} (${fmt.toUpperCase()})`, e));
    out.push(entry('Tonemapped preview (JPEG)', reply.tonemapped));
  }
  for (const bundle of ['gltf', 'blend', 'fbx', 'usd']) {
    for (const res of resolutions(reply[bundle])) {
      for (const [fmt, e] of Object.entries(reply[bundle][res])) out.push(entry(`${bundle === 'gltf' ? 'glTF' : bundle.toUpperCase()} ${res}${e?.include ? ' with textures' : ''} (${fmt})`, e));
    }
  }
  for (const [map, byRes] of Object.entries(reply)) {
    if (['hdri', 'tonemapped', 'gltf', 'blend', 'fbx', 'usd', 'colorchart'].includes(map) || !byRes || typeof byRes !== 'object') continue;
    for (const res of resolutions(byRes))
      for (const [fmt, e] of Object.entries(byRes[res] || {})) if (fmt === 'jpg' || fmt === 'png' || fmt === 'exr') out.push(entry(`${map} ${res} (${fmt.toUpperCase()})`, e));
  }
  return out.filter(Boolean).slice(0, 120);
}
