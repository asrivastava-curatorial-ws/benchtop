/**
 * Open Library: books with a public scan on the Internet Archive (PDF, EPUB, full text),
 * public domain in the United States.  API: https://openlibrary.org/search.json (no key).
 * Books that can only be borrowed are left out.
 */
export const source = {
  id: 'openlibrary',
  name: 'Open Library',
  about: 'Books with a free public scan (PDF, EPUB, full text) on the Internet Archive. Borrow-only books are left out.',
  homepage: 'https://openlibrary.org',
  terms: 'https://openlibrary.org/developers/api',
  types: ['text'],
  hosts: ['openlibrary.org', 'archive.org'],
  settings: { api: 'https://openlibrary.org/search.json' },
  keys: [],
  signup: '',
};

const FIELDS = 'key,title,author_name,first_publish_year,cover_i,ia,ebook_access,public_scan_b,subject,language';

export async function search(q, ctx) {
  if (!q.text.trim()) return { items: [], more: false };
  const size = Math.min(q.pageSize, 100);
  const reply = await ctx.get(ctx.setting('api'), { query: { q: q.text.trim(), has_fulltext: 'true', fields: FIELDS, limit: size, page: q.page }, cache: 1800 });
  const docs = reply.docs || [];
  const items = docs
    .filter((d) => (d.public_scan_b === true || d.ebook_access === 'public') && (d.ia || []).length)
    .map((d) => ({
      id: String(d.key || '').replace('/works/', ''),
      type: 'text',
      title: d.title,
      creator: (d.author_name || []).join(', '),
      page: `https://openlibrary.org${d.key}`,
      thumb: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg` : '',
      preview: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-L.jpg` : '',
      date: d.first_publish_year ? String(d.first_publish_year) : '',
      licence: 'Public domain',
      licenceNote: "A public scan on the Internet Archive: public domain in the United States. Check the author's dates for India (life + 60 years).",
      tags: (d.subject || []).slice(0, 10),
      provider: (d.language || []).slice(0, 3).join(', '),
      extra: { ia: (d.ia || []).slice(0, 4) },
    }));
  return { items, total: reply.numFound, more: (q.page - 1) * size + docs.length < (reply.numFound || 0) };
}

export async function files(item, ctx) {
  for (const id of item.extra.ia) {
    const meta = await ctx.get(`https://archive.org/metadata/${encodeURIComponent(id)}`, { cache: 600 });
    const m = meta.metadata || {};
    if (String(m['access-restricted-item']) === 'true') continue; // lending only
    const wanted = /^(Text PDF|Additional Text PDF|Image Container PDF|EPUB|DjVuTXT|Abbyy GZ|Single Page Processed JP2 ZIP)$/;
    const labels = {
      'Text PDF': 'PDF with text',
      'Additional Text PDF': 'PDF with text',
      'Image Container PDF': 'PDF (page images)',
      EPUB: 'EPUB',
      DjVuTXT: 'Full text (OCR)',
      'Abbyy GZ': 'OCR layout (ABBYY XML)',
      'Single Page Processed JP2 ZIP': 'Page images (JPEG 2000 in a ZIP)',
    };
    return (meta.files || [])
      .filter((f) => wanted.test(f.format || ''))
      .map((f) => ({
        label: `${labels[f.format] || f.format} · ${f.name}`,
        url: `https://archive.org/download/${encodeURIComponent(id)}/${f.name.split('/').map(encodeURIComponent).join('/')}`,
        name: f.name.split('/').pop(),
        size: Number(f.size) || undefined,
        md5: f.md5,
        sha1: f.sha1,
        original: /PDF/.test(f.format),
      }));
  }
  throw new Error('Every scan of this book is lending-only now; open its page to borrow it.');
}
