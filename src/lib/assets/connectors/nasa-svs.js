/**
 * NASA Scientific Visualization Studio: visualisations and animations of
 * Earth, the Sun, the Moon and the planets, up to 8K and some in stereo,
 * with frames and dome masters for planetariums.
 * API: https://svs.gsfc.nasa.gov/api (no key).
 */
export const source = {
  id: 'nasa-svs',
  name: 'NASA Scientific Visualization Studio',
  about: 'Visualisations and animations of Earth, the Sun, the Moon and the planets, up to 8K, some for domes and in stereo.',
  homepage: 'https://svs.gsfc.nasa.gov',
  terms: 'https://svs.gsfc.nasa.gov/help/#apis-svsapi',
  types: ['video', 'video3d', 'image'],
  hosts: ['svs.gsfc.nasa.gov'],
  settings: { api: 'https://svs.gsfc.nasa.gov/api' },
  keys: [],
  signup: '',
};

const media = (entry) => entry.media || entry.instance || null;

function flatten(page) {
  const out = [];
  const add = (m) => {
    if (m?.url && !out.some((x) => x.url === m.url)) out.push({ url: m.url, filename: m.filename || '', media_type: m.media_type || '', width: m.width || 0, height: m.height || 0 });
  };
  add(page.main_video);
  add(page.main_image);
  for (const group of page.media_groups || []) for (const entry of group.items || []) add(media(entry));
  return out;
}

export async function search(q, ctx) {
  const size = Math.min(q.pageSize, 20);
  const reply = await ctx.get(`${ctx.setting('api')}/search/`, { query: { search: q.text, limit: size, offset: (q.page - 1) * size }, cache: 1800 });
  const results = (reply.results || []).filter((r) => r.result_type !== 'Gallery');
  const pages = await ctx.mapLimit(results, 6, (r) => ctx.get(`${ctx.setting('api')}/${r.id}`, { cache: 86400 }));
  const items = [];
  results.forEach((r, i) => {
    const page = pages[i];
    if (!page) return;
    const video = page.main_video?.url ? page.main_video : null;
    const image = page.main_image || {};
    const credit = (page.credits || []).flatMap((c) => c.people || []).find((p) => p.name)?.name || '';
    const type = video ? 'video' : 'image';
    if (!q.types.includes(type) && !(type === 'video' && q.types.includes('video3d'))) return;
    items.push({
      id: String(r.id),
      type,
      title: ctx.clip(ctx.text(r.title || page.title || ''), 160),
      creator: credit ? `${credit} (NASA SVS)` : 'NASA Scientific Visualization Studio',
      page: ctx.https(r.url || page.url || `https://svs.gsfc.nasa.gov/${r.id}/`),
      thumb: image.url || '',
      preview: image.url || '',
      description: ctx.text(page.description || r.description || '', 1200),
      date: String(r.release_date || page.release_date || '').slice(0, 10),
      licence: 'US government work',
      licenceNote: 'NASA SVS: public domain unless the page says otherwise.',
      width: Math.max(video?.width || 0, image.width || 0),
      height: Math.max(video?.height || 0, image.height || 0),
      tags: (page.keywords || []).slice(0, 12),
      extra: { media: flatten(page) },
    });
  });
  return { items, total: reply.count, more: !!reply.next };
}

export async function files(item) {
  return item.extra.media.map((m) => {
    const name = m.filename || decodeURIComponent(m.url.split('/').pop());
    return { label: `${m.media_type || 'File'} · ${name}${m.width ? ` · ${m.width}×${m.height}` : ''}`, url: m.url, name, width: m.width, height: m.height };
  });
}
