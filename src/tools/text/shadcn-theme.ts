import { adjustForContrast, contrastRatio, oklchToHex, toOklchValues, trimNumber } from '../../lib/color';
import { ToolError } from '../../lib/errors';
import { defineTextTool, type Field } from '../types';

interface Tone {
  readonly l: number;
  readonly c: number;
  readonly h: number;
  readonly alpha?: number;
}

const css = (tone: Tone): string =>
  `oklch(${trimNumber(tone.l, 3)} ${trimNumber(tone.c, 3)} ${trimNumber(tone.c === 0 ? 0 : tone.h, 2)}${tone.alpha === undefined ? '' : ` / ${Math.round(tone.alpha * 100)}%`})`;
const hex = (tone: Tone): string => oklchToHex(tone.l, tone.c, tone.h);

const TINT: Record<string, number> = { none: 0, subtle: 0.006, strong: 0.018 };

/** The variable names are shadcn/ui's public theming contract; the values are computed here. */
function buildTheme(primaryInput: string, tintLevel: string, dark: boolean) {
  const base = toOklchValues(primaryInput);
  if (!base) throw new ToolError(`"${primaryInput}" is not a colour. Try a hex value such as #2563eb.`);
  const hue = base.h;
  const tint = TINT[tintLevel] ?? 0;
  const neutral = (l: number, scale = 1): Tone => ({ l, c: tint * scale, h: hue });

  // On dark surfaces a very dark brand colour would disappear, so it is lifted to a readable lightness.
  let primary: Tone = dark ? { l: Math.max(base.l, 0.62), c: base.c, h: hue } : { l: base.l, c: base.c, h: hue };
  const white: Tone = neutral(0.985, 0.3);
  const black: Tone = neutral(0.205, 1);
  let primaryForeground = contrastRatio(hex(white), hex(primary)) >= contrastRatio(hex(black), hex(primary)) ? white : black;
  let adjusted = false;
  if (contrastRatio(hex(primaryForeground), hex(primary)) < 4.5) {
    const fixed = toOklchValues(adjustForContrast(hex(primary), hex(primaryForeground), 4.5) ?? '');
    if (fixed) {
      primary = { l: fixed.l, c: fixed.c, h: hue };
      adjusted = true;
    }
    primaryForeground = contrastRatio(hex(white), hex(primary)) >= contrastRatio(hex(black), hex(primary)) ? white : black;
  }

  const chart = (offset: number, l: number, c: number): Tone => ({ l, c, h: (hue + offset + 360) % 360 });
  const tokens: [string, Tone][] = dark
    ? [
        ['background', neutral(0.145)],
        ['foreground', neutral(0.985, 0.3)],
        ['card', neutral(0.205)],
        ['card-foreground', neutral(0.985, 0.3)],
        ['popover', neutral(0.205)],
        ['popover-foreground', neutral(0.985, 0.3)],
        ['primary', primary],
        ['primary-foreground', primaryForeground],
        ['secondary', neutral(0.269)],
        ['secondary-foreground', neutral(0.985, 0.3)],
        ['muted', neutral(0.269)],
        ['muted-foreground', neutral(0.708)],
        ['accent', neutral(0.269)],
        ['accent-foreground', neutral(0.985, 0.3)],
        ['destructive', { l: 0.704, c: 0.191, h: 22.2 }],
        ['border', { l: 1, c: 0, h: 0, alpha: 0.1 }],
        ['input', { l: 1, c: 0, h: 0, alpha: 0.15 }],
        ['ring', { l: primary.l, c: primary.c * 0.8, h: hue }],
        ['chart-1', chart(0, 0.65, 0.2)],
        ['chart-2', chart(50, 0.7, 0.16)],
        ['chart-3', chart(150, 0.75, 0.16)],
        ['chart-4', chart(210, 0.65, 0.22)],
        ['chart-5', chart(290, 0.68, 0.2)],
        ['sidebar', neutral(0.205)],
        ['sidebar-foreground', neutral(0.985, 0.3)],
        ['sidebar-primary', primary],
        ['sidebar-primary-foreground', primaryForeground],
        ['sidebar-accent', neutral(0.269)],
        ['sidebar-accent-foreground', neutral(0.985, 0.3)],
        ['sidebar-border', { l: 1, c: 0, h: 0, alpha: 0.1 }],
        ['sidebar-ring', { l: primary.l, c: primary.c * 0.8, h: hue }],
      ]
    : [
        ['background', neutral(1, 0)],
        ['foreground', neutral(0.145)],
        ['card', neutral(1, 0)],
        ['card-foreground', neutral(0.145)],
        ['popover', neutral(1, 0)],
        ['popover-foreground', neutral(0.145)],
        ['primary', primary],
        ['primary-foreground', primaryForeground],
        ['secondary', neutral(0.97)],
        ['secondary-foreground', neutral(0.205)],
        ['muted', neutral(0.97)],
        ['muted-foreground', neutral(0.5)],
        ['accent', neutral(0.97)],
        ['accent-foreground', neutral(0.205)],
        ['destructive', { l: 0.577, c: 0.245, h: 27.3 }],
        ['border', neutral(0.922)],
        ['input', neutral(0.922)],
        ['ring', { l: Math.min(0.75, primary.l + 0.1), c: primary.c * 0.6, h: hue }],
        ['chart-1', chart(0, 0.62, 0.2)],
        ['chart-2', chart(50, 0.6, 0.14)],
        ['chart-3', chart(150, 0.5, 0.1)],
        ['chart-4', chart(210, 0.72, 0.17)],
        ['chart-5', chart(290, 0.68, 0.18)],
        ['sidebar', neutral(0.985)],
        ['sidebar-foreground', neutral(0.145)],
        ['sidebar-primary', primary],
        ['sidebar-primary-foreground', primaryForeground],
        ['sidebar-accent', neutral(0.97)],
        ['sidebar-accent-foreground', neutral(0.205)],
        ['sidebar-border', neutral(0.922)],
        ['sidebar-ring', { l: Math.min(0.75, primary.l + 0.1), c: primary.c * 0.6, h: hue }],
      ];
  return { tokens, adjusted };
}

