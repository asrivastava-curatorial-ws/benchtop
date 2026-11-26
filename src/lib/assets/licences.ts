/**
 * Licences of downloaded assets: read from what libraries write (Creative
 * Commons URLs and codes, rights statements, stock-library licences, software
 * and font licences), explained in plain words, checked against how the
 * asset will be used, and turned into a credit line.
 *
 * This is guidance, not legal advice: the source page is always kept.
 */
import type { AssetUse, LicenceLevel } from './model';

export type LicenceCode =
  | 'cc0'
  | 'pdm'
  | 'pd'
  | 'us-gov'
  | 'nkr'
  | 'by'
  | 'by-sa'
  | 'by-nc'
  | 'by-nc-sa'
  | 'by-nd'
  | 'by-nc-nd'
  | 'pexels'
  | 'pixabay'
  | 'unsplash'
  | 'ofl'
  | 'mit'
  | 'apache'
  | 'gpl'
  | 'gfdl'
  | 'other-free'
  | 'restricted'
  | 'unknown';

export interface Licence {
  readonly code: LicenceCode;
  /** "CC BY 4.0", "Public domain", "Pexels License". */
  readonly name: string;
  readonly url: string;
  readonly version: string;
  /** What the library said, when it adds something (a rights statement, a caveat). */
  readonly note: string;
}

const CC_URL: Readonly<Record<string, string>> = {
  by: 'https://creativecommons.org/licenses/by/',
  'by-sa': 'https://creativecommons.org/licenses/by-sa/',
  'by-nc': 'https://creativecommons.org/licenses/by-nc/',
  'by-nc-sa': 'https://creativecommons.org/licenses/by-nc-sa/',
  'by-nd': 'https://creativecommons.org/licenses/by-nd/',
  'by-nc-nd': 'https://creativecommons.org/licenses/by-nc-nd/',
};

const FIXED: Partial<Record<LicenceCode, { name: string; url: string }>> = {
  cc0: { name: 'CC0 1.0 (no rights reserved)', url: 'https://creativecommons.org/publicdomain/zero/1.0/' },
  pdm: { name: 'Public domain (marked)', url: 'https://creativecommons.org/publicdomain/mark/1.0/' },
  pd: { name: 'Public domain', url: '' },
  'us-gov': { name: 'US government work (public domain in the US)', url: 'https://www.usa.gov/government-copyright' },
  nkr: { name: 'No known copyright restrictions', url: 'https://www.flickr.com/commons/usage/' },
  pexels: { name: 'Pexels License', url: 'https://www.pexels.com/license/' },
  pixabay: { name: 'Pixabay Content License', url: 'https://pixabay.com/service/license-summary/' },
  unsplash: { name: 'Unsplash License', url: 'https://unsplash.com/license' },
  ofl: { name: 'SIL Open Font License 1.1', url: 'https://openfontlicense.org' },
  mit: { name: 'MIT License', url: 'https://opensource.org/license/mit' },
  apache: { name: 'Apache License 2.0', url: 'https://www.apache.org/licenses/LICENSE-2.0' },
  gpl: { name: 'GNU GPL', url: 'https://www.gnu.org/licenses/gpl-3.0.html' },
  gfdl: { name: 'GNU Free Documentation License', url: 'https://www.gnu.org/licenses/fdl-1.3.html' },
  'other-free': { name: 'Free licence (see source)', url: '' },
  restricted: { name: 'Rights reserved or restricted', url: '' },
  unknown: { name: 'Licence not confirmed', url: '' },
};

function make(code: LicenceCode, version = '', url = '', note = ''): Licence {
  if (code in CC_URL) {
    const v = version || '4.0';
    return { code, version: v, name: `CC ${code.toUpperCase()} ${v}`, url: url || `${CC_URL[code]}${v}/`, note };
  }
  const fixed = FIXED[code] ?? { name: code, url: '' };
  return { code, version, name: fixed.name, url: url || fixed.url, note };
}

/** The Creative Commons licence in a code or name such as "by-nc-sa", "CC BY-SA 3.0" or "Attribution-NonCommercial". */
function ccFromText(text: string): { code: LicenceCode; version: string } | null {
  const t = text.toLowerCase().replace(/creative\s*commons/g, 'cc');
  // Only text that names Creative Commons, or is a bare code ("by-nc-sa", "BY 4.0"): "digitised by…" is not a licence.
  if (!/(^|[^a-z])cc([^a-z]|$)|attribution|^\s*by([- ]|$)/.test(t)) return null;
  const version = /\b([1-4]\.0|2\.5)\b/.exec(t)?.[1] ?? '';
  const words = t
    .replace(/attribution/g, ' by ')
    .replace(/non[- ]?commercial/g, ' nc ')
    .replace(/share[- ]?alike/g, ' sa ')
    .replace(/no[- ]?deriv(ative)?s?|noderivs/g, ' nd ');
  const has = (w: string) => new RegExp(`(^|[^a-z])${w}([^a-z]|$)`).test(words);
  if (!has('by')) return null;
  const parts = ['by', has('nc') ? 'nc' : '', has('sa') ? 'sa' : has('nd') ? 'nd' : ''].filter(Boolean).join('-');
  return parts in CC_URL ? { code: parts as LicenceCode, version } : null;
}

