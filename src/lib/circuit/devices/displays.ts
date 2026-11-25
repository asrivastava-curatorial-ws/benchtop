/**
 * Display modules: an SSD1306 OLED (I²C), character LCDs with the HD44780
 * controller (wired in parallel or through a PCF8574 I²C backpack), an
 * ILI9341 colour TFT (SPI), MAX7219 LED matrices and digit displays, and
 * WS2812 ("NeoPixel") LEDs.  Each takes the controller's commands as the
 * firmware sends them and draws what the glass would show.
 */
import type { I2cTarget, PinMode, Screen, SpiTarget, View, Wiring } from '../bus';
import { address, Module, num, type Props, pinHigh, str } from '../modules';
import { glyph } from './font5x7';

/** A picture the editor draws; rgba is changed in place and `version` counts the changes. */
export class Raster implements Screen {
  version = 0;
  readonly rgba: Uint8ClampedArray;
  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.rgba = new Uint8ClampedArray(width * height * 4);
  }
  put(x: number, y: number, r: number, g: number, b: number): void {
    const i = (y * this.width + x) * 4;
    const a = this.rgba;
    a[i] = r;
    a[i + 1] = g;
    a[i + 2] = b;
    a[i + 3] = 255;
  }
  fill(r: number, g: number, b: number): void {
    for (let i = 0; i < this.rgba.length; i += 4) {
      this.rgba[i] = r;
      this.rgba[i + 1] = g;
      this.rgba[i + 2] = b;
      this.rgba[i + 3] = 255;
    }
  }
}

const hexColour = (hex: string): [number, number, number] => [Number.parseInt(hex.slice(1, 3), 16), Number.parseInt(hex.slice(3, 5), 16), Number.parseInt(hex.slice(5, 7), 16)];

/* ------------------------------------------------------------ SSD1306 -- */

export const OLED_TERMINALS = ['GND', 'VCC', 'SCL', 'SDA'] as const;

/** Bytes of arguments each SSD1306 command takes. */
function oledArguments(command: number): number {
  switch (command) {
    case 0x81: // contrast
    case 0x20: // addressing mode
    case 0xa8: // multiplex ratio
    case 0xd3: // display offset
    case 0xd5: // clock
    case 0xd9: // pre-charge
    case 0xda: // COM pins
    case 0xdb: // VCOMH
    case 0x8d: // charge pump
    case 0xd6: // zoom
      return 1;
    case 0x21: // column range
    case 0x22: // page range
    case 0xa3: // vertical scroll area
      return 2;
    case 0x26: // horizontal scroll
    case 0x27:
      return 6;
    case 0x29: // diagonal scroll
    case 0x2a:
      return 5;
    default:
      return 0;
  }
}

/** Frames between scroll steps, by the code in the scroll command. */
const SCROLL_FRAMES = [5, 64, 128, 256, 3, 4, 25, 2];

/** An SSD1306 128×64 (or 128×32) monochrome OLED on I²C. */
export class Ssd1306 extends Module implements I2cTarget {
  private readonly ram = new Uint8Array(128 * 8);
  private on = false;
  private contrast = 0x7f;
  private inverted = false;
  private allOn = false;
  private segRemap = false;
  private comRemap = false;
  private startLine = 0;
  private mode = 2;
  private colStart = 0;
  private colEnd = 127;
  private pageStart = 0;
  private pageEnd = 7;
  private col = 0;
  private page = 0;
  private expect: 'control' | 'command' | 'data' = 'control';
  private single = false;
  private command = -1;
  private args: number[] = [];
  private need = 0;
  private scroll: { right: boolean; from: number; to: number; frames: number } | null = null;
  private scrolling = false;
  private scrollFrom = 0;
  private scrolled = 0;
  private bus: Wiring['pins'][number] = null;
  private changed = 1;
  private shown = 0;
  readonly screen: Raster;

  constructor(props: Props) {
    super(props);
    this.screen = new Raster(128, num(props, 'height', 64) === 32 ? 32 : 64);
  }

