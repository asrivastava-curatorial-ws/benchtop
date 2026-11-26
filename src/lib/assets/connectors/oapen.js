/**
 * OAPEN Library: peer-reviewed open-access books from academic publishers (mostly CC BY or CC BY-NC-ND).
 * API: https://library.oapen.org/rest (DSpace; no key).
 */
export const source = {
  id: 'oapen',
  name: 'OAPEN Library',
  about: 'Peer-reviewed open-access books from academic publishers, mostly CC BY or CC BY-NC-ND.',
  homepage: 'https://library.oapen.org',
  terms: 'https://www.oapen.org/about',
  types: ['text'],
  hosts: ['library.oapen.org'],
  settings: { base: 'https://library.oapen.org' },
  keys: [],
  signup: '',
};

const link = (base, l) => (/^https?:/.test(l) ? l : l.startsWith('/rest/') ? `${base}${l}` : `${base}/rest${l}`);

export async function search(q, ctx) {
  if (!q.text.trim()) return { items: [], more: false };
  const base = ctx.setting('base');
  const size = Math.min(q.pageSize, 50);
  const reply = await ctx.get(`${base}/rest/search`, {
    headers: { Accept: 'application/json' },
    query: { query: q.text.trim(), expand: 'metadata,bitstreams', limit: size, offset: (q.page - 1) * size },
    cache: 1800,
  });
  const rows = Array.isArray(reply) ? reply : [];
  const items = rows.map((i) => {
    const meta = i.metadata || [];
    const values = (key) => meta.filter((m) => m.key === key && m.value).map((m) => m.value);
    const people = values('dc.contributor.author').length ? values('dc.contributor.author') : values('dc.contributor.editor');
    const thumb = (i.bitstreams || []).find((b) => b.bundleName === 'THUMBNAIL');
    return {
      id: i.handle || i.uuid,
      type: 'text',
      title: values('dc.title')[0] || i.name,
      creator: people.join('; '),
      page: i.handle ? `${base}/handle/${i.handle}` : base,
      thumb: thumb ? link(base, thumb.retrieveLink) : '',
      description: ctx.text(values('dc.description.abstract')[0] || '', 1500),
      date: values('dc.date.issued')[0] || '',
      licence: meta.map((m) => m.value).find((v) => String(v).includes('creativecommons.org')) || values('dc.rights')[0] || '',
      provider: values('publisher.name')[0] || values('dc.publisher')[0] || '',
      tags: values('dc.subject.other').slice(0, 10),
      extra: {
        bitstreams: (i.bitstreams || [])
          .filter((b) => b.bundleName === 'ORIGINAL')
          .map((b) => ({
            url: link(base, b.retrieveLink),
            name: b.name,
            mime: b.mimeType,
            size: b.sizeBytes,
            md5: b.checkSum && /md5/i.test(b.checkSum.checkSumAlgorithm || '') ? b.checkSum.value : '',
          })),
      },
    };
  });
  return { items, more: rows.length >= size };
}

export async function files(item) {
  return item.extra.bitstreams.map((b) => ({
    label: `${/pdf/.test(b.mime || '') ? 'PDF' : /\.epub$/i.test(b.name) ? 'EPUB' : 'File'} · ${b.name}`,
    url: b.url,
    name: b.name,
    size: b.size,
    md5: b.md5,
    original: true,
  }));
}
