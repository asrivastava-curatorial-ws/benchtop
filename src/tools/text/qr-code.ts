import { hexOf, isColor } from '../../lib/color';
import { ToolError } from '../../lib/errors';
import { defineTextTool, type Values } from '../types';

const kind = (value: string) => (v: Values) => v.kind === value;

/** Escapes \ ; , : and " for Wi-Fi and MECARD records. */
export const escapeRecord = (text: string): string => text.replace(/([;,:"])/g, '\\$1');

/** The text a QR code holds for each kind of content. */
export function qrPayload(o: Record<string, string | boolean>): string {
  const s = (key: string) => String(o[key] ?? '').trim();
  switch (o.kind) {
    case 'wifi':
      if (s('ssid') === '') throw new ToolError('Enter the network name (SSID).');
      return `WIFI:T:${o.security === 'nopass' ? 'nopass' : o.security};S:${escapeRecord(s('ssid'))};${o.security === 'nopass' ? '' : `P:${escapeRecord(String(o.password ?? ''))};`}${o.hidden ? 'H:true;' : ''};`;
    case 'upi': {
      if (!/^[\w.-]+@[\w.-]+$/.test(s('vpa'))) throw new ToolError('Enter a UPI ID such as name@bank.');
      const params = new URLSearchParams({ pa: s('vpa'), pn: s('payee') });
      if (s('amount') !== '') params.set('am', Number(s('amount')).toFixed(2));
      params.set('cu', 'INR');
      if (s('note') !== '') params.set('tn', s('note'));
      return `upi://pay?${params.toString().replace(/\+/g, '%20')}`;
    }
    case 'email':
      return `mailto:${s('to')}${s('subject') || s('body') ? `?${[s('subject') && `subject=${encodeURIComponent(s('subject'))}`, s('body') && `body=${encodeURIComponent(s('body'))}`].filter(Boolean).join('&')}` : ''}`;
    case 'sms':
      return `SMSTO:${s('phone')}:${s('message')}`;
    case 'tel':
      return `tel:${s('phone').replace(/[^\d+]/g, '')}`;
    case 'geo':
      return `geo:${s('lat')},${s('lon')}`;
    case 'vcard':
      return [
        'BEGIN:VCARD',
        'VERSION:3.0',
        `N:${s('lastName')};${s('firstName')}`,
        `FN:${`${s('firstName')} ${s('lastName')}`.trim()}`,
        s('org') && `ORG:${s('org')}`,
        s('title') && `TITLE:${s('title')}`,
        s('phone') && `TEL;TYPE=CELL:${s('phone')}`,
        s('to') && `EMAIL:${s('to')}`,
        s('url') && `URL:${s('url')}`,
        'END:VCARD',
      ]
        .filter(Boolean)
        .join('\n');
    default:
      if (s('text') === '') throw new ToolError('Enter the text or address to encode.');
      return s('text');
  }
}

export default defineTextTool({
  input: false,
  output: { label: 'SVG', language: 'xml' },
  options: [
    {
      key: 'kind',
      label: 'Content',
      type: 'select',
      choices: [
        { value: 'text', label: 'Text or web address' },
        { value: 'wifi', label: 'Wi-Fi network' },
        { value: 'upi', label: 'UPI payment' },
        { value: 'vcard', label: 'Contact card' },
        { value: 'email', label: 'Email' },
        { value: 'sms', label: 'Text message' },
        { value: 'tel', label: 'Phone call' },
        { value: 'geo', label: 'Map location' },
      ],
      default: 'text',
    },
    { key: 'text', label: 'Text or address', type: 'text', default: 'https://example.org/', wide: true, multiline: true, showIf: kind('text') },
    { key: 'ssid', label: 'Network name (SSID)', type: 'text', default: 'Museum-Guest', showIf: kind('wifi') },
    {
      key: 'security',
      label: 'Security',
      type: 'select',
      choices: [
        { value: 'WPA', label: 'WPA / WPA2 / WPA3' },
        { value: 'WEP', label: 'WEP' },
        { value: 'nopass', label: 'None (open)' },
      ],
      default: 'WPA',
      showIf: kind('wifi'),
    },
    { key: 'password', label: 'Password', type: 'text', default: '', secret: true, showIf: (v) => v.kind === 'wifi' && v.security !== 'nopass' },
    { key: 'hidden', label: 'Hidden network', type: 'toggle', default: false, showIf: kind('wifi') },
    { key: 'vpa', label: 'UPI ID', type: 'text', default: '', placeholder: 'name@bank', mono: true, showIf: kind('upi') },
    { key: 'payee', label: 'Payee name', type: 'text', default: '', showIf: kind('upi') },
    { key: 'amount', label: 'Amount (₹, optional)', type: 'text', default: '', showIf: kind('upi') },
    { key: 'note', label: 'Note', type: 'text', default: '', showIf: kind('upi') },
    { key: 'firstName', label: 'First name', type: 'text', default: '', showIf: kind('vcard') },
    { key: 'lastName', label: 'Last name', type: 'text', default: '', showIf: kind('vcard') },
    { key: 'org', label: 'Organisation', type: 'text', default: '', showIf: kind('vcard') },
    { key: 'title', label: 'Job title', type: 'text', default: '', showIf: kind('vcard') },
    { key: 'to', label: 'Email address', type: 'text', default: '', showIf: (v) => v.kind === 'email' || v.kind === 'vcard' },
    { key: 'subject', label: 'Subject', type: 'text', default: '', showIf: kind('email') },
    { key: 'body', label: 'Message', type: 'text', default: '', multiline: true, showIf: kind('email') },
    { key: 'phone', label: 'Phone number', type: 'text', default: '', showIf: (v) => v.kind === 'sms' || v.kind === 'tel' || v.kind === 'vcard' },
    { key: 'message', label: 'Message', type: 'text', default: '', showIf: kind('sms') },
    { key: 'url', label: 'Website', type: 'text', default: '', showIf: kind('vcard') },
    { key: 'lat', label: 'Latitude', type: 'text', default: '12.9716', showIf: kind('geo') },
    { key: 'lon', label: 'Longitude', type: 'text', default: '77.5946', showIf: kind('geo') },
    {
      key: 'ecc',
      label: 'Error correction',
      type: 'select',
      choices: [
        { value: 'L', label: 'Low (7%)' },
        { value: 'M', label: 'Medium (15%)' },
        { value: 'Q', label: 'Quartile (25%)' },
        { value: 'H', label: 'High (30%, survives a logo)' },
      ],
      default: 'M',
    },
    { key: 'scale', label: 'Module size', type: 'range', default: 6, min: 1, max: 20, step: 1, unit: 'px' },
    { key: 'foreground', label: 'Modules', type: 'color', default: '#000000' },
    { key: 'background', label: 'Background', type: 'color', default: '#ffffff' },
  ],
  runOnEmpty: true,
  async run(_input, o) {
    if (!isColor(o.foreground) || !isColor(o.background)) throw new ToolError('The colours must be valid CSS colours.');
    const payload = qrPayload(o as unknown as Record<string, string | boolean>);
    const { toSVG } = await import('bwip-js/generic');
    let svg: string;
    try {
      // eclevel is a BWIPP option that the bwip-js type definitions leave out.
      const options = {
        bcid: 'qrcode',
        text: payload,
        scale: o.scale,
        eclevel: o.ecc,
        barcolor: hexOf(o.foreground).slice(1),
        backgroundcolor: hexOf(o.background).slice(1),
        paddingwidth: 4,
        paddingheight: 4,
      };
      svg = toSVG(options as Parameters<typeof toSVG>[0]);
    } catch (error) {
      throw new ToolError((error instanceof Error ? error.message : String(error)).replace(/^(?:bwipp|bwip-js)\.[\w-]+(?:#\d+)?:\s*/, ''));
    }
    const size = /viewBox="0 0 (\d+) (\d+)"/.exec(svg);
    const sized = size ? svg.replace('<svg ', `<svg width="${size[1]}" height="${size[2]}" `) : svg;
    return {
      output: sized,
      preview: { kind: 'svg', svg: sized },
      fields: [{ label: 'Encoded text', value: payload, mono: true }, ...(size ? [{ label: 'Size', value: `${size[1]} × ${size[2]} px` }] : [])],
      filename: `qr-${o.kind}.svg`,
    };
  },
});
