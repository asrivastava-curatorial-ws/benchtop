import Bowser from 'bowser';
import { defineTextTool, type Field } from '../types';

export default defineTextTool({
  input: { label: 'User-Agent string', sample: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36' },
  output: { label: 'Parsed', language: 'json' },
  options: [],
  run(input) {
    const ua = input.trim().replace(/^user-agent:\s*/i, '');
    if (ua === '') return { output: '' };
    const result = Bowser.parse(ua);
    const text = (value: string | undefined) => value || 'unknown';
    const fields: Field[] = [
      { label: 'Browser', value: `${text(result.browser.name)} ${result.browser.version ?? ''}`.trim() },
      // Firefox freezes its Gecko "version" at the build date 20100101, which means nothing.
      { label: 'Engine', value: `${text(result.engine.name)} ${result.engine.version && result.engine.version !== '20100101' ? result.engine.version : ''}`.trim() },
      { label: 'Operating system', value: `${text(result.os.name)} ${result.os.versionName ?? result.os.version ?? ''}`.trim() },
      { label: 'Device', value: `${text(result.platform.type)}${result.platform.vendor ? `, ${result.platform.vendor}` : ''}${result.platform.model ? ` ${result.platform.model}` : ''}` },
    ];
    const bot = /bot|crawler|spider|crawling|slurp|bingpreview|facebookexternalhit|gptbot|claude|perplexity|ccbot/i.exec(ua);
    if (bot) fields.push({ label: 'Robot', value: `Looks like an automated client ("${bot[0]}")`, tone: 'warn' });
    return { output: `${JSON.stringify(result, null, 2)}\n`, fields, info: 'User-Agent strings are easy to fake and browsers are reducing their detail; use them as a hint only.' };
  },
});
