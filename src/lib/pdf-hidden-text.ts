/** An invisible text layer over a page picture, so a scan or a flattened page can be searched and copied. */
import { type PDFFont, PDFNumber, PDFOperator, PDFOperatorNames, type PDFPage, popGraphicsState, pushGraphicsState } from 'pdf-lib';
import { actualText, textOperators, textWidth } from './pdf-text';

export interface Word {
  readonly text: string;
  /** In points, origin at the top left of the page. */
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** Writes each word where it is on the picture, in text rendering mode 3 (neither filled nor stroked). */
export function hiddenText(page: PDFPage, font: PDFFont, words: readonly Word[]): void {
  const usable = words.filter((word) => word.text.trim() && word.w > 0 && word.h > 0);
  if (!usable.length) return;
  const key = page.node.newFontDictionary(font.name, font.ref);
  const height = page.getHeight();
  const ops: PDFOperator[] = [pushGraphicsState(), PDFOperator.of(PDFOperatorNames.SetTextRenderingMode, [PDFNumber.of(3)])];
  for (const word of usable) {
    const size = Math.max(1, word.h * 0.8);
    let natural = 0;
    try {
      natural = textWidth(font, word.text, size);
    } catch {
      continue; // A character the font cannot write.
    }
    // The word is stretched to the width it has on the picture, so selections line up.
    const stretch = natural > 0 ? Math.min(1000, Math.max(10, (word.w / natural) * 100)) : 100;
    ops.push(PDFOperator.of(PDFOperatorNames.SetTextHorizontalScaling, [PDFNumber.of(Math.round(stretch * 100) / 100)]));
    ops.push(...actualText(font, word.text, textOperators(font, key, word.text, { x: word.x, y: height - word.y - word.h * 0.8, size })));
  }
  ops.push(popGraphicsState());
  page.pushOperators(...ops);
}