/** Reads a licence from a library's text and/or URL. */
export function parseLicence(text = '', url = '', note = ''): Licence {
  const raw = `${text} ${url}`.trim();
  const t = raw.toLowerCase();
  const u = url.trim();
  const link = /^https?:\/\//.test(u) ? u.replace(/^http:/, 'https:') : '';
  if (!t) return make('unknown', '', '', note);
  const ccUrl = /creativecommons\.org\/licenses\/([a-z-]+)\/([0-9.]+)/.exec(t);
  if (ccUrl?.[1] && ccUrl[1] in CC_URL) return make(ccUrl[1] as LicenceCode, ccUrl[2] ?? '', link || `${CC_URL[ccUrl[1]]}${ccUrl[2]}/`, note);
  if (/publicdomain\/zero|\bcc-?0\b|\bcc ?zero\b|^zero$|creative commons 0|public domain dedication/.test(t)) return make('cc0', '1.0', '', note);
  if (/publicdomain\/mark|public domain mark|\bpdm\b/.test(t)) return make('pdm', '1.0', '', note);
  if (/rightsstatements\.org\/vocab\/nkc|no known copyright|no known restrictions|nkcr/.test(t)) return make('nkr', '', link, note);
  if (/rightsstatements\.org\/vocab\/noc-us|no copyright - united states/.test(t)) return make('pd', '', link, note || 'No copyright in the United States');
  if (/rightsstatements\.org\/vocab\/noc-nc/.test(t)) return make('by-nc', '', link, note || 'No copyright, but use limited to non-commercial purposes by contract');
  if (/rightsstatements\.org\/vocab\/(inc|cne|und|nkc)/.test(t)) return make('restricted', '', link, note || text);
  if (/pd-?usgov|us government|u\.s\. government|united states government|work of the (us|united states) federal/.test(t)) return make('us-gov', '', link, note);
  if (/pexels/.test(t)) return make('pexels', '', '', note);
  if (/pixabay/.test(t)) return make('pixabay', '', '', note);
  if (/unsplash/.test(t)) return make('unsplash', '', '', note);
  if (/\bofl\b|open font licen[cs]e/.test(t)) return make('ofl', '1.1', link, note);
  if (/\bmit\b/.test(t)) return make('mit', '', link, note);
  if (/apache/.test(t)) return make('apache', '2.0', link, note);
  if (/\bgfdl\b|free documentation licen[cs]e/.test(t)) return make('gfdl', '', link, note);
  if (/\b(l?gpl|gnu general public)/.test(t)) return make('gpl', '', link, note);
  const cc = ccFromText(t);
  if (cc) return make(cc.code, cc.version, '', note);
  if (/public[ -]?domain|\bpd\b|copyright expired|no copyright|^pd-/.test(t)) return make('pd', '', link, note);
  if (/\b(isc|bsd|zlib|unlicense|wtfpl|artistic licen[cs]e|ufl|ubuntu font licen[cs]e)\b/.test(t)) return make('other-free', '', link, note || text);
  if (/all rights reserved|in copyright|standard licen[cs]e|editorial|copyrighted|permission required|^st$|^ed$/.test(t)) return make('restricted', '', link, note || text);
  return { ...make('unknown', '', link, note), name: text && text.length < 60 ? `${text} (not confirmed)` : 'Licence not confirmed' };
}

export const attribution = (l: Licence) => l.code.startsWith('by') || ['ofl', 'mit', 'apache', 'gpl', 'gfdl', 'us-gov'].includes(l.code);
export const shareAlike = (l: Licence) => l.code === 'by-sa' || l.code === 'by-nc-sa' || l.code === 'gpl' || l.code === 'gfdl';
export const nonCommercial = (l: Licence) => l.code.includes('-nc');
export const noDerivatives = (l: Licence) => l.code.endsWith('-nd');
export const isStock = (l: Licence) => l.code === 'pexels' || l.code === 'pixabay' || l.code === 'unsplash';
export const isPublicDomain = (l: Licence) => ['cc0', 'pdm', 'pd', 'us-gov', 'nkr'].includes(l.code);
export const isOpen = (l: Licence) => l.code !== 'restricted' && l.code !== 'unknown';

