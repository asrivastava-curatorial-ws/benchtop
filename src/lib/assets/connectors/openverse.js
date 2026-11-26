/**
 * Openverse: openly licensed pictures and sounds gathered from Flickr,
 * Wikimedia Commons, museums and many other collections.
 * API: https://api.openverse.org/v1/ (works without a key; a free client ID and secret raise the limits).
 */
export const source = {
  id: 'openverse',
  name: 'Openverse',
  about: 'Openly licensed pictures and sounds gathered from Flickr, Wikimedia Commons, museums and many other collections.',
  homepage: 'https://openverse.org',
  terms: 'https://docs.openverse.org/terms_of_service.html',
  types: ['image', 'audio'],
  hosts: ['api.openverse.org'],
  settings: { api: 'https://api.openverse.org/v1' },
  keys: [
    { id: 'client_id', label: 'Client ID', optional: true, help: 'Optional. Register an application to search more often than anonymous use allows.' },
    { id: 'client_secret', label: 'Client secret', optional: true },
  ],
  signup: 'https://api.openverse.org/v1/#tag/auth/operation/register',
};

const LICENCES = {
  pd: 'cc0,pdm',
  by: 'cc0,pdm,by',
  'by-sa': 'cc0,pdm,by,by-sa',
  nc: 'cc0,pdm,by,by-sa,by-nc,by-nd,by-nc-sa,by-nc-nd',
  any: '',
};

let token = '';
let expires = 0;

async function authorisation(ctx) {
  const id = ctx.key('client_id');
  const secret = ctx.key('client_secret');
  if (!id || !secret) return {};
  if (!token || Date.now() > expires) {
    const reply = await ctx.post(`${ctx.setting('api')}/auth_tokens/token/`, { form: { grant_type: 'client_credentials', client_id: id, client_secret: secret } });
    token = reply.access_token || '';
    expires = Date.now() + ((reply.expires_in || 3600) - 60) * 1000;
  }
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function search(q, ctx) {
  const headers = await authorisation(ctx);
  const items = [];
  let total = 0;
  let more = false;
  for (const type of q.types) {
    const path = type === 'audio' ? 'audio' : 'images';
    const reply = await ctx.get(`${ctx.setting('api')}/${path}/`, {
      headers,
      query: {
        q: q.text,
        page: q.page,
        page_size: Math.min(q.pageSize, 20),
        license: LICENCES[q.licence],
        license_type: q.use === 'ticketed' || q.use === 'print' ? 'commercial' : '',
        mature: 'false',
      },
    });
    total += reply.result_count || 0;
    more = more || (reply.page || 1) < (reply.page_count || 0);
    for (const r of reply.results || []) {
      items.push({
        id: `${path}/${r.id}`,
        type: type === 'audio' ? 'audio' : 'image',
        title: r.title || 'Untitled',
        creator: r.creator || '',
        creatorUrl: r.creator_url || '',
        page: r.foreign_landing_url || `https://openverse.org/${path === 'images' ? 'image' : 'audio'}/${r.id}`,
        thumb: r.thumbnail || (path === 'images' ? `${ctx.setting('api')}/images/${r.id}/thumb/` : ''),
        preview: path === 'images' ? r.url : '',
        licence: `cc ${r.license || ''} ${r.license_version || ''}`,
        licenceUrl: r.license_url || '',
        width: r.width,
        height: r.height,
        duration: r.duration ? r.duration / 1000 : undefined,
        size: r.filesize,
        formats: r.filetype ? [r.filetype] : [],
        tags: (r.tags || []).map((t) => t.name).slice(0, 20),
        provider: r.provider || r.source || '',
        extra: { url: r.url, filetype: r.filetype || '', alt: r.alt_files || [] },
      });
    }
  }
  return { items, total, more };
}

export async function files(item) {
  const ext = (item.extra.filetype || item.extra.url.split('?')[0].split('.').pop() || 'jpg').toLowerCase();
  const out = [{ label: `Original (${ext.toUpperCase()})`, url: item.extra.url, name: `${item.title}.${ext}`, size: item.size, original: true }];
  for (const alt of item.extra.alt) {
    out.push({ label: `Alternative ${String(alt.filetype || '').toUpperCase()}`, url: alt.url, name: `${item.title}.${alt.filetype || 'bin'}`, size: alt.filesize });
  }
  return out;
}
