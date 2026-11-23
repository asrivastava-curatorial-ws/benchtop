import { context2d, createCanvas } from '../../ui/canvas';
import { defineImageTool, type Values } from '../types';

export const SOCIAL_SIZES: Record<string, { label: string; width: number; height: number }> = {
  'ig-square': { label: 'Instagram post, square (1080 × 1080)', width: 1080, height: 1080 },
  'ig-portrait': { label: 'Instagram post, portrait (1080 × 1350)', width: 1080, height: 1350 },
  'ig-story': { label: 'Instagram or WhatsApp story, reel (1080 × 1920)', width: 1080, height: 1920 },
  'fb-cover': { label: 'Facebook page cover (851 × 315)', width: 851, height: 315 },
  'fb-post': { label: 'Facebook link image (1200 × 630)', width: 1200, height: 630 },
  'x-post': { label: 'X post image (1600 × 900)', width: 1600, height: 900 },
  'x-header': { label: 'X header (1500 × 500)', width: 1500, height: 500 },
  'li-banner': { label: 'LinkedIn profile banner (1584 × 396)', width: 1584, height: 396 },
  'li-post': { label: 'LinkedIn post (1200 × 627)', width: 1200, height: 627 },
  'yt-thumb': { label: 'YouTube thumbnail (1280 × 720)', width: 1280, height: 720 },
  'yt-banner': { label: 'YouTube channel banner (2560 × 1440)', width: 2560, height: 1440 },
  avatar: { label: 'Profile picture (800 × 800)', width: 800, height: 800 },
  og: { label: 'Website share image, Open Graph (1200 × 630)', width: 1200, height: 630 },
  custom: { label: 'Custom size', width: 1200, height: 800 },
};

const matte = (v: Values) => v.fit === 'contain';

export default defineImageTool({
  controls: [
    { key: 'size', label: 'For', type: 'select', choices: Object.entries(SOCIAL_SIZES).map(([value, s]) => ({ value, label: s.label })), default: 'ig-square' },
    { key: 'width', label: 'Width', type: 'number', min: 16, max: 8000, step: 1, unit: 'px', default: 1200, showIf: (v: Values) => v.size === 'custom' },
    { key: 'height', label: 'Height', type: 'number', min: 16, max: 8000, step: 1, unit: 'px', default: 800, showIf: (v: Values) => v.size === 'custom' },
    {
      key: 'fit',
      label: 'Fit',
      type: 'segmented',
      choices: [
        { value: 'cover', label: 'Fill and crop' },
        { value: 'contain', label: 'Whole picture on a matte' },
      ],
      default: 'cover',
    },
    { key: 'focusX', label: 'Keep in view: across', type: 'range', min: 0, max: 100, step: 1, unit: '%', default: 50, showIf: (v: Values) => v.fit === 'cover' },
    { key: 'focusY', label: 'Keep in view: down', type: 'range', min: 0, max: 100, step: 1, unit: '%', default: 50, showIf: (v: Values) => v.fit === 'cover' },
    { key: 'zoom', label: 'Zoom', type: 'range', min: 100, max: 300, step: 1, unit: '%', default: 100, showIf: (v: Values) => v.fit === 'cover' },
    {
      key: 'matteStyle',
      label: 'Matte',
      type: 'segmented',
      choices: [
        { value: 'blur', label: 'Blurred picture' },
        { value: 'colour', label: 'Colour' },
      ],
      default: 'blur',
      showIf: matte,
    },
    { key: 'colour', label: 'Matte colour', type: 'color', default: '#f4f1ea', showIf: (v: Values) => matte(v) && v.matteStyle === 'colour' },
    { key: 'padding', label: 'Space around', type: 'range', min: 0, max: 30, step: 1, unit: '%', default: 6, showIf: matte },
  ],
  showSource: false,
  process(source, v, env) {
    const s = SOCIAL_SIZES[v.size] ?? SOCIAL_SIZES['ig-square'];
    const W = v.size === 'custom' ? v.width : (s?.width ?? 1080);
    const H = v.size === 'custom' ? v.height : (s?.height ?? 1080);
    // Previews draw at the same reduction as the source.
    const w = Math.max(1, Math.round(W * env.scale));
    const h = Math.max(1, Math.round(H * env.scale));
    const out = createCanvas(w, h);
    const ctx = context2d(out);
    ctx.imageSmoothingQuality = 'high';
    if (v.fit === 'cover') {
      const scale = Math.max(w / source.width, h / source.height) * (v.zoom / 100);
      const dw = source.width * scale;
      const dh = source.height * scale;
      const dx = (w - dw) * (v.focusX / 100);
      const dy = (h - dh) * (v.focusY / 100);
      ctx.drawImage(source, dx, dy, dw, dh);
    } else {
      if (v.matteStyle === 'blur') {
        const scale = Math.max(w / source.width, h / source.height) * 1.1;
        ctx.filter = `blur(${Math.max(4, Math.round(Math.min(w, h) * 0.04))}px) brightness(0.9)`;
        ctx.drawImage(source, (w - source.width * scale) / 2, (h - source.height * scale) / 2, source.width * scale, source.height * scale);
        ctx.filter = 'none';
      } else {
        ctx.fillStyle = v.colour;
        ctx.fillRect(0, 0, w, h);
      }
      const pad = Math.min(w, h) * (v.padding / 100);
      const scale = Math.min((w - 2 * pad) / source.width, (h - 2 * pad) / source.height);
      const dw = source.width * scale;
      const dh = source.height * scale;
      ctx.drawImage(source, (w - dw) / 2, (h - dh) / 2, dw, dh);
    }
    return { outputs: [{ canvas: out }], info: `${W} × ${H} px` };
  },
});
