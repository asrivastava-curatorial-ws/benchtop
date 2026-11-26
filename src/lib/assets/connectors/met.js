/**
 * The Metropolitan Museum of Art: 400,000+ public-domain artworks under its Open Access policy (CC0).
 * API: https://collectionapi.metmuseum.org (no key).  The search gives object numbers; each object is then read.
 */
export const source = {
  id: 'met',
  name: 'The Met',
  about: 'Public-domain artworks from The Metropolitan Museum of Art, New York, released as CC0.',
  homepage: 'https://www.metmuseum.org/art/collection',
  terms: 'https://www.metmuseum.org/policies/image-resources',
  types: ['image'],
  hosts: ['collectionapi.metmuseum.org'],
  settings: { api: 'https://collectionapi.metmuseum.org/public/collection/v1' },
  keys: [],
  signup: '',
};

export async function search(q, ctx) {
  const found = await ctx.get(`${ctx.setting('api')}/search`, { query: { q: q.text, hasImages: 'true' }, cache: 3600 });
  const ids = found.objectIDs || [];
  const size = Math.min(q.pageSize, 20);
  const start = (q.page - 1) * size;
  const objects = await ctx.mapLimit(ids.slice(start, start + size), 6, (id) => ctx.get(`${ctx.setting('api')}/objects/${id}`, { cache: 86400 }));
  const items = objects
    .filter((o) => o?.isPublicDomain && o.primaryImage)
    .map((o) => ({
      id: String(o.objectID),
      title: o.title || 'Untitled',
      creator: o.artistDisplayName || o.culture || '',
      creatorUrl: o.artistWikidata_URL || '',
      page: o.objectURL,
      thumb: o.primaryImageSmall || o.primaryImage,
      preview: o.primaryImageSmall || o.primaryImage,
      description: [o.objectName, o.medium, o.dimensions, o.creditLine].filter(Boolean).join('. '),
      date: o.objectDate || '',
      year: o.objectEndDate || undefined,
      deathYear: ctx.year(o.artistEndDate),
      licence: 'CC0',
      licenceNote: 'The Met Open Access',
      tags: (o.tags || []).map((t) => t.term).slice(0, 12),
      provider: o.department || '',
      extra: { primary: o.primaryImage, additional: o.additionalImages || [] },
    }));
  return { items, total: ids.length, more: start + size < ids.length };
}

export async function files(item) {
  const name = (n) => `${item.title.slice(0, 60)}${n ? `-${n + 1}` : ''}.jpg`;
  return [{ label: 'Main picture (largest)', url: item.extra.primary, name: name(0), original: true }].concat(
    item.extra.additional.map((url, n) => ({ label: `Other view ${n + 1}`, url, name: name(n + 1) })),
  );
}
