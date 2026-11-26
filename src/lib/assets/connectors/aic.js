/**
 * Art Institute of Chicago: public-domain artworks released as CC0, served through IIIF.
 * API: https://api.artic.edu/api/v1 (no key; asks for an identifying user agent).
 */
export const source = {
  id: 'aic',
  name: 'Art Institute of Chicago',
  about: 'Public-domain artworks from the Art Institute of Chicago, released as CC0.',
  homepage: 'https://www.artic.edu/collection',
  terms: 'https://www.artic.edu/open-access/open-access-images',
  types: ['image'],
  hosts: ['api.artic.edu'],
  settings: { api: 'https://api.artic.edu/api/v1', iiif: 'https://www.artic.edu/iiif/2' },
  keys: [],
  signup: '',
};

const FIELDS = 'id,title,image_id,artist_display,artist_title,date_display,date_end,medium_display,dimensions,credit_line,thumbnail,term_titles';

export async function search(q, ctx) {
  const reply = await ctx.get(`${ctx.setting('api')}/artworks/search`, {
    headers: { 'AIC-User-Agent': 'Benchtop Asset Finder (https://github.com/asrivastava-curatorial-ws/benchtop)' },
    query: { q: q.text, 'query[term][is_public_domain]': 'true', fields: FIELDS, limit: Math.min(q.pageSize, 100), page: q.page },
    cache: 600,
  });
  const iiif = reply.config?.iiif_url || ctx.setting('iiif');
  const items = (reply.data || [])
    .filter((a) => a.image_id)
    .map((a) => {
      const display = a.artist_display || '';
      const dates = /(\d{4})\s*[–-]\s*(\d{4})/.exec(display);
      return {
        id: String(a.id),
        title: ctx.clip(a.title || 'Untitled', 160),
        creator: display.split('\n')[0] || a.artist_title || '',
        page: `https://www.artic.edu/artworks/${a.id}`,
        thumb: `${iiif}/${a.image_id}/full/400,/0/default.jpg`,
        preview: `${iiif}/${a.image_id}/full/843,/0/default.jpg`,
        description: ctx.text([a.medium_display, a.dimensions, a.credit_line].filter(Boolean).join('. '), 800),
        date: a.date_display || '',
        year: a.date_end || undefined,
        deathYear: dates ? Number(dates[2]) : undefined,
        licence: 'CC0',
        licenceNote: 'Art Institute of Chicago open access',
        width: a.thumbnail?.width,
        height: a.thumbnail?.height,
        tags: (a.term_titles || []).slice(0, 12),
        extra: { iiif, image: a.image_id, width: a.thumbnail?.width || 3000 },
      };
    });
  const p = reply.pagination || {};
  return { items, total: p.total, more: (p.current_page || q.page) < (p.total_pages || 0) };
}

export async function files(item) {
  const { iiif, image, width } = item.extra;
  const sizes = [...new Set([843, 1686, width].filter((w) => w <= width))];
  return sizes.map((w) => ({
    label: w === width ? `JPEG, largest (${w} px wide)` : `JPEG, ${w} px wide`,
    url: `${iiif}/${image}/full/${w},/0/default.jpg`,
    name: `${item.title.slice(0, 60)}-${w}.jpg`,
    original: w === width,
  }));
}
