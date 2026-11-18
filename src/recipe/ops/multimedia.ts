/** Multimedia and forensics: rendering, image editing, steganography helpers, file signatures and ELF headers. */
import { stripMetadata } from '../../lib/metadata';
import { bArg, bool, bytesToLatin1, defineOp, editable, hex, hexToBytes, nArg, num, OpError, type Operation, sArg, sel, str, toBytes } from '../core';
import { detectFileType, scanEmbedded } from '../filetypes';
import { blank, blur, decode, draw, encodeAs, encodeBmp, encodePng, hslToRgb, mapPixels, type Pixels, pngResult, rgbToHsl } from '../image';
import { base64Decode } from './data-format';

const M = 'Multimedia' as const;
const F = 'Forensics' as const;

function fromFormat(input: string, format: string): Uint8Array {
  if (format === 'Base64') return base64Decode(input, 'A-Za-z0-9+/=');
  if (format === 'Hex') return hexToBytes(input);
  return toBytes(input);
}

function imageOp(name: string, description: string, args: Operation['args'], transform: (px: Pixels, a: Record<string, unknown>) => Pixels | Promise<Pixels>): Operation {
  return defineOp({
    name,
    category: M,
    description,
    input: 'bytes',
    output: 'bytes',
    args,
    run: async (input, a) => pngResult(await transform(await decode(input), a)),
  });
}

const ALIGN_H = ['Left', 'Center', 'Right'];
const ALIGN_V = ['Top', 'Middle', 'Bottom'];
const SMOOTH = ['Nearest Neighbour', 'Bilinear'];

function fitInto(px: Pixels, a: Record<string, unknown>, cover: boolean): Pixels {
  const w = Math.max(1, Number(a.width));
  const h = Math.max(1, Number(a.height));
  const scale = cover ? Math.max(w / px.width, h / px.height) : Math.min(w / px.width, h / px.height);
  const dw = px.width * scale;
  const dh = px.height * scale;
  const x = a.alignH === 'Left' ? 0 : a.alignH === 'Right' ? w - dw : (w - dw) / 2;
  const y = a.alignV === 'Top' ? 0 : a.alignV === 'Bottom' ? h - dh : (h - dh) / 2;
  return draw(
    px,
    w,
    h,
    (ctx, source) => {
      if (a.opaque === true) {
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, w, h);
      }
      ctx.drawImage(source, x, y, dw, dh);
    },
    a.algorithm !== 'Nearest Neighbour',
  );
}

const CHANNELS = ['Red', 'Green', 'Blue', 'Alpha'];
const channelIndex = (name: string) => Math.max(0, CHANNELS.indexOf(name));