  get address(): number {
    return address(this.props, 0x3c);
  }

  protected attach(): void {
    const bus = this.i2cBus(3, 2);
    if (!bus) return;
    this.bus = this.pin(3);
    this.links.add(bus.attach(this.address, this));
  }

  start(): boolean {
    if (!this.powered) return false;
    this.expect = 'control';
    return true;
  }

  write(value: number): boolean {
    if (this.expect === 'control') {
      this.single = (value & 0x80) !== 0;
      this.expect = value & 0x40 ? 'data' : 'command';
      return true;
    }
    if (this.expect === 'data') this.data(value);
    else this.commandByte(value);
    if (this.single) this.expect = 'control';
    return true;
  }

  read(): number {
    // The status byte: bit 6 is set while the display is off.
    return this.on ? 0x00 : 0x40;
  }

  stop(): void {
    this.expect = 'control';
  }

  private commandByte(value: number): void {
    if (this.need > 0) {
      this.args.push(value);
      this.need--;
      if (this.need === 0) this.run(this.command, this.args);
      return;
    }
    this.command = value;
    this.args = [];
    this.need = oledArguments(value);
    if (this.need === 0) this.run(value, []);
  }

  private run(c: number, a: readonly number[]): void {
    const arg = (i: number) => a[i] ?? 0;
    this.changed++;
    if (c === 0xae || c === 0xaf) this.on = c === 0xaf;
    else if (c === 0xa4 || c === 0xa5) this.allOn = c === 0xa5;
    else if (c === 0xa6 || c === 0xa7) this.inverted = c === 0xa7;
    else if (c === 0xa0 || c === 0xa1) this.segRemap = c === 0xa1;
    else if (c === 0xc0 || c === 0xc8) this.comRemap = c === 0xc8;
    else if (c >= 0x40 && c <= 0x7f) this.startLine = c & 0x3f;
    else if (c >= 0xb0 && c <= 0xb7) this.page = c & 7;
    else if (c <= 0x0f) this.col = (this.col & 0xf0) | c;
    else if (c >= 0x10 && c <= 0x1f) this.col = (this.col & 0x0f) | ((c & 0x0f) << 4);
    else if (c === 0x20) this.mode = arg(0) & 3;
    else if (c === 0x21) {
      this.colStart = arg(0) & 127;
      this.colEnd = arg(1) & 127;
      this.col = this.colStart;
    } else if (c === 0x22) {
      this.pageStart = arg(0) & 7;
      this.pageEnd = arg(1) & 7;
      this.page = this.pageStart;
    } else if (c === 0x81) this.contrast = arg(0);
    else if (c === 0x26 || c === 0x27) this.scroll = { right: c === 0x26, from: arg(1) & 7, to: arg(3) & 7, frames: SCROLL_FRAMES[arg(2) & 7] ?? 5 };
    else if (c === 0x29 || c === 0x2a) this.scroll = { right: c === 0x29, from: arg(1) & 7, to: arg(3) & 7, frames: SCROLL_FRAMES[arg(2) & 7] ?? 5 };
    else if (c === 0x2e) this.scrolling = false;
    else if (c === 0x2f && this.scroll) {
      this.scrolling = true;
      this.scrollFrom = this.seconds(this.bus);
      this.scrolled = 0;
    }
  }

  private data(value: number): void {
    this.ram[this.page * 128 + this.col] = value;
    this.changed++;
    if (this.mode === 0) {
      if (++this.col > this.colEnd) {
        this.col = this.colStart;
        if (++this.page > this.pageEnd) this.page = this.pageStart;
      }
    } else if (this.mode === 1) {
      if (++this.page > this.pageEnd) {
        this.page = this.pageStart;
        if (++this.col > this.colEnd) this.col = this.colStart;
      }
    } else this.col = (this.col + 1) & 127;
  }

