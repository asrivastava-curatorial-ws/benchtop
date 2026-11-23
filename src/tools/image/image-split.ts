import { ToolError } from '../../lib/errors';
import { context2d, createCanvas } from '../../ui/canvas';
import { defineImageTool, type Values } from '../types';

const custom = (v: Values) => v.layout === 'custom';

const LAYOUTS: Record<string, { cols: number; rows: number }> = {
  carousel2: { cols: 2, rows: 1 },
  carousel3: { cols: 3, rows: 1 },
  carousel4: { cols: 4, rows: 1 },
  grid3: { cols: 3, rows: 3 },
  halves: { cols: 1, rows: 2 },
  quarters: { cols: 2, rows: 2 },
};

export default defineImageTool({
  controls: [
    {
      key: 'layout',
      label: 'Split into',
      type: 'select',
      choices: [
        { value: 'carousel3', label: '3 side by side (panorama carousel)' },
        { value: 'carousel2', label: '2 side by side' },
        { value: 'carousel4', label: '4 side by side' },
        { value: 'grid3', label: '3 × 3 profile grid' },
        { value: 'quarters', label: '2 × 2 quarters' },
        { value: 'halves', label: 'Top and bottom halves' },
        { value: 'custom', label: 'Rows and columns of my choice' },
      ],
      default: 'carousel3',
    },
    { key: 'cols', label: 'Columns', type: 'number', min: 1, max: 20, step: 1, default: 3, showIf: custom },
    { key: 'rows', label: 'Rows', type: 'number', min: 1, max: 20, step: 1, default: 2, showIf: custom },
    { key: 'square', label: 'Make each tile square', type: 'toggle', default: false, help: 'Crops the picture first so that every tile is square, as Instagram grids need.' },
  ],
  showSource: false,
  process(source, v) {
    const preset = LAYOUTS[v.layout];
    const cols = Math.max(1, Math.min(20, Math.round(preset?.cols ?? v.cols)));
    const rows = Math.max(1, Math.min(20, Math.round(preset?.rows ?? v.rows)));
    let sx = 0;
    let sy = 0;
    let sw = source.width;
    let sh = source.height;
    if (v.square) {
      // The largest centred area whose tiles are square.
      const tile = Math.min(sw / cols, sh / rows);
      const nw = tile * cols;
      const nh = tile * rows;
      sx = (sw - nw) / 2;
      sy = (sh - nh) / 2;
      sw = nw;
      sh = nh;
    }
    const tw = Math.floor(sw / cols);
    const th = Math.floor(sh / rows);
    if (tw < 1 || th < 1) throw new ToolError('The picture is too small for that many tiles.');
    const outputs = [];
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const canvas = createCanvas(tw, th);
        context2d(canvas).drawImage(source, sx + c * tw, sy + r * th, tw, th, 0, 0, tw, th);
        outputs.push({ canvas, label: rows === 1 ? `Part ${c + 1}` : `Row ${r + 1} column ${c + 1}` });
      }
    return { outputs, info: `${outputs.length} tiles of ${tw} × ${th} px. Post them in order: left to right, top to bottom.` };
  },
});
