import { diffuse, luminance, ordered, PALETTES, type Rgb } from '../../lib/dither';
import { context2d, createCanvas } from '../../ui/canvas';
import { defineImageTool, type Values } from '../types';

const hexRgb = (hex: string): Rgb => {
  const n = Number.parseInt(hex.replace('#', '').slice(0, 6).padEnd(6, '0'), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

const isHalftone = (v: Values) => v.method === 'halftone';
const usesPalette = (v: Values) => v.method !== 'halftone';

export default defineImageTool({
  controls: [
    {
      key: 'method',
      label: 'Method',
      type: 'select',
      choices: [
        { value: 'floyd', label: 'Floyd–Steinberg diffusion' },
        { value: 'atkinson', label: 'Atkinson (classic Mac)' },
        { value: 'stucki', label: 'Stucki (smooth)' },
        { value: 'bayer', label: 'Ordered (Bayer pattern)' },
        { value: 'threshold', label: 'Threshold (no dither)' },
        { value: 'halftone', label: 'Halftone dots' },
      ],
      default: 'atkinson',
    },
    {
      key: 'palette',
      label: 'Colours',
      type: 'select',
      choices: [...Object.entries(PALETTES).map(([value, p]) => ({ value, label: p.label })), { value: 'custom', label: 'Two colours of your own' }],
      default: 'bw',
      showIf: usesPalette,
    },
    { key: 'dark', label: 'Dark colour', type: 'color', default: '#1d2b53', showIf: (v: Values) => usesPalette(v) && v.palette === 'custom' },
    { key: 'light', label: 'Light colour', type: 'color', default: '#fff1e8', showIf: (v: Values) => usesPalette(v) && v.palette === 'custom' },
    { key: 'pixel', label: 'Pixel size', type: 'range', min: 1, max: 12, step: 1, unit: 'px', default: 2, showIf: usesPalette, help: 'Bigger pixels for a chunky, retro look.' },
    { key: 'pattern', label: 'Pattern size', type: 'select', choices: ['2', '4', '8'], default: '4', showIf: (v: Values) => v.method === 'bayer' },
    { key: 'brightness', label: 'Brightness', type: 'range', min: -100, max: 100, step: 1, default: 0 },
    { key: 'contrast', label: 'Contrast', type: 'range', min: -100, max: 100, step: 1, default: 10 },
    { key: 'cell', label: 'Dot spacing', type: 'range', min: 3, max: 40, step: 1, unit: 'px', default: 9, showIf: isHalftone },
    { key: 'angle', label: 'Screen angle', type: 'range', min: 0, max: 90, step: 1, unit: '°', default: 45, showIf: (v: Values) => isHalftone(v) && v.inks === 'mono' },
    {
      key: 'inks',
      label: 'Inks',
      type: 'segmented',
      choices: [
        { value: 'mono', label: 'One ink' },
        { value: 'cmyk', label: 'CMYK' },
      ],
      default: 'mono',
      showIf: isHalftone,
    },
    { key: 'ink', label: 'Ink', type: 'color', default: '#111111', showIf: (v: Values) => isHalftone(v) && v.inks === 'mono' },
    { key: 'paper', label: 'Paper', type: 'color', default: '#ffffff', showIf: isHalftone },
  ],
  presets: [
    { name: 'Newspaper photo', values: { method: 'halftone', inks: 'mono', cell: 7, angle: 45, ink: '#1e1e20', paper: '#ece8dc', contrast: 15 } },
    { name: 'Comic print', values: { method: 'halftone', inks: 'cmyk', cell: 10, paper: '#fffdf4', contrast: 20 } },
    { name: 'Game Boy', values: { method: 'bayer', palette: 'gameboy', pixel: 4, pattern: '4', contrast: 10 } },
    { name: 'Classic Mac', values: { method: 'atkinson', palette: 'bw', pixel: 2, contrast: 15 } },
    { name: 'Risograph', values: { method: 'floyd', palette: 'custom', dark: '#0078bf', light: '#fff8e7', pixel: 2, contrast: 20 } },
  ],
  process(source, v, env) {
    const w = source.width;
    const h = source.height;
    // Tone adjustments first.
    const b = v.brightness * 1.28;
    const k = (259 * (v.contrast * 1.28 + 255)) / (255 * (259 - v.contrast * 1.28));
    const tone = (x: number) => k * (x - 128) + 128 + b;

    if (v.method === 'halftone') {
      const out = createCanvas(w, h);
      const ctx = context2d(out);
      ctx.fillStyle = v.paper;
      ctx.fillRect(0, 0, w, h);
      const data = context2d(source, true).getImageData(0, 0, w, h).data;
      const cell = Math.max(2, v.cell * env.scale);
      const screens: { angle: number; color: string; amount: (r: number, g: number, b: number) => number }[] =
        v.inks === 'cmyk'
          ? [
              { angle: 15, color: '#00aeef', amount: (r, g, bb) => cmyk(r, g, bb)[0] },
              { angle: 75, color: '#ec008c', amount: (r, g, bb) => cmyk(r, g, bb)[1] },
              { angle: 0, color: '#fff200', amount: (r, g, bb) => cmyk(r, g, bb)[2] },
              { angle: 45, color: '#231f20', amount: (r, g, bb) => cmyk(r, g, bb)[3] },
            ]
          : [{ angle: v.angle, color: v.ink, amount: (r, g, bb) => 1 - luminance(r, g, bb) / 255 }];
      ctx.globalCompositeOperation = v.inks === 'cmyk' ? 'multiply' : 'source-over';
      const diag = Math.hypot(w, h);
      for (const screen of screens) {
        const a = (screen.angle * Math.PI) / 180;
        const cos = Math.cos(a);
        const sin = Math.sin(a);
        ctx.fillStyle = screen.color;
        ctx.beginPath();
        for (let gy = -diag; gy < diag; gy += cell)
          for (let gx = -diag; gx < diag; gx += cell) {
            const x = w / 2 + gx * cos - gy * sin;
            const y = h / 2 + gx * sin + gy * cos;
            if (x < -cell || y < -cell || x > w + cell || y > h + cell) continue;
            const px = Math.min(w - 1, Math.max(0, Math.round(x)));
            const py = Math.min(h - 1, Math.max(0, Math.round(y)));
            const i = (py * w + px) * 4;
            const amount = screen.amount(clamp(tone(data[i] as number)), clamp(tone(data[i + 1] as number)), clamp(tone(data[i + 2] as number)));
            // Dot area grows with ink coverage.
            const r = (cell / Math.SQRT2) * Math.sqrt(Math.max(0, Math.min(1, amount)));
            if (r < 0.3) continue;
            ctx.moveTo(x + r, y);
            ctx.arc(x, y, r, 0, Math.PI * 2);
          }
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
      return { outputs: [{ canvas: out }] };
    }

    const block = Math.max(1, Math.round(v.pixel * env.scale));
    const sw = Math.max(1, Math.round(w / block));
    const sh = Math.max(1, Math.round(h / block));
    const small = createCanvas(sw, sh);
    const sctx = context2d(small, true);
    sctx.imageSmoothingQuality = 'high';
    sctx.drawImage(source, 0, 0, sw, sh);
    const img = sctx.getImageData(0, 0, sw, sh);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      d[i] = tone(d[i] as number);
      d[i + 1] = tone(d[i + 1] as number);
      d[i + 2] = tone(d[i + 2] as number);
    }
    const palette = v.palette === 'custom' ? [hexRgb(v.dark), hexRgb(v.light)] : ((PALETTES[v.palette] ?? PALETTES.bw)?.colors ?? []);
    if (v.method === 'bayer') ordered(d, sw, sh, palette, v.pattern === '2' ? 1 : v.pattern === '8' ? 3 : 2);
    else if (v.method === 'threshold') nearestOnly(d, palette);
    else diffuse(d, sw, sh, palette, v.method as 'floyd' | 'atkinson' | 'stucki');
    sctx.putImageData(img, 0, 0);
    const out = createCanvas(w, h);
    const octx = context2d(out);
    octx.imageSmoothingEnabled = false;
    octx.drawImage(small, 0, 0, w, h);
    return { outputs: [{ canvas: out }], info: `${palette.length} colours, ${sw} × ${sh} dots` };
  },
});

const clamp = (x: number) => Math.max(0, Math.min(255, x));

function cmyk(r: number, g: number, b: number): [number, number, number, number] {
  const c = 1 - r / 255;
  const m = 1 - g / 255;
  const y = 1 - b / 255;
  const k = Math.min(c, m, y);
  if (k >= 1) return [0, 0, 0, 1];
  return [(c - k) / (1 - k), (m - k) / (1 - k), (y - k) / (1 - k), k];
}

function nearestOnly(d: Uint8ClampedArray, palette: readonly Rgb[]) {
  for (let i = 0; i < d.length; i += 4) {
    let best = palette[0] as Rgb;
    let bestD = Number.POSITIVE_INFINITY;
    for (const c of palette) {
      const dist = 0.3 * ((d[i] as number) - c[0]) ** 2 + 0.59 * ((d[i + 1] as number) - c[1]) ** 2 + 0.11 * ((d[i + 2] as number) - c[2]) ** 2;
      if (dist < bestD) {
        bestD = dist;
        best = c;
      }
    }
    d[i] = best[0];
    d[i + 1] = best[1];
    d[i + 2] = best[2];
  }
}