/** The licence filter's levels, each including the ones before. */
export const LICENCE_LEVELS: readonly { readonly id: LicenceLevel; readonly label: string }[] = [
  { id: 'pd', label: 'Public domain and CC0 only' },
  { id: 'by', label: 'Also with credit (CC BY)' },
  { id: 'by-sa', label: 'Also share-alike (CC BY-SA)' },
  { id: 'nc', label: 'Also non-commercial and no-derivatives' },
  { id: 'any', label: 'Everything, even unconfirmed' },
];

/** Whether a licence passes the filter. */
export function allowedBy(l: Licence, level: LicenceLevel, stock: boolean): boolean {
  if (isStock(l)) return stock;
  if (level === 'any') return true;
  if (isPublicDomain(l)) return true;
  if (!isOpen(l)) return false;
  const rank = { pd: 0, by: 1, 'by-sa': 2, nc: 3 }[level];
  if (nonCommercial(l) || noDerivatives(l)) return rank >= 3;
  if (shareAlike(l)) return rank >= 2;
  return rank >= 1;
}

/** What the licence lets you do, in a sentence or two. */
export function explain(l: Licence): string {
  switch (l.code) {
    case 'cc0':
      return 'No rights reserved: use it for anything, changed or not, without asking. A credit is not required but is good practice.';
    case 'pdm':
    case 'pd':
      return 'Out of copyright where the library is. Free to use for anything; check the term in India (below) for works that are not old.';
    case 'nkr':
      return 'The library knows of no copyright restrictions. Usually free to use; check the source page for privacy or publicity rights.';
    case 'us-gov':
      return 'Made by the US government, so public domain in the US. Credit the agency; logos, insignia and recognisable people have rules of their own.';
    case 'by':
      return 'Use it for anything, including ticketed shows, and change it, as long as you credit the author and name the licence with a link.';
    case 'by-sa':
      return 'As CC BY: credit the author and the licence. Anything you make from it must be shared under the same licence.';
    case 'by-nc':
      return 'Credit the author and the licence. Not for commercial use: a ticketed show, paid product or advertising may count as commercial.';
    case 'by-nc-sa':
      return 'Credit the author; not for commercial use; anything made from it must carry the same licence.';
    case 'by-nd':
      return 'Credit the author and the licence. Share it only unchanged: no crops, edits, remixes or translations in what you show.';
    case 'by-nc-nd':
      return 'Credit the author; not for commercial use; only unchanged copies. The most restrictive Creative Commons licence.';
    case 'pexels':
      return 'Free to use, also commercially, without credit. You may not sell unaltered copies, imply endorsement by people shown, or show them in a bad light.';
    case 'pixabay':
      return 'Free to use without credit. Do not sell or redistribute it unaltered, and check trademarks, brands and recognisable people shown.';
    case 'unsplash':
      return 'Free to use without credit. You may not sell unaltered copies or use the photos to build a similar photo service.';
    case 'ofl':
      return 'Use the font for anything, including print, signs and logos. You may not sell the font files on their own; changed versions must keep the licence and use another name.';
    case 'mit':
    case 'apache':
      return 'Use it for anything; keep the copyright and licence notice with copies of the files.';
    case 'gpl':
    case 'gfdl':
      return 'Free to use and change; copies and changed versions must keep the same licence and its notice.';
    case 'other-free':
      return 'A free licence the app does not know by name. Read it on the source page.';
    case 'restricted':
      return 'Rights are reserved or limited. Do not use it without permission from the rights holder.';
    default:
      return 'The library gives no clear licence. Read the source page, and do not use it in public until you are sure.';
  }
}

export const USES: readonly { readonly id: AssetUse; readonly label: string }[] = [
  { id: 'free', label: 'Free exhibit or event' },
  { id: 'ticketed', label: 'Ticketed show' },
  { id: 'print', label: 'Print or products for sale' },
  { id: 'web', label: 'Website or social media' },
  { id: 'internal', label: 'Internal or study use' },
];

export interface UseCheck {
  readonly level: 'ok' | 'note' | 'warn' | 'stop';
  readonly text: string;
}

