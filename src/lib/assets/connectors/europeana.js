/**
 * Europeana: Europe's museums, libraries and archives in one search: pictures,
 * film, sound, texts and 3D, each with a standard rights statement.
 * API: https://api.europeana.eu/record/v2 (a free key; the public demo key works for trying it).
 */
export const source = {
  id: 'europeana',
  name: 'Europeana',
  about: "Europe's museums, libraries and archives: pictures, film, sound, texts and 3D, each with a rights statement.",
  homepage: 'https://www.europeana.eu',
  terms: 'https://www.europeana.eu/en/rights/api-terms-of-use',
  types: ['image', 'video', 'audio', 'text', 'model'],
  hosts: ['api.europeana.eu'],
  settings: { api: 'https://api.europeana.eu/record/v2', demoKey: 'api2demo' },
  keys: [{ id: 'key', label: 'API key', optional: true, help: 'Optional. Request a free personal key; without one the shared demo key is used, which has a low limit.' }],
  signup: 'https://pro.europeana.eu/pages/get-api',
};

const TYPES = { image: 'IMAGE', video: 'VIDEO', audio: 'SOUND', text: 'TEXT', model: '3D' };
const BACK = { VIDEO: 'video', SOUND: 'audio', TEXT: 'text', '3D': 'model' };
const first = (v) => (Array.isArray(v) ? v[0] : v) || '';
const key = (ctx) => ctx.key('key') || ctx.setting('demoKey');

export async function search(q, ctx) {
  const rows = Math.min(q.pageSize, 50);
  const reply = await ctx.get(`${ctx.setting('api')}/search.json`, {
    query: {
      wskey: key(ctx),
      query: q.text || '*',
      rows,
      start: (q.page - 1) * rows + 1,
      qf: `TYPE:(${q.types.map((t) => TYPES[t]).join(' OR ')})`,
      reusability: q.licence === 'any' ? '' : q.licence === 'nc' ? 'open,restricted' : 'open',
      media: 'true',
    },
    cache: 600,
  });
  const items = (reply.items || []).map((i) => ({
    id: i.id,
    type: BACK[i.type] || 'image',
    title: ctx.clip(ctx.text(first(i.title)), 160) || i.id,
    creator: ctx.clip(ctx.text(first(i.dcCreator)), 120),
    page: String(i.guid || '').split('?')[0],
    thumb: first(i.edmPreview),
    preview: i.type === 'IMAGE' ? first(i.edmPreview) : '',
    description: ctx.text(first(i.dcDescription), 1000),
    date: first(i.year),
    licence: '',
    licenceUrl: first(i.rights),
    provider: first(i.dataProvider),
    extra: { shownBy: first(i.edmIsShownBy) },
  }));
  return { items, total: reply.totalResults, more: (q.page - 1) * rows + items.length < (reply.totalResults || 0) };
}

export async function files(item, ctx) {
  const out = [];
  try {
    const record = await ctx.get(`${ctx.setting('api')}${item.id}.json`, { query: { wskey: key(ctx) } });
    const aggregation = (record.object?.aggregations || [])[0] || {};
    for (const wr of aggregation.webResources || []) {
      if (!wr.about || !/^https?:/.test(wr.about) || !wr.ebucoreHasMimeType) continue;
      const ext = wr.ebucoreHasMimeType.split('/').pop().replace('jpeg', 'jpg');
      out.push({
        label: `${wr.ebucoreHasMimeType}${wr.ebucoreWidth ? ` · ${wr.ebucoreWidth}×${wr.ebucoreHeight}` : ''}`,
        url: wr.about,
        name: `${item.title.slice(0, 60)}.${ext}`,
        size: wr.ebucoreFileByteSize,
        width: wr.ebucoreWidth,
        height: wr.ebucoreHeight,
      });
    }
  } catch (error) {
    ctx.log(`The record could not be read: ${error.message}`);
  }
  if (out.length === 0 && item.extra.shownBy)
    out.push({ label: 'The file the provider shows', url: item.extra.shownBy, name: decodeURIComponent(item.extra.shownBy.split('/').pop().split('?')[0]) || 'file' });
  return out;
}
