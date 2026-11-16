import { ToolError } from '../../lib/errors';
import { esc, formatMs, heading, html, note, pairs, pill, report, type Tone, table } from '../../lib/net/report';
import { defineTextTool, type Field } from '../types';

/** Header fields in order, with folded lines joined (RFC 5322). Stops at the first blank line. */
export function parseHeaders(text: string): [string, string][] {
  const fields: [string, string][] = [];
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (line.trim() === '') {
      if (fields.length > 0) break;
      continue;
    }
    if (/^[ \t]/.test(line) && fields.length > 0) {
      const last = fields[fields.length - 1] as [string, string];
      last[1] += ` ${line.trim()}`;
      continue;
    }
    const colon = line.indexOf(':');
    if (colon <= 0) continue;
    fields.push([line.slice(0, colon).trim(), line.slice(colon + 1).trim()]);
  }
  return fields;
}

/** Decodes RFC 2047 encoded words such as =?UTF-8?B?…?= and =?utf-8?Q?…?=. */
export function decodeWords(value: string): string {
  return value.replace(/=\?([^?]+)\?([bq])\?([^?]*)\?=(\s+(?==\?))?/gi, (_, charset: string, encoding: string, data: string) => {
    try {
      let bytes: Uint8Array;
      if (encoding.toLowerCase() === 'b') bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
      else {
        const text = data.replace(/_/g, ' ').replace(/=([0-9a-f]{2})/gi, (__, hex: string) => String.fromCharCode(parseInt(hex, 16)));
        bytes = Uint8Array.from(text, (char) => char.charCodeAt(0));
      }
      return new TextDecoder(charset).decode(bytes);
    } catch {
      return data;
    }
  });
}

export interface Hop {
  readonly from?: string;
  readonly by?: string;
  readonly with?: string;
  readonly date?: Date;
  readonly raw: string;
}

/** Received: headers, oldest first (they are added at the top as mail travels). */
export function receivedHops(fields: readonly [string, string][]): Hop[] {
  return fields
    .filter(([name]) => name.toLowerCase() === 'received')
    .map(([, value]) => {
      const semicolon = value.lastIndexOf(';');
      const dateText = semicolon >= 0 ? value.slice(semicolon + 1).trim() : '';
      const parsed = Date.parse(dateText.replace(/\s*\([^)]*\)\s*$/, ''));
      const part = (keyword: string) => new RegExp(`\\b${keyword}\\s+([^\\s;]+(?:\\s*\\([^)]*\\))?)`, 'i').exec(value)?.[1];
      return { from: part('from'), by: part('by'), with: /\bwith\s+([A-Z0-9]+)/i.exec(value)?.[1], date: Number.isNaN(parsed) ? undefined : new Date(parsed), raw: value };
    })
    .reverse();
}

export interface AuthResult {
  readonly method: string;
  readonly result: string;
  readonly detail: string;
}

/** spf=pass, dkim=fail … from Authentication-Results and ARC-Authentication-Results. */
export function authResults(fields: readonly [string, string][]): AuthResult[] {
  const results: AuthResult[] = [];
  for (const [name, value] of fields) {
    if (!/^(arc-)?authentication-results$/i.test(name)) continue;
    for (const part of value.split(';').slice(1)) {
      const match = /^\s*(spf|dkim|dmarc|arc|bimi|compauth|dkim-atps)\s*=\s*([a-z]+)\s*(.*)$/i.exec(part);
      if (match) results.push({ method: (match[1] as string).toLowerCase(), result: (match[2] as string).toLowerCase(), detail: (match[3] as string).trim() });
    }
    if (results.length > 0 && !/^arc-/i.test(name)) break;
  }
  return results;
}

const resultTone = (result: string): Tone =>
  result === 'pass' ? 'ok' : ['fail', 'permerror', 'hardfail'].includes(result) ? 'bad' : ['softfail', 'neutral', 'none', 'temperror', 'policy'].includes(result) ? 'warn' : 'muted';

