import { beforeEach, describe, expect, it } from 'vitest';
import { assetRecord, downloadTargets, licenceText, shortName } from '../../src/lib/assets/engine';
import { allowedBy, checkUse, creditLine, indiaCheck, parseLicence } from '../../src/lib/assets/licences';
import { type AssetItem, assetFolder, cleanItem, detectStereo, safeUrl, sameWorkKey } from '../../src/lib/assets/model';
import { allowedHosts, hostAllowed, leaksKey, redact } from '../../src/lib/assets/runtime';
import { codeOf, connectorTemplate, exportConnectors, loadConnectors, parseImport, saveConnectors } from '../../src/lib/assets/store';
import { exportCredits, readRecord } from '../../src/tools/custom/asset-credits';

describe('licences', () => {
  it('reads Creative Commons links, codes and names', () => {
    expect(parseLicence('', 'http://creativecommons.org/licenses/by-nc-sa/3.0/')).toMatchObject({ code: 'by-nc-sa', version: '3.0', url: 'https://creativecommons.org/licenses/by-nc-sa/3.0/' });
    expect(parseLicence('CC BY-SA 4.0').code).toBe('by-sa');
    expect(parseLicence('Attribution-NonCommercial-NoDerivs').code).toBe('by-nc-nd');
    expect(parseLicence('by').code).toBe('by');
    expect(parseLicence('CC-BY-4.0').code).toBe('by');
    expect(parseLicence('Creative Commons 0').code).toBe('cc0');
    expect(parseLicence('CC0-1.0').code).toBe('cc0');
    expect(parseLicence('', 'https://creativecommons.org/publicdomain/mark/1.0/').code).toBe('pdm');
  });

  it('does not mistake ordinary words for a licence', () => {
    expect(parseLicence('Public domain. Digitized by the Smithsonian Libraries').code).toBe('pd');
    expect(parseLicence('Scanned by volunteers').code).toBe('unknown');
  });

  it('knows rights statements, government works, stock, software and font licences', () => {
    expect(parseLicence('', 'http://rightsstatements.org/vocab/NKC/1.0/').code).toBe('nkr');
    expect(parseLicence('', 'http://rightsstatements.org/vocab/InC/1.0/').code).toBe('restricted');
    expect(parseLicence('US government work').code).toBe('us-gov');
    expect(parseLicence('Pexels License').code).toBe('pexels');
    expect(parseLicence('OFL-1.1').code).toBe('ofl');
    expect(parseLicence('Apache-2.0').code).toBe('apache');
    expect(parseLicence('MIT').code).toBe('mit');
    expect(parseLicence('UFL-1.0').code).toBe('other-free');
    expect(parseLicence('GPL-2.0-only').code).toBe('gpl');
    expect(parseLicence('').code).toBe('unknown');
  });

  it('filters by level, with stock licences on their own switch', () => {
    const by = parseLicence('CC BY 4.0');
    const nc = parseLicence('CC BY-NC 4.0');
    const sa = parseLicence('CC BY-SA 4.0');
    const pexels = parseLicence('Pexels License');
    const unknown = parseLicence('');
    expect(allowedBy(parseLicence('CC0'), 'pd', false)).toBe(true);
    expect(allowedBy(by, 'pd', false)).toBe(false);
    expect(allowedBy(by, 'by', false)).toBe(true);
    expect(allowedBy(sa, 'by', false)).toBe(false);
    expect(allowedBy(sa, 'by-sa', false)).toBe(true);
    expect(allowedBy(nc, 'by-sa', false)).toBe(false);
    expect(allowedBy(nc, 'nc', false)).toBe(true);
    expect(allowedBy(unknown, 'nc', false)).toBe(false);
    expect(allowedBy(unknown, 'any', false)).toBe(true);
    expect(allowedBy(pexels, 'any', false)).toBe(false);
    expect(allowedBy(pexels, 'pd', true)).toBe(true);
  });

  it('checks a licence against a use', () => {
    expect(checkUse(parseLicence('CC BY-NC 4.0'), 'ticketed')[0]?.level).toBe('stop');
    expect(checkUse(parseLicence('CC BY-NC 4.0'), 'free')[0]?.level).toBe('note');
    expect(checkUse(parseLicence('CC BY-ND 4.0'), 'free', true)[0]?.level).toBe('stop');
    expect(checkUse(parseLicence('CC0'), 'print')[0]?.level).toBe('ok');
  });

  it('applies the Indian copyright terms', () => {
    const pd = parseLicence('Public domain');
    expect(indiaCheck(pd, 'other', 1950, undefined, 2026).status).toBe('free');
    expect(indiaCheck(pd, 'other', 1980, undefined, 2026).text).toContain('until the end of 2040');
    expect(indiaCheck(pd, 'film', undefined, 1960, 2026).status).toBe('free');
    expect(indiaCheck(pd, 'film', undefined, 1970, 2026).status).toBe('check');
    expect(indiaCheck(pd, 'other', undefined, 1850, 2026).status).toBe('likely');
    expect(indiaCheck(parseLicence('CC0'), 'other', 2000, undefined, 2026).status).toBe('licensed');
  });

  it('writes credit lines in the title, author, source, licence form', () => {
    const line = creditLine({ title: 'Moon', creator: 'Jo', page: 'https://example.org/moon', sourceName: 'Openverse', licence: parseLicence('CC BY-SA 2.0') });
    expect(line).toBe('“Moon” by Jo, Openverse, https://example.org/moon, is licensed under CC BY-SA 2.0 (https://creativecommons.org/licenses/by-sa/2.0/).');
  });
});

