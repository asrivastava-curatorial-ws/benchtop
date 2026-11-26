/**
 * LibriVox: public-domain audiobooks read by volunteers (whole books as ZIP, or chapter by chapter).
 * API: https://librivox.org/api/feed/audiobooks/ (no key).  Searches titles, then authors.
 */
export const source = {
  id: 'librivox',
  name: 'LibriVox',
  about: 'Public-domain audiobooks read by volunteers, as whole books or chapter by chapter.',
  homepage: 'https://librivox.org',
  terms: 'https://librivox.org/pages/public-domain/',
  types: ['audio'],
  hosts: ['librivox.org'],
  settings: { api: 'https://librivox.org/api/feed/audiobooks/' },
  keys: [],
  signup: '',
};

async function feed(ctx, field, term, size, offset) {
  const r = await ctx.request(ctx.setting('api'), { query: { [field]: term, format: 'json', extended: 1, limit: size, offset }, cache: 1800 });
  if (r.status === 404) return []; // LibriVox answers "nothing found" with 404.
  if (r.status >= 400) throw new Error(`LibriVox answered ${r.status}`);
  return JSON.parse(r.text).books || [];
}

export async function search(q, ctx) {
  const text = q.text.trim();
  if (!text) return { items: [], more: false };
  const size = Math.min(q.pageSize, 50);
  const offset = (q.page - 1) * size;
  const books = [...(await feed(ctx, 'title', `^${text}`, size, offset)), ...(await feed(ctx, 'author', text.split(/\s+/).pop(), size, offset))];
  const seen = new Set();
  const items = [];
  for (const b of books) {
    if (seen.has(b.id)) continue;
    seen.add(b.id);
    const ia =
      String(b.url_iarchive || '')
        .split('/')
        .filter(Boolean)
        .pop() || '';
    const deaths = (b.authors || []).map((a) => Number.parseInt(a.dod, 10)).filter((y) => y > 0);
    items.push({
      id: String(b.id),
      type: 'audio',
      title: ctx.clip(b.title, 160),
      creator: (b.authors || []).map((a) => `${a.first_name || ''} ${a.last_name || ''}`.trim()).join(', '),
      page: b.url_librivox,
      thumb: b.coverart_thumbnail || (ia ? `https://archive.org/services/img/${ia}` : ''),
      preview: (b.sections || [])[0]?.listen_url || '',
      description: ctx.text(b.description || '', 1200),
      date: b.copyright_year,
      deathYear: deaths.length ? Math.max(...deaths) : undefined,
      licence: 'Public domain',
      licenceNote: 'LibriVox public-domain recording of a text that is public domain in the United States.',
      duration: b.totaltimesecs,
      tags: (b.genres || []).map((g) => g.name).filter(Boolean),
      provider: b.language,
      extra: { zip: b.url_zip_file, sections: (b.sections || []).map((s) => ({ url: s.listen_url, title: s.title })) },
    });
  }
  return { items, more: books.length >= size };
}

export async function files(item, ctx) {
  const base = item.title.slice(0, 80);
  const out = [];
  if (item.extra.zip) out.push({ label: 'Whole book, MP3 at 64 kbps (ZIP, unpacked after download)', url: ctx.https(item.extra.zip), name: `${base}.zip`, unzip: true, original: true });
  item.extra.sections.forEach((s, i) => {
    if (s.url) out.push({ label: `Chapter ${i + 1}: ${s.title}`, url: ctx.https(s.url), name: `${String(i + 1).padStart(2, '0')} - ${String(s.title).slice(0, 80)}.mp3` });
  });
  return out;
}
