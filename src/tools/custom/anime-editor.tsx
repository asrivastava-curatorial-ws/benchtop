/**
 * anime.js Editor: write anime.js code beside the animation it makes —
 * staggers, timelines, SVG line drawing and motion paths, springs, split
 * text.  Runs in a sealed frame; saves the result as a web page (and as SVG
 * or PNG when it draws in SVG).
 */
import { ANIME_EXAMPLES } from '../../lib/code-frames';
import { defineCustomTool } from '../types';
import { type CodeFrameConfig, CodeFrameEditor } from './_code-frame';

const CONFIG: CodeFrameConfig = {
  kind: 'anime',
  frameSrc: './anime/frame.html',
  codeLabel: 'anime.js code',
  examples: ANIME_EXAMPLES,
  library: async () => {
    const [code, licence] = await Promise.all([
      import('../../../node_modules/animejs/dist/bundles/anime.umd.min.js?raw').then((m) => m.default),
      import('../../../node_modules/animejs/LICENSE.md?raw').then((m) => m.default),
    ]);
    return { code, licence };
  },
  fileBase: 'animation',
  width: 760,
  height: 440,
  noSvg: 'This animation moves page elements rather than an SVG, so it can only be saved as a web page.',
  help: (
    <>
      “stage” is the drawing area, “width” and “height” its size, and every anime.js function — animate, createTimeline, stagger, splitText, createSpring, svg.createDrawable and the rest — is ready to
      use (anime.js 4). The code runs in a frame of its own that cannot reach your files, the app or the network, so pictures must be given as data URLs.
    </>
  ),
};

function AnimeEditor({ toolId }: { toolId: string }) {
  return <CodeFrameEditor toolId={toolId} config={CONFIG} />;
}

export default defineCustomTool(AnimeEditor);
