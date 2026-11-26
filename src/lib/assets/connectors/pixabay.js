/**
 * Pixabay: stock photos, illustrations, vectors and videos under the Pixabay Content License.
 * API: https://pixabay.com/api/ (a free key).
 */
export const source = {
  id: 'pixabay',
  name: 'Pixabay',
  about: 'Stock photos, illustrations, vectors and videos under the Pixabay Content License (free to use; not to resell unchanged).',
  homepage: 'https://pixabay.com',
  terms: 'https://pixabay.com/service/terms/',
  types: ['image', 'video', 'video3d'],
  stock: true,
  hosts: ['pixabay.com'],
  settings: { api: 'https://pixabay.com/api/', safesearch: 'true' },
  keys: [{ id: 'key', label: 'API key', optional: false, help: 'Sign in, open the API documentation page and copy the key shown there.' }],
  signup: 'https://pixabay.com/api/docs/',
};

const licence = { licence: 'Pixabay Content License', licenceNote: 'Free to use and change without credit. Not for resale unaltered, and not with identifiable people or brands in a misleading way.' };
const title = (tags, fallback) => {
  const t = String(tags || '')
    .split(',')[0]
    .trim();
  return t ? t[0].toUpperCase() + t.slice(1) : fallback;
};

export async function search(q, ctx) {
  const key = ctx.key('key');
  if (!key) throw new Error('Pixabay needs an API key (Sources › Pixabay).');
  const size = Math.max(3, Math.min(q.pageSize, 200));
  const items = [];
  let more = false;
  let total = 0;
  if (q.types.includes('image')) {
    const r = await ctx.get(ctx.setting('api'), { query: { key, q: q.text.trim(), per_page: size, page: q.page, safesearch: ctx.setting('safesearch') }, cache: 3600 });
    for (const h of r.hits || [])
      items.push({
        id: `image-${h.id}`,
        type: 'image',
        title: title(h.tags, 'Pixabay picture'),
        creator: h.user,
        creatorUrl: `https://pixabay.com/users/${h.user}-${h.user_id}/`,
        page: h.pageURL,
        thumb: h.webformatURL || h.previewURL,
        preview: h.largeImageURL,
        width: h.imageWidth,
        height: h.imageHeight,
        size: h.imageSize,
        tags: String(h.tags || '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        provider: h.type,
        ...licence,
        extra: { large: h.largeImageURL, full: h.fullHDURL, original: h.imageURL },
      });
    more ||= q.page * size < (r.totalHits || 0);
    total += r.totalHits || 0;
  }
  if (q.types.includes('video') || q.types.includes('video3d')) {
    const text = q.types.includes('video') ? q.text.trim() : `${q.text.trim()} 360`.trim();
    const r = await ctx.get(`${ctx.setting('api')}videos/`, { query: { key, q: text, per_page: size, page: q.page, safesearch: ctx.setting('safesearch') }, cache: 3600 });
    for (const h of r.hits || []) {
      const v = h.videos || {};
      items.push({
        id: `video-${h.id}`,
        type: 'video',
        title: title(h.tags, 'Pixabay video'),
        creator: h.user,
        creatorUrl: `https://pixabay.com/users/${h.user}-${h.user_id}/`,
        page: h.pageURL,
        thumb: v.tiny?.thumbnail || v.small?.thumbnail || '',
        preview: v.tiny?.url,
        width: v.large?.width,
        height: v.large?.height,
        duration: h.duration,
        size: v.large?.size,
        tags: String(h.tags || '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
        ...licence,
        extra: { videos: v },
      });
    }
    more ||= q.page * size < (r.totalHits || 0);
    total += r.totalHits || 0;
  }
  return { items, total, more };
}

export async function files(item) {
  const base = `pixabay-${item.id}`;
  if (item.type === 'image') {
    return [
      { label: 'Original (needs full API access)', url: item.extra.original, name: `${base}-original.jpg`, original: true },
      { label: 'Full HD (needs full API access)', url: item.extra.full, name: `${base}-fullhd.jpg` },
      { label: 'Large (1280 px)', url: item.extra.large, name: `${base}-1280.jpg`, note: 'Pixabay links expire after a day; search again if a download fails.' },
    ].filter((f) => f.url);
  }
  return ['large', 'medium', 'small', 'tiny']
    .map((size) => [size, item.extra.videos[size]])
    .filter(([, v]) => v?.url)
    .map(([size, v]) => ({ label: `${v.width}×${v.height} (${size})`, url: v.url, name: `${base}-${size}.mp4`, size: v.size, width: v.width, height: v.height }));
}
