/** Recognises what a decoded QR code holds: Wi-Fi details, contacts, links and so on. */
import { parseOtpAuthUri } from './totp';

export interface QrContent {
  readonly kind: string;
  readonly fields: readonly (readonly [string, string])[];
  readonly warnings: readonly string[];
}

/** Splits `KEY:value;KEY:value;;` records where \ escapes ; , : and \ (Wi-Fi and MECARD). */
export function parseRecord(body: string): [string, string][] {
  const fields: [string, string][] = [];
  let key = '';
  let value = '';
  let inKey = true;
  for (let i = 0; i < body.length; i++) {
    const char = body[i] as string;
    if (char === '\\' && i + 1 < body.length) {
      if (inKey) key += body[++i];
      else value += body[++i];
    } else if (inKey && char === ':') {
      inKey = false;
    } else if (inKey && char === ';') {
      // An empty field, such as the ";;" that ends a record.
      key = '';
    } else if (!inKey && char === ';') {
      fields.push([key, value]);
      key = '';
      value = '';
      inKey = true;
    } else if (inKey) {
      key += char;
    } else {
      value += char;
    }
  }
  if (!inKey || key !== '') fields.push([key, value]);
  return fields.filter(([k]) => k !== '');
}

const WIFI_SECURITY: Record<string, string> = {
  WPA: 'WPA/WPA2/WPA3 (password)',
  WPA2: 'WPA2 (password)',
  WPA3: 'WPA3 (password)',
  SAE: 'WPA3 (password)',
  WEP: 'WEP (obsolete)',
  nopass: 'Open network (no password)',
  '': 'Open network (no password)',
};

function wifi(text: string): QrContent {
  const record = new Map(parseRecord(text.slice(5)).map(([k, v]) => [k.toUpperCase(), v]));
  const security = record.get('T') ?? '';
  const fields: [string, string][] = [['Network name (SSID)', record.get('S') ?? '']];
  fields.push(['Security', WIFI_SECURITY[security] ?? security]);
  if (record.has('P')) fields.push(['Password', record.get('P') ?? '']);
  if (record.get('H')?.toLowerCase() === 'true') fields.push(['Hidden network', 'Yes']);
  if (record.has('E')) fields.push(['EAP method', record.get('E') ?? '']);
  if (record.has('I')) fields.push(['Identity', record.get('I') ?? '']);
  return {
    kind: 'Wi-Fi network',
    fields,
    warnings: security === 'WEP' ? ['WEP encryption can be broken in minutes.'] : security === 'nopass' ? ['Traffic on open networks can be read by others nearby.'] : [],
  };
}

/** Joins folded vCard / iCalendar lines and returns [name, parameters, value] triples. */
function contentLines(text: string): [string, string, string][] {
  const unfolded = text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '');
  const lines: [string, string, string][] = [];
  for (const line of unfolded.split('\n')) {
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    const head = line.slice(0, colon);
    const [name = '', ...params] = head.split(';');
    lines.push([
      name.toUpperCase().replace(/^ITEM\d+\./, ''),
      params.join(';'),
      line
        .slice(colon + 1)
        .replace(/\\n/gi, '\n')
        .replace(/\\([,;\\])/g, '$1'),
    ]);
  }
  return lines;
}

const VCARD_LABELS: Record<string, string> = { FN: 'Name', ORG: 'Organisation', TITLE: 'Job title', TEL: 'Phone', EMAIL: 'Email', URL: 'Website', ADR: 'Address', NOTE: 'Note', BDAY: 'Birthday' };
const EVENT_LABELS: Record<string, string> = { SUMMARY: 'Title', DTSTART: 'Starts', DTEND: 'Ends', LOCATION: 'Location', DESCRIPTION: 'Description', URL: 'Link' };

function formatIcsDate(value: string): string {
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(value);
  if (!match) return value;
  const [, y, mo, d, h, mi, s, z] = match;
  return h ? `${y}-${mo}-${d} ${h}:${mi}${s ? `:${s}` : ''}${z ? ' UTC' : ''}` : `${y}-${mo}-${d}`;
}

function vcard(text: string): QrContent {
  const fields: [string, string][] = [];
  for (const [name, params, value] of contentLines(text)) {
    const label = VCARD_LABELS[name];
    if (!label || value.trim() === '') continue;
    const type = /TYPE=([^;:]+)/i.exec(params)?.[1]?.toLowerCase();
    const shown = name === 'ADR' || name === 'ORG' ? value.split(';').filter(Boolean).join(', ') : value;
    fields.push([type ? `${label} (${type})` : label, shown]);
  }
  return { kind: 'Contact card (vCard)', fields, warnings: [] };
}

