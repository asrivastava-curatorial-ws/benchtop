/**
 * LaTeX maths to SVG and MathML with MathJax 3 (Apache 2.0), using its
 * DOM-free "lite" adaptor so it runs anywhere, workers included.  The SVG is
 * self-contained (glyph paths inline, no font cache), so it can be saved,
 * pasted into documents or turned into a PNG.
 */
import { liteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor.js';
import { STATE } from 'mathjax-full/js/core/MathItem.js';
import type { MmlNode } from 'mathjax-full/js/core/MmlTree/MmlNode.js';
import { SerializedMmlVisitor } from 'mathjax-full/js/core/MmlTree/SerializedMmlVisitor.js';
import { RegisterHTMLHandler } from 'mathjax-full/js/handlers/html.js';
import { AllPackages } from 'mathjax-full/js/input/tex/AllPackages.js';
import { TeX } from 'mathjax-full/js/input/tex.js';
import { mathjax } from 'mathjax-full/js/mathjax.js';
import { SVG } from 'mathjax-full/js/output/svg.js';

// Errors should be reported, not drawn in red; nothing may be loaded at run time.
const PACKAGES = AllPackages.filter((p: string) => !['noerrors', 'noundefined', 'autoload', 'require', 'bussproofs'].includes(p));

const adaptor = liteAdaptor();
RegisterHTMLHandler(adaptor);
const svgDocument = mathjax.document('', { InputJax: new TeX({ packages: PACKAGES }), OutputJax: new SVG({ fontCache: 'none' }) });
const mmlDocument = mathjax.document('', { InputJax: new TeX({ packages: PACKAGES }) });
const visitor = new SerializedMmlVisitor();

export interface TexResult {
  readonly svg: string;
  readonly mathml: string;
  readonly error: string | null;
  /** Size in pixels, and how far below the text baseline the picture reaches (for inline maths). */
  readonly width: number;
  readonly height: number;
  readonly depth: number;
}

export interface TexOptions {
  readonly display: boolean;
  /** Size of 1em in pixels when the SVG is drawn on its own. */
  readonly scale?: number;
  readonly color?: string;
}

export function texToSvg(latex: string, o: TexOptions): TexResult {
  const node = svgDocument.convert(latex, { display: o.display, em: 16, ex: 8, containerWidth: 1200 });
  let svg = adaptor.innerHTML(node);
  const error = /data-mjx-error="([^"]*)"/.exec(svg)?.[1] ?? null;
  // MathJax sizes the SVG in ex units; give it pixels (1ex = 0.431em in its default font) and a colour.
  const px = o.scale ?? 24;
  const exToPx = (ex: string) => Number((Number(ex) * px * 0.431).toFixed(2));
  const width = exToPx(/width="([\d.]+)ex"/.exec(svg)?.[1] ?? '0');
  const height = exToPx(/height="([\d.]+)ex"/.exec(svg)?.[1] ?? '0');
  const depth = -exToPx(/vertical-align:\s*(-?[\d.]+)ex/.exec(svg)?.[1] ?? '0');
  svg = svg
    .replace(/width="[\d.]+ex"/, `width="${width}"`)
    .replace(/height="[\d.]+ex"/, `height="${height}"`)
    .replace(/\s*style="vertical-align:[^"]*"/, '');
  if (o.color) svg = svg.replace(/currentColor/g, o.color);
  if (!svg.includes('xmlns="http://www.w3.org/2000/svg"')) svg = svg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
  // MathJax marks the picture as an image; name it with its TeX so that it is not an image without a description.
  const label = latex.replace(/^\s*\\displaystyle\s*/, '').trim();
  const name = label.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  svg = svg.replace(/^<svg( xmlns="http:\/\/www\.w3\.org\/2000\/svg")?/, (start) => `${start} aria-label="${name}"`);
  const mml = mmlDocument.convert(latex, { display: o.display, end: STATE.CONVERT }) as MmlNode;
  return { svg, mathml: visitor.visitTree(mml), error: error ? decodeEntities(error) : null, width, height, depth: Math.max(0, depth) };
}

/** LaTeX to MathML only (no SVG): light enough for a report of many formulas. */
export function texToMathml(latex: string, display = false): string {
  const mml = mmlDocument.convert(latex, { display, end: STATE.CONVERT }) as MmlNode;
  return visitor.visitTree(mml);
}

const decodeEntities = (s: string) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