function seeded(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

function elfInfo(b: Uint8Array): string {
  if (b[0] !== 0x7f || b[1] !== 0x45 || b[2] !== 0x4c || b[3] !== 0x46) throw new OpError('This is not an ELF file.');
  const is64 = b[4] === 2;
  const little = b[5] === 1;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const u16 = (o: number) => v.getUint16(o, little);
  const u32 = (o: number) => v.getUint32(o, little);
  const addr = (o: number) => (is64 ? v.getBigUint64(o, little) : BigInt(u32(o)));
  const TYPES: Record<number, string> = { 0: 'None', 1: 'Relocatable', 2: 'Executable', 3: 'Shared object', 4: 'Core' };
  const MACHINES: Record<number, string> = { 3: 'x86', 8: 'MIPS', 20: 'PowerPC', 21: 'PowerPC64', 40: 'ARM', 62: 'x86-64', 183: 'AArch64', 243: 'RISC-V' };
  const OSABI: Record<number, string> = { 0: 'System V', 3: 'Linux', 6: 'Solaris', 9: 'FreeBSD', 12: 'OpenBSD' };
  const shoff = Number(addr(is64 ? 0x28 : 0x20));
  const shentsize = u16(is64 ? 0x3a : 0x2e);
  const shnum = u16(is64 ? 0x3c : 0x30);
  const shstrndx = u16(is64 ? 0x3e : 0x32);
  const lines = [
    `Class: ${is64 ? 'ELF64' : 'ELF32'}`,
    `Data: ${little ? 'little-endian' : 'big-endian'}`,
    `OS/ABI: ${OSABI[b[7] ?? 0] ?? b[7]}`,
    `Type: ${TYPES[u16(0x10)] ?? u16(0x10)}`,
    `Machine: ${MACHINES[u16(0x12)] ?? u16(0x12)}`,
    `Entry point: 0x${addr(0x18).toString(16)}`,
    `Program headers: ${u16(is64 ? 0x38 : 0x2c)} at offset ${Number(addr(is64 ? 0x20 : 0x1c))}`,
    `Section headers: ${shnum} at offset ${shoff}`,
  ];
  if (shoff > 0 && shoff + shnum * shentsize <= b.length && shstrndx < shnum) {
    const section = (i: number) => shoff + i * shentsize;
    const strOffset = Number(addr(section(shstrndx) + (is64 ? 0x18 : 0x10)));
    const name = (o: number) => {
      let end = strOffset + o;
      while (end < b.length && b[end] !== 0) end++;
      return bytesToLatin1(b.slice(strOffset + o, end));
    };
    lines.push('', 'Sections:');
    for (let i = 0; i < shnum; i++) {
      const s = section(i);
      const size = Number(addr(s + (is64 ? 0x20 : 0x14)));
      lines.push(`  [${String(i).padStart(2)}] ${name(u32(s)).padEnd(20)} size ${size}`);
    }
  }
  return lines.join('\n');
}

export const multimediaOps: Operation[] = [
  defineOp({
    name: 'Render Image',
    category: M,
    description: 'Shows image data (raw, Base64 or hex) as a picture.',
    input: 'text',
    output: 'bytes',
    args: [sel('format', 'Input format', ['Raw', 'Base64', 'Hex'])],
    magic: [{ pattern: /^(?:\xff\xd8\xff|\x89\x50\x4e\x47|\x47\x49\x46|.{8}\x57\x45\x42\x50|\x42\x4d)/s }],
    run: (input, a) => {
      const bytes = fromFormat(input, sArg(a, 'format'));
      const type = detectFileType(bytes);
      if (!type?.mime.startsWith('image/')) throw new OpError('This is not an image Benchtop recognises.');
      return { value: bytes, preview: { kind: 'image', bytes, mime: type.mime } };
    },
  }),
  defineOp({
    name: 'Play Media',
    category: M,
    description: 'Plays audio or video data (raw, Base64 or hex).',
    input: 'text',
    output: 'bytes',
    args: [sel('format', 'Input format', ['Raw', 'Base64', 'Hex'])],
    run: (input, a) => {
      const bytes = fromFormat(input, sArg(a, 'format'));
      const type = detectFileType(bytes);
      if (!type || !/^(audio|video)\//.test(type.mime)) throw new OpError('This is not audio or video Benchtop recognises.');
      return { value: bytes, preview: { kind: 'media', bytes, mime: type.mime } };
    },
  }),
  defineOp({
    name: 'Generate Image',
    category: M,
    description: 'Draws the bytes themselves as pixels, to spot structure in data.',
    input: 'bytes',
    output: 'bytes',
    args: [sel('mode', 'Mode', ['Greyscale', 'RG', 'RGB', 'RGBA', 'Bits']), num('scale', 'Pixel Scale Factor', 8, { min: 1, max: 64 }), num('perRow', 'Pixels per row', 64, { min: 1, max: 4096 })],
    run: async (input, a) => {
      const mode = sArg(a, 'mode');
      const per = mode === 'Bits' ? 1 / 8 : mode === 'Greyscale' ? 1 : mode === 'RG' ? 2 : mode === 'RGB' ? 3 : 4;
      const count = Math.ceil(input.length / per);
      if (count > 4_000_000) throw new OpError('Too much data to draw (over 4 million pixels).');
      const row = Math.max(1, nArg(a, 'perRow'));
      const base = blank(row, Math.ceil(count / row));
      for (let p = 0; p < count; p++) {
        let rgba: number[];
        if (mode === 'Bits') {
          const bit = ((input[p >> 3] ?? 0) >> (7 - (p & 7))) & 1;
          rgba = bit ? [255, 255, 255, 255] : [0, 0, 0, 255];
        } else {
          const at = p * per;
          const c = (i: number) => input[at + i] ?? 0;
          rgba = mode === 'Greyscale' ? [c(0), c(0), c(0), 255] : mode === 'RG' ? [c(0), c(1), 0, 255] : mode === 'RGB' ? [c(0), c(1), c(2), 255] : [c(0), c(1), c(2), c(3)];
        }
        base.data.set(rgba, p * 4);
      }
      const scale = Math.max(1, nArg(a, 'scale'));
      return pngResult(draw(base, base.width * scale, base.height * scale, (ctx, source) => ctx.drawImage(source, 0, 0, base.width * scale, base.height * scale), false));
    },
  }),
  defineOp({
    name: 'Split Colour Channels',
    category: M,
    description: 'Separates an image into red, green and blue images.',
    input: 'bytes',
    output: 'text',
    run: async (input) => {
      const px = await decode(input);
      const files = await Promise.all(
        ['red', 'green', 'blue'].map(async (name, ch) => ({
          name: `${name}.png`,
          bytes: await encodePng(mapPixels(px, (...rgba) => [ch === 0 ? rgba[0] : 0, ch === 1 ? rgba[1] : 0, ch === 2 ? rgba[2] : 0, rgba[3]])),
        })),
      );
      return { value: files.map((f) => f.name).join('\n'), preview: { kind: 'files', files } };
    },
  }),
  imageOp('Rotate Image', 'Rotates an image by any angle.', [num('degrees', 'Rotation amount (degrees)', 90)], (px, a) => {
    const rad = (Number(a.degrees) * Math.PI) / 180;
    const w = Math.abs(px.width * Math.cos(rad)) + Math.abs(px.height * Math.sin(rad));
    const h = Math.abs(px.width * Math.sin(rad)) + Math.abs(px.height * Math.cos(rad));
    return draw(px, w, h, (ctx, source) => {
      ctx.translate(w / 2, h / 2);
      ctx.rotate(rad);
      ctx.drawImage(source, -px.width / 2, -px.height / 2);
    });
  }),
  imageOp(
    'Resize Image',
    'Resizes an image.',
    [
      num('width', 'Width', 100, { min: 1 }),
      num('height', 'Height', 100, { min: 1 }),
      sel('unit', 'Unit type', ['Pixels', 'Percent']),
      bool('aspect', 'Maintain aspect ratio'),
      sel('algorithm', 'Resizing algorithm', SMOOTH, 'Bilinear'),
    ],
    (px, a) => {
      let w = Number(a.width);
      let h = Number(a.height);
      if (a.unit === 'Percent') {
        w = (px.width * w) / 100;
        h = (px.height * h) / 100;
      }
      if (a.aspect === true) h = (w * px.height) / px.width;
      if (w * h > 100_000_000) throw new OpError('That size is too large.');
      return draw(px, w, h, (ctx, source) => ctx.drawImage(source, 0, 0, w, h), a.algorithm !== 'Nearest Neighbour');
    },
  ),
  imageOp('Blur Image', 'Blurs an image.', [num('amount', 'Amount', 5, { min: 1, max: 100 }), sel('type', 'Type', ['Fast', 'Gaussian'])], (px, a) =>
    blur(px, Number(a.amount) / (a.type === 'Gaussian' ? 1.5 : 1), a.type === 'Gaussian' ? 3 : 1),
  ),
  imageOp('Dither Image', 'Reduces an image to black and white with Floyd–Steinberg dithering.', [], (px) => {
    const grey = new Float32Array(px.width * px.height);
    for (let i = 0; i < grey.length; i++) grey[i] = 0.299 * (px.data[i * 4] as number) + 0.587 * (px.data[i * 4 + 1] as number) + 0.114 * (px.data[i * 4 + 2] as number);
    const out = blank(px.width, px.height);
    for (let y = 0; y < px.height; y++) {
      for (let x = 0; x < px.width; x++) {
        const i = y * px.width + x;
        const old = grey[i] as number;
        const value = old < 128 ? 0 : 255;
        const err = old - value;
        if (x + 1 < px.width) grey[i + 1] = (grey[i + 1] as number) + (err * 7) / 16;
        if (y + 1 < px.height) {
          if (x > 0) grey[i + px.width - 1] = (grey[i + px.width - 1] as number) + (err * 3) / 16;
          grey[i + px.width] = (grey[i + px.width] as number) + (err * 5) / 16;
          if (x + 1 < px.width) grey[i + px.width + 1] = (grey[i + px.width + 1] as number) + err / 16;
        }
        out.data.set([value, value, value, px.data[i * 4 + 3] as number], i * 4);
      }
    }
    return out;
  }),
  imageOp('Invert Image', 'Inverts the colours of an image.', [], (px) => mapPixels(px, (r, g, b, a) => [255 - r, 255 - g, 255 - b, a])),
  imageOp('Flip Image', 'Mirrors an image horizontally or vertically.', [sel('axis', 'Axis', ['Horizontal', 'Vertical'])], (px, a) =>
    draw(px, px.width, px.height, (ctx, source) => {
      if (a.axis === 'Horizontal') {
        ctx.translate(px.width, 0);
        ctx.scale(-1, 1);
      } else {
        ctx.translate(0, px.height);
        ctx.scale(1, -1);
      }
      ctx.drawImage(source, 0, 0);
    }),
  ),
  imageOp(
    'Crop Image',
    'Cuts out part of an image, or trims a uniform border automatically.',
    [
      num('x', 'X Position', 0, { min: 0 }),
      num('y', 'Y Position', 0, { min: 0 }),
      num('width', 'Width', 10, { min: 1 }),
      num('height', 'Height', 10, { min: 1 }),
      bool('auto', 'Autocrop'),
      num('tolerance', 'Autocrop tolerance (%)', 0.02, { min: 0, max: 100, step: 0.01 }),
    ],
    (px, a) => {
      let { x, y, width, height } = { x: Number(a.x), y: Number(a.y), width: Number(a.width), height: Number(a.height) };
      if (a.auto === true) {
        const tol = (Number(a.tolerance) / 100) * 255 * 4;
        const ref = [0, 1, 2, 3].map((c) => px.data[c] as number);
        const same = (i: number) => [0, 1, 2, 3].reduce((s, c) => s + Math.abs((px.data[i * 4 + c] as number) - (ref[c] as number)), 0) <= tol;
        let top = 0;
        let bottom = px.height - 1;
        let left = 0;
        let right = px.width - 1;
        const rowSame = (row: number) => Array.from({ length: px.width }, (_, c) => same(row * px.width + c)).every(Boolean);
        const colSame = (col: number) => Array.from({ length: px.height }, (_, r) => same(r * px.width + col)).every(Boolean);
        while (top < bottom && rowSame(top)) top++;
        while (bottom > top && rowSame(bottom)) bottom--;
        while (left < right && colSame(left)) left++;
        while (right > left && colSame(right)) right--;
        ({ x, y, width, height } = { x: left, y: top, width: right - left + 1, height: bottom - top + 1 });
      }
      width = Math.min(width, px.width - x);
      height = Math.min(height, px.height - y);
      if (width <= 0 || height <= 0) throw new OpError('The crop area lies outside the image.');
      return draw(px, width, height, (ctx, source) => ctx.drawImage(source, -x, -y));
    },
  ),
  imageOp(
    'Image Brightness / Contrast',
    'Adjusts brightness and contrast (−100 to 100).',
    [num('brightness', 'Brightness', 0, { min: -100, max: 100 }), num('contrast', 'Contrast', 0, { min: -100, max: 100 })],
    (px, a) => {
      const b = (Number(a.brightness) / 100) * 255;
      const c = Number(a.contrast) / 100;
      const factor = (1 + c) / (1 - Math.min(0.99, c));
      const f = (v: number) => (v + b - 128) * factor + 128;
      return mapPixels(px, (r, g, bl, al) => [f(r), f(g), f(bl), al]);
    },
  ),
  imageOp('Image Opacity', 'Sets how opaque an image is.', [num('opacity', 'Opacity (%)', 100, { min: 0, max: 100 })], (px, a) =>
    mapPixels(px, (r, g, b, al) => [r, g, b, (al * Number(a.opacity)) / 100]),
  ),
  imageOp('Image Filter', 'Turns an image greyscale or sepia.', [sel('type', 'Filter type', ['Greyscale', 'Sepia'])], (px, a) =>
    mapPixels(px, (r, g, b, al) => {
      if (a.type === 'Sepia') return [0.393 * r + 0.769 * g + 0.189 * b, 0.349 * r + 0.686 * g + 0.168 * b, 0.272 * r + 0.534 * g + 0.131 * b, al];
      const y = 0.299 * r + 0.587 * g + 0.114 * b;
      return [y, y, y, al];
    }),
  ),
  imageOp(
    'Contain Image',
    'Scales an image to fit inside a box, keeping its proportions.',
    [
      num('width', 'Width', 100, { min: 1 }),
      num('height', 'Height', 100, { min: 1 }),
      sel('alignH', 'Horizontal align', ALIGN_H, 'Center'),
      sel('alignV', 'Vertical align', ALIGN_V, 'Middle'),
      sel('algorithm', 'Resizing algorithm', SMOOTH, 'Bilinear'),
      bool('opaque', 'Opaque background', true),
    ],
    (px, a) => fitInto(px, a, false),
  ),
  imageOp(
    'Cover Image',
    'Scales an image to fill a box, keeping its proportions and cropping the overflow.',
    [
      num('width', 'Width', 100, { min: 1 }),
      num('height', 'Height', 100, { min: 1 }),
      sel('alignH', 'Horizontal align', ALIGN_H, 'Center'),
      sel('alignV', 'Vertical align', ALIGN_V, 'Middle'),
      sel('algorithm', 'Resizing algorithm', SMOOTH, 'Bilinear'),
    ],
    (px, a) => fitInto(px, a, true),
  ),
  imageOp(
    'Image Hue/Saturation/Lightness',
    'Shifts hue (degrees) and adjusts saturation and lightness (−100 to 100).',
    [num('hue', 'Hue', 0, { min: -360, max: 360 }), num('saturation', 'Saturation', 0, { min: -100, max: 100 }), num('lightness', 'Lightness', 0, { min: -100, max: 100 })],
    (px, a) =>
      mapPixels(px, (r, g, b, al) => {
        const [h, s, l] = rgbToHsl(r, g, b);
        const [nr, ng, nb] = hslToRgb(h + Number(a.hue), Math.min(1, Math.max(0, s * (1 + Number(a.saturation) / 100))), Math.min(1, Math.max(0, l + Number(a.lightness) / 200)));
        return [nr, ng, nb, al];
      }),
  ),
  imageOp(
    'Sharpen Image',
    'Sharpens an image with an unsharp mask.',
    [num('radius', 'Radius', 2, { min: 1, max: 50 }), num('amount', 'Amount', 1, { min: 0, max: 5, step: 0.1 }), num('threshold', 'Threshold', 10, { min: 0, max: 255 })],
    (px, a) => {
      const soft = blur(px, Number(a.radius));
      const out = blank(px.width, px.height);
      for (let i = 0; i < px.data.length; i++) {
        if (i % 4 === 3) {
          out.data[i] = px.data[i] as number;
          continue;
        }
        const diff = (px.data[i] as number) - (soft.data[i] as number);
        out.data[i] = Math.abs(diff) >= Number(a.threshold) ? (px.data[i] as number) + diff * Number(a.amount) : (px.data[i] as number);
      }
      return out;
    },
  ),
  imageOp('Normalise Image', 'Stretches each colour channel to use the full range.', [], (px) => {
    const lo = [255, 255, 255];
    const hi = [0, 0, 0];
    for (let i = 0; i < px.data.length; i += 4)
      for (let c = 0; c < 3; c++) {
        lo[c] = Math.min(lo[c] as number, px.data[i + c] as number);
        hi[c] = Math.max(hi[c] as number, px.data[i + c] as number);
      }
    const f = (v: number, c: number) => ((v - (lo[c] as number)) * 255) / Math.max(1, (hi[c] as number) - (lo[c] as number));
    return mapPixels(px, (r, g, b, al) => [f(r, 0), f(g, 1), f(b, 2), al]);
  }),
  defineOp({
    name: 'Convert Image Format',
    category: M,
    description: 'Re-encodes an image as JPEG, PNG, WebP or BMP.',
    input: 'bytes',
    output: 'bytes',
    args: [sel('format', 'Output Format', ['JPEG', 'PNG', 'WebP', 'BMP']), num('quality', 'JPEG Quality', 80, { min: 1, max: 100 })],
    run: async (input, a) => {
      const px = await decode(input);
      const format = sArg(a, 'format');
      const bytes = format === 'PNG' ? await encodePng(px) : format === 'BMP' ? encodeBmp(px) : await encodeAs(px, format === 'JPEG' ? 'image/jpeg' : 'image/webp', nArg(a, 'quality') / 100);
      const mime = format === 'PNG' ? 'image/png' : format === 'BMP' ? 'image/bmp' : format === 'JPEG' ? 'image/jpeg' : 'image/webp';
      return { value: bytes, preview: { kind: 'image', bytes, mime } };
    },
  }),
  imageOp(
    'Add Text To Image',
    'Writes text onto an image.',
    [
      str('text', 'Text', ''),
      sel('alignH', 'Horizontal align', ['None', 'Left', 'Center', 'Right']),
      sel('alignV', 'Vertical align', ['None', 'Top', 'Middle', 'Bottom']),
      num('x', 'X position', 0),
      num('y', 'Y position', 0),
      num('size', 'Size', 32, { min: 4 }),
      sel('font', 'Font face', ['Sans-serif', 'Serif', 'Monospace']),
      editable('colour', 'Colour', [
        { label: 'White', value: '#ffffff' },
        { label: 'Black', value: '#000000' },
        { label: 'Red', value: '#ff0000' },
      ]),
    ],
    (px, a) =>
      draw(px, px.width, px.height, (ctx, source) => {
        ctx.drawImage(source, 0, 0);
        const size = Number(a.size);
        ctx.font = `${size}px ${String(a.font).toLowerCase()}`;
        ctx.fillStyle = String(a.colour) || '#ffffff';
        const width = ctx.measureText(String(a.text)).width;
        const x = a.alignH === 'Left' ? 0 : a.alignH === 'Center' ? (px.width - width) / 2 : a.alignH === 'Right' ? px.width - width : Number(a.x);
        const y = a.alignV === 'Top' ? size : a.alignV === 'Middle' ? (px.height + size) / 2 : a.alignV === 'Bottom' ? px.height - size * 0.2 : Number(a.y) + size;
        ctx.fillText(String(a.text), x, y);
      }),
  ),
  /* -------------------------------------------------------- forensics -- */
  defineOp({
    name: 'Detect File Type',
    category: F,
    description: 'Identifies the file type from its signature (magic bytes).',
    input: 'bytes',
    output: 'text',
    run: (input) => {
      const type = detectFileType(input);
      return type ? `File type:   ${type.name}\nExtension:   ${type.ext}\nMIME type:   ${type.mime}` : 'Unknown file type. Try Scan for Embedded Files.';
    },
  }),
  defineOp({
    name: 'Scan for Embedded Files',
    category: F,
    description: 'Lists the file signatures found anywhere in the data.',
    input: 'bytes',
    output: 'text',
    run: (input) => {
      const found = scanEmbedded(input);
      if (found.length === 0) return 'No embedded files were found.';
      return found.map((f) => `Offset ${f.offset} (0x${f.offset.toString(16)}): ${f.type.name} (.${f.type.ext})${f.length ? `, ${f.length} bytes` : ''}`).join('\n');
    },
  }),
  defineOp({
    name: 'Extract Files',
    category: F,
    also: ['Extractors'],
    description: 'Carves out the files embedded in the data whose end can be found (PNG, JPEG, GIF, ZIP, PDF, WAV, BMP…).',
    input: 'bytes',
    output: 'text',
    run: (input) => {
      const files = scanEmbedded(input)
        .filter((f) => f.length !== null && f.length > 0)
        .map((f, i) => ({ name: `extracted_${String(i + 1).padStart(3, '0')}_at_${f.offset}.${f.type.ext}`, bytes: input.slice(f.offset, f.offset + (f.length as number)) }));
      if (files.length === 0) return 'No complete embedded files were found.';
      return { value: files.map((f) => `${f.name} (${f.bytes.length} bytes)`).join('\n'), preview: { kind: 'files', files } };
    },
  }),
  defineOp({
    name: 'Remove EXIF',
    category: F,
    also: ['Multimedia'],
    description: 'Removes EXIF, GPS and other metadata from JPEG, PNG and WebP images.',
    input: 'bytes',
    output: 'bytes',
    run: (input) => stripMetadata(input, { keepColorProfile: true, keepOrientation: false }).bytes,
  }),
  defineOp({
    name: 'Extract RGBA',
    category: F,
    description: 'Lists the red, green, blue and alpha values of every pixel.',
    input: 'bytes',
    output: 'text',
    args: [
      editable('delimiter', 'Delimiter', [
        { label: 'Comma', value: ',' },
        { label: 'Space', value: ' ' },
        { label: 'Line feed', value: '\\n' },
      ]),
      bool('alpha', 'Include Alpha', true),
    ],
    run: async (input, a) => {
      const px = await decode(input);
      const out: number[] = [];
      for (let i = 0; i < px.data.length; i += 4) out.push(...Array.from(px.data.slice(i, i + (bArg(a, 'alpha') ? 4 : 3))));
      return out.join(sArg(a, 'delimiter').replace(/\\n/g, '\n'));
    },
  }),
  defineOp({
    name: 'View Bit Plane',
    category: F,
    description: 'Shows one bit of one colour channel as a black-and-white image (for spotting hidden data).',
    input: 'bytes',
    output: 'bytes',
    args: [sel('colour', 'Colour', CHANNELS), num('bit', 'Bit', 0, { min: 0, max: 7 })],
    run: async (input, a) => {
      const px = await decode(input);
      const ch = channelIndex(sArg(a, 'colour'));
      const bit = nArg(a, 'bit');
      return pngResult(
        mapPixels(px, (...rgba) => {
          const v = (((rgba[ch] as number) >> bit) & 1) * 255;
          return [v, v, v, 255];
        }),
      );
    },
  }),
  defineOp({
    name: 'Randomize Colour Palette',
    category: F,
    description: 'Gives every distinct colour a random new one, revealing near-identical colours.',
    input: 'bytes',
    output: 'bytes',
    args: [str('seed', 'Seed', '')],
    run: async (input, a) => {
      const px = await decode(input);
      const random = seeded(sArg(a, 'seed') || hex(input.slice(0, 16)));
      const palette = new Map<number, [number, number, number]>();
      return pngResult(
        mapPixels(px, (r, g, b, al) => {
          const key = (r << 16) | (g << 8) | b;
          let colour = palette.get(key);
          if (!colour) {
            colour = [Math.floor(random() * 256), Math.floor(random() * 256), Math.floor(random() * 256)];
            palette.set(key, colour);
          }
          return [...colour, al];
        }),
      );
    },
  }),
  defineOp({
    name: 'Extract LSB',
    category: F,
    description: 'Reads hidden data from the least significant bits of chosen colour channels.',
    input: 'bytes',
    output: 'bytes',
    args: [
      sel('c1', 'Colour Pattern #1', ['R', 'G', 'B', 'A']),
      sel('c2', 'Colour Pattern #2', ['', 'R', 'G', 'B', 'A']),
      sel('c3', 'Colour Pattern #3', ['', 'R', 'G', 'B', 'A']),
      sel('c4', 'Colour Pattern #4', ['', 'R', 'G', 'B', 'A']),
      sel('order', 'Pixel Order', ['Row', 'Column']),
      num('bit', 'Bit', 0, { min: 0, max: 7 }),
    ],
    run: async (input, a) => {
      const px = await decode(input);
      const pattern = [sArg(a, 'c1'), sArg(a, 'c2'), sArg(a, 'c3'), sArg(a, 'c4')].filter(Boolean).map((c) => 'RGBA'.indexOf(c));
      const bit = nArg(a, 'bit');
      const bits: number[] = [];
      const visit = (x: number, y: number) => {
        for (const ch of pattern) bits.push(((px.data[(y * px.width + x) * 4 + ch] as number) >> bit) & 1);
      };
      if (sArg(a, 'order') === 'Row') for (let y = 0; y < px.height; y++) for (let x = 0; x < px.width; x++) visit(x, y);
      else for (let x = 0; x < px.width; x++) for (let y = 0; y < px.height; y++) visit(x, y);
      const out = new Uint8Array(Math.floor(bits.length / 8));
      for (let i = 0; i < out.length; i++) for (let j = 0; j < 8; j++) out[i] = ((out[i] as number) << 1) | (bits[i * 8 + j] as number);
      return out;
    },
  }),
  defineOp({
    name: 'ELF Info',
    category: F,
    description: 'Shows the header and sections of a Linux/Unix ELF binary.',
    input: 'bytes',
    output: 'text',
    run: (input) => elfInfo(input),
  }),
];