function mecard(text: string): QrContent {
  const labels: Record<string, string> = { N: 'Name', TEL: 'Phone', EMAIL: 'Email', URL: 'Website', ADR: 'Address', NOTE: 'Note', ORG: 'Organisation', BDAY: 'Birthday' };
  const fields = parseRecord(text.slice(7)).map(([k, v]) => [labels[k.toUpperCase()] ?? k, k.toUpperCase() === 'N' ? v.split(',').reverse().join(' ').trim() : v] as [string, string]);
  return { kind: 'Contact card (MECARD)', fields, warnings: [] };
}

function event(text: string): QrContent {
  const fields: [string, string][] = [];
  for (const [name, , value] of contentLines(text)) {
    const label = EVENT_LABELS[name];
    if (label && value.trim() !== '') fields.push([label, name.startsWith('DT') ? formatIcsDate(value) : value]);
  }
  return { kind: 'Calendar event', fields, warnings: [] };
}

function link(text: string): QrContent {
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    return { kind: 'Text', fields: [], warnings: [] };
  }
  const warnings: string[] = [];
  if (url.protocol === 'http:') warnings.push('This link is not encrypted (http, not https).');
  if (url.hostname.split('.').some((label) => label.startsWith('xn--'))) warnings.push(`The address uses an internationalised domain (${url.hostname}); check it is not a look-alike.`);
  if (url.username || url.password) warnings.push('The link contains a user name or password before the host, a trick used to disguise addresses.');
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(url.hostname)) warnings.push('The link points at a bare IP address instead of a domain name.');
  return {
    kind: 'Web address',
    fields: [['Host', url.hostname], ['Path', decodeURIComponent(url.pathname)], ...(url.search ? [['Query', url.search.slice(1)] as [string, string]] : [])],
    warnings,
  };
}

export function describeQrContent(text: string): QrContent {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();
  if (lower.startsWith('wifi:')) return wifi(trimmed);
  if (lower.startsWith('begin:vcard')) return vcard(trimmed);
  if (lower.startsWith('mecard:')) return mecard(trimmed);
  if (lower.startsWith('begin:vevent') || lower.startsWith('begin:vcalendar')) return event(trimmed);
  if (lower.startsWith('otpauth://')) {
    try {
      const info = parseOtpAuthUri(trimmed);
      return {
        kind: 'Two-factor set-up link (TOTP)',
        fields: [
          ['Issuer', info.issuer],
          ['Account', info.account],
          ['Algorithm', info.algorithm],
          ['Digits', String(info.digits)],
          ['Period', `${info.period} s`],
          ['Secret', `${info.secret.replace(/[\s=]/g, '').length} characters (open the TOTP tool to use it)`],
        ],
        warnings: ['This code holds a two-factor secret. Anyone who sees it can generate your sign-in codes.'],
      };
    } catch (error) {
      return { kind: 'Two-factor set-up link', fields: [], warnings: [error instanceof Error ? error.message : String(error)] };
    }
  }
  if (lower.startsWith('mailto:')) {
    const [address = '', query = ''] = trimmed.slice(7).split('?');
    const params = new URLSearchParams(query);
    const fields: [string, string][] = [['To', decodeURIComponent(address)]];
    for (const key of ['subject', 'body', 'cc', 'bcc']) {
      const value = params.get(key);
      if (value) fields.push([key[0]?.toUpperCase() + key.slice(1), value]);
    }
    return { kind: 'Email', fields, warnings: [] };
  }
  if (lower.startsWith('tel:')) return { kind: 'Phone number', fields: [['Number', trimmed.slice(4)]], warnings: [] };
  if (lower.startsWith('smsto:') || lower.startsWith('sms:')) {
    const rest = trimmed.slice(trimmed.indexOf(':') + 1);
    const [number = '', message = ''] = lower.startsWith('smsto:') ? rest.split(/:(.*)/s, 2) : [rest.split('?')[0] ?? '', new URLSearchParams(rest.split('?')[1] ?? '').get('body') ?? ''];
    return { kind: 'Text message', fields: [['To', number], ...(message ? [['Message', message] as [string, string]] : [])], warnings: [] };
  }
  if (lower.startsWith('geo:')) {
    const [lat = '', lon = ''] = trimmed.slice(4).split(/[;?]/)[0]?.split(',') ?? [];
    return {
      kind: 'Map location',
      fields: [
        ['Latitude', lat],
        ['Longitude', lon],
      ],
      warnings: [],
    };
  }
  if (/^https?:\/\//i.test(trimmed)) return link(trimmed);
  return { kind: 'Text', fields: [], warnings: [] };
}
