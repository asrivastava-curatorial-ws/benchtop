/**
 * Pexels: stock photos and videos under the Pexels License (free to use and change, no credit needed;
 * don't sell unaltered copies).  API: https://api.pexels.com (a free key).
 */
export const source = {
  id: 'pexels',
  name: 'Pexels',
  about: 'Stock photos and videos under the Pexels License: free to use without credit, but not to resell unchanged.',
  homepage: 'https://www.pexels.com',
  terms: 'https://www.pexels.com/api/documentation/#guidelines',
  types: ['image', 'video', 'video3d'],
  stock: true,
  hosts: ['api.pexels.com'],
  settings: { api: 'https://api.pexels.com' },
  keys: [{ id: 'key', label: 'API key', optional: false, help: 'Sign in and request an API key; it is shown at once.' }],
  signup: 'https://www.pexels.com/api/new/',
};

const licence = { licence: 'Pexels License', licenceNote: 'Free to use and change; credit appreciated. Not for resale unaltered or as part of a competing service.' };

export async function search(q, ctx) {
  const key = ctx.key('key');
  if (!key) throw new Error('Pexels needs an API key (Sources › Pexels).');
  const size = Math.min(q.pageSize, 80);
  const headers = { Authorization: key };
  const items = [];
  let more = false;
  let total = 0;
  if (q.types.includes('image')) {
    const r = await ctx.get(`${ctx.setting('api')}/v1/search`, { headers, query: { query: q.text.trim() || 'nature', per_page: size, page: q.page }, cache: 3600 });
    for (const p of r.photos || [])
      items.push({
        id: `photo-${p.id}`,
        type: 'image',
        title: p.alt || 'Pexels photo',
        creator: p.photographer,
        creatorUrl: p.photographer_url,
        page: p.url,
        thumb: p.src?.medium,
        preview: p.src?.large,
        width: p.width,
        height: p.height,
        ...licence,
        extra: { src: p.src || {} },
      });
    more ||= !!r.next_page;
    total += r.total_results || 0;
  }
  if (q.types.includes('video') || q.types.includes('video3d')) {
    const text = q.types.includes('video') ? q.text.trim() : `${q.text.trim()} 360`.trim();
    const r = await ctx.get(`${ctx.setting('api')}/videos/search`, { headers, query: { query: text || 'nature', per_page: size, page: q.page }, cache: 3600 });
    for (const v of r.videos || []) {
      const slug =
        String(v.url || '')
          .replace(/\/$/, '')
          .split('/')
          .pop() || '';
      const title = slug.replace(/-\d+$/, '').replace(/-/g, ' ');
      items.push({
        id: `video-${v.id}`,
        type: 'video',
        title: title ? title[0].toUpperCase() + title.slice(1) : 'Pexels video',
        creator: v.user?.name,
        creatorUrl: v.user?.url,
        page: v.url,
        thumb: v.image,
        width: v.width,
        height: v.height,
        duration: v.duration,
        ...licence,
        extra: { videos: v.video_files || [] },
      });
    }
    more ||= !!r.next_page;
    total += r.total_results || 0;
  }
  return { items, total, more };
}

export async function files(item) {
  const base = `pexels-${item.id}`;
  if (item.type === 'image') {
    return [
      ['original', 'Original'],
      ['large2x', 'Large (twice screen size)'],
      ['large', 'Large'],
    ]
      .filter(([k]) => item.extra.src[k])
      .map(([k, label]) => ({
        label,
        url: item.extra.src[k],
        name: `${base}-${k}.jpg`,
        original: k === 'original',
        width: k === 'original' ? item.width : undefined,
        height: k === 'original' ? item.height : undefined,
      }));
  }
  return item.extra.videos
    .filter((v) => v.link)
    .sort((a, b) => (b.width || 0) - (a.width || 0))
    .map((v) => ({
      label: `${v.width}×${v.height} ${String(v.quality || '').toUpperCase()}${v.fps ? ` ${Math.round(v.fps)} fps` : ''}`,
      url: v.link,
      name: `${base}-${v.width}x${v.height}.${String(v.file_type || 'video/mp4')
        .split('/')
        .pop()}`,
      width: v.width,
      height: v.height,
    }));
}
