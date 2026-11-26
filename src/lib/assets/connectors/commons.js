/**
 * Wikimedia Commons: millions of freely licensed pictures, sound, video,
 * 3D models (STL), drawings (SVG) and scanned books (PDF).
 * API: the MediaWiki action API at commons.wikimedia.org/w/api.php (no key).
 */
export const source = {
  id: 'commons',
  name: 'Wikimedia Commons',
  about: 'Freely licensed pictures, sound, video, STL models, SVG drawings and scanned books.',
  homepage: 'https://commons.wikimedia.org',
  terms: 'https://foundation.wikimedia.org/wiki/Policy:Terms_of_Use',
  types: ['image', 'video', 'video3d', 'audio', 'text', 'model', 'icon'],
  hosts: ['commons.wikimedia.org'],
  settings: { api: 'https://commons.wikimedia.org/w/api.php' },
  keys: [],
  signup: '',
};

const FILTERS = {
  image: 'filetype:bitmap',
  video: 'filetype:video',
  video3d: 'filetype:video incategory:"Stereoscopic videos"|"360° videos"|"VR180 videos"|"Anaglyph videos"',
  audio: 'filetype:audio',
  text: 'filemime:application/pdf',
  model: 'filetype:3d',
  icon: 'filetype:drawing',
};
const META = 'LicenseShortName|LicenseUrl|Artist|ImageDescription|DateTimeOriginal|ObjectName|Categories|UsageTerms';

function kindOf(info, asked) {
  const media = String(info.mediatype || '').toUpperCase();
  if (asked === 'video3d') return 'video3d';
  if (media === '3D') return 'model';
  if (media === 'VIDEO') return 'video';
  if (media === 'AUDIO') return 'audio';
  if (media === 'MULTIMEDIA') return String(info.mime || '').startsWith('audio') ? 'audio' : 'video';
  if (media === 'DRAWING') return 'icon';
  if (info.mime === 'application/pdf' || media === 'OFFICE') return 'text';
  return 'image';
}

function item(page, asked, ctx) {
  const info = (page.imageinfo || [])[0];
  if (!info) return null;
  const meta = info.extmetadata || {};
  const field = (name) => meta[name]?.value || '';
  const artist = field('Artist');
  const link = /href="([^"]+)"/.exec(artist);
  return {
    id: page.title,
    type: kindOf(info, asked),
    title: ctx.text(field('ObjectName')) || page.title.replace(/^File:/, '').replace(/\.[a-z0-9]+$/i, ''),
    creator: ctx.text(artist, 200),
    creatorUrl: link ? ctx.https(link[1]) : '',
    page: info.descriptionurl,
    thumb: info.thumburl || '',
    preview: info.thumburl ? info.thumburl.replace('/400px-', '/1280px-') : '',
    description: ctx.text(field('ImageDescription'), 1200),
    date: ctx.text(field('DateTimeOriginal'), 40),
    licence: field('LicenseShortName') || field('UsageTerms'),
    licenceUrl: field('LicenseUrl'),
    width: info.width,
    height: info.height,
    duration: info.duration,
    size: info.size,
    formats: [
      String(info.mime || '')
        .split('/')
        .pop(),
    ],
    tags: ctx.text(field('Categories')).split('|').filter(Boolean).slice(0, 15),
    extra: { url: info.url, sha1: info.sha1, thumb: info.thumburl || '', title: page.title, width: info.width || 0, video: kindOf(info, asked).startsWith('video') },
  };
}

export async function search(q, ctx) {
  const limit = Math.min(q.pageSize, 30);
  const items = [];
  let more = false;
  let total = 0;
  for (const type of q.types) {
    const reply = await ctx.get(ctx.setting('api'), {
      query: {
        action: 'query',
        format: 'json',
        formatversion: 2,
        generator: 'search',
        gsrsearch: `${q.text} ${FILTERS[type] || ''}`.trim(),
        gsrnamespace: 6,
        gsrlimit: limit,
        gsroffset: (q.page - 1) * limit,
        prop: 'imageinfo',
        iiprop: 'url|size|mime|mediatype|extmetadata|sha1',
        iiurlwidth: 400,
        iiextmetadatafilter: META,
        iiextmetadatalanguage: 'en',
        origin: '*',
      },
      cache: 600,
    });
    const pages = (reply.query?.pages || []).slice().sort((a, b) => (a.index || 0) - (b.index || 0));
    for (const page of pages) {
      const found = item(page, type, ctx);
      if (found) items.push(found);
    }
    more = more || !!reply.continue;
    total += reply.query?.searchinfo?.totalhits || 0;
  }
  return { items, total: total || undefined, more };
}

export async function files(item, ctx) {
  const extra = item.extra;
  const name = extra.title.replace(/^File:/, '');
  const out = [{ label: `Original (${name.split('.').pop().toUpperCase()})`, url: extra.url, name, size: item.size, sha1: extra.sha1, original: true }];
  if (item.type === 'image' && extra.thumb) {
    for (const width of [1920, 3840]) {
      if (extra.width > width) out.push({ label: `JPEG, ${width} px wide`, url: extra.thumb.replace('/400px-', `/${width}px-`), name: `${name.replace(/\.[a-z0-9]+$/i, '')}-${width}.jpg` });
    }
  }
  if (extra.video) {
    const reply = await ctx.get(ctx.setting('api'), {
      query: { action: 'query', format: 'json', formatversion: 2, titles: extra.title, prop: 'videoinfo', viprop: 'derivatives', origin: '*' },
    });
    const page = (reply.query?.pages || [])[0] || {};
    for (const d of (page.videoinfo || [])[0]?.derivatives || []) {
      if (!d.src || d.src === extra.url) continue;
      out.push({ label: `Copy: ${d.shorttitle || d.type || 'transcode'}`, url: d.src, name: decodeURIComponent(d.src.split('/').pop()), width: d.width, height: d.height, note: d.type || '' });
    }
  }
  return out;
}
