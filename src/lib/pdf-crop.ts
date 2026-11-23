/** Cropping PDF pages by setting their boxes; nothing on the page is removed. */
import type { PDFDocument } from 'pdf-lib';

export interface Margins {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

/** Margins as seen on screen, turned into margins of the page's own (unrotated) box. */
export function boxMargins(visual: Margins, rotate: number): Margins {
  switch (((rotate % 360) + 360) % 360) {
    case 90:
      return { left: visual.top, top: visual.right, right: visual.bottom, bottom: visual.left };
    case 180:
      return { top: visual.bottom, bottom: visual.top, left: visual.right, right: visual.left };
    case 270:
      return { right: visual.top, bottom: visual.right, left: visual.bottom, top: visual.left };
    default:
      return visual;
  }
}

/**
 * Crops pages (1-based numbers) by margins in points, measured from the
 * current crop box.  "permanent" also changes the paper size (media box) and
 * the trim, bleed and art boxes, so every program sees the smaller page.
 */
export function cropPages(doc: PDFDocument, pages: readonly number[], margins: (page: number) => Margins, permanent: boolean): void {
  for (const n of pages) {
    const page = doc.getPage(n - 1);
    const base = page.getCropBox();
    const m = boxMargins(margins(n), page.getRotation().angle);
    const width = base.width - m.left - m.right;
    const height = base.height - m.top - m.bottom;
    if (width < 1 || height < 1) throw new RangeError(`The margins are larger than page ${n}.`);
    const x = base.x + m.left;
    const y = base.y + m.bottom;
    page.setCropBox(x, y, width, height);
    if (permanent) {
      page.setMediaBox(x, y, width, height);
      page.setTrimBox(x, y, width, height);
      page.setBleedBox(x, y, width, height);
      page.setArtBox(x, y, width, height);
    }
  }
}

/** Bounds of the non-white pixels of a rendered page, as margins in pixels. */
export function contentMargins(data: Uint8ClampedArray, width: number, height: number, threshold = 245): Margins | null {
  let top = height;
  let bottom = -1;
  let left = width;
  let right = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const a = data[i + 3] as number;
      if (a < 16) continue;
      if ((data[i] as number) > threshold && (data[i + 1] as number) > threshold && (data[i + 2] as number) > threshold) continue;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
      if (x < left) left = x;
      if (x > right) right = x;
    }
  }
  if (bottom < 0) return null;
  return { top, left, bottom: height - 1 - bottom, right: width - 1 - right };
}
