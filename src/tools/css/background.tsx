import { defineVisualTool, type Values } from '../types';
import { arbitrary, color, css, inline, rule, SAMPLE_SCENE, svgDataUri, tailwind } from './_shared';

const TILE = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48"><rect width="48" height="48" fill="#f8fafc"/><circle cx="24" cy="24" r="9" fill="#17694e"/><path d="M0 0h12v12H0zM36 36h12v12H36z" fill="#c8962e"/></svg>`;

const IMAGES: Record<string, { label: string; url: () => string }> = {
  scene: { label: 'Landscape (sample)', url: () => svgDataUri(SAMPLE_SCENE) },
  tile: { label: 'Tile (sample)', url: () => svgDataUri(TILE) },
  gradient: { label: 'Gradient', url: () => '' },
  url: { label: 'Your image URL', url: () => '' },
  none: { label: 'None', url: () => '' },
};

const custom = (v: Values) => v.size === 'custom';

const controls = [
  { key: 'color', label: 'Background colour', type: 'color', alpha: true, default: '#e2e8f0' },
  { key: 'image', label: 'Image', type: 'select', choices: Object.entries(IMAGES).map(([value, info]) => ({ value, label: info.label })), default: 'scene' },
  {
    key: 'url',
    label: 'Image URL',
    type: 'text',
    default: 'images/hero.jpg',
    placeholder: 'images/hero.jpg',
    mono: true,
    wide: true,
    showIf: (v: Values) => v.image === 'url',
    help: 'Written into the CSS as-is. The preview cannot load it, because Benchtop never makes network requests.',
  },
  { key: 'gradient', label: 'Gradient', type: 'text', default: 'linear-gradient(135deg, #17694e, #c8962e)', mono: true, wide: true, showIf: (v: Values) => v.image === 'gradient' },
  { key: 'size', label: 'Size', type: 'select', choices: ['auto', 'cover', 'contain', 'custom'], default: 'cover' },
  { key: 'sizeX', label: 'Width', type: 'range', min: 1, max: 200, step: 1, unit: '%', default: 50, showIf: custom },
  { key: 'sizeY', label: 'Height', type: 'range', min: 0, max: 200, step: 1, unit: '%', default: 0, showIf: custom, help: '0 means "auto" (keep the aspect ratio).' },
  { key: 'repeat', label: 'Repeat', type: 'select', choices: ['no-repeat', 'repeat', 'repeat-x', 'repeat-y', 'space', 'round'], default: 'no-repeat' },
  { key: 'x', label: 'Position X', type: 'range', min: 0, max: 100, step: 1, unit: '%', default: 50 },
  { key: 'y', label: 'Position Y', type: 'range', min: 0, max: 100, step: 1, unit: '%', default: 50 },
  { key: 'attachment', label: 'Attachment', type: 'select', choices: ['scroll', 'fixed', 'local'], default: 'scroll' },
  {
    key: 'blend',
    label: 'Blend mode',
    type: 'select',
    choices: [
      'normal',
      'multiply',
      'screen',
      'overlay',
      'darken',
      'lighten',
      'color-dodge',
      'color-burn',
      'hard-light',
      'soft-light',
      'difference',
      'exclusion',
      'hue',
      'saturation',
      'color',
      'luminosity',
    ],
    default: 'normal',
  },
  { key: 'clip', label: 'Clip', type: 'select', choices: ['border-box', 'padding-box', 'content-box', 'text'], default: 'border-box' },
] as const;

const position = (x: number, y: number): string => {
  const named = (value: number, low: string, high: string) => (value === 0 ? low : value === 50 ? 'center' : value === 100 ? high : `${value}%`);
  const a = named(x, 'left', 'right');
  const b = named(y, 'top', 'bottom');
  return a === 'center' && b === 'center' ? 'center' : `${a} ${b}`;
};

export default defineVisualTool({
  controls,
  render(v) {
    let image = '';
    if (v.image === 'gradient') image = v.gradient.trim();
    else if (v.image === 'url') image = v.url.trim() ? `url("${v.url.trim().replace(/"/g, '%22')}")` : '';
    else if (v.image !== 'none') image = `url("${IMAGES[v.image]?.url() ?? ''}")`;
    const size = v.size === 'custom' ? `${v.sizeX}% ${v.sizeY === 0 ? 'auto' : `${v.sizeY}%`}` : v.size;
    const declarations: [string, string][] = [['background-color', color(v.color)]];
    if (image) {
      declarations.push(['background-image', image], ['background-size', size], ['background-repeat', v.repeat], ['background-position', position(v.x, v.y)]);
      if (v.attachment !== 'scroll') declarations.push(['background-attachment', v.attachment]);
      if (v.blend !== 'normal') declarations.push(['background-blend-mode', v.blend]);
    }
    if (v.clip !== 'border-box') declarations.push(['background-clip', v.clip]);
    if (v.clip === 'text') declarations.push(['color', 'transparent']);
    const isText = v.clip === 'text';
    // Inline data URIs make the CSS long; show a placeholder in the code for the samples.
    const shown = declarations.map(([property, value]) => [property, property === 'background-image' && v.image !== 'url' && v.image !== 'gradient' ? 'url("image.svg")' : value] as [string, string]);
    const classes = [
      `bg-${arbitrary(color(v.color))}`,
      image && `bg-${v.size === 'custom' ? arbitrary(size) : v.size}`,
      image &&
        `bg-${v.repeat === 'no-repeat' ? 'no-repeat' : v.repeat === 'repeat' ? 'repeat' : v.repeat === 'repeat-x' ? 'repeat-x' : v.repeat === 'repeat-y' ? 'repeat-y' : v.repeat === 'space' ? 'repeat-space' : 'repeat-round'}`,
      image && `bg-${position(v.x, v.y) === 'center' ? 'center' : arbitrary(position(v.x, v.y))}`,
      image && v.blend !== 'normal' && `bg-blend-${v.blend}`,
      v.clip !== 'border-box' && `bg-clip-${v.clip.replace('-box', '')}`,
      isText && 'text-transparent',
    ];
    return {
      preview: isText ? (
        <p class="pv-clip-text" style={inline(declarations)}>
          Background clipped to text
        </p>
      ) : (
        <div class="pv-bg" style={`${inline(declarations)} border: 12px solid rgb(0 0 0 / .08); padding: 18px;`}>
          <div class="pv-bg-content">Content box</div>
        </div>
      ),
      css: '.pv-bg { width: min(100%, 560px); aspect-ratio: 16 / 10; border-radius: 6px; } .pv-bg-content { display: inline-block; padding: 4px 8px; background: rgb(255 255 255 / .75); color: #111; border-radius: 4px; font-size: 13px; } .pv-clip-text { font-size: 64px; font-weight: 900; line-height: 1; margin: 0; text-align: center; }',
      outputs: [css(rule('.hero', shown)), tailwind(classes, image && v.image !== 'gradient' ? 'add bg-[url(...)] with your image path' : undefined)],
      note:
        v.image === 'url'
          ? 'The preview cannot show a remote or relative image; the generated CSS is unaffected.'
          : v.image === 'scene' || v.image === 'tile'
            ? 'The sample image is embedded for the preview; the code uses a placeholder file name.'
            : undefined,
    };
  },
});
