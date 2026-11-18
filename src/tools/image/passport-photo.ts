import { context2d, createCanvas } from '../../ui/canvas';
import { defineImageTool, type Values } from '../types';

interface Spec {
  readonly w: number;
  readonly h: number;
  /** Head height (chin to crown) in mm, smallest and largest allowed. */
  readonly head: readonly [number, number];
  /** Typical space above the crown, in mm. */
  readonly crown: number;
}

const SPECS: Record<string, Spec> = {
  '35x45': { w: 35, h: 45, head: [32, 36], crown: 4 },
  '51x51': { w: 50.8, h: 50.8, head: [25.4, 34.9], crown: 6 },
  '33x48': { w: 33, h: 48, head: [28, 33], crown: 4 },
};

const SHEETS: Record<string, [number, number]> = {
  '4x6': [101.6, 152.4],
  '5x7': [127, 177.8],
  a4: [210, 297],
};

const mmToPx = (mm: number, dpi: number) => Math.round((mm / 25.4) * dpi);

export default defineImageTool({
  controls: [
    {
      key: 'size',
      label: 'Photo size',
      type: 'select',
      choices: [
        { value: '35x45', label: '35 × 45 mm (India, UK, EU, Australia and many others)' },
        { value: '51x51', label: '2 × 2 in, 51 × 51 mm (USA, India visa and OCI)' },
        { value: '33x48', label: '33 × 48 mm (China visa)' },
        { value: 'custom', label: 'Other size' },
      ],
      default: '35x45',
    },
    { key: 'width', label: 'Width', type: 'number', min: 10, max: 150, step: 0.5, unit: 'mm', default: 35, showIf: (v: Values) => v.size === 'custom' },
    { key: 'height', label: 'Height', type: 'number', min: 10, max: 150, step: 0.5, unit: 'mm', default: 45, showIf: (v: Values) => v.size === 'custom' },
    { key: 'zoom', label: 'Zoom', type: 'range', min: 30, max: 400, step: 1, unit: '%', default: 100, help: 'Make the head fill the space between the guide lines.' },
    { key: 'x', label: 'Move left or right', type: 'range', min: -60, max: 60, step: 0.5, unit: '%', default: 0 },
    { key: 'y', label: 'Move up or down', type: 'range', min: -60, max: 60, step: 0.5, unit: '%', default: 0 },
    { key: 'background', label: 'Fill colour', type: 'color', default: '#ffffff', help: 'Shows where the photo does not cover the frame. To replace a busy background, use Background Remover first.' },
    {
      key: 'sheet',
      label: 'Print sheet',
      type: 'select',
      choices: [
        { value: '4x6', label: '4 × 6 in (10 × 15 cm photo paper)' },
        { value: '5x7', label: '5 × 7 in' },
        { value: 'a4', label: 'A4' },
        { value: 'none', label: 'No sheet' },
      ],
      default: '4x6',
    },
    { key: 'cut', label: 'Cutting lines', type: 'toggle', default: true, showIf: (v: Values) => v.sheet !== 'none' },
    {
      key: 'dpi',
      label: 'Resolution',
      type: 'segmented',
      choices: [
        { value: '300', label: '300 dpi' },
        { value: '600', label: '600 dpi' },
      ],
      default: '300',
    },
  ],
  formats: ['jpeg', 'png', 'webp'],
  showSource: false,
  process(source, v) {
    const dpi = Number(v.dpi) || 300;
    const spec: Spec = SPECS[v.size] ?? { w: v.width, h: v.height, head: [v.height * 0.7, v.height * 0.8], crown: v.height * 0.08 };
    const w = mmToPx(spec.w, dpi);
    const h = mmToPx(spec.h, dpi);
    const photo = createCanvas(w, h);
    const context = context2d(photo);
    context.fillStyle = v.background;
    context.fillRect(0, 0, w, h);
    const scale = Math.max(w / source.width, h / source.height) * (v.zoom / 100);
    const dw = source.width * scale;
    const dh = source.height * scale;
    context.imageSmoothingQuality = 'high';
    context.drawImage(source, (w - dw) / 2 + (v.x / 100) * w, (h - dh) / 2 + (v.y / 100) * h, dw, dh);

    // The same photo with the head guides.
    const guide = createCanvas(w, h);
    const g = context2d(guide);
    g.drawImage(photo, 0, 0);
    const px = (mm: number) => (mm / spec.h) * h;
    const crown = px(spec.crown);
    const chinNear = crown + px(spec.head[0]);
    const chinFar = crown + px(spec.head[1]);
    g.lineWidth = Math.max(1.5, w / 250);
    g.strokeStyle = 'rgba(0, 170, 255, 0.9)';
    g.setLineDash([w / 40, w / 60]);
    for (const y of [crown, chinNear, chinFar]) {
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(w, y);
      g.stroke();
    }
    g.beginPath();
    g.moveTo(w / 2, 0);
    g.lineTo(w / 2, h);
    g.stroke();
    g.setLineDash([]);
    g.strokeStyle = 'rgba(255, 196, 0, 0.9)';
    g.beginPath();
    g.ellipse(w / 2, (crown + (chinNear + chinFar) / 2) / 2, ((chinNear + chinFar) / 2 - crown) * 0.37, ((chinNear + chinFar) / 2 - crown) / 2, 0, 0, Math.PI * 2);
    g.stroke();

    const outputs = [
      { label: 'Photo', canvas: photo },
      { label: 'Guide', canvas: guide },
    ];
    let info = `${spec.w} × ${spec.h} mm at ${dpi} dpi (${w} × ${h} px). Top line: top of the head. Lower lines: the chin should fall between them.`;
    if (v.sheet !== 'none') {
      const [sw, sh] = SHEETS[v.sheet];
      const sheetW = mmToPx(sw, dpi);
      const sheetH = mmToPx(sh, dpi);
      const gap = mmToPx(2, dpi);
      const margin = mmToPx(4, dpi);
      // Portrait sheet; try both orientations of the grid and keep the one with more copies.
      const columns = Math.max(1, Math.floor((sheetW - margin * 2 + gap) / (w + gap)));
      const rows = Math.max(1, Math.floor((sheetH - margin * 2 + gap) / (h + gap)));
      const sheet = createCanvas(sheetW, sheetH);
      const s = context2d(sheet);
      s.fillStyle = '#ffffff';
      s.fillRect(0, 0, sheetW, sheetH);
      const gridW = columns * w + (columns - 1) * gap;
      const gridH = rows * h + (rows - 1) * gap;
      const left = (sheetW - gridW) / 2;
      const top = (sheetH - gridH) / 2;
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < columns; c++) {
          const x = left + c * (w + gap);
          const y = top + r * (h + gap);
          s.drawImage(photo, x, y);
          if (v.cut) {
            s.strokeStyle = '#9aa4ad';
            s.lineWidth = Math.max(1, dpi / 300);
            s.strokeRect(x - 0.5, y - 0.5, w + 1, h + 1);
          }
        }
      outputs.push({ label: 'Print sheet', canvas: sheet });
      info += ` The sheet holds ${rows * columns} copies; print it at 100% (no scaling).`;
    }
    return { outputs, info: `${info} Rules change, so check the current requirements of the office you apply to.` };
  },
});
