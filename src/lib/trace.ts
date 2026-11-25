/** Pictures traced into SVG shapes with ImageTracer (public domain), in the page. */
import { cjs } from '../recipe/core';
import { context2d, createCanvas } from '../ui/canvas';

export type Preset = 'logo' | 'artwork' | 'poster' | 'lineart';

export interface TraceSettings {
  readonly preset: Preset;
  readonly colours: number;
  readonly detail: number;
  readonly speckles: number;
  readonly smooth: number;
}

export const PRESETS: Record<Preset, Omit<TraceSettings, 'preset'>> = {
  logo: { colours: 6, detail: 1, speckles: 8, smooth: 0 },
  artwork: { colours: 16, detail: 0.5, speckles: 4, smooth: 0 },
  poster: { colours: 8, detail: 1, speckles: 16, smooth: 2 },
  lineart: { colours: 2, detail: 1, speckles: 8, smooth: 0 },
};

/** Largest side traced; bigger pictures are scaled down first (tracing time grows with area). */
const TRACE_EDGE = 1200;

export async function traceToSvg(canvas: HTMLCanvasElement, settings: TraceSettings): Promise<string> {
  const tracer = cjs(await import('imagetracerjs'));
  const scale = Math.min(1, TRACE_EDGE / Math.max(canvas.width, canvas.height));
  const work = createCanvas(canvas.width * scale, canvas.height * scale);
  const context = context2d(work, true);
  context.imageSmoothingQuality = 'high';
  context.drawImage(canvas, 0, 0, work.width, work.height);
  const data = context.getImageData(0, 0, work.width, work.height);
  const svg = tracer.imagedataToSVG(data, {
    numberofcolors: settings.colours,
    ltres: settings.detail,
    qtres: settings.detail,
    pathomit: settings.speckles,
    blurradius: settings.smooth,
    blurdelta: 20,
    colorsampling: 2,
    colorquantcycles: settings.colours <= 2 ? 1 : 3,
    roundcoords: 1,
    rightangleenhance: settings.preset !== 'artwork',
    scale: 1 / scale,
    viewbox: true,
    strokewidth: 0,
    linefilter: true,
  });
  return svg.replace('desc="Created with imagetracer.js version 1.2.6" ', '');
}
