/**
 * Internet Archive: public-domain and openly licensed films (Prelinger,
 * feature films), recordings, books and pictures.
 * API: archive.org advanced search, and the metadata API for an item's files (no key).
 */
export const source = {
  id: 'archive',
  name: 'Internet Archive',
  about: 'Films, newsreels, recordings, books and pictures, many in the public domain or under Creative Commons licences.',
  homepage: 'https://archive.org',
  terms: 'https://archive.org/about/terms',
  types: ['video', 'video3d', 'audio', 'text', 'image'],
  hosts: ['archive.org'],
  settings: {},
  keys: [],
  signup: '',
};

const MEDIA = { video: 'movies', video3d: 'movies', audio: 'audio', text: 'texts', image: 'image' };
const LICENCE_QUERY = {
  pd: ['*publicdomain*'],
  by: ['*publicdomain*', '*licenses/by/*'],
  'by-sa': ['*publicdomain*', '*licenses/by/*', '*licenses/by-sa/*'],
  nc: ['*publicdomain*', '*licenses/by*'],
};
const FIELDS = ['identifier', 'title', 'creator', 'mediatype', 'licenseurl', 'date', 'year', 'description', 'item_size', 'collection', 'subject'];
const SKIP =
  /^(metadata|item tile|thumbnail|archive bittorrent|columbia peaks|spectrogram|png|jpeg thumb|item image|djvu xml|scandata|abbyy gz|single page processed jp2 zip|chocr|hocr|page numbers json|.*metadata)$/i;

const first = (v) => (Array.isArray(v) ? v[0] : v) || '';

export function query(q) {
  const types = [...new Set(q.types.map((t) => MEDIA[t]).filter(Boolean))];
  let s = q.text.trim() ? `(${q.text.trim()})` : '*:*';
  s += ` AND mediatype:(${types.join(' OR ')})`;
  if (q.types.length === 1 && q.types[0] === 'video3d') s += ' AND (stereoscopic OR "3D" OR "360" OR vr180 OR anaglyph OR "side by side")';
  const licences = LICENCE_QUERY[q.licence];
  if (licences) s += ` AND (${licences.map((l) => `licenseurl:${l}`).join(' OR ')})`;
  return s;
}

export async function search(q, ctx) {
  const reply = await ctx.get('https://archive.org/advancedsearch.php', {
    query: { q: query(q), 'fl[]': FIELDS, 'sort[]': 'downloads desc', rows: q.pageSize, page: q.page, output: 'json' },
    cache: 600,
  });
  const response = reply.response || {};
  const items = (response.docs || []).map((d) => {
    const media = first(d.mediatype);
    const type = media === 'movies' ? (q.types.includes('video3d') && !q.types.includes('video') ? 'video3d' : 'video') : media === 'audio' ? 'audio' : media === 'texts' ? 'text' : 'image';
    return {
      id: d.identifier,
      type,
      title: ctx.clip(ctx.text(first(d.title)), 160) || d.identifier,
      creator: [].concat(d.creator || []).join(', '),
      page: `https://archive.org/details/${d.identifier}`,
      thumb: `https://archive.org/services/img/${d.identifier}`,
      description: ctx.text(first(d.description), 800),
      date: first(d.date),
      year: Number(d.year) || ctx.year(first(d.date)),
      licence: first(d.licenseurl) ? '' : 'Licence not stated',
      licenceUrl: first(d.licenseurl),
      size: Number(d.item_size) || undefined,
      tags: [].concat(d.subject || []).slice(0, 15),
      provider: []
        .concat(d.collection || [])
        .slice(0, 3)
        .join(', '),
      extra: {},
    };
  });
  return { items, total: response.numFound, more: (response.start || 0) + items.length < (response.numFound || 0) };
}

export async function files(item, ctx) {
  const reply = await ctx.get(`https://archive.org/metadata/${encodeURIComponent(item.id)}`, { cache: 600 });
  const out = [];
  for (const f of reply.files || []) {
    const format = String(f.format || '');
    if (SKIP.test(format) || /\.(xml|sqlite|torrent|json)$/i.test(f.name) || f.name.startsWith('__ia_')) continue;
    const length = Number(f.length) || 0;
    const size = Number(f.size) || undefined;
    const dims = f.width && f.height ? ` · ${f.width}×${f.height}` : '';
    out.push({
      label: `${format || 'File'} · ${f.name}${dims}${length ? ` · ${Math.round(length / 60)} min` : ''}`,
      url: `https://archive.org/download/${encodeURIComponent(item.id)}/${f.name.split('/').map(encodeURIComponent).join('/')}`,
      name: f.name.split('/').pop(),
      size,
      md5: f.md5 || '',
      sha1: f.sha1 || '',
      original: f.source === 'original',
      width: Number(f.width) || undefined,
      height: Number(f.height) || undefined,
    });
  }
  return out.sort((a, b) => Number(b.original) - Number(a.original) || (b.size || 0) - (a.size || 0)).slice(0, 80);
}
