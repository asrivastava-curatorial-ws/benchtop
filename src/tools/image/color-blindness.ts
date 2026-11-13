import { type Deficiency, simulateDeficiency } from '../../lib/pixels';
import { defineImageTool } from '../types';
import { transformPixels } from './_shared';

const KINDS: { value: Deficiency; label: string; note: string }[] = [
  { value: 'protanopia', label: 'Protanopia', note: 'no red cones (about 1% of men)' },
  { value: 'deuteranopia', label: 'Deuteranopia', note: 'no green cones (about 1% of men)' },
  { value: 'tritanopia', label: 'Tritanopia', note: 'no blue cones (rare)' },
  { value: 'achromatopsia', label: 'Achromatopsia', note: 'no colour vision (very rare)' },
];

export default defineImageTool({
  controls: [
    { key: 'view', label: 'Show', type: 'select', choices: [{ value: 'all', label: 'All four side by side' }, ...KINDS.map((kind) => ({ value: kind.value, label: kind.label }))], default: 'all' },
  ],
  process(source, values) {
    const kinds = values.view === 'all' ? KINDS : KINDS.filter((kind) => kind.value === values.view);
    return {
      outputs: kinds.map((kind) => ({ label: kind.label, canvas: transformPixels(source, (pixels) => simulateDeficiency(pixels, kind.value)) })),
      info: `${kinds.map((kind) => `${kind.label}: ${kind.note}`).join('. ')}. Simulation by Machado, Oliveira and Fernandes (2009), at full severity.`,
    };
  },
});
