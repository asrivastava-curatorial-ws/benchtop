/** Canvas plumbing shared by the image tools. */
import type { Pixels } from '../../lib/pixels';
import { context2d, createCanvas } from '../../ui/canvas';

export function readPixels(canvas: HTMLCanvasElement): Pixels {
  return context2d(canvas, true).getImageData(0, 0, canvas.width, canvas.height).data;
}

/** A new canvas holding the given RGBA pixels. */
export function canvasFrom(pixels: Pixels, width: number, height: number): HTMLCanvasElement {
  const canvas = createCanvas(width, height);
  const data = new ImageData(width, height);
  data.data.set(pixels);
  context2d(canvas).putImageData(data, 0, 0);
  return canvas;
}

/** Runs a pixel transform and returns the result as a new canvas of the same size. */
export function transformPixels(source: HTMLCanvasElement, transform: (pixels: Pixels, width: number, height: number) => Pixels): HTMLCanvasElement {
  return canvasFrom(transform(readPixels(source), source.width, source.height), source.width, source.height);
}

export function copyCanvas(source: HTMLCanvasElement): HTMLCanvasElement {
  const canvas = createCanvas(source.width, source.height);
  context2d(canvas).drawImage(source, 0, 0);
  return canvas;
}