describe('asset model', () => {
  it('keeps only https links (plain http only for this computer)', () => {
    expect(safeUrl('http://example.org/a')).toBe('https://example.org/a');
    expect(safeUrl('//example.org/a')).toBe('https://example.org/a');
    expect(safeUrl('http://127.0.0.1:8080/a')).toBe('http://127.0.0.1:8080/a');
    expect(safeUrl('javascript:alert(1)')).toBe('');
    expect(safeUrl('file:///etc/passwd')).toBe('');
  });

  it('spots stereo 3D, 360° and VR180 video', () => {
    expect(detectStereo('Big Buck Bunny 3D SBS')).toBe('sbs');
    expect(detectStereo('Coral reef 360° video')).toBe('360');
    expect(detectStereo('Temple walk VR180')).toBe('180');
    expect(detectStereo('Anaglyph moon')).toBe('anaglyph');
    expect(detectStereo('stereoscopic film', 3840, 1080)).toBe('sbs');
    expect(detectStereo('A plain film')).toBeUndefined();
  });

  it('cleans what a connector returns', () => {
    const item = cleanItem({ id: 7, title: 'Rocket 360 video', type: 'video', licence: 'CC0', thumb: 'http://x.org/t.jpg', page: 'javascript:x', tags: ['a', 3] }, 'lib', 'image');
    expect(item?.id).toBe('7');
    expect(item?.type).toBe('video3d');
    expect(item?.stereo).toBe('360');
    expect(item?.thumb).toBe('https://x.org/t.jpg');
    expect(item?.page).toBe('');
    expect(item?.licence.code).toBe('cc0');
    expect(cleanItem({ title: 'no id' }, 'lib', 'image')).toBeNull();
  });

  it('files each asset by kind, library and title', () => {
    const item = cleanItem({ id: 'File:Moon.jpg', title: 'Moon over the city', licence: 'CC0' }, 'commons', 'image') as AssetItem;
    expect(assetFolder(item, 'Wikimedia Commons')).toEqual(['Pictures', 'Wikimedia Commons', 'Moon over the city [File-Moon.jpg]']);
    expect(sameWorkKey(item)).toBe(sameWorkKey({ ...item, source: 'openverse', id: 'x' }));
  });
});

describe('connector sandbox rules', () => {
  it('allows only listed hosts over https, with wildcards and URL settings', () => {
    const hosts = allowedHosts({ hosts: ['api.example.org', '*.wikipedia.org'], settings: { api: 'https://other.example.net/v1', language: 'en' } });
    expect(hosts).toEqual(['api.example.org', '*.wikipedia.org', 'other.example.net']);
    expect(hostAllowed('https://hi.wikipedia.org/w/api.php', hosts)).toBe(true);
    expect(hostAllowed('https://wikipedia.org/', hosts)).toBe(true);
    expect(hostAllowed('https://evilwikipedia.org/', hosts)).toBe(false);
    expect(hostAllowed('http://api.example.org/', hosts)).toBe(false);
    expect(hostAllowed('http://127.0.0.1:9/', [])).toBe(false);
    expect(hostAllowed('http://127.0.0.1:9/', ['127.0.0.1'])).toBe(true);
  });

  it('hides keys in the request log', () => {
    expect(redact('https://a.org/s?api_key=abc&q=moon')).toBe('https://a.org/s?api_key=•••&q=moon');
    expect(redact('https://a.org/s?k=secret-1', ['secret-1'])).toBe('https://a.org/s?k=•••');
  });

  it('notices links that would carry a key elsewhere', () => {
    expect(leaksKey('https://evil.org/?x=secret-value', { key: 'secret-value' }, ['api.example.org'])).toBe(true);
    expect(leaksKey('https://evil.org/?x=secret%2Dvalue', { key: 'secret-value' }, ['api.example.org'])).toBe(true);
    expect(leaksKey('https://api.example.org/?x=secret-value', { key: 'secret-value' }, ['api.example.org'])).toBe(false);
    expect(leaksKey('https://cdn.org/a.jpg', { key: 'secret-value' }, [])).toBe(false);
  });
});