const block = (selector: string, lines: string[]): string => `${selector} {\n${lines.map((line) => `  ${line}`).join('\n')}\n}`;

function previewPanel(tokens: Map<string, string>, title: string): string {
  const t = (name: string) => tokens.get(name) ?? '#888888';
  const button = (bg: string, fg: string, label: string, border = 'transparent') =>
    `<span style="display:inline-block;padding:7px 14px;border-radius:8px;font-size:13px;font-weight:600;background:${bg};color:${fg};border:1px solid ${border};margin:0 6px 6px 0">${label}</span>`;
  return (
    `<div style="flex:1 1 260px;background:${t('background')};color:${t('foreground')};padding:16px;border-radius:12px;border:1px solid ${t('border')}">` +
    `<div style="font-size:12px;color:${t('muted-foreground')};margin-bottom:8px">${title}</div>` +
    `<div style="background:${t('card')};color:${t('card-foreground')};border:1px solid ${t('border')};border-radius:10px;padding:14px">` +
    `<div style="font-size:16px;font-weight:700;margin-bottom:4px">Create project</div>` +
    `<div style="font-size:13px;color:${t('muted-foreground')};margin-bottom:12px">Deploy your new project in one click.</div>` +
    `<div style="border:1px solid ${t('input')};border-radius:8px;padding:7px 10px;font-size:13px;color:${t('muted-foreground')};margin-bottom:12px">Project name</div>` +
    `${button(t('primary'), t('primary-foreground'), 'Deploy')}${button(t('secondary'), t('secondary-foreground'), 'Cancel')}${button(t('destructive'), '#ffffff', 'Delete')}${button('transparent', t('foreground'), 'Outline', t('border'))}` +
    '</div></div>'
  );
}

