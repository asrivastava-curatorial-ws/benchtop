/**
 * Iconify: over 200,000 open-source icons from more than 150 sets (Material, Tabler, Phosphor,
 * Lucide, Font Awesome Free, …) as SVG, each set with its own licence.
 * API: https://api.iconify.design (no key).
 */
export const source = {
  id: 'iconify',
  name: 'Iconify icons',
  about: 'Open-source icons from more than 150 sets (Material, Tabler, Phosphor, Lucide, …) as SVG, each set with its own licence.',
  homepage: 'https://icon-sets.iconify.design',
  terms: 'https://iconify.design/docs/api/',
  types: ['icon'],
  hosts: ['api.iconify.design'],
  settings: { api: 'https://api.iconify.design' },
  keys: [],
  signup: '',
};

export async function search(q, ctx) {
  if (!q.text.trim()) return { items: [], more: false };
  const size = Math.max(32, Math.min(q.pageSize, 999));
  const api = ctx.setting('api');
  const reply = await ctx.get(`${api}/search`, { query: { query: q.text.trim(), limit: size, start: (q.page - 1) * size }, cache: 3600 });
  const sets = reply.collections || {};
  const items = (reply.icons || []).map((full) => {
    const [prefix, name] = String(full).split(':');
    const set = sets[prefix] || {};
    const licence = set.license || {};
    return {
      id: full,
      type: 'icon',
      title: `${name.replace(/-/g, ' ')} (${set.name || prefix})`,
      creator: set.author?.name || '',
      creatorUrl: set.author?.url || '',
      page: `https://icon-sets.iconify.design/${prefix}/${name}/`,
      thumb: `${api}/${prefix}/${name}.svg?height=96`,
      description: `${set.name || prefix}${set.total ? `, a set of ${set.total} icons` : ''}${set.category ? ` (${set.category})` : ''}`,
      licence: licence.spdx || licence.title || '',
      licenceUrl: licence.url || '',
      licenceNote: licence.title ? `Icon set licence: ${licence.title}` : '',
      provider: set.name || prefix,
      formats: ['svg'],
      tags: [prefix, ...(set.tags || [])],
      extra: { prefix, name },
    };
  });
  return { items, total: reply.total, more: (q.page - 1) * size + items.length < (reply.total || 0) };
}

export async function files(item, ctx) {
  const api = ctx.setting('api');
  const { prefix, name } = item.extra;
  return [
    { label: 'SVG', url: `${api}/${prefix}/${name}.svg`, name: `${prefix}-${name}.svg`, original: true },
    { label: 'SVG, 512 px tall', url: `${api}/${prefix}/${name}.svg?height=512`, name: `${prefix}-${name}-512.svg` },
    { label: 'Iconify JSON (for code)', url: `${api}/${prefix}.json?icons=${encodeURIComponent(name)}`, name: `${prefix}-${name}.json` },
  ];
}
