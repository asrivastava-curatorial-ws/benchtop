/**
 * Sketchfab: downloadable 3D models under Creative Commons licences (museum scans among them).
 * API: https://api.sketchfab.com/v3 (searching needs no key; downloading needs your own API token).
 */
export const source = {
  id: 'sketchfab',
  name: 'Sketchfab',
  about: 'Downloadable 3D models under Creative Commons licences, including museum scans.',
  homepage: 'https://sketchfab.com/search?features=downloadable&type=models',
  terms: 'https://sketchfab.com/terms',
  types: ['model'],
  hosts: ['api.sketchfab.com'],
  settings: { api: 'https://api.sketchfab.com/v3' },
  keys: [{ id: 'token', label: 'API token', optional: true, help: 'Needed to download (not to search). Sign in, open Settings › Password & API, and copy the token.' }],
  signup: 'https://sketchfab.com/settings/password',
};

const LICENCES = {
  pd: ['cc0'],
  by: ['cc0', 'by'],
  'by-sa': ['cc0', 'by', 'by-sa'],
  nc: ['cc0', 'by', 'by-sa', 'by-nd', 'by-nc', 'by-nc-sa', 'by-nc-nd'],
  any: [],
};
const SLUGS = {
  'CC Attribution': 'by',
  'CC Attribution-ShareAlike': 'by-sa',
  'CC Attribution-NoDerivs': 'by-nd',
  'CC Attribution-NonCommercial': 'by-nc',
  'CC Attribution-NonCommercial-ShareAlike': 'by-nc-sa',
  'CC Attribution-NonCommercial-NoDerivs': 'by-nc-nd',
  'CC0 Public Domain': 'cc0',
};

export async function search(q, ctx) {
  const count = Math.min(q.pageSize, 24);
  const reply = await ctx.get(`${ctx.setting('api')}/search`, {
    query: { type: 'models', q: q.text, downloadable: 'true', count, cursor: (q.page - 1) * count, license: LICENCES[q.licence] },
    cache: 600,
  });
  const items = (reply.results || []).map((m) => {
    const images = (m.thumbnails?.images || []).slice().sort((a, b) => a.width - b.width);
    const pick = (w) => (images.find((i) => i.width >= w) || images[images.length - 1])?.url || '';
    const licence = typeof m.license === 'string' ? m.license : (m.license && (m.license.slug || SLUGS[m.license.label] || m.license.label)) || '';
    return {
      id: m.uid,
      type: 'model',
      title: ctx.clip(m.name || 'Untitled', 160),
      creator: (m.user && (m.user.displayName || m.user.username)) || '',
      creatorUrl: m.user?.profileUrl || '',
      page: m.viewerUrl || `https://sketchfab.com/3d-models/${m.uid}`,
      thumb: pick(256),
      preview: pick(640),
      description: `${m.faceCount ? `${m.faceCount} faces, ${m.vertexCount} vertices. ` : ''}${ctx.text(m.description || '', 800)}`,
      date: String(m.publishedAt || '').slice(0, 10),
      licence: SLUGS[licence] || licence,
      licenceUrl: m.license?.url || '',
      size: (m.archives && (m.archives.glb?.size || m.archives.gltf?.size)) || undefined,
      tags: (m.tags || []).map((t) => t.name).slice(0, 15),
      extra: {},
    };
  });
  return { items, more: !!reply.next };
}

export async function files(item, ctx) {
  const token = ctx.key('token');
  if (!token) throw new Error('Sketchfab needs your API token to download: add it under Sources › Sketchfab.');
  const reply = await ctx.get(`${ctx.setting('api')}/models/${item.id}/download`, { headers: { Authorization: `Token ${token}` } });
  const labels = { glb: 'glTF binary (GLB)', gltf: 'glTF with textures (ZIP)', usdz: 'USDZ (for Apple AR)', source: 'Source files as uploaded (ZIP)' };
  return Object.entries(reply)
    .filter(([, e]) => e?.url)
    .map(([kind, e]) => ({
      label: labels[kind] || kind,
      url: e.url,
      name: `${item.title.slice(0, 60)}-${kind}.${kind === 'glb' ? 'glb' : kind === 'usdz' ? 'usdz' : 'zip'}`,
      size: e.size,
      unzip: kind === 'gltf',
      note: 'The download link works for a few minutes.',
    }));
}