  /** Horizontal scrolling moves the memory itself, a column per step (about 100 frames a second). */
  private advanceScroll(): void {
    const s = this.scroll;
    if (!this.scrolling || !s) return;
    const steps = Math.floor(((this.seconds(this.bus) - this.scrollFrom) * 100) / s.frames);
    for (; this.scrolled < steps && this.scrolled < 1e6; this.scrolled++) {
      for (let page = s.from; page <= Math.max(s.from, s.to); page++) {
        const row = this.ram.subarray(page * 128, page * 128 + 128);
        if (s.right) {
          const last = row[127] as number;
          row.copyWithin(1, 0, 127);
          row[0] = last;
        } else {
          const first = row[0] as number;
          row.copyWithin(0, 1);
          row[127] = first;
        }
      }
      this.changed++;
    }
  }

  view(): View {
    this.advanceScroll();
    if (this.changed !== this.shown) this.draw();
    return { powered: this.powered, on: this.on, screen: this.screen };
  }

  private draw(): void {
    this.shown = this.changed;
    const { width, height } = this.screen;
    const colour = str(this.props, 'colour', 'white');
    const level = 0.55 + (0.45 * this.contrast) / 255;
    const white = hexColour(colour === 'blue' ? '#6fc8ff' : '#e8f4ff');
    const yellow = hexColour('#ffd23a');
    const dark: [number, number, number] = [6, 9, 14];
    const lit = this.powered && this.on;
    for (let y = 0; y < height; y++) {
      const scanned = this.comRemap ? y : height - 1 - y;
      const row = (scanned + this.startLine) & 63;
      const ink = colour === 'yellow-blue' && y < 16 ? yellow : colour === 'yellow-blue' ? hexColour('#6fc8ff') : white;
      for (let x = 0; x < width; x++) {
        const column = this.segRemap ? x : 127 - x;
        let on = (((this.ram[(row >> 3) * 128 + column] as number) >> (row & 7)) & 1) === 1;
        if (this.inverted) on = !on;
        if (this.allOn) on = true;
        if (lit && on) this.screen.put(x, y, ink[0] * level, ink[1] * level, ink[2] * level);
        else this.screen.put(x, y, ...dark);
      }
    }
    this.screen.version++;
  }
}

/* ------------------------------------------------------------ HD44780 -- */

/** A few characters of the HD44780's standard (A00) set that differ from ASCII or lie above it, as five column bytes. */
const LCD_EXTRA: Readonly<Record<number, readonly number[]>> = {
  92: [0x15, 0x16, 0x7c, 0x16, 0x15], // ¥
  126: [0x08, 0x08, 0x2a, 0x1c, 0x08], // →
  127: [0x08, 0x1c, 0x2a, 0x08, 0x08], // ←
  165: [0x00, 0x00, 0x08, 0x00, 0x00], // ·
  223: [0x00, 0x07, 0x05, 0x07, 0x00], // °
  224: [0x38, 0x44, 0x44, 0x38, 0x44], // α
  226: [0x7e, 0x15, 0x25, 0x25, 0x1a], // β
  228: [0x7c, 0x20, 0x20, 0x1c, 0x20], // µ
  244: [0x58, 0x64, 0x04, 0x64, 0x58], // Ω
  246: [0x63, 0x55, 0x49, 0x41, 0x41], // Σ
  247: [0x04, 0x3c, 0x04, 0x3c, 0x04], // π
  253: [0x08, 0x08, 0x2a, 0x08, 0x08], // ÷
  255: [0x7f, 0x7f, 0x7f, 0x7f, 0x7f], // █
};

/** The HD44780 character LCD controller: instructions and characters, as the firmware writes them. */
export class Hd44780 {
  readonly ddram = new Uint8Array(128).fill(0x20);
  readonly cgram = new Uint8Array(64);
  address = 0;
  toCgram = false;
  increment = true;
  shiftOnWrite = false;
  displayOn = false;
  cursor = false;
  blink = false;
  shift = 0;
  eightBit = true;
  twoLines = false;
  private nibble: number | null = null;
  changes = 0;

