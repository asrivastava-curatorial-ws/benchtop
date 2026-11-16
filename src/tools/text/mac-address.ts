import { randomBytes, toHex } from '../../lib/bytes';
import { ToolError } from '../../lib/errors';
import { defineTextTool, type Field } from '../types';

export interface Vendor {
  readonly prefix: string;
  readonly name: string;
  readonly country: string;
}

/** Parses the bundled "prefix<TAB>name<TAB>country" table. */
export function parseOuiTable(text: string): Map<string, Vendor> {
  const table = new Map<string, Vendor>();
  for (const line of text.split('\n')) {
    const [prefix, name, country] = line.split('\t');
    if (prefix && name) table.set(prefix, { prefix, name, country: country ?? '' });
  }
  return table;
}

let loaded: Promise<Map<string, Vendor>> | null = null;

/** The bundled IEEE registry, or null when it cannot be read (the rest of the tool still works). */
async function vendors(): Promise<Map<string, Vendor> | null> {
  loaded ??= (async () => {
    const [{ default: url }, { gunzipSync }] = await Promise.all([import('../../data/oui.tsv.gz?url'), import('fflate')]);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    // Some servers decompress .gz files on the way; only inflate real gzip data.
    return parseOuiTable(new TextDecoder().decode(bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : bytes));
  })();
  try {
    return await loaded;
  } catch {
    loaded = null;
    return null;
  }
}

/** Longest registered prefix (MA-S 36 bits, MA-M 28 bits, MA-L 24 bits) for a MAC address in hex. */
export function lookupVendor(table: Map<string, Vendor>, hex: string): Vendor | undefined {
  return table.get(hex.slice(0, 9)) ?? table.get(hex.slice(0, 7)) ?? table.get(hex.slice(0, 6));
}

export function formatMac(hex: string, style: string): string {
  const pairs = hex.match(/../g) ?? [];
  switch (style) {
    case 'dash':
      return pairs.join('-');
    case 'cisco':
      return (hex.match(/.{4}/g) ?? []).join('.');
    case 'bare':
      return hex;
    default:
      return pairs.join(':');
  }
}

/** fe80:: address made from a MAC with modified EUI-64 (RFC 4291 appendix A). */
export function eui64LinkLocal(hex: string): string {
  const flipped = (Number.parseInt(hex.slice(0, 2), 16) ^ 0x02).toString(16).padStart(2, '0');
  const eui = `${flipped}${hex.slice(2, 6)}fffe${hex.slice(6, 12)}`;
  return `fe80::${(eui.match(/.{4}/g) ?? []).map((group) => group.replace(/^0+(?=.)/, '')).join(':')}`;
}

export default defineTextTool({
  input: false,
  output: { label: 'Addresses' },
  options: [
    {
      key: 'mode',
      label: 'Tool',
      type: 'segmented',
      choices: [
        { value: 'lookup', label: 'Look up' },
        { value: 'generate', label: 'Generate' },
      ],
      default: 'lookup',
    },
    { key: 'mac', label: 'MAC address', type: 'text', default: '3c:22:fb:12:34:56', mono: true, wide: true, showIf: (v) => v.mode === 'lookup' },
    { key: 'count', label: 'How many', type: 'number', default: 5, min: 1, max: 1000, step: 1, showIf: (v) => v.mode === 'generate' },
    { key: 'prefix', label: 'Start with', type: 'text', default: '', mono: true, placeholder: 'Optional vendor prefix, e.g. 00:1A:2B', showIf: (v) => v.mode === 'generate' },
    {
      key: 'local',
      label: 'Locally administered',
      type: 'toggle',
      default: true,
      help: 'Sets the bit that marks an address as not assigned by a manufacturer, so it cannot clash with real hardware.',
      showIf: (v) => v.mode === 'generate',
    },
    {
      key: 'style',
      label: 'Format',
      type: 'select',
      choices: [
        { value: 'colon', label: '00:1a:2b:3c:4d:5e' },
        { value: 'dash', label: '00-1a-2b-3c-4d-5e' },
        { value: 'cisco', label: '001a.2b3c.4d5e' },
        { value: 'bare', label: '001a2b3c4d5e' },
      ],
      default: 'colon',
    },
    { key: 'upper', label: 'Uppercase', type: 'toggle', default: false },
  ],
  action: 'Run',
  runOnEmpty: true,
  async run(_input, o) {
    const shape = (hex: string) => {
      const text = formatMac(hex, o.style);
      return o.upper ? text.toUpperCase() : text.toLowerCase();
    };
    if (o.mode === 'generate') {
      const prefix = o.prefix.replace(/[^0-9a-f]/gi, '').toLowerCase();
      if (prefix.length > 10 || prefix.length % 2 === 1) throw new ToolError('The prefix must be whole bytes (an even number of hex digits, at most 5 bytes).');
      const out: string[] = [];
      for (let i = 0; i < o.count; i++) {
        let hex = (prefix + toHex(randomBytes(6))).slice(0, 12);
        if (prefix.length === 0) {
          let first = Number.parseInt(hex.slice(0, 2), 16) & 0xfe;
          first = o.local ? first | 0x02 : first & 0xfd;
          hex = first.toString(16).padStart(2, '0') + hex.slice(2);
        }
        out.push(shape(hex));
      }
      return { output: out.join('\n') };
    }
    const hex = o.mac.replace(/[^0-9a-f]/gi, '').toLowerCase();
    if (hex.length !== 12) throw new ToolError('A MAC address has 12 hexadecimal digits.');
    const first = Number.parseInt(hex.slice(0, 2), 16);
    const local = (first & 0x02) !== 0;
    const multicast = (first & 0x01) !== 0;
    const table = local ? null : await vendors();
    const vendor = table ? lookupVendor(table, hex.toUpperCase()) : undefined;
    const fields: Field[] = [
      {
        label: 'Vendor',
        value: vendor ? vendor.name : local ? 'None: locally administered (random or virtual)' : table ? 'Not in the IEEE registry' : 'Unknown: the vendor list could not be loaded',
        tone: vendor ? 'ok' : 'muted',
      },
      ...(vendor?.country ? [{ label: 'Registered in', value: vendor.country } as Field] : []),
      ...(vendor
        ? [{ label: 'Assignment block', value: `${vendor.prefix.length === 6 ? 'MA-L (24-bit)' : vendor.prefix.length === 7 ? 'MA-M (28-bit)' : 'MA-S (36-bit)'} ${vendor.prefix}` } as Field]
        : []),
      { label: 'Type', value: `${multicast ? 'Multicast' : 'Unicast'}, ${local ? 'locally administered' : 'globally unique (OUI)'}` },
      { label: 'Formats', value: ['colon', 'dash', 'cisco', 'bare'].map((style) => formatMac(hex, style)).join('  '), mono: true },
      { label: 'IPv6 link-local (EUI-64)', value: eui64LinkLocal(hex), mono: true },
    ];
    return { output: shape(hex), fields, info: 'Vendor data: IEEE MA-L, MA-M and MA-S registries, bundled with the app.' };
  },
});