describe('records kept beside downloads', () => {
  const item = cleanItem(
    { id: 'abc', title: 'A pig’s heart', creator: 'Royal Veterinary College', page: 'https://wellcomecollection.org/works/x', licence: 'CC BY 4.0', date: '1920', deathYear: 1950 },
    'wellcome',
    'image',
  ) as AssetItem;

  it('keep names short but keep the extension', () => {
    expect(shortName(`${'a'.repeat(150)}.jpeg`)).toBe(`${'a'.repeat(95)}.jpeg`);
    expect(shortName('ok.png')).toBe('ok.png');
    expect(shortName('\u0007')).toBe('file');
  });

  it('put parts in sub-folders, at most six folders deep', () => {
    const t = downloadTargets(item, { label: 'glTF', url: 'https://x.org/m.gltf', name: 'm.gltf', parts: [{ url: 'https://x.org/t.jpg', name: 'textures/a/b/c/t.jpg' }] }, 'Wellcome Collection');
    expect(t.dir).toHaveLength(3);
    expect(t.parts[0]?.dir).toEqual([...t.dir, 'textures', 'a', 'b']);
    expect(t.parts[0]?.name).toBe('c - t.jpg');
  });

  it('merge a record with the one already there', () => {
    const first = assetRecord(
      item,
      { id: 'wellcome', name: 'Wellcome Collection', homepage: 'https://wellcomecollection.org' },
      { name: 'a.jpg', label: 'Full size', url: 'https://x/a.jpg', size: 10, verified: null, parts: 0, unpacked: 0 },
      undefined,
      new Date('2026-11-26T00:00:00Z'),
    );
    const second = assetRecord(
      item,
      { id: 'wellcome', name: 'Wellcome Collection', homepage: '' },
      { name: 'b.jpg', label: 'Large', url: 'https://x/b.jpg', size: 5, verified: 'md5', parts: 0, unpacked: 0 },
      first,
    );
    expect((second.files as { name: string }[]).map((f) => f.name)).toEqual(['a.jpg', 'b.jpg']);
    expect(second.credit).toContain('is licensed under CC BY 4.0');
    expect(readRecord({ ...second, _folder: ['Pictures', 'Wellcome Collection', 'x'] }, 'k')).toMatchObject({
      title: 'A pig’s heart',
      deathYear: 1950,
      files: 2,
      folder: 'Pictures › Wellcome Collection › x',
    });
  });

  it('write a plain licence note with the use and India checks', () => {
    const text = licenceText(item, 'Wellcome Collection', new Date('2026-11-26T00:00:00Z'));
    expect(text).toContain('Licence: CC BY 4.0');
    expect(text).toContain('Ticketed show:');
    expect(text).toContain('In India: The licence itself allows use in India');
    expect(text).toContain('not legal advice');
  });

  it('export credits in every format', () => {
    const record = readRecord(
      assetRecord(item, { id: 'wellcome', name: 'Wellcome Collection', homepage: '' }, { name: 'a.jpg', label: '', url: '', size: 1, verified: null, parts: 0, unpacked: 0 }),
      'k',
    );
    if (!record) throw new Error('no record');
    expect(exportCredits([record], 'txt', 'free')).toContain('“A pig’s heart” by Royal Veterinary College');
    expect(exportCredits([record], 'md', 'free')).toContain('[A pig’s heart](https://wellcomecollection.org/works/x)');
    expect(exportCredits([record], 'html', 'free')).toContain('rel="license"');
    expect(exportCredits([record], 'csv', 'ticketed').split('\r\n')[0]).toContain('For this use');
    expect(exportCredits([record], 'film', 'free')).toMatch(/^PICTURES\n\nA pig’s heart · Royal Veterinary College/);
    expect(readRecord({ nothing: true }, 'x')).toBeNull();
  });
});

describe('connector list', () => {
  const memory = new Map<string, string>();
  beforeEach(() => {
    memory.clear();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => memory.get(k) ?? null,
      setItem: (k: string, v: string) => memory.set(k, v),
      removeItem: (k: string) => memory.delete(k),
    };
  });

  it('starts with every built-in connector on, and keeps edits, order and custom ones', () => {
    const fresh = loadConnectors();
    expect(fresh).toHaveLength(34);
    expect(fresh.every((r) => r.enabled && r.code === null && !r.custom)).toBe(true);
    const custom = connectorTemplate('my-library-1');
    saveConnectors([
      { ...(fresh[1] as (typeof fresh)[number]), enabled: false },
      { id: 'my-library-1', code: custom, enabled: true, settings: { api: 'https://x.org' }, custom: true },
    ]);
    const again = loadConnectors();
    // Built-in connectors missing from the stored list come back in their place; yours stay after them.
    expect(again.map((r) => r.id).slice(0, 2)).toEqual([fresh[0]?.id, fresh[1]?.id]);
    expect(again[1]?.enabled).toBe(false);
    expect(again).toHaveLength(35);
    expect(again[34]).toMatchObject({ id: 'my-library-1', custom: true, settings: { api: 'https://x.org' } });
    expect(codeOf(again[34] as (typeof again)[number])).toBe(custom);
  });

  it('exports without keys and imports files or single connectors', () => {
    const list = loadConnectors().slice(0, 2);
    const file = exportConnectors(list);
    expect(file).not.toMatch(/"keys"\s*:\s*\{/);
    expect(parseImport(file)).toHaveLength(2);
    expect(parseImport(connectorTemplate('x-y'))).toHaveLength(1);
    expect(() => parseImport('console.log(1)')).toThrow(/not a connector/);
    expect(() => parseImport('{"x":1}')).toThrow(/no "connectors"/);
  });
});
