import { describe, expect, it } from 'vitest';
import { decodeWords, messageToHtml, parseMime, parseParams } from '../../src/lib/eml';

const bytes = (lines: string[]) => new TextEncoder().encode(lines.join('\r\n'));
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('e-mail messages', () => {
  it('decodes encoded words and parameters', () => {
    expect(decodeWords('=?UTF-8?B?Q2Fmw6k=?= =?UTF-8?B?IHRvbW9ycm93?=')).toBe('Café tomorrow');
    expect(decodeWords('=?iso-8859-1?q?Gr=FC=DFe_aus?= Bangalore')).toBe('Grüße aus Bangalore');
    // A character split between two words survives.
    expect(decodeWords('=?UTF-8?Q?=E0=A4=A8?= =?UTF-8?Q?=E0=A4=AE?=')).toBe('नम');
    expect(decodeWords('plain text')).toBe('plain text');
    expect(parseParams('attachment; filename*0*=UTF-8\'\'long%20; filename*1="name.txt"').params.filename).toBe('long name.txt');
    expect(parseParams('text/plain; charset="utf-8"; format=flowed')).toEqual({ value: 'text/plain', params: { charset: 'utf-8', format: 'flowed' } });
    expect(parseParams('inline; filename="a \\"b\\".png"').params.filename).toBe('a "b".png');
  });

  it('turns a plain text message into a page', () => {
    const message = bytes([
      'From: =?UTF-8?Q?J=C3=BCrgen?= <j@example.org>',
      'To: Asha <asha@example.org>',
      'Subject: =?UTF-8?B?Q2Fmw6k=?=',
      ' =?UTF-8?B?IHRvbW9ycm93?=',
      'Date: Tue, 24 Nov 2026 10:00:00 +0530',
      'Content-Type: text/plain; charset=ISO-8859-1',
      'Content-Transfer-Encoding: quoted-printable',
      '',
      'Gr=FC=DFe! See https://example.org/page.',
      'Long line soft=',
      ' break.',
    ]);
    const { html, subject, attachments } = messageToHtml(message);
    expect(subject).toBe('Café tomorrow');
    expect(attachments).toEqual([]);
    expect(html).toContain('<h1>Café tomorrow</h1>');
    expect(html).toContain('<th>From</th><td>Jürgen &lt;j@example.org&gt;</td>');
    expect(html).toContain('Grüße! See <a href="https://example.org/page">https://example.org/page</a>.');
    expect(html).toContain('Long line soft break.');
    expect(html).toContain("default-src 'none'");
  });

  it('shows the HTML with its pictures and lists the attachments', () => {
    const message = bytes([
      'From: a@example.org',
      'Subject: Report',
      'MIME-Version: 1.0',
      'Content-Type: multipart/mixed; boundary="outer"',
      '',
      'This is a multi-part message.',
      '--outer',
      'Content-Type: multipart/alternative; boundary=alt',
      '',
      '--alt',
      'Content-Type: text/plain; charset=utf-8',
      '',
      'The plain version.',
      '--alt',
      'Content-Type: multipart/related; boundary="rel"',
      '',
      '--rel',
      'Content-Type: text/html; charset=utf-8',
      'Content-Transfer-Encoding: base64',
      '',
      btoa('<html><head><style>p { color: teal; }</style></head><body><p>Hello <img src="cid:logo@x"></p><script>alert(1)</script></body></html>'),
      '--rel',
      'Content-Type: image/png',
      'Content-ID: <logo@x>',
      'Content-Disposition: inline; filename="logo.png"',
      'Content-Transfer-Encoding: base64',
      '',
      PNG,
      '--rel--',
      '--alt--',
      '--outer',
      'Content-Type: application/pdf',
      "Content-Disposition: attachment; filename*=UTF-8''r%C3%A9sum%C3%A9.pdf",
      'Content-Transfer-Encoding: base64',
      '',
      btoa('%PDF-1.4 fake'),
      '--outer--',
      'Epilogue.',
    ]);
    const tree = parseMime(message);
    expect(tree.type).toBe('multipart/mixed');
    expect(tree.parts.map((p) => p.type)).toEqual(['multipart/alternative', 'application/pdf']);
    const { html, attachments } = messageToHtml(message, { embedAttachments: true });
    expect(html).toContain('<p>Hello <img src="data:image/png;base64,');
    expect(html).not.toContain('cid:');
    expect(html).not.toContain('The plain version');
    expect(html).not.toContain('<script');
    expect(html).toContain('p { color: teal; }');
    expect(attachments.map((a) => [a.name, a.type, new TextDecoder().decode(a.bytes)])).toEqual([['résumé.pdf', 'application/pdf', '%PDF-1.4 fake']]);
    expect(html).toContain('<a download="résumé.pdf" href="data:application/pdf;base64,');
    expect(messageToHtml(message).html).not.toContain('download=');
  });

  it('opens saved web pages (MHTML) with their pictures', () => {
    const page = bytes([
      'From: <Saved by Blink>',
      'Snapshot-Content-Location: https://example.org/',
      'Subject: Example page',
      'MIME-Version: 1.0',
      'Content-Type: multipart/related; type="text/html"; boundary="----MultipartBoundary--x"',
      '',
      '------MultipartBoundary--x',
      'Content-Type: text/html',
      'Content-Location: https://example.org/',
      'Content-Transfer-Encoding: quoted-printable',
      '',
      '<html><body><h2>Museum</h2><img src=3D"https://example.org/a.png"></body></html>',
      '------MultipartBoundary--x',
      'Content-Type: image/png',
      'Content-Location: https://example.org/a.png',
      'Content-Transfer-Encoding: base64',
      '',
      PNG,
      '------MultipartBoundary--x--',
    ]);
    const { html, subject, attachments } = messageToHtml(page);
    expect(subject).toBe('Example page');
    expect(attachments).toEqual([]);
    expect(html).toContain('<h2>Museum</h2><img src="data:image/png;base64,');
    expect(html).not.toContain('class="mail-head"');
  });

  it('lists forwarded messages as attachments', () => {
    const message = bytes([
      'Subject: Fwd',
      'Content-Type: multipart/mixed; boundary=b',
      '',
      '--b',
      'Content-Type: text/plain',
      '',
      'See below.',
      '--b',
      'Content-Type: message/rfc822',
      '',
      'Subject: The original',
      '',
      'Original text.',
      '--b--',
    ]);
    const { attachments, html } = messageToHtml(message);
    expect(attachments.map((a) => a.name)).toEqual(['The original.eml']);
    expect(html).toContain('See below.');
  });
});
