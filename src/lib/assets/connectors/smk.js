/**
 * SMK, the National Gallery of Denmark: paintings, drawings and prints in the public domain,
 * many scanned at very high resolution.  API: https://api.smk.dk/api/v1 (no key).
 */
export const source = {
  id: 'smk',
  name: 'SMK (National Gallery of Denmark)',
  about: 'Public-domain paintings, drawings and prints from the National Gallery of Denmark, many in very high resolution.',
  homepage: 'https://open.smk.dk',
  terms: 'https://www.smk.dk/article/smk-api/',
  types: ['image'],
  hosts: ['api.smk.dk'],
  settings: { api: 'https://api.smk.dk/api/v1', language: 'en' },
  keys: [],
  signup: '',
};

export async function search(q, ctx) {
  const rows = Math.min(q.pageSize, 100);
  const reply = await ctx.get(`${ctx.setting('api')}/art/search/`, {
    query: { keys: q.text.trim() || '*', offset: (q.page - 1) * rows, rows, filters: '[has_image:true],[public_domain:true]', lang: ctx.setting('language') },
    cache: 600,
  });
  const items = (reply.items || []).map((a) => {
    const maker = (a.production || [])[0] || {};
    const thumb = String(a.image_thumbnail || '').replace('/full/!1024,/', '/full/!400,/');
    return {
      id: a.object_number || a.id,
      type: 'image',
      title: (a.titles || [])[0]?.title || 'Untitled',
      creator: (a.artist || [])[0] || maker.creator || '',
      page: a.frontend_url || `https://open.smk.dk/artwork/image/${encodeURIComponent(a.object_number || '')}`,
      thumb,
      preview: a.image_thumbnail,
      description: [(a.object_names || [])[0]?.name, maker.creator_nationality].filter(Boolean).join(' · '),
      date: (a.production_date || [])[0]?.period || '',
      deathYear: ctx.year(maker.creator_date_of_death),
      licence: '',
      licenceUrl: a.rights || 'https://creativecommons.org/publicdomain/zero/1.0/',
      width: a.image_width,
      height: a.image_height,
      size: a.image_size,
      provider: 'Statens Museum for Kunst',
      extra: { native: a.image_native, iiif: a.image_iiif_id, more: (a.alternative_images || []).map((i) => ({ native: i.native, width: i.width, height: i.height })) },
    };
  });
  return { items, total: reply.found, more: (q.page - 1) * rows + items.length < (reply.found || 0) };
}

export async function files(item) {
  const out = [];
  if (item.extra.native)
    out.push({
      label: `Original (JPEG${item.width ? `, ${item.width}×${item.height}` : ''})`,
      url: item.extra.native,
      name: `${item.id}.jpg`,
      original: true,
      size: item.size,
      width: item.width,
      height: item.height,
    });
  if (item.extra.iiif) out.push({ label: 'Large (3000 px, JPEG)', url: `${item.extra.iiif}/full/!3000,3000/0/default.jpg`, name: `${item.id}-3000.jpg` });
  item.extra.more.forEach((m, i) => {
    if (m.native) out.push({ label: `Other view ${i + 1} (${m.width}×${m.height})`, url: m.native, name: `${item.id}-view-${i + 1}.jpg`, width: m.width, height: m.height });
  });
  return out;
}
