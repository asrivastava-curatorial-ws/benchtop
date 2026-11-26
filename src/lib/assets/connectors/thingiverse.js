/**
 * Thingiverse: things to 3D print (STL, OBJ, SCAD, STEP), most under Creative Commons licences.
 * API: https://api.thingiverse.com (needs an app token).
 */
export const source = {
  id: 'thingiverse',
  name: 'Thingiverse',
  about: 'Things to 3D print and make (STL, OBJ, SCAD, STEP), mostly under Creative Commons licences.',
  homepage: 'https://www.thingiverse.com',
  terms: 'https://www.thingiverse.com/legal/api',
  types: ['model'],
  hosts: ['api.thingiverse.com'],
  settings: { api: 'https://api.thingiverse.com' },
  keys: [{ id: 'token', label: 'App token', optional: false, help: 'Create an app at Thingiverse (type: desktop app) and copy its token.' }],
  signup: 'https://www.thingiverse.com/apps/create',
};

const auth = (ctx) => {
  if (!ctx.key('token')) throw new Error('Thingiverse needs an app token (Sources › Thingiverse).');
  return { Authorization: `Bearer ${ctx.key('token')}` };
};

export async function search(q, ctx) {
  const headers = auth(ctx);
  const size = Math.min(q.pageSize, 20);
  const reply = await ctx.get(`${ctx.setting('api')}/search/${encodeURIComponent(q.text.trim() || 'model')}/`, {
    headers,
    query: { type: 'things', per_page: size, page: q.page, sort: 'relevant' },
    cache: 600,
  });
  const hits = reply.hits || [];
  const things = await ctx.mapLimit(hits, 6, (hit) => ctx.get(`${ctx.setting('api')}/things/${hit.id}`, { headers, cache: 86400 }));
  const items = things.filter(Boolean).map((t) => ({
    id: String(t.id),
    type: 'model',
    title: t.name || 'Untitled',
    creator: (t.creator && (t.creator.name || [t.creator.first_name, t.creator.last_name].filter(Boolean).join(' '))) || '',
    creatorUrl: t.creator?.public_url || '',
    page: t.public_url || `https://www.thingiverse.com/thing:${t.id}`,
    thumb: t.thumbnail || '',
    preview: t.default_image?.url || t.thumbnail || '',
    description: ctx.text(t.description_html || t.description || '', 800),
    date: String(t.added || '').slice(0, 10),
    licence: t.license || '',
    tags: (t.tags || []).map((x) => x.name).slice(0, 15),
    extra: {},
  }));
  return { items, total: reply.total, more: q.page * size < (reply.total || 0) };
}

export async function files(item, ctx) {
  const headers = auth(ctx);
  const reply = await ctx.get(`${ctx.setting('api')}/things/${item.id}/files`, { headers });
  return (Array.isArray(reply) ? reply : []).map((f) => ({
    label: `${String(f.name || '')
      .split('.')
      .pop()
      .toUpperCase()} · ${f.name}`,
    url: f.direct_url || f.download_url,
    name: f.name,
    size: f.size,
    headers: f.direct_url ? [] : [['Authorization', headers.Authorization]],
  }));
}