  /** An enable pulse: RS and the data lines D7–D0 as one byte (in 4-bit mode only D7–D4 count). */
  strobe(rs: boolean, value: number): void {
    if (this.eightBit) {
      this.execute(rs, value & 0xff);
      return;
    }
    const high = value & 0xf0;
    if (this.nibble === null) this.nibble = high;
    else {
      this.execute(rs, this.nibble | (high >> 4));
      this.nibble = null;
    }
  }

  private move(forward: boolean): void {
    if (this.toCgram) {
      this.address = (this.address + (forward ? 1 : 63)) & 63;
      return;
    }
    let a = this.address + (forward ? 1 : -1);
    if (this.twoLines) {
      if (a === 0x28) a = 0x40;
      else if (a === 0x68) a = 0x00;
      else if (a === 0x3f) a = 0x27;
      else if (a < 0) a = 0x67;
    } else if (a > 0x4f) a = 0;
    else if (a < 0) a = 0x4f;
    this.address = a;
  }

  private execute(rs: boolean, b: number): void {
    this.changes++;
    if (rs) {
      if (this.toCgram) this.cgram[this.address & 63] = b & 0x1f;
      else this.ddram[this.address & 0x7f] = b;
      this.move(this.increment);
      if (this.shiftOnWrite && !this.toCgram) this.shift += this.increment ? 1 : -1;
      return;
    }
    if (b & 0x80) {
      this.toCgram = false;
      this.address = b & 0x7f;
    } else if (b & 0x40) {
      this.toCgram = true;
      this.address = b & 0x3f;
    } else if (b & 0x20) {
      const eight = (b & 0x10) !== 0;
      if (eight !== this.eightBit) this.nibble = null;
      this.eightBit = eight;
      this.twoLines = (b & 0x08) !== 0;
    } else if (b & 0x10) {
      const right = (b & 0x04) !== 0;
      if (b & 0x08) this.shift += right ? -1 : 1;
      else this.move(right);
    } else if (b & 0x08) {
      this.displayOn = (b & 0x04) !== 0;
      this.cursor = (b & 0x02) !== 0;
      this.blink = (b & 0x01) !== 0;
    } else if (b & 0x04) {
      this.increment = (b & 0x02) !== 0;
      this.shiftOnWrite = (b & 0x01) !== 0;
    } else if (b & 0x02) {
      this.address = 0;
      this.toCgram = false;
      this.shift = 0;
    } else if (b & 0x01) {
      this.ddram.fill(0x20);
      this.address = 0;
      this.toCgram = false;
      this.increment = true;
      this.shift = 0;
    }
  }

  /**
   * The memory address shown at a column of a line.  Lines 0 and 1 start at
   * 0x00 and 0x40 and hold 40 characters each; on four-line displays lines 2
   * and 3 carry on where lines 0 and 1 leave off.  The display can be shifted.
   */
  addressAt(line: number, column: number, columns: number): number {
    const start = line % 2 === 0 ? 0x00 : 0x40;
    const offset = line >= 2 ? columns : 0;
    return start + ((((offset + column + this.shift) % 40) + 40) % 40);
  }

  /** The dot rows of a character, top first (five bits each, the left dot highest). */
  rows(code: number): number[] {
    if (code < 0x10) return Array.from(this.cgram.subarray((code & 7) * 8, (code & 7) * 8 + 8));
    const columns = LCD_EXTRA[code] ?? (code >= 0x20 && code < 0x80 ? Array.from(glyph(code)) : null);
    if (!columns) return [0, 0, 0, 0, 0, 0, 0, 0];
    return Array.from({ length: 8 }, (_, row) => columns.reduce((bits, col, i) => bits | (((col >> row) & 1) << (4 - i)), 0));
  }
}

const LCD_COLOURS: Readonly<Record<string, { lit: string; dim: string; ink: string; inkLit: string }>> = {
  green: { lit: '#9fd23a', dim: '#4d5f2a', ink: '#24341a', inkLit: '#142008' },
  blue: { lit: '#2f63ff', dim: '#1b2f6b', ink: '#7f9aff', inkLit: '#f2f6ff' },
};

