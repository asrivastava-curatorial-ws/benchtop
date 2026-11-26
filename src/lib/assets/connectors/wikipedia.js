/**
 * Wikipedia: encyclopedia articles in any language, as plain text, HTML or wikitext (CC BY-SA 4.0).
 * API: https://<language>.wikipedia.org/w/api.php (no key).  Change "language" for another Wikipedia (hi, kn, ta, …).
 */
export const source = {
  id: 'wikipedia',
  name: 'Wikipedia',
  about: 'Encyclopedia articles in any language, as plain text, HTML or wikitext, under CC BY-SA 4.0.',
  homepage: 'https://www.wikipedia.org',
  terms: 'https://foundation.wikimedia.org/wiki/Policy:Terms_of_Use',
  types: ['text'],
  hosts: ['*.wikipedia.org'],
  settings: { language: 'en' },
  keys: [],
  signup: '',
};

const site = (ctx) => `https://${(ctx.setting('language') || 'en').toLowerCase().replace(/[^a-z-]/g, '')}.wikipedia.org`;
const slug = (title) => encodeURIComponent(String(title).replace(/ /g, '_'));

export async function search(q, ctx) {
  if (!q.text.trim() || q.licence === 'pd' || q.licence === 'by') return { items: [], more: false };
  const size = Math.min(q.pageSize, 20); // extracts come back for at most 20 pages at a time
  const reply = await ctx.get(`${site(ctx)}/w/api.php`, {
    query: {
      action: 'query',
      format: 'json',
      formatversion: 2,
      generator: 'search',
      gsrsearch: q.text.trim(),
      gsrnamespace: 0,
      gsrlimit: size,
      gsroffset: (q.page - 1) * size,
      prop: 'pageimages|extracts|info',
      piprop: 'thumbnail',
      pithumbsize: 320,
      exintro: 1,
      explaintext: 1,
      exlimit: 'max',
      exchars: 700,
      inprop: 'url',
    },
    cache: 600,
  });
  const pages = (reply.query?.pages || []).slice().sort((a, b) => (a.index || 0) - (b.index || 0));
  const items = pages.map((p) => ({
    id: String(p.pageid),
    type: 'text',
    title: p.title,
    creator: 'Wikipedia contributors',
    creatorUrl: `${site(ctx)}/w/index.php?title=${slug(p.title)}&action=history`,
    page: p.fullurl || `${site(ctx)}/wiki/${slug(p.title)}`,
    thumb: p.thumbnail?.source,
    description: p.extract || '',
    date: String(p.touched || '').slice(0, 10),
    licence: 'CC BY-SA 4.0',
    licenceUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
    licenceNote: 'Text of a Wikipedia article. Pictures in the article have licences of their own.',
    size: p.length,
    provider: `${ctx.setting('language') || 'en'}.wikipedia.org`,
    extra: { title: p.title, site: site(ctx) },
  }));
  return { items, more: !!reply.continue?.gsroffset };
}

export async function files(item, ctx) {
  const { title, site: base } = item.extra;
  const name = String(title).slice(0, 100);
  const out = [];
  try {
    const reply = await ctx.get(`${base}/w/api.php`, { query: { action: 'query', format: 'json', formatversion: 2, prop: 'extracts', explaintext: 1, exsectionformat: 'plain', titles: title } });
    const text = (reply.query?.pages || [])[0]?.extract;
    if (text) out.push({ label: 'Plain text', text: `${title}\n\n${text}\n\nSource: ${item.page}\nLicence: CC BY-SA 4.0, Wikipedia contributors\n`, name: `${name}.txt` });
  } catch (error) {
    ctx.log(`The plain text could not be read: ${error.message}`);
  }
  out.push({ label: 'HTML (the article as a web page)', url: `${base}/api/rest_v1/page/html/${slug(title)}`, name: `${name}.html`, original: true });
  out.push({ label: 'Wikitext (the source markup)', url: `${base}/w/index.php?title=${slug(title)}&action=raw`, name: `${name}.wiki.txt` });
  return out;
}
