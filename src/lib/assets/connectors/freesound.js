/**
 * Freesound: sound effects, field recordings and samples under CC0, CC BY and CC BY-NC.
 * API: https://freesound.org/apiv2 (an API key to search; an OAuth2 access token to fetch originals).
 */
export const source = {
  id: 'freesound',
  name: 'Freesound',
  about: 'Sound effects, field recordings and samples under CC0, CC BY and CC BY-NC.',
  homepage: 'https://freesound.org',
  terms: 'https://freesound.org/help/tos_api/',
  types: ['audio'],
  hosts: ['freesound.org'],
  settings: { api: 'https://freesound.org/apiv2' },
  keys: [
    { id: 'key', label: 'API key', optional: false, help: 'Apply for API credentials (free) and copy the key ("client secret").' },
    {
      id: 'oauth_token',
      label: 'OAuth2 access token',
      optional: true,
      help: "Only for original files. Follow Freesound's OAuth2 steps in a browser and paste the access token here (it lasts 24 hours). Without it, high-quality previews are offered.",
    },
  ],
  signup: 'https://freesound.org/apiv2/apply',
};

const FIELDS = 'id,name,username,license,previews,duration,filesize,type,samplerate,channels,images,url,description,tags,created';

export async function search(q, ctx) {
  if (!ctx.key('key')) throw new Error('Freesound needs an API key (Sources › Freesound).');
  const names = ['"Creative Commons 0"'];
  if (q.licence !== 'pd') names.push('"Attribution"');
  if (q.licence === 'nc' || q.licence === 'any') names.push('"Attribution NonCommercial"');
  const size = Math.min(q.pageSize, 150);
  const reply = await ctx.get(`${ctx.setting('api')}/search/`, {
    headers: { Authorization: `Token ${ctx.key('key')}` },
    query: { query: q.text.trim(), filter: q.licence === 'any' ? '' : `license:(${names.join(' OR ')})`, fields: FIELDS, page: q.page, page_size: size },
    cache: 600,
  });
  const items = (reply.results || []).map((s) => ({
    id: String(s.id),
    type: 'audio',
    title: s.name,
    creator: s.username,
    creatorUrl: `https://freesound.org/people/${encodeURIComponent(s.username || '')}/`,
    page: s.url,
    thumb: s.images?.waveform_m || '',
    preview: s.previews?.['preview-hq-mp3'] || '',
    description: ctx.text(s.description || '', 800),
    date: String(s.created || '').slice(0, 10),
    licence: '',
    licenceUrl: s.license,
    duration: s.duration,
    size: s.filesize,
    formats: [s.type],
    tags: (s.tags || []).slice(0, 15),
    extra: { previews: s.previews || {}, type: s.type, samplerate: s.samplerate, channels: s.channels },
  }));
  return { items, total: reply.count, more: !!reply.next };
}

export async function files(item, ctx) {
  const base = item.title.replace(/\.[a-z0-9]{2,4}$/i, '').slice(0, 80);
  const out = [];
  const token = ctx.key('oauth_token');
  if (token)
    out.push({
      label: `Original ${String(item.extra.type).toUpperCase()}`,
      url: `${ctx.setting('api')}/sounds/${item.id}/download/`,
      name: `${base}.${item.extra.type || 'wav'}`,
      size: item.size,
      original: true,
      headers: [['Authorization', `Bearer ${token}`]],
    });
  const previews = item.extra.previews || {};
  if (previews['preview-hq-ogg'])
    out.push({
      label: 'Preview, OGG about 192 kbps',
      url: previews['preview-hq-ogg'],
      name: `${base}-preview.ogg`,
      note: token ? '' : 'Add an OAuth2 access token under Sources › Freesound to download the original.',
    });
  if (previews['preview-hq-mp3']) out.push({ label: 'Preview, MP3 about 128 kbps', url: previews['preview-hq-mp3'], name: `${base}-preview.mp3` });
  return out;
}
