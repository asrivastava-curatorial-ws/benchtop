import { describe, expect, it } from 'vitest';
import { PICO } from '../../src/lib/circuit/boards';
import { isScreen } from '../../src/lib/circuit/bus';
import { EXAMPLES } from '../../src/lib/circuit/examples';
import type { CircuitDoc } from '../../src/lib/circuit/netlist';
import { PICO_EXAMPLES } from '../../src/lib/circuit/pico-examples';
import { PicoMcu, picoFlashImage } from '../../src/lib/circuit/rp2040';
import { Session } from '../../src/lib/circuit/session';

const image = (id: string) => {
  const e = PICO_EXAMPLES.find((x) => x.id === id);
  if (!e) throw new Error(id);
  return Uint8Array.from(atob(e.image), (c) => c.charCodeAt(0));
};

async function start(id: string) {
  const mcu = await PicoMcu.load(image(id), PICO);
  let serial = '';
  mcu.onSerial = (text) => {
    serial += text;
  };
  return { mcu, out: () => serial };
}

/** Runs in steps of 1 ms, calling `each` after every step. */
function run(mcu: PicoMcu, seconds: number, each?: () => void) {
  const from = mcu.seconds;
  for (let t = 0.001; t <= seconds + 1e-9; t += 0.001) {
    mcu.runUntil(from + t);
    each?.();
  }
}

describe('Raspberry Pi Pico', () => {
  it('boots through the boot ROM and blinks', async () => {
    const { mcu, out } = await start('pico-blink');
    const led: boolean[] = [];
    const gp16: string[] = [];
    run(mcu, 1.2, () => {
      led.push(mcu.boardLed);
      gp16.push(mcu.mode(16));
    });
    expect(out()).toContain('Hello from the Raspberry Pi Pico');
    expect(out()).toContain('Board LED on');
    expect(out()).toContain('GP16 LED on');
    expect(led.slice(100, 400).every(Boolean)).toBe(true);
    expect(led.slice(600, 900).some(Boolean)).toBe(false);
    expect(gp16[700]).toBe('high');
    expect(gp16[200]).toBe('low');
  });

  it('reads a voltage on GP26 and drives PWM on GP15', async () => {
    const { mcu, out } = await start('pico-pot');
    mcu.setAnalog(23, 1.65);
    let high = 0;
    let samples = 0;
    run(mcu, 0.5);
    for (let k = 0; k < 2000; k++) {
      mcu.runUntil(mcu.seconds + 0.00005);
      samples++;
      if (mcu.mode(16) === 'high') high++;
    }
    expect(out()).toMatch(/A0 = 204[0-9]\s+\(1\.65 V\)/);
    expect(out().match(/A0 = /g)?.length).toBeGreaterThan(1);
    // 2048 / 16 = 128 of 255: about half the time high.
    expect(high / samples).toBeGreaterThan(0.4);
    expect(high / samples).toBeLessThan(0.6);
  });

  it('reads UF2 and ELF-free binary images', () => {
    const bin = image('pico-blink');
    // A UF2 of the same image, in 256-byte blocks.
    const blocks = Math.ceil(bin.length / 256);
    const uf2 = new Uint8Array(blocks * 512);
    const view = new DataView(uf2.buffer);
    for (let b = 0; b < blocks; b++) {
      const at = b * 512;
      view.setUint32(at, 0x0a324655, true);
      view.setUint32(at + 4, 0x9e5d5157, true);
      view.setUint32(at + 8, 0x2000, true);
      view.setUint32(at + 12, 0x10000000 + b * 256, true);
      view.setUint32(at + 16, 256, true);
      view.setUint32(at + 20, b, true);
      view.setUint32(at + 24, blocks, true);
      view.setUint32(at + 28, 0xe48bff56, true);
      uf2.set(bin.subarray(b * 256, b * 256 + 256), at + 32);
      view.setUint32(at + 508, 0x0ab16f30, true);
    }
    expect(picoFlashImage(uf2).subarray(0, bin.length)).toEqual(bin);
    expect(picoFlashImage(bin)).toEqual(bin);
    expect(() => picoFlashImage(new Uint8Array(10))).toThrow(/Pico firmware/);
  });
});

describe('Raspberry Pi Pico circuits', () => {
  async function session(id: string) {
    const e = EXAMPLES.find((x) => x.id === id);
    if (!e) throw new Error(id);
    const doc = e.make();
    let text = '';
    const problems: string[] = [];
    const s = new Session(doc, {
      onSerial: (_id, t) => {
        text += t;
      },
      onBoardProblem: (_id, message) => problems.push(message),
    });
    for (let i = 0; i < 400 && s.loading > 0; i++) await new Promise((r) => setTimeout(r, 5));
    return { s, doc, serial: () => text, problems };
  }
  const run = (s: Session, seconds: number) => {
    const end = s.time + seconds;
    while (s.time < end - 1e-9) s.advance(Math.min(0.05, end - s.time), s.doc.speed, 1e9);
  };
  const part = (doc: CircuitDoc, type: string) => doc.parts.find((p) => p.type === type) as CircuitDoc['parts'][number];

  it('lights the LED on GP16 through its resistor', async () => {
    const { s, doc, serial } = await session('pico-blink');
    let lit = 0;
    let dark = 0;
    for (let k = 0; k < 24; k++) {
      run(s, 0.05);
      const current = s.built.runtimes.get(part(doc, 'led').id)?.view().current as number;
      if (current > 0.005) lit++;
      else dark++;
    }
    expect(serial()).toContain('GP16 LED on');
    expect(lit).toBeGreaterThan(6);
    expect(dark).toBeGreaterThan(6);
  });

  it('draws the potentiometer on the OLED over I2C0 at GP20 and GP21', async () => {
    const { s, doc, serial } = await session('pico-oled');
    run(s, 0.4);
    expect(serial()).toContain('OLED ready');
    const view = s.built.runtimes.get(part(doc, 'oled').id)?.view();
    const screen = view?.screen;
    if (!isScreen(screen)) throw new Error('no screen');
    // The bar is filled 60 % of the way: lit at x = 40, dark at x = 110, on row 48.
    const at = (x: number, y: number) => screen.rgba[(y * screen.width + x) * 4] as number;
    expect(at(40, 48)).toBeGreaterThan(100);
    expect(at(110, 48)).toBeLessThan(100);
  });

  it('turns the servo with the potentiometer', async () => {
    const { s, doc } = await session('pico-servo');
    run(s, 0.6);
    const angle = s.built.runtimes.get(part(doc, 'servo').id)?.view().angle as number;
    expect(angle).toBeGreaterThan(35);
    expect(angle).toBeLessThan(55);
  });

  it('asks for MicroPython firmware it does not have', async () => {
    const { problems } = await session('pico-micropython');
    expect(problems.join(' ')).toMatch(/Open MicroPython on the board/);
  });
});