export default defineTextTool({
  input: {
    label: 'Message headers',
    placeholder: 'Paste the full headers of a message ("Show original" or "View source" in your mail program).',
    language: 'text',
    sample: [
      'Received: from mail.example.org (mail.example.org [198.51.100.25])',
      '\tby mx.example.com with ESMTPS id a1b2c3; Mon, 16 Nov 2026 09:15:42 +0530',
      'Received: from [192.0.2.10] (unknown [192.0.2.10])',
      '\tby mail.example.org with ESMTPSA id d4e5f6; Mon, 16 Nov 2026 09:15:40 +0530',
      'Authentication-Results: mx.example.com;',
      '\tspf=pass smtp.mailfrom=example.org;',
      '\tdkim=pass header.d=example.org header.s=mail;',
      '\tdmarc=pass header.from=example.org',
      'From: Asha Rao <asha@example.org>',
      'To: Ravi Kumar <ravi@example.com>',
      'Subject: =?UTF-8?Q?Gallery_lighting_=E2=80=93_revised_plan?=',
      'Date: Mon, 16 Nov 2026 09:15:38 +0530',
      'Message-ID: <20261116091538.12345@mail.example.org>',
      'Return-Path: <asha@example.org>',
    ].join('\n'),
  },
  output: false,
  options: [],
  mainThread: false,
  run(input) {
    const fields = parseHeaders(input);
    if (fields.length === 0) throw new ToolError('No header fields found. Paste the headers starting with lines like "Received:" or "From:".');
    const get = (name: string) => fields.find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1];
    const hops = receivedHops(fields);
    const auth = authResults(fields);
    const result: Field[] = [];
    for (const name of ['From', 'To', 'Subject', 'Date', 'Message-ID', 'Return-Path', 'Reply-To']) {
      const value = get(name);
      if (value) result.push({ label: name, value: decodeWords(value), mono: name === 'Message-ID' || name === 'Return-Path' });
    }
    const delays = hops.map((hop, index) => {
      const previous = hops[index - 1]?.date;
      return hop.date && previous ? hop.date.getTime() - previous.getTime() : undefined;
    });
    const dated = hops.filter((hop) => hop.date);
    const total = dated.length >= 2 ? (dated[dated.length - 1]?.date?.getTime() ?? 0) - (dated[0]?.date?.getTime() ?? 0) : undefined;
    result.push({ label: 'Hops', value: String(hops.length) });
    if (total !== undefined) result.push({ label: 'Delivery time', value: formatMs(total), tone: total > 10 * 60_000 ? 'warn' : 'ok' });
    for (const method of ['spf', 'dkim', 'dmarc']) {
      const found = auth.find((item) => item.method === method);
      result.push({
        label: method.toUpperCase(),
        value: found ? found.result : 'not reported',
        tone: found ? (resultTone(found.result) === 'info' ? 'muted' : (resultTone(found.result) as 'ok' | 'warn' | 'bad' | 'muted')) : 'muted',
      });
    }
    const fromDomain = /@([^>\s]+)/.exec(get('From') ?? '')?.[1]?.toLowerCase();
    const returnDomain = /@([^>\s]+)/.exec(get('Return-Path') ?? '')?.[1]?.toLowerCase();
    const warnings: string[] = [];
    if (fromDomain && returnDomain && !returnDomain.endsWith(fromDomain) && !fromDomain.endsWith(returnDomain))
      warnings.push(`The Return-Path domain (${returnDomain}) differs from the From domain (${fromDomain}); common for mailing services, but also for spoofed mail.`);
    if (delays.some((delay) => delay !== undefined && delay < -60_000)) warnings.push('Some hops have clocks that run backwards; times between them are unreliable.');
    return {
      fields: result,
      warnings,
      preview: {
        kind: 'html',
        html: report(
          heading('Route'),
          hops.length === 0
            ? note('No Received headers.')
            : table(
                ['#', 'From', 'By', 'With', 'Time (UTC)', 'Delay'],
                hops.map((hop, index) => [
                  index + 1,
                  html(`<code>${esc(hop.from ?? '')}</code>`),
                  html(`<code>${esc(hop.by ?? '')}</code>`),
                  hop.with ?? '',
                  hop.date ? hop.date.toISOString().replace('T', ' ').slice(0, 19) : '',
                  delays[index] !== undefined ? html(pill(formatMs(Math.max(0, delays[index] as number)), (delays[index] as number) > 5 * 60_000 ? 'warn' : 'ok')) : '',
                ]),
                { numeric: [0] },
              ),
          auth.length > 0
            ? heading('Authentication') +
                table(
                  ['Check', 'Result', 'Details'],
                  auth.map((item) => [item.method.toUpperCase(), html(pill(item.result, resultTone(item.result))), item.detail]),
                )
            : note('No Authentication-Results header: the receiving server did not record its checks.'),
          heading('All header fields'),
          pairs(fields.map(([name, value]) => [name, decodeWords(value)])),
        ),
      },
    };
  },
});
