/**
 * Cleveland Museum of Art: open-access artworks released as CC0, with print-size and full-size TIFF files.
 * API: https://openaccess-api.clevelandart.org (no key).
 */
export const source = {
  id: 'cleveland',
  name: 'Cleveland Museum of Art',
  about: 'Open-access artworks from the Cleveland Museum of Art, released as CC0, up to full-size TIFF.',
  homepage: 'https://www.clevelandart.org/art/collection/search',
  terms: 'https://www.clevelandart.org/open-access',
  types: ['image'],
  hosts: ['openaccess-api.clevelandart.org'],
  settings: { api: 'https://openaccess-api.clevelandart.org/api/artworks/' },
  keys: [],
  signup: '',
};

export async function search(q, ctx) {
  const size = Math.min(q.pageSize, 50);
  const reply = await ctx.get(ctx.setting('api'), { query: { q: q.text, cc0: '1', has_image: '1', limit: size, skip: (q.page - 1) * size }, cache: 600 });
  const items = (reply.data || [])
    .filter((a) => a.share_license_status === 'CC0' && a.images && a.images.web)
    .map((a) => {
      const creator = (a.creators || [])[0] || {};
      return {
        id: String(a.id),
        title: a.title || 'Untitled',
        creator: creator.description || '',
        page: a.url || `https://clevelandart.org/art/${a.accession_number}`,
        thumb: a.images.web.url,
        preview: a.images.web.url,
        description: ctx.text([a.type, a.technique, a.description].filter(Boolean).join('. '), 800),
        date: a.creation_date || '',
        year: a.creation_date_latest || undefined,
        deathYear: Number(creator.death_year) || undefined,
        licence: 'CC0',
        licenceNote: 'Cleveland Museum of Art open access',
        width: Number((a.images.full || a.images.print || a.images.web).width) || undefined,
        height: Number((a.images.full || a.images.print || a.images.web).height) || undefined,
        provider: a.department || '',
        extra: { images: a.images },
      };
    });
  const total = reply.info?.total || 0;
  return { items, total, more: q.page * size < total };
}

export async function files(item) {
  const labels = { full: 'Full size', print: 'Print size', web: 'Web size' };
  return ['full', 'print', 'web']
    .filter((k) => item.extra.images[k]?.url)
    .map((k) => {
      const img = item.extra.images[k];
      return {
        label: `${labels[k]} (${img.url.split('.').pop().toUpperCase()})`,
        url: img.url,
        name: img.url.split('/').pop(),
        width: Number(img.width) || undefined,
        height: Number(img.height) || undefined,
        size: Number(img.filesize) || undefined,
        original: k === 'full',
      };
    });
}
