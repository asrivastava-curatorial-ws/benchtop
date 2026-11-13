/** Lays out images in a sprite sheet and writes the CSS that shows each one. */
import { ToolError } from './errors';
import { slugify } from './words';

export interface SpriteInput {
  readonly name: string;
  readonly width: number;
  readonly height: number;
}

export interface Placed extends SpriteInput {
  readonly className: string;
  readonly x: number;
  readonly y: number;
}

export interface SpriteLayout {
  readonly width: number;
  readonly height: number;
  readonly items: readonly Placed[];
}

export type SpriteDirection = 'horizontal' | 'vertical' | 'grid';

export function layoutSprite(inputs: readonly SpriteInput[], direction: SpriteDirection, padding: number): SpriteLayout {
  if (inputs.length === 0) throw new ToolError('Add at least one image.');
  const used = new Set<string>();
  const nameOf = (name: string) => {
    const base = slugify(name.replace(/\.[^.]+$/, ''), { separator: '-', lowercase: true, maxLength: 60, keepUnicode: false }) || 'icon';
    let candidate = base;
    for (let n = 2; used.has(candidate); n++) candidate = `${base}-${n}`;
    used.add(candidate);
    return candidate;
  };
  const items: Placed[] = [];
  let width = 0;
  let height = 0;
  if (direction === 'grid') {
    const columns = Math.ceil(Math.sqrt(inputs.length));
    const cellW = Math.max(...inputs.map((input) => input.width));
    const cellH = Math.max(...inputs.map((input) => input.height));
    inputs.forEach((input, index) => {
      const x = (index % columns) * (cellW + padding);
      const y = Math.floor(index / columns) * (cellH + padding);
      items.push({ ...input, className: nameOf(input.name), x, y });
    });
    const rows = Math.ceil(inputs.length / columns);
    width = columns * cellW + (columns - 1) * padding;
    height = rows * cellH + (rows - 1) * padding;
  } else {
    let position = 0;
    for (const input of inputs) {
      const x = direction === 'horizontal' ? position : 0;
      const y = direction === 'vertical' ? position : 0;
      items.push({ ...input, className: nameOf(input.name), x, y });
      position += (direction === 'horizontal' ? input.width : input.height) + padding;
    }
    width = direction === 'horizontal' ? position - padding : Math.max(...inputs.map((input) => input.width));
    height = direction === 'vertical' ? position - padding : Math.max(...inputs.map((input) => input.height));
  }
  return { width, height, items };
}

/** CSS for the sheet.  With `scale` 2 the sheet is treated as @2x artwork and shown at half size. */
export function spriteCss(layout: SpriteLayout, imageUrl: string, prefix: string, scale: 1 | 2): string {
  const s = (value: number) => (value === 0 ? '0' : `${-value / scale}px`);
  const size = scale === 2 ? `\n  background-size: ${layout.width / 2}px ${layout.height / 2}px;` : '';
  const head = `.${prefix} {\n  display: inline-block;\n  background-image: url("${imageUrl}");\n  background-repeat: no-repeat;${size}\n}\n`;
  const rules = layout.items.map(
    (item) => `.${prefix}-${item.className} {\n  width: ${item.width / scale}px;\n  height: ${item.height / scale}px;\n  background-position: ${s(item.x)} ${s(item.y)};\n}`,
  );
  return `${head}\n${rules.join('\n\n')}\n`;
}

export function spriteHtml(layout: SpriteLayout, prefix: string): string {
  return `${layout.items.map((item) => `<span class="${prefix} ${prefix}-${item.className}" role="img" aria-label="${item.className.replace(/-/g, ' ')}"></span>`).join('\n')}\n`;
}
