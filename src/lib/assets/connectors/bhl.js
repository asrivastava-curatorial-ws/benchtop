/**
 * Biodiversity Heritage Library: scanned natural-history books and journals, most of them public domain.
 * API: https://www.biodiversitylibrary.org/api3 (a free key).
 */
export const source = {
  id: 'bhl',
  name: 'Biodiversity Heritage Library',
  about: 'Scanned natural-history books and journals with their illustrations; most are public domain.',
  homepage: 'https://www.biodiversitylibrary.org',
  terms: 'https://about.biodiversitylibrary.org/help/copyright-and-reuse/',
  types: ['text'],
  hosts: ['www.biodiversitylibrary.org'],
  settings: { api: 'https://www.biodiversitylibrary.org/api3' },
  keys: [{ id: 'key', label: 'API key', optional: false, help: 'Request a free key with your name and e-mail.' }],
  signup: 'https://www.biodiversitylibrary.org/getapikey.aspx',
};

export async function search(q, ctx) {
  const key = ctx.key('key');
  if (!key) throw new Error('The Biodiversity Heritage Library needs a free API key (Sources › Biodiversity Heritage Library).');
  if (!q.text.trim()) return { items: [], more: false };
  const size = Math.min(q.pageSize, 50);
  const api = ctx.setting('api');
  const reply = await ctx.get(api, { query: { op: 'PublicationSearch', searchterm: q.text.trim(), searchtype: 'C', page: q.page, pageSize: size, format: 'json', apikey: key }, cache: 1800 });
  if (reply.Status !== 'ok') throw new Error(`BHL: ${reply.ErrorMessage || 'the search failed'}`);
  const hits = (reply.Result || []).filter((r) => r.ItemID || r.TitleID);
  // Rights are stated per scanned volume, so each volume's details are read too.
  const details = await ctx.mapLimit(hits, 6, (hit) =>
    ctx.get(api, {
      query: hit.ItemID ? { op: 'GetItemMetadata', id: hit.ItemID, format: 'json', apikey: key } : { op: 'GetTitleMetadata', id: hit.TitleID, items: 't', format: 'json', apikey: key },
      cache: 86400,
    }),
  );
  const items = [];
  hits.forEach((hit, n) => {
    const result = (details[n]?.Result || [])[0] || {};
    const volume = Array.isArray(result.Items) ? result.Items[0] || {} : result;
    const itemId = String(hit.ItemID || volume.ItemID || '');
    if (!itemId) return;
    const rights = [volume.LicenseUrl, volume.License, volume.CopyrightStatus, volume.Rights].find((s) => s) || '';
    const deaths = (hit.Authors || [])
      .map((a) => /\d{4}\s*-\s*(\d{4})/.exec(a.Dates || ''))
      .filter(Boolean)
      .map((m) => Number(m[1]));
    const label = hit.Volume || volume.Volume || '';
    const title = hit.Title || result.FullTitle || label;
    items.push({
      id: itemId,
      type: 'text',
      title: label ? `${title} (${label})` : title,
      creator: (hit.Authors || [])
        .map((a) => a.Name)
        .filter(Boolean)
        .join('; '),
      page: `https://www.biodiversitylibrary.org/item/${itemId}`,
      thumb: volume.ItemThumbUrl || `https://www.biodiversitylibrary.org/itemthumb/${itemId}`,
      description: hit.Genre || '',
      date: hit.PublicationDate || volume.Year || hit.Year || '',
      deathYear: deaths.length ? Math.max(...deaths) : undefined,
      licence: /public domain/i.test(rights) && !/creativecommons/i.test(rights) ? 'Public domain' : rights,
      licenceNote: rights,
      extra: {},
    });
  });
  return { items, more: items.length >= size / 2 };
}

export async function files(item) {
  const note = 'BHL asks for the credit "Image from the Biodiversity Heritage Library" with a link to the item. Large volumes take a while to prepare as PDF.';
  return [
    { label: 'Whole volume (PDF)', url: `https://www.biodiversitylibrary.org/itempdf/${item.id}`, name: `${item.title.slice(0, 80)}.pdf`, original: true, note },
    { label: 'OCR text', url: `https://www.biodiversitylibrary.org/itemtext/${item.id}`, name: `${item.title.slice(0, 80)}.txt` },
  ];
}
