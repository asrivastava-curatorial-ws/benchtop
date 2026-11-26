/**
 * Library of Congress: photographs, prints, films and recordings, many free to use and reuse.
 * API: loc.gov JSON (add fo=json to any search page; no key).
 */
export const source = {
  id: 'loc',
  name: 'Library of Congress',
  about: 'Photographs, prints, films and recordings from the Library of Congress, many with no known restrictions.',
  homepage: 'https://www.loc.gov/free-to-use/',
  terms: 'https://www.loc.gov/legal/',
  types: ['image', 'video', 'audio'],
  hosts: ['www.loc.gov'],
  settings: {},
  keys: [],
  signup: '',
};

const ENDPOINTS = { image: 'photos', video: 'film-and-videos', audio: 'audio' };
const first = (v) => (Array.isArray(v) ? v[0] : v) || '';

/** The library writes rights as sentences; this turns the common ones into a licence. */
function rights(text) {
  const t = String(text || '').toLowerCase();
  if (!t) return 'Rights on the item page';
  if (t.includes('no known restrictions')) return 'No known copyright restrictions';
  if (t.includes('public domain')) return 'Public domain';
  return `Restricted: ${text}`;
}

export async function search(q, ctx) {
  const size = Math.min(q.pageSize, 50);
  const items = [];
  let total = 0;
  let more = false;
  for (const type of q.types) {
    const reply = await ctx.get(`https://www.loc.gov/${ENDPOINTS[type]}/`, { query: { q: q.text, fo: 'json', c: size, sp: q.page }, cache: 600 });
    for (const r of reply.results || []) {
      const images = [].concat(r.image_url || []);
      const advisory = first(r.rights_advisory) || first(r.rights) || first(r.rights_information);
      items.push({
        id: ctx.https(r.url || r.id || ''),
        type,
        title: ctx.clip(ctx.text(r.title || ''), 160),
        creator: ctx.clip([].concat(r.contributor || []).join(', '), 120),
        page: ctx.https(r.url || r.id || ''),
        thumb: ctx.https(images[0] || ''),
        preview: ctx.https((images[images.length - 1] || '').split('#')[0]),
        description: ctx.text(first(r.description), 800),
        date: r.date || '',
        licence: rights(advisory),
        licenceNote: advisory,
        tags: [].concat(r.subject || []).slice(0, 10),
        extra: { url: ctx.https(r.url || r.id || '') },
      });
    }
    total += reply.pagination?.of || 0;
    more = more || !!reply.pagination?.next;
  }
  return { items, total, more };
}

export async function files(item, ctx) {
  const reply = await ctx.get(item.extra.url, { query: { fo: 'json', at: 'item,resources' } });
  const out = [];
  let jpeg = null;
  for (const resource of reply.resources || []) {
    for (const group of resource.files || []) {
      for (const f of [].concat(group)) {
        if (!f?.url) continue;
        const mime = String(f.mimetype || '');
        if (mime === 'image/jpeg') {
          if (!jpeg || (f.width || 0) > (jpeg.width || 0)) jpeg = f;
          continue;
        }
        if (/^(image\/tiff|image\/jp2|video|audio|application\/pdf)/.test(mime)) {
          out.push({
            label: `${mime.split('/').pop().toUpperCase()} original`,
            url: ctx.https(f.url),
            name: decodeURIComponent(f.url.split('/').pop()),
            size: f.size,
            width: f.width,
            height: f.height,
            original: true,
          });
        }
      }
    }
  }
  if (jpeg) out.push({ label: 'Largest JPEG', url: ctx.https(jpeg.url), name: decodeURIComponent(jpeg.url.split('/').pop()), size: jpeg.size, width: jpeg.width, height: jpeg.height });
  return out;
}
