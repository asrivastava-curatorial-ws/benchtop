import { adjustForContrast, alphaOf, compositeOver, contrastRatio, hexOf, isColor } from '../../lib/color';
import { ToolError } from '../../lib/errors';
import { defineTextTool, type Field } from '../types';

const verdict = (ratio: number, needed: number, label: string): Field => ({
  label,
  value: ratio >= needed ? `Pass (needs ${needed}:1)` : `Fail (needs ${needed}:1)`,
  tone: ratio >= needed ? 'ok' : 'bad',
});

export default defineTextTool({
  input: false,
  output: false,
  options: [
    { key: 'foreground', label: 'Text colour', type: 'color', default: '#6b7280', alpha: true },
    { key: 'background', label: 'Background', type: 'color', default: '#ffffff' },
    { key: 'sample', label: 'Sample text', type: 'text', default: 'The quick brown fox jumps over the lazy dog', wide: true },
  ],
  runOnEmpty: true,
  run(_input, o) {
    if (!isColor(o.foreground)) throw new ToolError(`"${o.foreground}" is not a valid text colour.`);
    if (!isColor(o.background)) throw new ToolError(`"${o.background}" is not a valid background colour.`);
    const background = hexOf(o.background);
    // Translucent text is judged by the colour it actually produces on the background.
    const translucent = alphaOf(o.foreground) < 1;
    const foreground = translucent ? compositeOver(o.foreground, background) : hexOf(o.foreground);
    const ratio = contrastRatio(foreground, background);
    const fields: Field[] = [
      { label: 'Contrast ratio', value: `${ratio.toFixed(2)}:1`, mono: true, tone: ratio >= 4.5 ? 'ok' : ratio >= 3 ? 'warn' : 'bad', swatch: foreground },
      verdict(ratio, 4.5, 'AA — normal text'),
      verdict(ratio, 3, 'AA — large text (18pt, or 14pt bold)'),
      verdict(ratio, 3, 'AA — icons and UI components'),
      verdict(ratio, 7, 'AAA — normal text'),
      verdict(ratio, 4.5, 'AAA — large text'),
    ];
    for (const [target, label] of [
      [4.5, 'Nearest text colour that passes AA'],
      [7, 'Nearest text colour that passes AAA'],
    ] as const) {
      if (ratio >= target) continue;
      const suggestion = adjustForContrast(foreground, background, target);
      fields.push(
        suggestion
          ? { label, value: `${suggestion}  (${contrastRatio(suggestion, background).toFixed(2)}:1)`, mono: true, swatch: suggestion }
          : { label, value: 'Not reachable on this background — change the background too', tone: 'muted' },
      );
    }
    const text = o.sample.trim() || 'Sample text';
    const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const html =
      `<div style="background:${background};color:${foreground};padding:20px 24px;border-radius:10px;border:1px solid rgba(128,128,128,.35)">` +
      `<p style="margin:0 0 10px;font-size:24px;font-weight:700;line-height:1.25">${escaped}</p>` +
      `<p style="margin:0 0 10px;font-size:16px;line-height:1.5">${escaped}</p>` +
      `<p style="margin:0;font-size:12px;line-height:1.5">${escaped}</p></div>`;
    return {
      fields,
      preview: { kind: 'html', html },
      info: translucent ? `Translucent text blends to ${foreground} on this background` : 'WCAG 2.2 contrast (relative luminance)',
    };
  },
});
