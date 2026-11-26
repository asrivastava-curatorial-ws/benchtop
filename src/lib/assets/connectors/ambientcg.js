/**
 * ambientCG: CC0 PBR materials, HDRIs and 3D models (ZIP downloads, unpacked after download).
 * API: https://ambientcg.com/api/v2/full_json (no key).
 */
export const source = {
  id: 'ambientcg',
  name: 'ambientCG',
  about: 'CC0 PBR materials, HDRIs and 3D models.',
  homepage: 'https://ambientcg.com',
  terms: 'https://docs.ambientcg.com/license/',
  types: ['texture', 'model'],
  hosts: ['ambientcg.com'],
  settings: { api: 'https://ambientcg.com/api/v2/full_json' },
  keys: [],
  signup: '',
};

export async function search(q, ctx) {
  const types = [q.types.includes('texture') ? 'Material,HDRI,Decal,Atlas' : '', q.types.includes('model') ? '3DModel' : ''].filter(Boolean).join(',');
  const size = Math.min(q.pageSize, 100);
  const reply = await ctx.get(ctx.setting('api'), {
    query: { q: q.text, type: types, include: 'downloadData,previewData,displayData,tagData', limit: size, offset: (q.page - 1) * size, sort: 'Popular' },
    cache: 1800,
  });
  const items = (reply.foundAssets || []).map((a) => {
    const previews = a.previewImage || {};
    return {
      id: a.assetId,
      type: a.dataType === '3DModel' ? 'model' : 'texture',
      title: a.displayName || a.assetId,
      creator: 'ambientCG (Lennart Demes)',
      page: a.shortLink || `https://ambientcg.com/view?id=${a.assetId}`,
      thumb: previews['256-PNG'] || previews['256-JPG-242424'] || Object.values(previews)[0] || '',
      preview: previews['1024-JPG-242424'] || previews['1024-PNG'] || '',
      description: [a.dataTypeName, a.displayCategory, a.creationMethodName].filter(Boolean).join(' · '),
      date: String(a.releaseDate || '').slice(0, 10),
      licence: 'CC0',
      licenceNote: 'ambientCG',
      tags: (a.tags || []).slice(0, 15),
      stereo: a.dataType === 'HDRI' ? '360' : undefined,
      extra: { downloads: a.downloadFolders?.default?.downloadFiletypeCategories || {} },
    };
  });
  return { items, total: reply.numberOfResults, more: (q.page - 1) * size + items.length < (reply.numberOfResults || 0) };
}

export async function files(item) {
  const out = [];
  for (const category of Object.values(item.extra.downloads)) {
    for (const d of category.downloads || []) {
      if (!d.downloadLink) continue;
      const ext = String(d.fileName || '')
        .split('.')
        .pop()
        .toLowerCase();
      out.push({ label: `${d.attribute || 'Download'} (${ext.toUpperCase()})`, url: d.downloadLink, name: d.fileName, size: d.size, unzip: ext === 'zip' });
    }
  }
  return out;
}
