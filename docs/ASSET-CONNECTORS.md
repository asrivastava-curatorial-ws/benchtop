# Asset Finder connectors

Asset Finder reaches each library through a connector: one JavaScript file that
knows that library's API. The 34 built-in connectors live in
`src/lib/assets/connectors/`, and the same text is shown on Asset Finder's
**Sources** tab, where any of them can be edited, tested, reset to the built-in
code, exported and imported, and where new ones can be written from a template.
A library that changes its API can be fixed there without waiting for a new
version of Benchtop.

## The sandbox

A connector runs in a worker of its own. `fetch`, `XMLHttpRequest`,
`WebSocket`, `EventSource`, IndexedDB, caches, `importScripts`, other workers and
storage are taken away before its code runs. It asks for data through `ctx`,
and the app makes each request for it:

- over https only (plain http only to this computer: `127.0.0.1`, `localhost`, `[::1]`);
- only to the hosts in `source.hosts` (`*.example.org` allows every
  sub-domain) and the hosts of its URL-valued settings, redirects included (at
  most five; leaving the first host drops `Authorization`, cookies and any header
  carrying a key);
- at most 60 requests per search, 6 at a time, 30 seconds each, 90 seconds per
  search; answers up to 8 MB.

Thumbnail and file links a connector returns are dropped when they would carry
one of its keys to a host it does not list, and a file's own headers are sent
only to the connector's hosts. Keys are hidden in the request log and in errors.
In the desktop app keys are kept in `asset-keys.json` in the app's settings
folder, readable by your account only, and never exported.

## The file

```js
export const source = {
  id: 'my-library',            // 2–41 lower-case letters, digits or dashes; names its keys and settings
  name: 'My library',
  about: 'What it has, in a sentence.',
  homepage: 'https://example.org',
  terms: 'https://example.org/terms',
  types: ['image'],            // image, video, video3d, audio, text, model, texture, icon, font
  hosts: ['api.example.org'],
  settings: { api: 'https://api.example.org/v1' },   // editable on the Sources tab
  keys: [{ id: 'key', label: 'API key', optional: false, help: 'Where to get it.' }],
  signup: 'https://example.org/developers',
  stock: false,                // true for stock-photo licences (asked only when stock libraries are on)
};

export async function search(q, ctx) {
  // q: { text, types, page, pageSize, licence: 'pd'|'by'|'by-sa'|'nc'|'any', stock, use }
  const r = await ctx.get(`${ctx.setting('api')}/search`, { query: { q: q.text, page: q.page }, headers: { Authorization: ctx.key('key') }, cache: 600 });
  return {
    items: r.results.map((x) => ({
      id: x.id,                 // required
      title: x.title,
      type: 'image',
      creator: x.author, creatorUrl: x.author_url, page: x.url,
      thumb: x.thumbnail, preview: x.large,
      description: x.text, date: x.date, deathYear: x.author_died,
      licence: x.licence_name,  // text, a Creative Commons code, or…
      licenceUrl: x.licence_url, licenceNote: x.credit,
      width: x.w, height: x.h, duration: x.seconds, size: x.bytes,
      tags: x.tags, provider: x.collection,
      stereo: undefined,        // 'sbs', 'tb', 'anaglyph', '3d', '360' or '180' (otherwise guessed from the title)
      files: undefined,         // the files, when the search already has them
      extra: { download: x.download },   // anything files() needs later
    })),
    total: r.count,
    more: !!r.next,
  };
}

export async function files(item, ctx) {
  return [
    { label: 'Original', url: item.extra.download, name: 'picture.jpg', size: 123, sha256: '…', original: true },
    // also: md5, sha1, width, height, note, headers: [['Authorization', '…']], unzip: true,
    // parts: [{ url, name: 'textures/wood.jpg', size, md5 }]   (fetched into the asset's folder with it)
    // or text made here: { label: 'Plain text', text: '…', name: 'article.txt' }
  ];
}

// Optional: called just before a file is downloaded (a fresh link, a reported download).
export async function prepare(item, file, ctx) {
  return file;
}
```

## `ctx`

| Call | Does |
| --- | --- |
| `ctx.get(url, { query, headers, cache, as })` | GET; `query` values may be arrays; `cache` keeps the answer for that many seconds; `as`: `'json'` (default), `'text'` or `'raw'` (`{ status, headers, text }`). Throws on 400 and above. |
| `ctx.post(url, { form, json, body, headers })` | POST a form, JSON or a string. |
| `ctx.request(url, options)` | Any method; resolves `{ status, headers, text }` without throwing. |
| `ctx.key(name)`, `ctx.setting(name)` | A key from the Sources tab; a setting (yours or the connector's own). |
| `ctx.text(html, max)`, `ctx.clip(s, n)` | HTML to plain text; shorten with an ellipsis. |
| `ctx.https(url)`, `ctx.year(s)` | `http:` and `//` links to `https:`; the first year in a string. |
| `ctx.mapLimit(items, n, fn)` | Run `fn` over items, `n` at a time; a failure leaves `undefined` and a log line. |
| `ctx.log(...)` | A line in the Sources tab's request log. |

Licences are read from what the library writes: Creative Commons links, codes
(`by-nc-sa`) and names (`CC BY-SA 4.0`, `Attribution-NonCommercial`), CC0 and
the Public Domain Mark, rightsstatements.org, US government works, the Pexels,
Pixabay and Unsplash licences, and software and font licences (OFL, MIT, Apache,
GPL). What the app cannot recognise is shown as "not confirmed" and filtered as
such.

## Files in the library

Downloads go into the library folder as `Kind/Library/Title [id]/`, with
`asset.json` (where the asset came from, its licence, its credit line and the
files saved) and `LICENCE.txt` (what the licence allows for each use, and the
copyright term in India) beside the files. Asset Credits reads `asset.json`.
