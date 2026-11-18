/** Text drawing shared by the watermark, caption and frame tools. */
import '@fontsource/barlow/latin-700.css';
import '@fontsource/barlow-semi-condensed/latin-700.css';

export const FONTS = [
  { value: 'sans', label: 'Sans (Barlow)' },
  { value: 'condensed', label: 'Condensed (Barlow Semi Condensed)' },
  { value: 'serif', label: 'Serif (system)' },
  { value: 'mono', label: 'Monospace (JetBrains Mono)' },
] as const;

const FAMILIES: Record<string, string> = {
  sans: '"Barlow", system-ui, sans-serif',
  condensed: '"Barlow Semi Condensed", "Barlow", system-ui, sans-serif',
  serif: 'Georgia, "Times New Roman", serif',
  mono: '"JetBrains Mono Variable", ui-monospace, monospace',
};

export function fontFor(kind: string, weight: number, size: number): string {
  return `${weight} ${Math.max(1, Math.round(size))}px ${FAMILIES[kind] ?? FAMILIES.sans}`;
}

/** Waits for a bundled font, so the first drawing does not use a fallback. */
export async function ready(font: string): Promise<void> {
  try {
    await document.fonts.load(font);
  } catch {
    // Drawing still works with a fallback font.
  }
}

/** Breaks text into lines no wider than `width`, keeping explicit line breaks. */
export function wrap(context: CanvasRenderingContext2D, text: string, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (!words.length) {
      lines.push('');
      continue;
    }
    let line = words[0];
    for (const word of words.slice(1)) {
      const next = `${line} ${word}`;
      if (context.measureText(next).width <= width) line = next;
      else {
        lines.push(line);
        line = word;
      }
    }
    lines.push(line);
  }
  return lines;
}

export function hexToRgba(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  const v = m ? Number.parseInt(m[1], 16) : 0;
  return `rgba(${(v >> 16) & 255}, ${(v >> 8) & 255}, ${v & 255}, ${Math.min(1, Math.max(0, alpha))})`;
}
