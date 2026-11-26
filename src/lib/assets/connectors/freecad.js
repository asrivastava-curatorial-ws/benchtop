/**
 * FreeCAD parts library: thousands of CAD parts (fasteners, profiles, electronics, furniture,
 * architecture, robots) as FreeCAD documents with STEP, STL and BREP copies.  CC BY 3.0.
 * Kept in FreeCAD's GitHub repository; the file list comes from GitHub's API (60 requests an hour
 * without a token, so it is kept for 12 hours).
 */
export const source = {
  id: 'freecad',
  name: 'FreeCAD parts library',
  about: 'CAD parts (fasteners, profiles, electronics, furniture, architecture, robots) as FreeCAD, STEP, STL and BREP files.',
  homepage: 'https://github.com/FreeCAD/FreeCAD-library',
  terms: 'https://github.com/FreeCAD/FreeCAD-library#license',
  types: ['model'],
  hosts: ['api.github.com'],
  settings: {
    tree: 'https://api.github.com/repos/FreeCAD/FreeCAD-library/git/trees/master?recursive=1',
    raw: 'https://raw.githubusercontent.com/FreeCAD/FreeCAD-library/master',
    page: 'https://github.com/FreeCAD/FreeCAD-library/tree/master',
  },
  keys: [{ id: 'token', label: 'GitHub token', optional: true, help: 'Optional: a GitHub personal access token (no scopes needed) raises the limit of 60 requests an hour.' }],
  signup: 'https://github.com/settings/tokens',
};

const CAD = /\.(fcstd|step|stp|stl|brep|brp|iges|igs|obj|dxf|svg)$/i;

/** MD5 of a string's UTF-8 bytes (the library names its thumbnails by it). */
function md5(text) {
  const bytes = new TextEncoder().encode(text);
  const words = new Uint32Array(((bytes.length + 8) >> 6) * 16 + 16);
  for (let i = 0; i < bytes.length; i++) words[i >> 2] |= bytes[i] << ((i % 4) * 8);
  words[bytes.length >> 2] |= 0x80 << ((bytes.length % 4) * 8);
  words[(((bytes.length + 8) >> 6) + 1) * 16 - 2] = bytes.length * 8;
  const S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
  const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);
  let [a0, b0, c0, d0] = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];
  for (let block = 0; block < words.length - 15; block += 16) {
    let [a, b, c, d] = [a0, b0, c0, d0];
    for (let i = 0; i < 64; i++) {
      const round = i >> 4;
      const f = round === 0 ? (b & c) | (~b & d) : round === 1 ? (d & b) | (~d & c) : round === 2 ? b ^ c ^ d : c ^ (b | ~d);
      const g = round === 0 ? i : round === 1 ? (5 * i + 1) % 16 : round === 2 ? (3 * i + 5) % 16 : (7 * i) % 16;
      const shift = S[round * 4 + (i % 4)];
      const sum = (a + f + K[i] + words[block + g]) >>> 0;
      [a, d, c] = [d, c, b];
      b = (b + ((sum << shift) | (sum >>> (32 - shift)))) >>> 0;
    }
    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }
  return [a0, b0, c0, d0].map((n) => Array.from({ length: 4 }, (_, i) => ((n >>> (i * 8)) & 255).toString(16).padStart(2, '0')).join('')).join('');
}

/** Python's urllib.parse.quote: keeps letters, digits, "_.-~" and "/". */
const quote = (path) =>
  path
    .split('/')
    .map((s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`))
    .join('/');
const raw = (ctx, path) => `${ctx.setting('raw')}/${path.split('/').map(encodeURIComponent).join('/')}`;

/** Parts: files with the same name (without extension) in the same folder. */
async function catalogue(ctx) {
  const headers = { Accept: 'application/vnd.github+json', ...(ctx.key('token') ? { Authorization: `Bearer ${ctx.key('token')}` } : {}) };
  const reply = await ctx.get(ctx.setting('tree'), { headers, cache: 12 * 3600 });
  if (reply.truncated) ctx.log('GitHub cut the file list short; some parts may be missing.');
  const thumbs = new Set();
  const parts = new Map();
  for (const entry of reply.tree || []) {
    if (entry.type !== 'blob') continue;
    if (entry.path.startsWith('thumbnails/')) {
      thumbs.add(entry.path.slice(11));
      continue;
    }
    if (!CAD.test(entry.path) || !entry.path.includes('/')) continue;
    const stem = entry.path.replace(/\.[^./]+$/, '');
    if (!parts.has(stem)) parts.set(stem, { stem, files: [] });
    parts.get(stem).files.push({ path: entry.path, size: entry.size || 0 });
  }
  return { parts: [...parts.values()], thumbs };
}

export async function search(q, ctx) {
  if (q.licence === 'pd') return { items: [], more: false };
  const words = q.text.toLowerCase().split(/\s+/).filter(Boolean);
  const { parts, thumbs } = await catalogue(ctx);
  const matches = parts.filter((p) => words.every((w) => p.stem.toLowerCase().includes(w)));
  const start = (q.page - 1) * q.pageSize;
  const items = matches.slice(start, start + q.pageSize).map((p) => {
    const folders = p.stem.split('/');
    const name = folders.pop();
    const document = p.files.find((f) => /\.fcstd$/i.test(f.path));
    const thumb = document ? `${md5(quote(document.path))}.png` : '';
    const formats = [...new Set(p.files.map((f) => f.path.split('.').pop().toLowerCase()))];
    return {
      id: p.stem,
      type: 'model',
      title: name.replace(/[_]+/g, ' '),
      creator: 'FreeCAD library contributors',
      creatorUrl: 'https://github.com/FreeCAD/FreeCAD-library/graphs/contributors',
      page: `${ctx.setting('page')}/${folders.map(encodeURIComponent).join('/')}`,
      thumb: thumb && thumbs.has(thumb) ? raw(ctx, `thumbnails/${thumb}`) : '',
      description: `${folders.join(' › ')} · ${formats.join(', ').toUpperCase()}`,
      licence: 'CC BY 3.0',
      licenceUrl: 'https://creativecommons.org/licenses/by/3.0/',
      size: p.files.reduce((sum, f) => sum + f.size, 0),
      formats,
      tags: folders.slice(0, 4),
      provider: folders[0] || '',
      extra: { files: p.files },
    };
  });
  return { items, total: matches.length, more: start + items.length < matches.length };
}

export async function files(item, ctx) {
  const label = {
    fcstd: 'FreeCAD document (FCStd)',
    step: 'STEP (any CAD program)',
    stp: 'STEP (any CAD program)',
    stl: 'STL (3D printing)',
    brep: 'BREP (OpenCASCADE)',
    brp: 'BREP (OpenCASCADE)',
    iges: 'IGES',
    igs: 'IGES',
    obj: 'OBJ mesh',
    dxf: 'DXF drawing',
    svg: 'SVG drawing',
  };
  return item.extra.files.map((f) => {
    const ext = f.path.split('.').pop().toLowerCase();
    return { label: label[ext] || ext.toUpperCase(), url: raw(ctx, f.path), name: f.path.split('/').pop(), size: f.size, original: ext === 'fcstd' };
  });
}
