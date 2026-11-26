/**
 * Wikisource: transcribed public-domain books, poems, speeches and documents in many languages,
 * downloaded page by page or as a whole work with its chapters.
 * API: https://<language>.wikisource.org/w/api.php (no key).  Change "language" for another Wikisource.
 */
export const source = {
  id: 'wikisource',
  name: 'Wikisource',
  about: 'Transcribed public-domain books, poems, speeches and documents, with their chapters, in many languages.',
  homepage: 'https://wikisource.org',
  terms: 'https://foundation.wikimedia.org/wiki/Policy:Terms_of_Use',
  types: ['text'],
  hosts: ['*.wikisource.org'],
  settings: { language: 'en' },
  keys: [],
  signup: '',
};

const site = (ctx) => `https://${(ctx.setting('language') || 'en').toLowerCase().replace(/[^a-z-]/g, '')}.wikisource.org`;
const slug = (title) => encodeURIComponent(String(title).replace(/ /g, '_'));

export async function search(q, ctx) {
  if (!q.text.trim()) return { items: [], more: false };
  const size = Math.min(q.pageSize, 50);
  const reply = await ctx.get(`${site(ctx)}/w/api.php`, {
    query: {
      action: 'query',
      format: 'json',
      formatversion: 2,
      list: 'search',
      srsearch: q.text.trim(),
      srnamespace: 0,
      srlimit: size,
      sroffset: (q.page - 1) * size,
      srprop: 'snippet|wordcount|timestamp',
    },
    cache: 600,
  });
  const hits = reply.query?.search || [];
  const items = hits.map((h) => ({
    id: String(h.pageid),
    type: 'text',
    title: h.title,
    creator: '',
    page: `${site(ctx)}/wiki/${slug(h.title)}`,
    description: `${ctx.text(h.snippet || '', 400)}${h.wordcount ? ` (${h.wordcount} words on this page)` : ''}`,
    date: String(h.timestamp || '').slice(0, 10),
    licence: 'Public domain',
    licenceNote: "Wikisource texts are public domain in the United States; some translations are CC BY-SA (see the page). Check the author's dates for India (life + 60 years).",
    provider: `${ctx.setting('language') || 'en'}.wikisource.org`,
    extra: { title: h.title, site: site(ctx) },
  }));
  return { items, total: reply.query?.searchinfo?.totalhits, more: !!reply.continue?.sroffset };
}

export async function files(item, ctx) {
  const { title, site: base } = item.extra;
  const name = String(title).replace(/\//g, ' - ').slice(0, 100);
  const out = [];
  let chapters = [];
  try {
    const reply = await ctx.get(`${base}/w/api.php`, { query: { action: 'query', format: 'json', formatversion: 2, list: 'allpages', apprefix: `${title}/`, apnamespace: 0, aplimit: 300 } });
    chapters = (reply.query?.allpages || []).map((p) => p.title);
  } catch (error) {
    ctx.log(`The chapters could not be listed: ${error.message}`);
  }
  if (chapters.length) {
    out.push({
      label: `Whole work: this page and ${chapters.length} chapters (HTML)`,
      url: `${base}/api/rest_v1/page/html/${slug(title)}`,
      name: `${name}.html`,
      original: true,
      parts: chapters.map((c, i) => ({
        url: `${base}/api/rest_v1/page/html/${slug(c)}`,
        name: `chapters/${String(i + 1).padStart(3, '0')} - ${c
          .slice(title.length + 1)
          .replace(/\//g, ' - ')
          .slice(0, 90)}.html`,
      })),
    });
  }
  out.push({ label: 'This page (HTML)', url: `${base}/api/rest_v1/page/html/${slug(title)}`, name: `${name}.html`, original: !chapters.length });
  try {
    const reply = await ctx.get(`${base}/w/api.php`, { query: { action: 'parse', format: 'json', formatversion: 2, page: title, prop: 'text', disableeditsection: 1 } });
    const text = ctx.text(String(reply.parse?.text || '').replace(/<(style|script)[\s\S]*?<\/\1>/gi, ''));
    if (text) out.push({ label: 'This page (plain text)', text: `${title}\n\n${text}\n\nSource: ${item.page}\n`, name: `${name}.txt` });
  } catch (error) {
    ctx.log(`The plain text could not be read: ${error.message}`);
  }
  out.push({ label: 'This page (wikitext)', url: `${base}/w/index.php?title=${slug(title)}&action=raw`, name: `${name}.wiki.txt` });
  return out;
}
