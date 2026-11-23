import svg2vectordrawable from 'svg2vectordrawable';
import { ToolError } from '../../lib/errors';
import { countNodes, parseVectorDrawable, toCompose, toSvg } from '../../lib/vector-drawable';
import { defineTextTool, type TextResult } from '../types';

const SAMPLE = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
  <defs>
    <linearGradient id="roof" x1="2" y1="2" x2="22" y2="9" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#17694E"/>
      <stop offset="1" stop-color="#2FA37A"/>
    </linearGradient>
  </defs>
  <!-- A museum building -->
  <path d="M12 2 2 7v2h20V7z" fill="url(#roof)"/>
  <rect x="4" y="10" width="2" height="8" fill="#17694E"/>
  <rect x="9" y="10" width="2" height="8" fill="#17694E"/>
  <rect x="13" y="10" width="2" height="8" fill="#17694E"/>
  <rect x="18" y="10" width="2" height="8" fill="#17694E"/>
  <path d="M2 19h20v3H2z" fill="#0F5540"/>
  <circle cx="12" cy="6.2" r="1.2" fill="#FFFFFF"/>
</svg>
`;

const isVector = (text: string) => /^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<vector\b/.test(text);
const isSvg = (text: string) => /<svg\b/i.test(text);

export default defineTextTool({
  input: { label: 'SVG or VectorDrawable XML', language: 'xml', sample: SAMPLE, accept: '.svg,.xml' },
  output: { label: 'Output', language: 'xml' },
  options: [
    {
      key: 'to',
      label: 'Convert to',
      type: 'segmented',
      choices: [
        { value: 'vd', label: 'VectorDrawable' },
        { value: 'compose', label: 'Compose ImageVector' },
        { value: 'svg', label: 'SVG' },
      ],
      default: 'vd',
      help: 'Paste SVG or an Android vector drawable; the input format is detected.',
    },
    { key: 'precision', label: 'Decimal places', type: 'number', default: 2, min: 0, max: 6, step: 1, help: 'For numbers in paths taken from SVG.' },
    { key: 'fillBlack', label: 'Fill unpainted shapes in black, as SVG does', type: 'toggle', default: true },
    {
      key: 'tint',
      label: 'Tint',
      type: 'text',
      default: '',
      placeholder: '?attr/colorControlNormal',
      mono: true,
      help: 'Adds android:tint, for icons that take the theme colour.',
      showIf: (v) => v.to === 'vd',
    },
    { key: 'name', label: 'Kotlin name', type: 'text', default: 'MuseumIcon', mono: true, showIf: (v) => v.to === 'compose' },
    { key: 'pkg', label: 'Kotlin package', type: 'text', default: 'com.example.app.ui.icons', mono: true, showIf: (v) => v.to === 'compose' },
  ],
  async run(input, o): Promise<TextResult> {
    const source = input.trim();
    let xml: string;
    let from: 'svg' | 'vd';
    if (isVector(source)) {
      xml = source;
      from = 'vd';
    } else if (isSvg(source)) {
      from = 'svg';
      try {
        xml = await svg2vectordrawable(source, { floatPrecision: Math.round(o.precision), fillBlack: o.fillBlack, xmlTag: true, ...(o.tint.trim() ? { tint: o.tint.trim() } : {}) });
      } catch (error) {
        throw new ToolError(`This SVG could not be converted: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else {
      throw new ToolError('Paste an SVG (<svg …>) or an Android vector drawable (<vector …>).');
    }

    const { drawable, warnings } = parseVectorDrawable(xml);
    const preview = toSvg(drawable, []);
    const counts = countNodes(drawable.children);
    const info = `${from === 'svg' ? 'SVG' : 'VectorDrawable'} in · ${counts.paths} path${counts.paths === 1 ? '' : 's'}, ${counts.groups} group${counts.groups === 1 ? '' : 's'}${counts.gradients ? `, ${counts.gradients} gradient${counts.gradients === 1 ? '' : 's'}` : ''}${counts.clips ? `, ${counts.clips} clip path${counts.clips === 1 ? '' : 's'}` : ''} · ${drawable.width} × ${drawable.height} ${drawable.unit}, viewport ${drawable.viewportWidth} × ${drawable.viewportHeight}`;
    if (counts.gradients && o.to === 'vd') warnings.push('Gradients need Android 7.0 (API 24) or later, or AndroidX VectorDrawableCompat.');
    const base = { info, warnings: [...new Set(warnings)], preview: { kind: 'svg' as const, svg: preview, checker: true } };

    if (o.to === 'svg') {
      const svgWarnings: string[] = [];
      const svg = toSvg(drawable, svgWarnings);
      return { ...base, output: svg, language: 'xml', filename: 'drawable.svg', warnings: [...new Set([...base.warnings, ...svgWarnings])] };
    }
    if (o.to === 'compose') {
      const pkg = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/.test(o.pkg.trim()) ? o.pkg.trim() : 'com.example.app.ui.icons';
      return { ...base, output: toCompose(drawable, o.name, pkg), language: 'text', filename: `${o.name.replace(/[^A-Za-z0-9]/g, '') || 'Icon'}.kt` };
    }
    let out = xml;
    if (from === 'vd' && o.tint.trim() && !/android:tint=/.test(out)) out = out.replace(/<vector\b/, `<vector android:tint="${o.tint.trim().replace(/"/g, '')}"`);
    return { ...base, output: out.endsWith('\n') ? out : `${out}\n`, language: 'xml', filename: 'ic_drawable.xml' };
  },
});