/** Problems with using an asset under this licence for `use`, worst first. */
export function checkUse(l: Licence, use: AssetUse, willChange = false): UseCheck[] {
  const out: UseCheck[] = [];
  if (!isOpen(l))
    out.push({ level: 'stop', text: l.code === 'restricted' ? 'Rights are reserved: ask the rights holder first.' : 'The licence is not confirmed: check the source page before public use.' });
  if (nonCommercial(l) && (use === 'ticketed' || use === 'print')) out.push({ level: 'stop', text: 'NonCommercial: not for a ticketed show or products for sale.' });
  else if (nonCommercial(l) && use === 'web') out.push({ level: 'warn', text: 'NonCommercial: fine on a museum website, but not in advertising or on a page that sells tickets.' });
  if (noDerivatives(l)) out.push({ level: willChange ? 'stop' : 'warn', text: 'NoDerivatives: show it whole and unchanged (no crops, overlays or translations).' });
  if (shareAlike(l)) out.push({ level: 'note', text: 'ShareAlike: if you change it, share your version under the same licence.' });
  if (isStock(l) && use === 'print') out.push({ level: 'warn', text: 'Stock licence: a print or product must add something; selling the photo itself, unaltered, is not allowed.' });
  if (l.code === 'us-gov') out.push({ level: 'note', text: 'US government work: do not use agency logos or imply endorsement.' });
  if (attribution(l) && use !== 'internal') out.push({ level: 'note', text: 'Credit needed: put the credit line near the asset or in the credits.' });
  if (out.length === 0) out.push({ level: 'ok', text: 'Fine for this use.' });
  const rank = { stop: 0, warn: 1, note: 2, ok: 3 };
  return out.sort((a, b) => rank[a.level] - rank[b.level]);
}

export interface CreditInput {
  readonly title: string;
  readonly creator: string;
  readonly page: string;
  readonly sourceName: string;
  readonly licence: Licence;
}

/** A credit line in the Creative Commons "title, author, source, licence" form. */
export function creditLine(a: CreditInput): string {
  const title = a.title && a.title !== 'Untitled' ? `“${a.title}”` : 'Untitled';
  const by = a.creator ? ` by ${a.creator}` : '';
  const licence = a.licence.url ? `${a.licence.name} (${a.licence.url})` : a.licence.name;
  const verb = isPublicDomain(a.licence) ? 'is in the public domain' : isStock(a.licence) ? `is used under the ${licence}` : `is licensed under ${licence}`;
  const where = a.page ? `${a.sourceName}, ${a.page}` : a.sourceName;
  return a.licence.code === 'cc0' || a.licence.code === 'pdm' || a.licence.code === 'pd' ? `${title}${by}, ${where}. ${a.licence.name}.` : `${title}${by}, ${where}, ${verb}.`;
}

/** A short line for panels and end credits. */
export const shortCredit = (a: CreditInput) => [a.title, a.creator, a.sourceName, a.licence.name].filter((s) => s && s !== 'Untitled').join(' · ');

export interface IndiaCheck {
  readonly status: 'licensed' | 'free' | 'likely' | 'check';
  readonly text: string;
}

/**
 * Whether a public-domain work is also out of copyright in India (Copyright Act
 * 1957, as amended in 2012): literary, dramatic, musical and artistic works,
 * photographs included, for the author's life and 60 years; films, sound
 * recordings, anonymous, posthumous and government works for 60 years from
 * publication.  Terms run to the end of the calendar year.
 */
export function indiaCheck(l: Licence, kind: 'film' | 'sound' | 'other', deathYear?: number, year?: number, now = new Date().getFullYear()): IndiaCheck {
  if (!isPublicDomain(l)) {
    return isOpen(l) ? { status: 'licensed', text: 'The licence itself allows use in India; no copyright term to check.' } : { status: 'check', text: 'No licence to rely on; ask the rights holder.' };
  }
  if (l.code === 'cc0') return { status: 'licensed', text: 'CC0 waives copyright worldwide, India included.' };
  const last = now - 61;
  if (kind === 'film' || kind === 'sound') {
    if (year && year <= last)
      return { status: 'free', text: `Published in ${year}: ${kind === 'film' ? 'films' : 'sound recordings'} are protected in India for 60 years from publication, so this one is free.` };
    if (year)
      return {
        status: 'check',
        text: `Published in ${year}: in India ${kind === 'film' ? 'films' : 'sound recordings'} stay protected until the end of ${year + 60}. Public domain elsewhere is not enough here.`,
      };
    return { status: 'check', text: 'No publication year: in India films and recordings are protected for 60 years from publication. Check before a public show.' };
  }
  if (deathYear && deathYear <= last) return { status: 'free', text: `The author died in ${deathYear}: protected in India for life plus 60 years, so it is free now.` };
  if (deathYear) return { status: 'check', text: `The author died in ${deathYear}: in India the work stays protected until the end of ${deathYear + 60}.` };
  if (year && year <= now - 140)
    return { status: 'likely', text: `Made around ${year}: almost certainly out of copyright in India (life plus 60 years), though the author's death year is not known.` };
  if (l.code === 'us-gov') return { status: 'check', text: 'A US government work: free in the US; agencies such as NASA allow use worldwide, but India has no special rule for it.' };
  return { status: 'check', text: 'The author’s death year is not known: in India works are protected for life plus 60 years (photographs too, since 2012).' };
}
