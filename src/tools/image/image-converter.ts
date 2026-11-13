import { defineImageTool } from '../types';
import { copyCanvas } from './_shared';

export default defineImageTool({
  controls: [],
  showSource: false,
  process(source) {
    return { outputs: [{ label: 'Image', canvas: copyCanvas(source) }], info: 'Choose a format and quality below the options; the size estimate updates as you change them.' };
  },
});
