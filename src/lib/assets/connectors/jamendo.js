/**
 * Jamendo: independent music under Creative Commons licences (many are NonCommercial).
 * API: https://api.jamendo.com/v3.0 (a free client id).
 */
export const source = {
  id: 'jamendo',
  name: 'Jamendo Music',
  about: 'Independent music under Creative Commons licences; many tracks are NonCommercial.',
  homepage: 'https://www.jamendo.com',
  terms: 'https://devportal.jamendo.com/api_terms_of_use',
  types: ['audio'],
  hosts: ['api.jamendo.com'],
  settings: { api: 'https://api.jamendo.com/v3.0' },
  keys: [{ id: 'client_id', label: 'Client ID', optional: false, help: 'Create a free developer app and copy its Client ID.' }],
  signup: 'https://devportal.jamendo.com/',
};

export async function search(q, ctx) {
  if (!ctx.key('client_id')) throw new Error('Jamendo needs a client id (Sources › Jamendo Music).');
  const size = Math.min(q.pageSize, 200);
  const strict = q.licence === 'pd' || q.licence === 'by' || q.licence === 'by-sa';
  const reply = await ctx.get(`${ctx.setting('api')}/tracks/`, {
    query: {
      client_id: ctx.key('client_id'),
      format: 'json',
      limit: size,
      offset: (q.page - 1) * size,
      search: q.text.trim(),
      include: 'licenses musicinfo',
      audioformat: 'mp32',
      audiodlformat: 'flac',
      imagesize: '300',
      ccnc: strict ? 'false' : '',
      ccnd: strict ? 'false' : '',
    },
    cache: 600,
  });
  if (reply.headers && reply.headers.status === 'failed') throw new Error(`Jamendo: ${reply.headers.error_message || 'the search failed'}`);
  const items = (reply.results || []).map((t) => {
    const tags = t.musicinfo?.tags || {};
    return {
      id: String(t.id),
      type: 'audio',
      title: t.name,
      creator: t.artist_name,
      creatorUrl: t.artist_id ? `https://www.jamendo.com/artist/${t.artist_id}` : '',
      page: t.shareurl,
      thumb: t.image || t.album_image,
      preview: t.audio,
      description: t.album_name ? `From the album “${t.album_name}”` : '',
      date: t.releasedate,
      licence: '',
      licenceUrl: t.license_ccurl,
      duration: t.duration,
      tags: [...(tags.genres || []), ...(tags.instruments || []), ...(tags.vartags || [])].slice(0, 15),
      extra: { download: t.audiodownload, allowed: t.audiodownload_allowed === true, stream: t.audio },
    };
  });
  return { items, total: reply.headers?.results_fullcount, more: items.length >= size };
}

export async function files(item) {
  const base = `${item.creator} - ${item.title}`.slice(0, 100);
  const out = [];
  if (item.extra.allowed && item.extra.download) out.push({ label: 'FLAC (lossless)', url: item.extra.download, name: `${base}.flac`, original: true });
  if (item.extra.stream)
    out.push({
      label: 'MP3 (high-quality stream copy)',
      url: item.extra.stream,
      name: `${base}.mp3`,
      note: item.extra.allowed ? '' : 'The artist turned off full downloads; only the stream copy is offered.',
    });
  return out;
}