export default defineTextTool({
  input: false,
  output: { label: 'globals.css', language: 'css' },
  options: [
    { key: 'color', label: 'Primary colour', type: 'color', default: '#2563eb' },
    { key: 'radius', label: 'Corner radius', type: 'range', default: 0.625, min: 0, max: 1.5, step: 0.125, unit: 'rem' },
    {
      key: 'tint',
      label: 'Tint greys with the primary hue',
      type: 'select',
      choices: [
        { value: 'none', label: 'No (pure neutral)' },
        { value: 'subtle', label: 'Subtly' },
        { value: 'strong', label: 'Noticeably' },
      ],
      default: 'subtle',
    },
  ],
  runOnEmpty: true,
  run(_input, o) {
    const light = buildTheme(o.color, o.tint, false);
    const dark = buildTheme(o.color, o.tint, true);
    const names = light.tokens.map(([name]) => name);
    const output = [
      '@import "tailwindcss";',
      '',
      '@custom-variant dark (&:is(.dark *));',
      '',
      block(':root', [`--radius: ${trimNumber(o.radius, 3)}rem;`, ...light.tokens.map(([name, tone]) => `--${name}: ${css(tone)};`)]),
      '',
      block(
        '.dark',
        dark.tokens.map(([name, tone]) => `--${name}: ${css(tone)};`),
      ),
      '',
      block('@theme inline', [
        ...names.map((name) => `--color-${name}: var(--${name});`),
        '--radius-sm: calc(var(--radius) - 4px);',
        '--radius-md: calc(var(--radius) - 2px);',
        '--radius-lg: var(--radius);',
        '--radius-xl: calc(var(--radius) + 4px);',
      ]),
      '',
      '@layer base {\n  * {\n    @apply border-border outline-ring/50;\n  }\n  body {\n    @apply bg-background text-foreground;\n  }\n}',
      '',
    ].join('\n');

    const lightHex = new Map(light.tokens.map(([name, tone]) => [name, hex(tone)]));
    const darkHex = new Map(dark.tokens.map(([name, tone]) => [name, name === 'border' || name === 'input' ? '#2e2e2e' : hex(tone)]));
    const check = (label: string, foreground: string, background: string, needed: number): Field => {
      const ratio = contrastRatio(foreground, background);
      return { label, value: `${ratio.toFixed(2)}:1 ${ratio >= needed ? 'passes' : 'fails'} ${needed}:1`, tone: ratio >= needed ? 'ok' : 'bad', swatch: foreground };
    };
    const pair = (theme: Map<string, string>, a: string, b: string) => [theme.get(a) ?? '#000', theme.get(b) ?? '#fff'] as const;
    const fields: Field[] = [
      check('Light: text on background', ...pair(lightHex, 'foreground', 'background'), 4.5),
      check('Light: text on primary', ...pair(lightHex, 'primary-foreground', 'primary'), 4.5),
      check('Light: muted text on background', ...pair(lightHex, 'muted-foreground', 'background'), 4.5),
      check('Dark: text on background', ...pair(darkHex, 'foreground', 'background'), 4.5),
      check('Dark: text on primary', ...pair(darkHex, 'primary-foreground', 'primary'), 4.5),
      check('Dark: muted text on background', ...pair(darkHex, 'muted-foreground', 'background'), 4.5),
    ];
    const html = `<div style="display:flex;flex-wrap:wrap;gap:12px;font-family:system-ui,sans-serif">${previewPanel(lightHex, 'Light')}${previewPanel(darkHex, 'Dark')}</div>`;
    return {
      output,
      fields,
      preview: { kind: 'html', html },
      info:
        light.adjusted || dark.adjusted
          ? 'The primary colour was nudged lighter or darker so that button text reaches 4.5:1 contrast'
          : 'Primary colour used as given; all text pairings reach WCAG AA',
      filename: 'globals.css',
    };
  },
});
