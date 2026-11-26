/**
 * NASA 3D Resources: models of spacecraft, rovers, telescopes and planets
 * (for rendering and 3D printing), and planetary textures.
 * Kept in NASA's GitHub repository; the file list comes from GitHub's API.
 */
export const source = {
  id: 'nasa-3d',
  name: 'NASA 3D Resources',
  about: 'Models of spacecraft, rovers and telescopes for rendering and 3D printing, and planetary textures.',
  homepage: 'https://github.com/nasa/NASA-3D-Resources',
  terms: 'https://www.nasa.gov/nasa-brand-center/images-and-media/',
  types: ['model', 'texture'],
  hosts: ['api.github.com'],
  settings: {
    tree: 'https://api.github.com/repos/nasa/NASA-3D-Resources/git/trees/master?recursive=1',
    raw: 'https://raw.githubusercontent.com/nasa/NASA-3D-Resources/master',
  },
  keys: [],
  signup: '',
};

/** Models (folders two levels down), each with its files. */
async function catalogue(ctx) {
  const reply = await ctx.get(ctx.setting('tree'), { headers: { Accept: 'application/vnd.github+json' }, cache: 12 * 3600 });
  const groups = new Map();
  for (const entry of reply.tree || []) {
    if (entry.type !== 'blob') continue;
    const parts = entry.path.split('/');
    if (parts.length < 3) continue;
    const key = `${parts[0]}/${parts[1]}`;
    if (!groups.has(key)) groups.set(key, { section: parts[0], name: parts[1], files: [] });
    groups.get(key).files.push({ path: entry.path, size: entry.size || 0 });
  }
  return [...groups.values()];
}

const raw = (ctx, path) => `${ctx.setting('raw')}/${path.split('/').map(encodeURIComponent).join('/')}`;

export async function search(q, ctx) {
  const words = q.text.toLowerCase().split(/\s+/).filter(Boolean);
  const wanted = (g) => (/^images/i.test(g.section) ? 'texture' : 'model');
  const matches = (await catalogue(ctx)).filter((g) => q.types.includes(wanted(g)) && words.every((w) => `${g.section} ${g.name} ${g.files.map((f) => f.path).join(' ')}`.toLowerCase().includes(w)));
  const start = (q.page - 1) * q.pageSize;
  const items = matches.slice(start, start + q.pageSize).map((g) => {
    const formats = [...new Set(g.files.map((f) => f.path.split('.').pop().toLowerCase()))].slice(0, 8);
    const picture = g.files.find((f) => /\.(jpe?g|png)$/i.test(f.path));
    return {
      id: `${g.section}/${g.name}`,
      type: wanted(g),
      title: g.name.replace(/[-_]+/g, ' '),
      creator: 'NASA',
      page: `https://github.com/nasa/NASA-3D-Resources/tree/master/${encodeURIComponent(g.section)}/${encodeURIComponent(g.name)}`,
      thumb: picture ? raw(ctx, picture.path) : '',
      description: `${g.section} · ${g.files.length} files (${formats.join(', ')})`,
      licence: 'US government work',
      licenceNote: 'NASA media guidelines apply.',
      size: g.files.reduce((sum, f) => sum + f.size, 0),
      formats,
      tags: [g.section],
      extra: { files: g.files },
    };
  });
  return { items, total: matches.length, more: start + items.length < matches.length };
}

export async function files(item, ctx) {
  return item.extra.files.map((f) => {
    const name = f.path.split('/').slice(2).join('/');
    return { label: `${name.split('.').pop().toUpperCase()} · ${name}`, url: raw(ctx, f.path), name: name.split('/').pop(), size: f.size };
  });
}
