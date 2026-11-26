/**
 * Wellcome Collection: pictures from the history of medicine and health (prints, photographs,
 * manuscripts, scans), many under CC0, the Public Domain Mark or CC BY.
 * API: https://api.wellcomecollection.org/catalogue/v2 (no key).  Pictures come from its IIIF image server.
 */
export const source = {
  id: 'wellcome',
  name: 'Wellcome Collection',
  about: 'Pictures from the history of medicine and health: prints, photographs, manuscripts and scans.',
  homepage: 'https://wellcomecollection.org',
  terms: 'https://developers.wellcomecollection.org/',
  types: ['image'],
  hosts: ['api.wellcomecollection.org'],
  settings: { api: 'https://api.wellcomecollection.org/catalogue/v2' },
  keys: [],
  signup: '',
};

const LICENCES = { pd: 'cc-0,pdm', by: 'cc-0,pdm,cc-by', 'by-sa': 'cc-0,pdm,cc-by', nc: 'cc-0,pdm,cc-by,cc-by-nc,cc-by-nc-nd', any: '' };
const base = (info) => String(info || '').replace(/\/info\.json$/, '');

export async function search(q, ctx) {
  const size = Math.min(q.pageSize, 100);
  const reply = await ctx.get(`${ctx.setting('api')}/images`, {
    query: { query: q.text.trim(), pageSize: size, page: q.page, include: 'source.contributors', 'locations.license': LICENCES[q.licence] },
    cache: 600,
  });
  const items = (reply.results || []).map((r) => {
    const location = (r.locations || []).find((l) => l.locationType && l.locationType.id === 'iiif-image') || (r.locations || [])[0] || {};
    const licence = location.license || {};
    const image = base(location.url || r.thumbnail?.url);
    const work = r.source || {};
    return {
      id: r.id,
      type: 'image',
      title: work.title || 'Untitled',
      creator: (work.contributors || [])
        .map((c) => c.agent?.label)
        .filter(Boolean)
        .join('; '),
      page: work.id ? `https://wellcomecollection.org/works/${work.id}` : 'https://wellcomecollection.org',
      thumb: image ? `${image}/full/!400,400/0/default.jpg` : '',
      preview: image ? `${image}/full/!1024,1024/0/default.jpg` : '',
      licence: licence.label || '',
      licenceUrl: licence.url || '',
      licenceNote: location.credit ? `Credit: ${location.credit}` : '',
      provider: location.credit || '',
      extra: { image },
    };
  });
  return { items, total: reply.totalResults, more: q.page < (reply.totalPages || 0) };
}

export async function files(item) {
  if (!item.extra.image) return [];
  const id = item.extra.image.split('/').pop();
  return [
    { label: 'Full size (JPEG)', url: `${item.extra.image}/full/full/0/default.jpg`, name: `${id}.jpg`, original: true },
    { label: 'Large (2048 px, JPEG)', url: `${item.extra.image}/full/!2048,2048/0/default.jpg`, name: `${id}-2048.jpg` },
  ];
}
