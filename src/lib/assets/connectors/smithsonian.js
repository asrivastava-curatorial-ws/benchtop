/**
 * Smithsonian Open Access: millions of pictures and hundreds of 3D scans from
 * the Smithsonian's museums, released as CC0.
 * API: https://api.si.edu/openaccess/api/v1.0 (needs a free api.data.gov key).
 */
export const source = {
  id: 'smithsonian',
  name: 'Smithsonian Open Access',
  about: "Pictures and 3D scans from the Smithsonian's museums, archives and zoo, released as CC0.",
  homepage: 'https://www.si.edu/openaccess',
  terms: 'https://www.si.edu/termsofuse',
  types: ['image', 'model'],
  hosts: ['api.si.edu'],
  settings: { api: 'https://api.si.edu/openaccess/api/v1.0' },
  keys: [{ id: 'key', label: 'api.data.gov key', optional: false, help: 'Sign up with your name and e-mail; the key arrives at once.' }],
  signup: 'https://api.data.gov/signup/',
};

export async function search(q, ctx) {
  if (!ctx.key('key')) throw new Error('Smithsonian Open Access needs a free api.data.gov key (Sources › Smithsonian Open Access).');
  const kinds = [q.types.includes('image') ? '"Images"' : '', q.types.includes('model') ? '"3D Images"' : ''].filter(Boolean);
  const size = Math.min(q.pageSize, 50);
  const reply = await ctx.get(`${ctx.setting('api')}/search`, {
    query: { q: `${q.text || '*'} AND online_media_type:(${kinds.join(' OR ')})`, start: (q.page - 1) * size, rows: size, api_key: ctx.key('key') },
    cache: 600,
  });
  const response = reply.response || {};
  const items = [];
  for (const row of response.rows || []) {
    const content = row.content || {};
    const dnr = content.descriptiveNonRepeating || {};
    const media = (dnr.online_media?.media || []).filter((m) => String(m.usage?.access || '').toUpperCase() === 'CC0');
    if (media.length === 0) continue;
    const is3d = media.some((m) => /3d/i.test(m.type || ''));
    const freetext = content.freetext || {};
    const thumb = media.find((m) => m.thumbnail)?.thumbnail || '';
    items.push({
      id: row.id,
      type: is3d ? 'model' : 'image',
      title: dnr.title?.content || row.title || 'Untitled',
      creator: (freetext.name || [])[0]?.content || '',
      page: ctx.https(dnr.record_link || `https://collections.si.edu/search/detail/${row.id}`),
      thumb: thumb?.includes('deliveryService') && !thumb.includes('max=') ? `${thumb}&max=400` : thumb,
      description: ctx.text((freetext.notes || []).map((n) => n.content).join('\n'), 1000),
      date: (freetext.date || [])[0]?.content || '',
      licence: 'CC0',
      licenceNote: 'Smithsonian Open Access',
      provider: dnr.data_source || '',
      tags: (content.indexedStructured?.topic || []).slice(0, 10),
      extra: { media },
    });
  }
  return { items, total: response.rowCount, more: q.page * size < (response.rowCount || 0) };
}

export async function files(item) {
  const out = [];
  for (const m of item.extra.media) {
    const is3d = /3d/i.test(m.type || '');
    if (!is3d && m.content) out.push({ label: 'Picture (JPEG)', url: m.content, name: `${String(m.idsId || item.id).replace(/[:/]/g, '-')}.jpg`, original: true });
    for (const r of m.resources || []) {
      if (!r.url) continue;
      const ext = r.url.split('?')[0].split('.').pop().toLowerCase().slice(0, 5);
      out.push({
        label: `${r.label || (is3d ? '3D file' : 'Alternative file')} (${ext.toUpperCase()})`,
        url: r.url,
        name: `${String(m.idsId || item.id).replace(/[:/]/g, '-')}-${String(r.label || 'file').replace(/[^\w]+/g, '-')}.${ext}`,
        original: /full|high/i.test(r.label || ''),
      });
    }
  }
  return out;
}
