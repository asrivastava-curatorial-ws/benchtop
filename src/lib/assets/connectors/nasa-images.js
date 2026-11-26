/**
 * NASA Image and Video Library: photographs, video and audio from NASA's
 * missions and centres.  NASA's own media is not copyrighted in the US.
 * API: https://images-api.nasa.gov (no key).
 */
export const source = {
  id: 'nasa-images',
  name: 'NASA Images',
  about: 'Photographs, video and audio from NASA missions and centres, generally free of copyright.',
  homepage: 'https://images.nasa.gov',
  terms: 'https://www.nasa.gov/nasa-brand-center/images-and-media/',
  types: ['image', 'video', 'audio'],
  hosts: ['images-api.nasa.gov'],
  settings: { api: 'https://images-api.nasa.gov' },
  keys: [],
  signup: '',
};

export async function search(q, ctx) {
  const reply = await ctx.get(`${ctx.setting('api')}/search`, {
    query: { q: q.text, media_type: q.types.join(','), page: q.page, page_size: Math.min(q.pageSize, 100) },
    cache: 600,
  });
  const collection = reply.collection || {};
  const items = [];
  for (const entry of collection.items || []) {
    const d = (entry.data || [])[0];
    if (!d?.nasa_id) continue;
    const thumb = ctx.https((entry.links || []).find((l) => l.render === 'image' || l.rel === 'preview')?.href || '');
    const credit = d.photographer || d.secondary_creator || '';
    items.push({
      id: d.nasa_id,
      type: d.media_type === 'video' ? 'video' : d.media_type === 'audio' ? 'audio' : 'image',
      title: ctx.clip(d.title || d.nasa_id, 160),
      creator: credit || (d.center ? `NASA ${d.center}` : 'NASA'),
      page: `https://images.nasa.gov/details/${encodeURIComponent(d.nasa_id)}`,
      thumb,
      preview: d.media_type === 'image' ? thumb.replace('~thumb.', '~medium.') : '',
      description: ctx.text(d.description || '', 1200),
      date: (d.date_created || '').slice(0, 10),
      licence: 'US government work',
      licenceNote: credit ? `Credited to ${credit}: it may be third-party material, so check before use. NASA media guidelines apply.` : 'NASA media guidelines apply.',
      tags: (d.keywords || []).slice(0, 15),
      provider: d.center || '',
      extra: {},
    });
  }
  const more = (collection.links || []).some((l) => l.rel === 'next');
  return { items, total: collection.metadata?.total_hits, more };
}

const LABELS = { orig: 'Original', large: 'Large', medium: 'Medium', small: 'Small', mobile: 'Mobile', thumb: 'Thumbnail' };

export async function files(item, ctx) {
  const reply = await ctx.get(`${ctx.setting('api')}/asset/${encodeURIComponent(item.id)}`);
  const out = [];
  for (const entry of reply.collection?.items || []) {
    const url = ctx.https(entry.href || '');
    const name = decodeURIComponent(url.split('/').pop() || '');
    if (!name || name === 'metadata.json' || /preview_thumb/.test(name)) continue;
    const ext = name.split('.').pop().toLowerCase();
    const variant = (/~([a-z0-9_]+)\./i.exec(name) || [])[1] || '';
    const label = ext === 'srt' || ext === 'vtt' ? `Captions (${ext.toUpperCase()})` : `${LABELS[variant] || variant || 'File'} · ${ext.toUpperCase()}`;
    out.push({ label, url, name, original: variant === 'orig' });
  }
  return out;
}