/** Draws an HD44780 display: each character 5×8 dots in a 6×9 cell, with a margin. */
function drawLcd(lcd: Hd44780, screen: Raster, columns: number, lines: number, backlight: boolean, powered: boolean, colour: string, blinkOn: boolean): void {
  const scheme = LCD_COLOURS[colour] ?? (LCD_COLOURS.green as { lit: string; dim: string; ink: string; inkLit: string });
  const bg = hexColour(backlight && powered ? scheme.lit : scheme.dim);
  const ink = hexColour(colour === 'blue' && backlight && powered ? scheme.inkLit : scheme.ink);
  // Dots that are off still show faintly.
  const ghost: [number, number, number] = [bg[0] * 0.92, bg[1] * 0.92, bg[2] * 0.92];
  screen.fill(...bg);
  for (let line = 0; line < lines; line++) {
    for (let column = 0; column < columns; column++) {
      const at = lcd.addressAt(line, column, columns);
      const rows = powered && lcd.displayOn ? lcd.rows(lcd.ddram[at] as number) : [0, 0, 0, 0, 0, 0, 0, 0];
      const here = powered && lcd.displayOn && !lcd.toCgram && (lcd.address & 0x7f) === at;
      for (let y = 0; y < 8; y++) {
        let bits = rows[y] ?? 0;
        if (here && lcd.cursor && y === 7) bits = 0x1f;
        if (here && lcd.blink && blinkOn) bits = 0x1f;
        for (let x = 0; x < 5; x++) {
          const on = (bits >> (4 - x)) & 1;
          screen.put(2 + column * 6 + x, 2 + line * 9 + y, ...(on ? ink : ghost));
        }
      }
    }
  }
  screen.version++;
}

