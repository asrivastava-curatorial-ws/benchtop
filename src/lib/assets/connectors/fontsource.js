/**
 * Fontsource: about 1,800 open-source fonts (all of Google Fonts and more) as TTF and WOFF2,
 * mostly under the SIL Open Font License.  API: https://api.fontsource.org/v1 (no key).
 */
export const source = {
  id: 'fontsource',
  name: 'Fontsource fonts',
  about: 'Open-source fonts, including all of Google Fonts, as TTF and WOFF2; most under the SIL Open Font License.',
  homepage: 'https://fontsource.org',
  terms: 'https://fontsource.org/docs/api/introduction',
  types: ['font'],
  hosts: ['api.fontsource.org'],
  settings: { api: 'https://api.fontsource.org/v1' },
  keys: [],
  signup: '',
};

export async function search(q, ctx) {
  const all = await ctx.get(`${ctx.setting('api')}/fonts`, { cache: 86400 });
  const words = q.text.toLowerCase().split(/\s+/).filter(Boolean);
  const found = (Array.isArray(all) ? all : [])
    .filter((f) => words.every((w) => `${f.family} ${f.category} ${(f.subsets || []).join(' ')} ${f.type}`.toLowerCase().includes(w)))
    .sort((a, b) => Number(b.family.toLowerCase() === q.text.trim().toLowerCase()) - Number(a.family.toLowerCase() === q.text.trim().toLowerCase()) || a.family.localeCompare(b.family));
  const start = (q.page - 1) * q.pageSize;
  const items = found.slice(start, start + q.pageSize).map((f) => ({
    id: f.id,
    type: 'font',
    title: f.family,
    creator: f.type === 'google' ? 'Google Fonts designers' : 'The font’s designers',
    page: `https://fontsource.org/fonts/${f.id}`,
    description: `${f.category}${f.variable ? ', variable' : ''} · weights ${(f.weights || []).join(', ')} · ${(f.styles || []).join(' and ')} · scripts: ${(f.subsets || []).join(', ')}`,
    date: f.lastModified,
    licence: f.license,
    tags: [f.category, ...(f.subsets || [])],
    formats: ['ttf', 'woff2'],
    extra: { subset: f.defSubset || 'latin' },
  }));
  return { items, total: found.length, more: start + items.length < found.length };
}

export async function files(item, ctx) {
  const detail = await ctx.get(`${ctx.setting('api')}/fonts/${encodeURIComponent(item.id)}`, { cache: 86400 });
  const subset = detail.defSubset || item.extra.subset;
  const ttfs = [];
  const out = [];
  for (const [weight, styles] of Object.entries(detail.variants || {})) {
    for (const [style, subsets] of Object.entries(styles || {})) {
      const urls = subsets[subset]?.url || {};
      const stem = `${item.id}-${subset}-${weight}-${style}`;
      if (urls.ttf) {
        ttfs.push({ url: urls.ttf, name: `${stem}.ttf` });
        out.push({ label: `${weight} ${style} (TTF, for desktop apps)`, url: urls.ttf, name: `${stem}.ttf` });
      }
      if (urls.woff2) out.push({ label: `${weight} ${style} (WOFF2, for web pages)`, url: urls.woff2, name: `${stem}.woff2` });
    }
  }
  if (ttfs.length > 1) out.unshift({ label: `Whole family: ${ttfs.length} TTF files (${subset})`, url: ttfs[0].url, name: ttfs[0].name, original: true, parts: ttfs.slice(1) });
  return out;
}
