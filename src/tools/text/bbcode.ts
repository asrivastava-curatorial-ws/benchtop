import { escapeHtml } from '../../lib/text';
import { defineTextTool } from '../types';

const SIMPLE: [string, string][] = [
  ['b', 'strong'],
  ['i', 'em'],
  ['u', 'u'],
  ['s', 's'],
  ['code', 'code'],
  ['quote', 'blockquote'],
  ['center', 'center'],
  ['sub', 'sub'],
  ['sup', 'sup'],
];

export function bbcodeToHtml(source: string): string {
  let html = escapeHtml(source);
  for (const [bb, tag] of SIMPLE) html = html.replace(new RegExp(`\\[${bb}\\]([\\s\\S]*?)\\[\\/${bb}\\]`, 'gi'), tag === 'code' ? '<pre><code>$1</code></pre>' : `<${tag}>$1</${tag}>`);
  html = html
    .replace(/\[quote=(?:&quot;)?([^\]]+?)(?:&quot;)?\]([\s\S]*?)\[\/quote\]/gi, '<blockquote><cite>$1</cite>$2</blockquote>')
    .replace(/\[url\]((?:https?|mailto):[^[\s]+)\[\/url\]/gi, '<a href="$1">$1</a>')
    .replace(/\[url=((?:https?|mailto):[^\]\s]+)\]([\s\S]*?)\[\/url\]/gi, '<a href="$1">$2</a>')
    .replace(/\[img\](https?:[^[\s]+)\[\/img\]/gi, '<img src="$1" alt="">')
    .replace(/\[color=(#[0-9a-f]{3,6}|[a-z]+)\]([\s\S]*?)\[\/color\]/gi, '<span style="color:$1">$2</span>')
    .replace(/\[size=(\d{1,3})\]([\s\S]*?)\[\/size\]/gi, '<span style="font-size:$1%">$2</span>')
    .replace(/\[list(=1)?\]([\s\S]*?)\[\/list\]/gi, (_, ordered: string | undefined, items: string) => {
      const tag = ordered ? 'ol' : 'ul';
      return `<${tag}>${items
        .split(/\[\*\]/)
        .map((item) => item.trim())
        .filter(Boolean)
        .map((item) => `<li>${item}</li>`)
        .join('')}</${tag}>`;
    })
    .replace(/\n/g, '<br>\n');
  return html;
}

export function htmlToBbcode(source: string): string {
  return source
    .replace(/<\s*(strong|b)\s*>([\s\S]*?)<\/\s*\1\s*>/gi, '[b]$2[/b]')
    .replace(/<\s*(em|i)\s*>([\s\S]*?)<\/\s*\1\s*>/gi, '[i]$2[/i]')
    .replace(/<\s*u\s*>([\s\S]*?)<\/\s*u\s*>/gi, '[u]$1[/u]')
    .replace(/<\s*(s|del|strike)\s*>([\s\S]*?)<\/\s*\1\s*>/gi, '[s]$2[/s]')
    .replace(/<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href: string, text: string) => (href === text ? `[url]${href}[/url]` : `[url=${href}]${text}[/url]`))
    .replace(/<img\s[^>]*src="([^"]+)"[^>]*>/gi, '[img]$1[/img]')
    .replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, '[quote]$1[/quote]')
    .replace(/<pre[^>]*>\s*(?:<code[^>]*>)?([\s\S]*?)(?:<\/code>)?\s*<\/pre>/gi, '[code]$1[/code]')
    .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '[code]$1[/code]')
    .replace(/<ul[^>]*>([\s\S]*?)<\/ul>/gi, (_, items: string) => `[list]\n${items.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '[*]$1\n')}[/list]`)
    .replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_, items: string) => `[list=1]\n${items.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '[*]$1\n')}[/list]`)
    .replace(/<span[^>]*style="[^"]*color:\s*([^;"]+)[^"]*"[^>]*>([\s\S]*?)<\/span>/gi, '[color=$1]$2[/color]')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>\s*<p[^>]*>/gi, '\n\n')
    .replace(/<\/?(p|div|span|html|body|head)[^>]*>/gi, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .trim();
}

export default defineTextTool({
  input: { label: 'Input', sample: '[b]Opening hours[/b]\n[list]\n[*]Monday to Sunday\n[*]10 am to 6 pm\n[/list]\nSee [url=https://example.org/visit]the visit page[/url].' },
  output: { label: 'Output' },
  options: [
    {
      key: 'direction',
      label: 'Direction',
      type: 'segmented',
      choices: [
        { value: 'toHtml', label: 'BBCode to HTML' },
        { value: 'toBb', label: 'HTML to BBCode' },
      ],
      default: 'toHtml',
    },
  ],
  swap: (v) => ({ direction: v.direction === 'toHtml' ? 'toBb' : 'toHtml' }),
  run(input, o) {
    if (o.direction === 'toBb') return { output: htmlToBbcode(input), language: 'text' };
    const html = bbcodeToHtml(input);
    return { output: html, language: 'html', preview: { kind: 'html', html } };
  },
});