/** Terminals of a 16-pin character LCD. */
export const LCD_TERMINALS = ['VSS', 'VDD', 'V0', 'RS', 'RW', 'E', 'D0', 'D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'A', 'K'] as const;

const lcdSize = (props: Props): [number, number] => (str(props, 'size', '16x2') === '20x4' ? [20, 4] : [16, 2]);

/** A character LCD wired in parallel: data is taken when E falls. */
export class LcdParallel extends Module {
  readonly lcd = new Hd44780();
  readonly screen: Raster;
  private shown = -1;
  /** The backlight LED's current, set by the part each step. */
  backlight: () => number = () => 0;
  private clock: Wiring['pins'][number] = null;

  constructor(props: Props) {
    super(props);
    const [c, l] = lcdSize(props);
    this.screen = new Raster(c * 6 + 3, l * 9 + 3);
  }

  protected attach(): void {
    let last: PinMode = 'low';
    this.clock = this.watch(5, (mode) => {
      const falling = pinHigh(last) && !pinHigh(mode);
      last = mode;
      if (!falling || !this.powered || this.high(4)) return;
      let value = 0;
      for (let bit = 0; bit < 8; bit++) if (this.high(6 + bit)) value |= 1 << bit;
      this.lcd.strobe(this.high(3), value);
    });
  }

  view(): View {
    const [columns, lines] = lcdSize(this.props);
    const lit = this.backlight() > 0.001;
    const blinkOn = Math.floor(this.seconds(this.clock) * 2) % 2 === 0;
    const key = this.lcd.changes * 8 + (lit ? 4 : 0) + (this.powered ? 2 : 0) + (blinkOn ? 1 : 0);
    if (key !== this.shown) {
      this.shown = key;
      drawLcd(this.lcd, this.screen, columns, lines, lit, this.powered, str(this.props, 'colour', 'green'), blinkOn);
    }
    return { powered: this.powered, screen: this.screen };
  }
}

export const LCD_I2C_TERMINALS = ['GND', 'VCC', 'SDA', 'SCL'] as const;

/**
 * A character LCD with a PCF8574 I²C backpack: each byte written sets the
 * expander's outputs P0–P7, wired to RS, RW, E, the backlight and D4–D7.
 */
export class LcdI2c extends Module implements I2cTarget {
  readonly lcd = new Hd44780();
  readonly screen: Raster;
  private port = 0xff;
  private shown = -1;
  private clock: Wiring['pins'][number] = null;

  constructor(props: Props) {
    super(props);
    const [c, l] = lcdSize(props);
    this.screen = new Raster(c * 6 + 3, l * 9 + 3);
  }

  get address(): number {
    return address(this.props, 0x27);
  }

  protected attach(): void {
    const bus = this.i2cBus(2, 3);
    if (!bus) return;
    this.clock = this.pin(2);
    this.links.add(bus.attach(this.address, this));
  }

  start(): boolean {
    return this.powered;
  }
  write(value: number): boolean {
    const before = this.port;
    this.port = value;
    // E (P2) falling with RW (P1) low: the LCD takes RS (P0) and D4–D7 (P4–P7).
    if (before & 0x04 && !(value & 0x04) && !(value & 0x02)) this.lcd.strobe((value & 0x01) !== 0, value & 0xf0);
    return true;
  }
  read(): number {
    return this.port;
  }
  stop(): void {}

  view(): View {
    const [columns, lines] = lcdSize(this.props);
    const lit = (this.port & 0x08) !== 0;
    const blinkOn = Math.floor(this.seconds(this.clock) * 2) % 2 === 0;
    const key = this.lcd.changes * 8 + (lit ? 4 : 0) + (this.powered ? 2 : 0) + (blinkOn ? 1 : 0);
    if (key !== this.shown) {
      this.shown = key;
      drawLcd(this.lcd, this.screen, columns, lines, lit, this.powered, str(this.props, 'colour', 'green'), blinkOn);
    }
    return { powered: this.powered, screen: this.screen };
  }
}

/* ------------------------------------------------------------ ILI9341 -- */

export const TFT_TERMINALS = ['VCC', 'GND', 'CS', 'RESET', 'DC', 'MOSI', 'SCK', 'LED', 'MISO'] as const;

/** An ILI9341 240×320 colour TFT on SPI, 16-bit colour. */
export class Ili9341 extends Module implements SpiTarget {
  readonly screen = new Raster(240, 320);
  private command = 0;
  private args: number[] = [];
  private x0 = 0;
  private x1 = 239;
  private y0 = 0;
  private y1 = 319;
  private x = 0;
  private y = 0;
  private highByte: number | null = null;
  private madctl = 0;
  private on = false;
  private inverted = false;
  private sleeping = true;
  constructor(props: Props) {
    super(props);
    this.screen.fill(0, 0, 0);
  }

  protected attach(): void {
    const bus = this.spiBus(5, 6);
    if (!bus) return;
    const cs = this.pin(2);
    this.links.add(bus.attach(cs ? cs.pin : null, this));
    this.watch(3, (mode) => {
      if (mode === 'low') this.reset();
    });
  }

  private reset(): void {
    this.madctl = 0;
    this.on = false;
    this.sleeping = true;
    this.inverted = false;
    this.command = 0;
    this.screen.version++;
  }

  transfer(value: number): number {
    if (!this.powered) return 0xff;
    const dc = this.pin(4);
    const data = dc ? pinHigh(dc.bus.mode(dc.pin)) : true;
    if (!data) {
      this.command = value;
      this.args = [];
      this.highByte = null;
      switch (value) {
        case 0x01:
          this.reset();
          break;
        case 0x11:
          this.sleeping = false;
          break;
        case 0x10:
          this.sleeping = true;
          break;
        case 0x29:
          this.on = true;
          this.screen.version++;
          break;
        case 0x28:
          this.on = false;
          this.screen.version++;
          break;
        case 0x20:
        case 0x21:
          this.inverted = value === 0x21;
          this.screen.version++;
          break;
        case 0x2c:
          this.x = this.x0;
          this.y = this.y0;
          break;
      }
      return 0;
    }
    switch (this.command) {
      case 0x2a:
      case 0x2b: {
        this.args.push(value);
        if (this.args.length === 4) {
          const [a = 0, b = 0, c = 0, d = 0] = this.args;
          if (this.command === 0x2a) {
            this.x0 = (a << 8) | b;
            this.x1 = (c << 8) | d;
          } else {
            this.y0 = (a << 8) | b;
            this.y1 = (c << 8) | d;
          }
        }
        break;
      }
      case 0x36:
        this.madctl = value;
        break;
      case 0x2c:
      case 0x3c:
        if (this.highByte === null) this.highByte = value;
        else {
          this.pixel((this.highByte << 8) | value);
          this.highByte = null;
        }
        break;
    }
    return 0;
  }

  private pixel(colour: number): void {
    const swap = (this.madctl & 0x20) !== 0;
    let col = swap ? this.y : this.x;
    let row = swap ? this.x : this.y;
    if (this.madctl & 0x40) col = 239 - col;
    if (this.madctl & 0x80) row = 319 - row;
    if (col >= 0 && col < 240 && row >= 0 && row < 320) {
      let r = ((colour >> 11) & 31) * 8.226;
      const g = ((colour >> 5) & 63) * 4.048;
      let b = (colour & 31) * 8.226;
      // The panel is BGR: with the BGR bit clear, red and blue swap.
      if (!(this.madctl & 0x08)) [r, b] = [b, r];
      // The panel is mounted so that MX set reads left to right.
      this.screen.put(239 - col, row, r, g, b);
      this.screen.version++;
    }
    if (++this.x > this.x1) {
      this.x = this.x0;
      if (++this.y > this.y1) this.y = this.y0;
    }
  }

  view(): View {
    const lit = this.powered && this.on && !this.sleeping;
    return { powered: this.powered, on: lit, inverted: this.inverted, screen: this.screen };
  }
}

/* ------------------------------------------------------------ MAX7219 -- */

export const MATRIX_TERMINALS = ['VCC', 'GND', 'DIN', 'CS', 'CLK'] as const;

/** Segments of the code-B font: 0–9, '-', E, H, L, P, blank (bits A to G as 6 to 0). */
const CODE_B = [0x7e, 0x30, 0x6d, 0x79, 0x33, 0x5b, 0x5f, 0x70, 0x7f, 0x7b, 0x01, 0x4f, 0x37, 0x0e, 0x67, 0x00];

/**
 * MAX7219 LED drivers in a chain (an 8×8 matrix each, or eight 7-segment
 * digits): 16 bits shift in on CLK (or the SPI bus) and are taken when CS
 * (LOAD) rises; the module nearest DIN takes the last 16.
 */
export class Max7219 extends Module implements SpiTarget {
  private bits: number[] = [];
  private regs: Uint8Array[] = [];

  constructor(props: Props) {
    super(props);
    this.resize();
  }

  get count(): number {
    return Math.max(1, Math.min(8, Math.round(num(this.props, 'modules', 1))));
  }

  private resize(): void {
    while (this.regs.length < this.count) this.regs.push(new Uint8Array(16));
    this.regs.length = this.count;
  }

  override configure(props: Props): void {
    super.configure(props);
    this.resize();
  }

  protected attach(): void {
    const spi = this.spiBus(2, 4);
    if (spi) this.links.add(spi.attach(null, this));
    let clock: PinMode = 'low';
    this.watch(4, (mode) => {
      const rising = !pinHigh(clock) && pinHigh(mode);
      clock = mode;
      if (rising && this.powered) this.shiftIn(this.high(2) ? 1 : 0);
    });
    let load: PinMode = 'high';
    this.watch(3, (mode) => {
      const rising = !pinHigh(load) && pinHigh(mode);
      load = mode;
      if (rising) this.latch();
    });
  }

  private shiftIn(bit: number): void {
    this.bits.push(bit);
    if (this.bits.length > 16 * this.count) this.bits.shift();
  }

  transfer(value: number): number {
    if (this.powered) for (let i = 7; i >= 0; i--) this.shiftIn((value >> i) & 1);
    return 0xff;
  }

  private latch(): void {
    if (!this.powered) return;
    const n = this.bits.length;
    for (let k = 0; k < this.count; k++) {
      const end = n - 16 * k;
      if (end < 16) break;
      let word = 0;
      for (let i = end - 16; i < end; i++) word = (word << 1) | (this.bits[i] as number);
      const register = (word >> 8) & 0x0f;
      (this.regs[k] as Uint8Array)[register] = word & 0xff;
    }
  }

  /** Each module's eight rows as bytes (bit 7 the leftmost dot), or eight digits' segments. */
  view(): View {
    const leds: number[] = [];
    for (const r of this.regs) {
      const shutdown = !(r[0x0c] as number);
      const test = (r[0x0f] as number) & 1;
      const limit = (r[0x0b] as number) & 7;
      const decode = r[0x09] as number;
      for (let digit = 0; digit < 8; digit++) {
        let v = r[digit + 1] as number;
        if ((decode >> digit) & 1) v = (v & 0x80) | (CODE_B[v & 0x0f] ?? 0);
        leds.push(!this.powered ? 0 : test ? 0xff : shutdown || digit > limit ? 0 : v);
      }
    }
    return { powered: this.powered, leds, intensity: this.regs[0] ? ((this.regs[0][0x0a] as number) & 15) / 15 : 0 };
  }
}

/* ----------------------------------------------------------- NeoPixel -- */

export const PIXEL_TERMINALS = ['DIN', 'VDD', 'GND', 'DOUT'] as const;

/**
 * WS2812B LEDs: 24 bits each (green, red, blue, highest bit first), a long
 * high pulse being a 1; a pause of 50 µs starts again at the first LED, and
 * bits beyond the last LED pass on to a chain wired to DOUT.
 */
export class NeoPixels extends Module {
  colours: number[] = [];
  private index = 0;
  private bitCount = 0;
  private word = 0;
  private lastFall = -1e12;
  private rose = 0;
  private next: NeoPixels | null = null;

  constructor(props: Props) {
    super(props);
    this.resize();
  }

  get count(): number {
    return Math.max(1, Math.min(256, Math.round(num(this.props, 'count', 16))));
  }

  private resize(): void {
    const n = this.count;
    while (this.colours.length < n) this.colours.push(0);
    this.colours.length = n;
  }

  override configure(props: Props): void {
    super.configure(props);
    this.resize();
  }

  protected attach(wiring: Wiring): void {
    this.next = null;
    for (const [device, terminal] of wiring.peers[3] ?? []) if (device instanceof NeoPixels && terminal === 0) this.next = device;
    this.watch(0, (mode, at, pin) => {
      const hz = pin.bus.hz;
      if (pinHigh(mode)) {
        if (at - this.lastFall > 50e-6 * hz) this.restart();
        this.rose = at;
      } else {
        this.lastFall = at;
        this.bit(at - this.rose > 0.6e-6 * hz ? 1 : 0);
      }
    });
  }

  /** A pause long enough to latch: the next bit is for the first LED again (and so down the chain). */
  restart(): void {
    this.index = 0;
    this.bitCount = 0;
    this.word = 0;
    this.next?.restart();
  }

  bit(b: number): void {
    if (!this.powered) return;
    if (this.index >= this.colours.length) {
      this.next?.bit(b);
      return;
    }
    this.word = (this.word << 1) | b;
    if (++this.bitCount === 24) {
      const g = (this.word >> 16) & 0xff;
      const r = (this.word >> 8) & 0xff;
      const bl = this.word & 0xff;
      this.colours[this.index++] = (r << 16) | (g << 8) | bl;
      this.bitCount = 0;
      this.word = 0;
    }
  }

  view(): View {
    return { powered: this.powered, colours: this.powered ? this.colours.slice() : this.colours.map(() => 0) };
  }
}
