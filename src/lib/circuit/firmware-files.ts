/** Firmware images: Intel HEX (Arduino exports) and UF2 (Raspberry Pi Pico). */

/** Reads Intel HEX into a byte image starting at address 0 (or `base`). */
export function parseIntelHex(text: string, size: number, base = 0): Uint8Array {
  const image = new Uint8Array(size).fill(0xff);
  let upper = 0;
  let any = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (!line.startsWith(':')) throw new Error('This is not an Intel HEX file: every line should start with a colon.');
    const bytes = line
      .slice(1)
      .match(/../g)
      ?.map((h) => Number.parseInt(h, 16));
    if (!bytes || bytes.some(Number.isNaN)) throw new Error('The HEX file has a line that is not hexadecimal.');
    const length = bytes[0] as number;
    const address = ((bytes[1] as number) << 8) | (bytes[2] as number);
    const type = bytes[3] as number;
    const data = bytes.slice(4, 4 + length);
    const sum = bytes.reduce((a, b) => (a + b) & 0xff, 0);
    if (sum !== 0) throw new Error('The HEX file is damaged (a checksum does not match).');
    if (type === 0) {
      const at = upper + address - base;
      if (at < 0 || at + data.length > size) throw new Error('The program is too big for this board, or built for a different one.');
      image.set(data, at);
      any = true;
    } else if (type === 1) break;
    else if (type === 2) upper = (((data[0] as number) << 8) | (data[1] as number)) << 4;
    else if (type === 4) upper = (((data[0] as number) << 8) | (data[1] as number)) << 16;
  }
  if (!any) throw new Error('The HEX file holds no program.');
  return image;
}

const UF2_MAGIC_START0 = 0x0a324655;
const UF2_MAGIC_START1 = 0x9e5d5157;
const UF2_MAGIC_END = 0x0ab16f30;

/** Writes the blocks of a UF2 file into a flash image whose first byte is at `flashBase`. */
export function loadUf2(bytes: Uint8Array, flash: Uint8Array, flashBase: number): number {
  let blocks = 0;
  for (let offset = 0; offset + 512 <= bytes.length; offset += 512) {
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 512);
    if (view.getUint32(0, true) !== UF2_MAGIC_START0 || view.getUint32(4, true) !== UF2_MAGIC_START1 || view.getUint32(508, true) !== UF2_MAGIC_END) continue;
    const flags = view.getUint32(8, true);
    // Flag 0x1: not for the main flash.
    if (flags & 1) continue;
    const target = view.getUint32(12, true);
    const size = view.getUint32(16, true);
    const at = target - flashBase;
    if (at < 0 || at + size > flash.length || size > 476) continue;
    flash.set(bytes.subarray(offset + 32, offset + 32 + size), at);
    blocks++;
  }
  if (blocks === 0) throw new Error('No blocks for the Pico’s flash were found in this UF2 file.');
  return blocks;
}

export function isUf2(bytes: Uint8Array): boolean {
  return bytes.length >= 512 && new DataView(bytes.buffer, bytes.byteOffset).getUint32(0, true) === UF2_MAGIC_START0;
}
