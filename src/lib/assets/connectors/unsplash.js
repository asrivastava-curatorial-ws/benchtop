/**
 * Unsplash: high-resolution photographs under the Unsplash License.
 * API: https://api.unsplash.com (a free access key).  Each download is reported to Unsplash, as its API asks.
 */
export const source = {
  id: 'unsplash',
  name: 'Unsplash',
  about: 'High-resolution photographs under the Unsplash License: free to use, but not to resell unchanged or build a rival service.',
  homepage: 'https://unsplash.com',
  terms: 'https://unsplash.com/api-terms',
  types: ['image'],
  stock: true,
  hosts: ['api.unsplash.com'],
  settings: { api: 'https://api.unsplash.com', appName: 'Benchtop', contentFilter: 'high' },
  keys: [{ id: 'key', label: 'Access key', optional: false, help: 'Register as a developer, create an app and copy its Access Key. Put the app name you registered in the appName setting.' }],
  signup: 'https://unsplash.com/oauth/applications',
};

const headers = (ctx) => ({ Authorization: `Client-ID ${ctx.key('key')}`, 'Accept-Version': 'v1' });
const utm = (ctx, url) => (url ? `${url}${url.includes('?') ? '&' : '?'}utm_source=${encodeURIComponent(ctx.setting('appName') || 'Benchtop')}&utm_medium=referral` : '');

export async function search(q, ctx) {
  if (!ctx.key('key')) throw new Error('Unsplash needs an access key (Sources › Unsplash).');
  const r = await ctx.get(`${ctx.setting('api')}/search/photos`, {
    headers: headers(ctx),
    query: { query: q.text.trim() || 'nature', per_page: Math.min(q.pageSize, 30), page: q.page, content_filter: ctx.setting('contentFilter') },
    cache: 3600,
  });
  const items = (r.results || []).map((p) => {
    const words = p.description || p.alt_description || 'Unsplash photo';
    return {
      id: p.id,
      type: 'image',
      title: ctx.clip(words[0].toUpperCase() + words.slice(1), 160),
      creator: p.user?.name,
      creatorUrl: utm(ctx, p.user?.links?.html),
      page: utm(ctx, p.links?.html),
      thumb: p.urls?.small,
      preview: p.urls?.regular,
      date: String(p.created_at || '').slice(0, 10),
      width: p.width,
      height: p.height,
      licence: 'Unsplash License',
      licenceNote: 'Free to use and change without credit (credit appreciated). Not for resale unaltered or to build a competing service.',
      tags: (p.tags || []).map((t) => t.title).filter(Boolean),
      extra: { full: p.urls?.full, regular: p.urls?.regular, track: p.links?.download_location },
    };
  });
  return { items, total: r.total, more: q.page < (r.total_pages || 0) };
}

export async function files(item) {
  return [
    { label: `Full size (${item.width}×${item.height})`, url: item.extra.full, name: `unsplash-${item.id}.jpg`, original: true, width: item.width, height: item.height },
    { label: 'Regular (1080 px wide)', url: item.extra.regular, name: `unsplash-${item.id}-1080.jpg`, width: 1080 },
  ].filter((f) => f.url);
}

/** Called just before a file is downloaded: reports the download, and takes the link Unsplash answers with. */
export async function prepare(item, file, ctx) {
  if (!item.extra.track || !ctx.key('key')) return file;
  const reply = await ctx.get(item.extra.track, { headers: headers(ctx) });
  return file.original && reply.url ? { ...file, url: reply.url } : file;
}
