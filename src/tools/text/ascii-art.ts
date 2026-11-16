import { ToolError } from '../../lib/errors';
import { defineTextTool } from '../types';

/** A curated set of FIGlet fonts; each is a separate chunk loaded on first use. */
const FONTS: Record<string, () => Promise<{ default: string }>> = {
  Standard: () => import('figlet/importable-fonts/Standard.js'),
  Big: () => import('figlet/importable-fonts/Big.js'),
  Slant: () => import('figlet/importable-fonts/Slant.js'),
  Small: () => import('figlet/importable-fonts/Small.js'),
  Banner3: () => import('figlet/importable-fonts/Banner3.js'),
  Block: () => import('figlet/importable-fonts/Block.js'),
  Doom: () => import('figlet/importable-fonts/Doom.js'),
  Shadow: () => import('figlet/importable-fonts/Shadow.js'),
  Speed: () => import('figlet/importable-fonts/Speed.js'),
  Lean: () => import('figlet/importable-fonts/Lean.js'),
  Mini: () => import('figlet/importable-fonts/Mini.js'),
  Script: () => import('figlet/importable-fonts/Script.js'),
  'ANSI Shadow': () => import('figlet/importable-fonts/ANSI Shadow.js'),
  'Calvin S': () => import('figlet/importable-fonts/Calvin S.js'),
  Bloody: () => import('figlet/importable-fonts/Bloody.js'),
  Graffiti: () => import('figlet/importable-fonts/Graffiti.js'),
  'Larry 3D': () => import('figlet/importable-fonts/Larry 3D.js'),
  'Star Wars': () => import('figlet/importable-fonts/Star Wars.js'),
  Isometric1: () => import('figlet/importable-fonts/Isometric1.js'),
  '3-D': () => import('figlet/importable-fonts/3-D.js'),
};

const loaded = new Set<string>();

export default defineTextTool({
  input: { label: 'Text', sample: 'Benchtop' },
  output: { label: 'ASCII art' },
  options: [
    { key: 'font', label: 'Font', type: 'select', choices: Object.keys(FONTS), default: 'Standard' },
    {
      key: 'layout',
      label: 'Letter spacing',
      type: 'select',
      choices: [
        { value: 'default', label: 'Font default' },
        { value: 'full', label: 'Full width' },
        { value: 'fitted', label: 'Fitted' },
        { value: 'controlled smushing', label: 'Smushed' },
      ],
      default: 'default',
    },
    { key: 'width', label: 'Wrap at', type: 'number', default: 100, min: 20, max: 400, step: 10, unit: 'chars' },
    {
      key: 'comment',
      label: 'Wrap as a code comment',
      type: 'select',
      choices: [
        { value: 'none', label: 'No' },
        { value: 'slash', label: '// …' },
        { value: 'hash', label: '# …' },
        { value: 'block', label: '/* … */' },
      ],
      default: 'none',
    },
  ],
  async run(input, o) {
    if (input.trim() === '') return '';
    const { default: figlet } = await import('figlet');
    if (!loaded.has(o.font)) {
      const font = await FONTS[o.font]?.().catch(() => null);
      if (!font) throw new ToolError(`The font "${o.font}" is not available.`);
      figlet.parseFont(o.font, font.default);
      loaded.add(o.font);
    }
    const art = input
      .split(/\r?\n/)
      .map((line) => figlet.textSync(line, { font: o.font as never, horizontalLayout: o.layout as never, width: o.width, whitespaceBreak: true }))
      .join('\n')
      .replace(/\s+$/gm, '');
    const lines = art.split('\n');
    const output =
      o.comment === 'slash' ? lines.map((line) => `// ${line}`).join('\n') : o.comment === 'hash' ? lines.map((line) => `# ${line}`).join('\n') : o.comment === 'block' ? `/*\n${art}\n*/` : art;
    return { output, info: 'Fonts from FIGlet (figlet.js).' };
  },
});
