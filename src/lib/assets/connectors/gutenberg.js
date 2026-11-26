/**
 * Project Gutenberg: public-domain ebooks (EPUB, Kindle, HTML, plain text), judged by US law.
 * API: Gutendex, https://gutendex.com/books/ (no key).
 */
export const source = {
  id: 'gutenberg',
  name: 'Project Gutenberg',
  about: 'Public-domain ebooks as EPUB, Kindle, HTML and plain text. Public domain is judged by US law, so check the India note.',
  homepage: 'https://www.gutenberg.org',
  terms: 'https://www.gutenberg.org/policy/permission.html',
  types: ['text'],
  hosts: ['gutendex.com'],
  settings: { api: 'https://gutendex.com/books/' },
  keys: [],
  signup: '',
};

export async function search(q, ctx) {
  if (!q.text.trim()) return { items: [], more: false };
  const reply = await ctx.get(ctx.setting('api'), { query: { search: q.text.trim(), copyright: 'false', page: q.page }, cache: 1800 });
  const items = (reply.results || []).map((b) => {
    const authors = (b.authors || []).map((a) => {
      const [last, first] = String(a.name || '').split(/,\s*/);
      return first && !first.includes(',') ? `${first} ${last}` : a.name;
    });
    const deaths = (b.authors || []).map((a) => a.death_year).filter((y) => typeof y === 'number');
    return {
      id: String(b.id),
      type: 'text',
      title: ctx.clip(b.title, 200),
      creator: authors.join(', '),
      page: `https://www.gutenberg.org/ebooks/${b.id}`,
      thumb: b.formats?.['image/jpeg'] || '',
      preview: b.formats?.['image/jpeg'] || '',
      description: ctx.text((b.summaries || [])[0] || '', 1500),
      deathYear: deaths.length ? Math.max(...deaths) : undefined,
      licence: 'Public domain',
      licenceNote: 'Public domain in the United States (Project Gutenberg).',
      tags: [...(b.subjects || []), ...(b.bookshelves || [])].slice(0, 12),
      provider: (b.languages || []).join(', '),
      extra: { formats: b.formats || {} },
    };
  });
  return { items, total: reply.count, more: !!reply.next };
}

export async function files(item) {
  const formats = Object.entries(item.extra.formats);
  const pick = (prefix) => (formats.find(([mime, url]) => mime.startsWith(prefix) && !String(url).endsWith('.zip')) || [])[1];
  const note = 'Project Gutenberg asks that its name be removed if you share changed texts.';
  return [
    { label: 'EPUB (e-readers and phones)', url: pick('application/epub+zip'), name: `${item.title.slice(0, 80)}.epub`, original: true, note },
    { label: 'Kindle', url: pick('application/x-mobipocket-ebook'), name: `${item.title.slice(0, 80)}.mobi` },
    { label: 'HTML (web page)', url: pick('text/html'), name: `${item.title.slice(0, 80)}.html` },
    { label: 'Plain text', url: pick('text/plain'), name: `${item.title.slice(0, 80)}.txt` },
    { label: 'Cover picture', url: pick('image/jpeg'), name: `${item.title.slice(0, 80)} cover.jpg` },
  ].filter((f) => f.url);
}
