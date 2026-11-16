import { escapeHtml } from '../../lib/text';
import { defineTextTool } from '../types';

export default defineTextTool({
  input: false,
  output: { label: 'HTML', language: 'html' },
  options: [
    { key: 'title', label: 'Title', type: 'text', default: 'Hands-on Science Galleries', wide: true },
    { key: 'description', label: 'Description', type: 'text', default: 'Interactive exhibits, shows and workshops for curious minds of every age.', wide: true, multiline: true },
    { key: 'url', label: 'Page address', type: 'text', default: 'https://www.example.org/', mono: true, wide: true },
    { key: 'image', label: 'Share image address', type: 'text', default: 'https://www.example.org/share.jpg', mono: true, wide: true, help: '1200 × 630 px works everywhere.' },
    { key: 'imageAlt', label: 'Image description', type: 'text', default: '', wide: true },
    { key: 'siteName', label: 'Site name', type: 'text', default: 'Example Museum' },
    { key: 'type', label: 'Type', type: 'select', choices: ['website', 'article', 'profile', 'book', 'video.movie', 'music.song', 'product'], default: 'website' },
    { key: 'locale', label: 'Locale', type: 'text', default: 'en_IN' },
    {
      key: 'twitterCard',
      label: 'X / Twitter card',
      type: 'select',
      choices: [
        { value: 'summary_large_image', label: 'Large image' },
        { value: 'summary', label: 'Small image' },
        { value: 'none', label: 'Leave out' },
      ],
      default: 'summary_large_image',
    },
    { key: 'twitterSite', label: 'X / Twitter account', type: 'text', default: '', placeholder: '@account' },
    { key: 'themeColor', label: 'Theme colour', type: 'text', default: '#0d1117', mono: true },
    { key: 'canonical', label: 'Canonical link', type: 'toggle', default: true },
  ],
  runOnEmpty: true,
  run(_input, o) {
    const tag = (attribute: 'name' | 'property', key: string, value: string) => (value.trim() === '' ? null : `<meta ${attribute}="${key}" content="${escapeHtml(value.trim())}">`);
    const lines = [
      `<title>${escapeHtml(o.title)}</title>`,
      tag('name', 'description', o.description),
      o.canonical && o.url.trim() !== '' ? `<link rel="canonical" href="${escapeHtml(o.url.trim())}">` : null,
      tag('name', 'theme-color', o.themeColor),
      '',
      '<!-- Open Graph (Facebook, LinkedIn, WhatsApp, Slack…) -->',
      tag('property', 'og:type', o.type),
      tag('property', 'og:title', o.title),
      tag('property', 'og:description', o.description),
      tag('property', 'og:url', o.url),
      tag('property', 'og:image', o.image),
      tag('property', 'og:image:alt', o.imageAlt),
      tag('property', 'og:site_name', o.siteName),
      tag('property', 'og:locale', o.locale),
      ...(o.twitterCard === 'none'
        ? []
        : [
            '',
            '<!-- X / Twitter -->',
            tag('name', 'twitter:card', o.twitterCard),
            tag('name', 'twitter:site', o.twitterSite),
            tag('name', 'twitter:title', o.title),
            tag('name', 'twitter:description', o.description),
            tag('name', 'twitter:image', o.image),
            tag('name', 'twitter:image:alt', o.imageAlt),
          ]),
    ].filter((line): line is string => line !== null);
    const warnings: string[] = [];
    if (o.title.length > 60) warnings.push(`The title is ${o.title.length} characters; search results cut it at about 60.`);
    if (o.description.length > 160) warnings.push(`The description is ${o.description.length} characters; search results cut it at about 160.`);
    if (o.image !== '' && !/^https:\/\//.test(o.image)) warnings.push('Use an absolute https:// address for the share image; relative paths are ignored by most sites.');
    return { output: `${lines.join('\n')}\n`, warnings, filename: 'meta-tags.html' };
  },
});
