/**
 * D3.js Editor: write D3 code beside the chart it draws, with data files of
 * your own (CSV, TSV, JSON) that d3.csv and friends read in place of the
 * network.  Runs in a sealed frame; saves SVG, PNG or a web page.
 */
import { D3_EXAMPLES, D3_FILES } from '../../lib/code-frames';
import { defineCustomTool } from '../types';
import { type CodeFrameConfig, CodeFrameEditor } from './_code-frame';

const CONFIG: CodeFrameConfig = {
  kind: 'd3',
  frameSrc: './d3/frame.html',
  codeLabel: 'D3.js code',
  examples: D3_EXAMPLES,
  files: D3_FILES,
  library: async () => {
    const [code, licence] = await Promise.all([import('../../../node_modules/d3/dist/d3.min.js?raw').then((m) => m.default), import('../../../node_modules/d3/LICENSE?raw').then((m) => m.default)]);
    return { code, licence };
  },
  fileBase: 'chart',
  width: 760,
  height: 440,
  noSvg: 'There is no SVG in the drawing to save.',
  help: (
    <>
      “svg” is an SVG of the size above, “width” and “height” its size, “data” the first data file (parsed, with numbers as numbers) and “files” all of them by name; d3.csv, d3.tsv, d3.json and
      d3.text read the data files. The code runs in a frame of its own that cannot reach your files, the app or the network. An endless loop freezes the page, as in any browser: leave “Run as I type”
      off while writing loops.
    </>
  ),
};

function D3Editor({ toolId }: { toolId: string }) {
  return <CodeFrameEditor toolId={toolId} config={CONFIG} />;
}

export default defineCustomTool(D3Editor);
