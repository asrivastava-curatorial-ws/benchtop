import { splitLines } from '../../lib/text';
import { defineTextTool, type Values } from '../types';

/** User agents of crawlers that collect content for AI training or AI answers. Edit freely: the list changes often. */
const AI_CRAWLERS = [
  'GPTBot',
  'ChatGPT-User',
  'OAI-SearchBot',
  'ClaudeBot',
  'Claude-User',
  'Claude-SearchBot',
  'anthropic-ai',
  'Google-Extended',
  'Applebot-Extended',
  'CCBot',
  'PerplexityBot',
  'Perplexity-User',
  'Bytespider',
  'Amazonbot',
  'meta-externalagent',
  'FacebookBot',
  'cohere-ai',
  'Diffbot',
  'ImagesiftBot',
  'Omgilibot',
  'YouBot',
  'AI2Bot',
  'DuckAssistBot',
  'Timpibot',
  'MistralAI-User',
].join('\n');

const lines = (text: string): string[] =>
  splitLines(text)
    .map((line) => line.trim())
    .filter(Boolean);

const isCustom = (v: Values): boolean => v.policy === 'custom';

export default defineTextTool({
  input: false,
  output: { label: 'robots.txt' },
  options: [
    {
      key: 'policy',
      label: 'All crawlers',
      type: 'select',
      choices: [
        { value: 'allow', label: 'May crawl everything' },
        { value: 'custom', label: 'May crawl everything except…' },
        { value: 'block', label: 'May crawl nothing' },
      ],
      default: 'custom',
    },
    { key: 'disallow', label: 'Disallow (one path per line)', type: 'text', default: '/admin/\n/cart/\n/*?sessionid=', multiline: true, mono: true, showIf: isCustom },
    { key: 'allow', label: 'Allow exceptions (one per line)', type: 'text', default: '/admin/help/', multiline: true, mono: true, showIf: isCustom },
    { key: 'blockAi', label: 'Block AI crawlers', type: 'toggle', default: false },
    {
      key: 'aiBots',
      label: 'AI crawler user agents',
      type: 'text',
      default: AI_CRAWLERS,
      multiline: true,
      mono: true,
      showIf: (v: Values) => v.blockAi === true,
      help: 'Compliance is voluntary; this only stops crawlers that honour robots.txt.',
    },
    {
      key: 'rules',
      label: 'Rules for specific crawlers',
      type: 'list',
      itemLabel: 'Crawler',
      max: 30,
      default: [],
      item: [
        { key: 'agent', label: 'User-agent', type: 'text', default: 'Googlebot-Image', mono: true },
        { key: 'disallow', label: 'Disallow', type: 'text', default: '/', multiline: true, mono: true },
        { key: 'allow', label: 'Allow', type: 'text', default: '', multiline: true, mono: true },
      ],
    },
    { key: 'crawlDelay', label: 'Crawl-delay (seconds, 0 = none)', type: 'number', default: 0, min: 0, max: 3600, step: 1 },
    { key: 'sitemaps', label: 'Sitemap URLs (one per line)', type: 'text', default: 'https://example.org/sitemap.xml', multiline: true, mono: true },
  ],
  runOnEmpty: true,
  run(_input, o) {
    const warnings: string[] = [];
    const checkPaths = (paths: string[], where: string) => {
      for (const path of paths) {
        if (!/^[/*$]/.test(path)) warnings.push(`${where}: "${path}" should start with "/" (paths are matched from the site root).`);
      }
    };
    const blocks: string[] = [];
    const general = ['User-agent: *'];
    if (o.policy === 'block') general.push('Disallow: /');
    else if (o.policy === 'allow') general.push('Disallow:');
    else {
      const disallow = lines(o.disallow);
      const allow = lines(o.allow);
      checkPaths(disallow, 'Disallow');
      checkPaths(allow, 'Allow');
      for (const path of allow) general.push(`Allow: ${path}`);
      for (const path of disallow) general.push(`Disallow: ${path}`);
      if (disallow.length === 0) general.push('Disallow:');
    }
    if (o.crawlDelay > 0) {
      general.push(`Crawl-delay: ${o.crawlDelay}`);
      warnings.push('Crawl-delay is ignored by Google; Bing and Yandex honour it.');
    }
    blocks.push(general.join('\n'));

    for (const rule of o.rules) {
      const agent = rule.agent.trim();
      if (agent === '') continue;
      const allow = lines(rule.allow);
      const disallow = lines(rule.disallow);
      checkPaths([...allow, ...disallow], agent);
      blocks.push([`User-agent: ${agent}`, ...allow.map((path) => `Allow: ${path}`), ...(disallow.length > 0 ? disallow.map((path) => `Disallow: ${path}`) : ['Disallow:'])].join('\n'));
    }

    if (o.blockAi) {
      const bots = lines(o.aiBots);
      if (bots.length > 0) blocks.push(['# AI crawlers', ...bots.map((bot) => `User-agent: ${bot}`), 'Disallow: /'].join('\n'));
    }

    const sitemaps = lines(o.sitemaps);
    for (const url of sitemaps) {
      if (!/^https?:\/\/\S+$/i.test(url)) warnings.push(`Sitemap "${url}" must be an absolute URL starting with http:// or https://.`);
    }
    if (sitemaps.length > 0) blocks.push(sitemaps.map((url) => `Sitemap: ${url}`).join('\n'));

    return { output: `${blocks.join('\n\n')}\n`, warnings: warnings.length > 0 ? warnings : undefined, filename: 'robots.txt' };
  },
});
