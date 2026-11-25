/**
 * The modules of the circuit simulator (displays, sensors, motors and
 * controls) running against the example sketches on emulated boards: each
 * example circuit is built, its board's firmware runs, and what the module
 * shows or reports is checked.
 */
import { describe, expect, it } from 'vitest';
import { isScreen, type Screen } from '../../src/lib/circuit/bus';
import type { Servo, ShiftRegister } from '../../src/lib/circuit/devices/actuators';
import { type LcdI2c, type LcdParallel, Max7219, type NeoPixels } from '../../src/lib/circuit/devices/displays';
import { bmeHumidity, bmePressure, bmeRaw, bmeTemperature, dhtBytes } from '../../src/lib/circuit/devices/sensors';
import { EXAMPLES } from '../../src/lib/circuit/examples';
import type { CircuitDoc } from '../../src/lib/circuit/netlist';
import { Session } from '../../src/lib/circuit/session';

async function start(id: string): Promise<{ session: Session; doc: CircuitDoc; serial: () => string }> {
  const e = EXAMPLES.find((x) => x.id === id);
  if (!e) throw new Error(id);
  const doc = e.make();
  let text = '';
  const problems: string[] = [];
  const session = new Session(doc, {
    onSerial: (_id, t) => {
      text += t;
    },
    onBoardProblem: (_id, message) => problems.push(message),
  });
  for (let i = 0; i < 400 && session.loading > 0; i++) await new Promise((r) => setTimeout(r, 5));
  if (problems.length) throw new Error(problems.join('; '));
  return { session, doc, serial: () => text };
}

/** Runs the circuit for some simulated seconds. */
const run = (session: Session, seconds: number) => {
  const end = session.time + seconds;
  while (session.time < end - 1e-9) session.advance(Math.min(0.05, end - session.time), session.doc.speed, 1e9);
};

const partOf = (doc: CircuitDoc, type: string) => {
  const p = doc.parts.find((x) => x.type === type);
  if (!p) throw new Error(`no ${type}`);
  return p;
};

const deviceOf = <T>(session: Session, doc: CircuitDoc, type: string) => session.built.runtimes.get(partOf(doc, type).id)?.device as T;
const viewOf = (session: Session, doc: CircuitDoc, type: string) => session.built.runtimes.get(partOf(doc, type).id)?.view() ?? {};

const screenOf = (session: Session, doc: CircuitDoc, type: string): Screen => {
  const s = viewOf(session, doc, type).screen;
  if (!isScreen(s)) throw new Error('no screen');
  return s;
};

const pixel = (s: Screen, x: number, y: number) => {
  const i = (y * s.width + x) * 4;
  return [s.rgba[i], s.rgba[i + 1], s.rgba[i + 2]] as [number, number, number];
};
const lit = (s: Screen, x: number, y: number) => pixel(s, x, y).some((c) => c > 100);

/** The text on a line of a character LCD. */
const lcdLine = (lcd: { addressAt(line: number, column: number, columns: number): number; ddram: Uint8Array }, line: number, columns = 16) =>
  Array.from({ length: columns }, (_, c) => String.fromCharCode(lcd.ddram[lcd.addressAt(line, c, columns)] as number)).join('');

describe('displays', () => {
  it('draws on the SSD1306 OLED over I²C', async () => {
    const { session, doc, serial } = await start('uno-oled');
    run(session, 0.4);
    expect(serial()).toContain('OLED ready');
    const view = viewOf(session, doc, 'oled');
    expect(view.on).toBe(true);
    const s = screenOf(session, doc, 'oled');
    // "Benchtop" in size 2 from (4, 0): the B's first column is lit from top to bottom.
    expect(lit(s, 4, 0)).toBe(true);
    expect(lit(s, 5, 13)).toBe(true);
    expect(lit(s, 0, 0)).toBe(false);
    // The frame around the ball.
    expect(lit(s, 64, 30)).toBe(true);
    expect(lit(s, 0, 45)).toBe(true);
    session.dispose();
  });

  it('shows text on an LCD through its I²C backpack, with a custom character', async () => {
    const { session, doc } = await start('uno-lcd-i2c');
    run(session, 1.4);
    const lcd = deviceOf<LcdI2c>(session, doc, 'lcd-i2c').lcd;
    expect(lcdLine(lcd, 0)).toBe('Hello, world! \u0000 ');
    expect(lcdLine(lcd, 1)).toMatch(/^Up [01] s/);
    // The heart: row 1 is 01010.
    expect(lcd.rows(0)[1]).toBe(0b01010);
    expect(lcd.displayOn).toBe(true);
    session.dispose();
  });

  it('shows text on a parallel LCD in 4-bit mode', async () => {
    const { session, doc } = await start('uno-lcd');
    run(session, 0.3);
    const lcd = deviceOf<LcdParallel>(session, doc, 'lcd').lcd;
    expect(lcd.eightBit).toBe(false);
    expect(lcd.twoLines).toBe(true);
    expect(lcdLine(lcd, 0)).toBe('hello, world!   ');
    expect(lcdLine(lcd, 1).trim()).toBe('0');
    // The backlight LED is wired through 220 Ω.
    expect(viewOf(session, doc, 'lcd').powered).toBe(true);
    session.dispose();
  });

  it('draws in colour on the ILI9341 TFT over SPI', async () => {
    const { session, doc, serial } = await start('uno-tft');
    run(session, 1.2);
    expect(serial()).toContain('Drawn');
    expect(viewOf(session, doc, 'tft').on).toBe(true);
    const s = screenOf(session, doc, 'tft');
    // Colour bars from y = 64: red at the left, white at the right.
    const [r, g, b] = pixel(s, 15, 80);
    expect(r).toBeGreaterThan(200);
    expect(g).toBeLessThan(40);
    expect(b).toBeLessThan(40);
    expect(pixel(s, 225, 80).every((c) => c > 200)).toBe(true);
    // Blue bar: the panel's BGR order is handled.
    const blue = pixel(s, 165, 80);
    expect(blue[2]).toBeGreaterThan(200);
    expect(blue[0]).toBeLessThan(40);
    // The yellow title.
    let yellow = 0;
    for (let x = 30; x < 180; x++) for (let y = 12; y < 36; y++) if (pixel(s, x, y)[0] > 200 && pixel(s, x, y)[1] > 200 && pixel(s, x, y)[2] < 60) yellow++;
    expect(yellow).toBeGreaterThan(200);
    session.dispose();
  });

  it('lights the MAX7219 matrix sent bit by bit', async () => {
    const { session, doc } = await start('uno-matrix');
    run(session, 0.4);
    const leds = viewOf(session, doc, 'led-matrix').leds as readonly number[];
    expect(leds).toEqual([0b00000000, 0b01100110, 0b11111111, 0b11111111, 0b01111110, 0b00111100, 0b00011000, 0b00000000]);
    expect(deviceOf<Max7219>(session, doc, 'led-matrix')).toBeInstanceOf(Max7219);
    run(session, 0.8);
    expect(viewOf(session, doc, 'led-matrix').leds).toEqual([0b00111100, 0b01000010, 0b10100101, 0b10000001, 0b10100101, 0b10011001, 0b01000010, 0b00111100]);
    session.dispose();
  });

  it('colours the NeoPixel ring', async () => {
    const { session, doc } = await start('uno-neopixel');
    run(session, 0.2);
    const ring = deviceOf<NeoPixels>(session, doc, 'neopixel-ring');
    expect(ring.colours).toHaveLength(16);
    expect(ring.colours.every((c) => c > 0)).toBe(true);
    // A rainbow: the hues differ round the ring.
    expect(new Set(ring.colours).size).toBeGreaterThan(8);
    const first = ring.colours.slice();
    run(session, 0.1);
    expect(ring.colours).not.toEqual(first);
    session.dispose();
  });

  it('counts in binary on LEDs through the 74HC595', async () => {
    const { session, doc } = await start('uno-595');
    run(session, 0.05);
    const chip = deviceOf<ShiftRegister>(session, doc, 'shift-register');
    const a = chip.latched;
    run(session, 0.75);
    const b = chip.latched;
    expect(b).toBeGreaterThan(a);
    expect(b - a).toBeGreaterThanOrEqual(4);
    expect(b - a).toBeLessThanOrEqual(6);
    // The LEDs follow the outputs.
    const leds = doc.parts.filter((p) => p.type === 'led');
    const on = leds.map((p) => ((session.built.runtimes.get(p.id)?.view().current as number) ?? 0) > 0.002);
    const value = on.reduce((v, bit, i) => v | ((bit ? 1 : 0) << i), 0);
    expect(value).toBe(chip.latched);
    session.dispose();
  });
});

describe('sensors', () => {
  it('reads the DHT22 and its changes', async () => {
    const { session, doc, serial } = await start('uno-dht22');
    run(session, 0.3);
    expect(serial()).toContain('Temperature: 24.0 C  Humidity: 55.0 %');
    const dht = partOf(doc, 'dht22');
    session.setLive(dht.id, { ...dht.props, temperature: -5.5, humidity: 80 });
    run(session, 2.1);
    expect(serial()).toContain('Temperature: -5.5 C  Humidity: 80.0 %');
    session.dispose();
  });

  it('frames DHT data as the sensors do', () => {
    expect(dhtBytes('dht22', 65.2, 35.1)).toEqual([0x02, 0x8c, 0x01, 0x5f, 0xee]);
    expect(dhtBytes('dht22', 50, -10.1)).toEqual([0x01, 0xf4, 0x80, 0x65, 0xda]);
    expect(dhtBytes('dht11', 40, 25)).toEqual([40, 0, 25, 0, 65]);
  });

  it('turns BME280 readings into raw values the datasheet formulas turn back', () => {
    const raw = bmeRaw(21.5, 998.2, 63.4);
    const { t, fine } = bmeTemperature(raw.t);
    expect(t).toBeCloseTo(21.5, 2);
    expect(bmePressure(raw.p, fine)).toBeCloseTo(998.2, 1);
    expect(bmeHumidity(raw.h, fine)).toBeCloseTo(63.4, 1);
  });

  it('serves the BME280 over I²C to a sketch using the integer formulas', async () => {
    const { session, serial } = await start('uno-bme280');
    run(session, 0.1);
    const line = /Temperature ([\d.-]+) C {2}Pressure ([\d.]+) hPa {2}Humidity ([\d.]+) %/.exec(serial());
    expect(line).not.toBeNull();
    expect(Number(line?.[1])).toBeCloseTo(24, 1);
    expect(Number(line?.[2])).toBeCloseTo(1013.25, 0);
    expect(Number(line?.[3])).toBeCloseTo(50, 0);
    session.dispose();
  });

  it('serves the MPU6050 registers', async () => {
    const { session, doc, serial } = await start('uno-mpu6050');
    run(session, 0.05);
    expect(serial()).toContain('a = 0.00, 0.00, 1.00 g  rotation = 0.0, 0.0, 0.0 deg/s  24.0 C');
    const mpu = partOf(doc, 'mpu6050');
    session.setLive(mpu.id, { ...mpu.props, ax: 0.5, gz: -90 });
    run(session, 0.6);
    expect(serial()).toContain('a = 0.50, 0.00, 1.00 g  rotation = 0.0, 0.0, -90.0 deg/s');
    session.dispose();
  });

  it('keeps time in the DS1307 and shows it on the shared I²C bus', async () => {
    const { session, doc } = await start('uno-clock');
    run(session, 1.3);
    const lcd = deviceOf<LcdI2c>(session, doc, 'lcd-i2c').lcd;
    const now = new Date();
    expect(lcdLine(lcd, 0)).toBe(`Date ${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} `);
    expect(lcdLine(lcd, 1)).toMatch(/^Time \d\d:\d\d:\d\d {3}$/);
    session.dispose();
  });

  it('times the HC-SR04 echo for the distance set', async () => {
    const { session, doc, serial } = await start('uno-sonar');
    run(session, 0.3);
    expect(serial()).toMatch(/Distance: 4[12]\.\d cm/);
    const sonar = partOf(doc, 'ultrasonic');
    session.setLive(sonar.id, { ...sonar.props, distance: 250 });
    run(session, 0.6);
    expect(serial()).toMatch(/Distance: 2(49|50|51)\.\d cm/);
    session.setLive(sonar.id, { ...sonar.props, distance: 440 });
    run(session, 0.6);
    expect(serial()).toContain('Nothing in range');
    session.dispose();
  });

  it('follows the PIR sensor', async () => {
    const { session, doc, serial } = await start('uno-pir');
    run(session, 0.1);
    expect(serial()).toContain('Watching for motion');
    session.interact(partOf(doc, 'pir').id, 'toggle');
    run(session, 0.1);
    expect(serial()).toContain('Motion detected');
    expect(session.mcu(partOf(doc, 'arduino-uno').id)?.mode(13)).toBe('high');
    session.interact(partOf(doc, 'pir').id, 'toggle');
    run(session, 2.3);
    expect(serial()).toContain('Motion ended');
    session.dispose();
  });

  it('reads light and temperature from resistive sensors', async () => {
    const ntc = await start('uno-ntc');
    run(ntc.session, 0.1);
    const t = Number(/Temperature: ([\d.-]+) C/.exec(ntc.serial())?.[1]);
    expect(t).toBeGreaterThan(29.5);
    expect(t).toBeLessThan(30.5);
    ntc.session.dispose();

    const ldr = await start('uno-ldr');
    run(ldr.session, 0.1);
    const bright = Number(/Light reading: (\d+)/.exec(ldr.serial())?.[1]);
    const part = partOf(ldr.doc, 'ldr');
    ldr.session.setLive(part.id, { ...part.props, light: 2 });
    run(ldr.session, 0.6);
    expect(ldr.serial()).toContain('dark: LED on');
    expect(bright).toBeGreaterThan(500);
    ldr.session.dispose();
  });
});

describe('motors and controls', () => {
  it('sweeps the servo with the Servo library', async () => {
    const { session, doc } = await start('uno-servo');
    const servo = deviceOf<Servo>(session, doc, 'servo');
    run(session, 0.3);
    const early = servo.target;
    run(session, 0.6);
    expect(servo.target).toBeGreaterThan(early);
    expect(servo.pulse).toBeGreaterThan(0.0005);
    expect(servo.pulse).toBeLessThan(0.0025);
    session.dispose();
  });

  it('sets the servo from the potentiometer', async () => {
    const { session, doc, serial } = await start('uno-servo-knob');
    run(session, 0.5);
    expect(serial()).toMatch(/A0 = 25[5-7] {2}angle = 4[45]/);
    const servo = deviceOf<Servo>(session, doc, 'servo');
    expect(servo.target).toBeGreaterThan(43);
    expect(servo.target).toBeLessThan(47);
    session.dispose();
  });

  it('turns the stepper half a turn', async () => {
    const { session, doc, serial } = await start('uno-stepper');
    run(session, 2.3);
    expect(serial()).toContain('Clockwise');
    const angle = viewOf(session, doc, 'stepper').angle as number;
    expect(Math.abs(angle)).toBeGreaterThan(170);
    expect(Math.abs(angle)).toBeLessThan(190);
    session.dispose();
  });

  it('opens the keypad lock', async () => {
    const { session, doc, serial } = await start('uno-keypad');
    run(session, 0.05);
    const pad = partOf(doc, 'keypad');
    // Key centres in the keypad's own units: column c at 1.5 + 2c, row r at 1.65 + 2.4r.
    const press = (row: number, column: number) => {
      session.interact(pad.id, 'press', [1.5 + 2 * column, 1.65 + 2.4 * row]);
      run(session, 0.06);
      session.interact(pad.id, 'release');
      run(session, 0.06);
    };
    press(0, 0);
    press(0, 1);
    press(0, 2);
    press(1, 0);
    press(3, 2);
    expect(serial()).toContain('Key 1');
    expect(serial()).toContain('Key 4');
    expect(serial()).toContain('Unlocked');
    expect(session.mcu(partOf(doc, 'arduino-uno').id)?.mode(13)).toBe('high');
    session.dispose();
  });

  it('counts turns of the rotary encoder', async () => {
    const { session, doc, serial } = await start('uno-encoder');
    run(session, 0.05);
    const knob = partOf(doc, 'encoder');
    for (let i = 0; i < 3; i++) {
      session.interact(knob.id, 'press', [6.3, 3]);
      session.interact(knob.id, 'release');
      run(session, 0.02);
    }
    expect(serial()).toContain('Position: 3');
    session.interact(knob.id, 'press', [2.4, 3]);
    session.interact(knob.id, 'release');
    run(session, 0.02);
    expect(serial()).toMatch(/Position: 2\s*$/);
    session.interact(knob.id, 'press', [4.3, 3]);
    run(session, 0.05);
    session.interact(knob.id, 'release');
    run(session, 0.4);
    expect(serial()).toContain('Pressed: back to 0');
    session.dispose();
  });

  it('reads the joystick', async () => {
    const { session, doc, serial } = await start('uno-joystick');
    run(session, 0.1);
    expect(serial()).toMatch(/x = 51[01]/);
    const stick = partOf(doc, 'joystick');
    session.setLive(stick.id, { ...stick.props, x: 1, y: 0 });
    session.interact(stick.id, 'press');
    run(session, 0.3);
    expect(serial()).toMatch(/x = 102[23] {2}y = 0 {2}pressed/);
    session.dispose();
  });
});

describe('more boards', () => {
  it('runs the OLED example on the Nano', async () => {
    const { session, doc } = await start('nano-oled');
    run(session, 0.4);
    expect(lit(screenOf(session, doc, 'oled'), 4, 0)).toBe(true);
    session.dispose();
  });

  it('runs the Mega 2560', async () => {
    const { session, doc, serial } = await start('mega-blink');
    run(session, 0.3);
    expect(serial()).toContain('Hello from the Arduino Mega 2560');
    const board = partOf(doc, 'arduino-mega').id;
    expect(session.mcu(board)?.mode(13)).toBe('high');
    run(session, 0.5);
    expect(session.mcu(board)?.mode(13)).toBe('low');
    session.dispose();
  });

  it('reads A8 and drives pins 22 to 31 on the Mega', async () => {
    const { session, doc, serial } = await start('mega-bars');
    run(session, 0.2);
    expect(serial()).toMatch(/A8 = 61[2-6] {2}LEDs lit: 6/);
    const lit = doc.parts.filter((p) => p.type === 'led').filter((p) => ((session.built.runtimes.get(p.id)?.view().current as number) ?? 0) > 0.002);
    expect(lit).toHaveLength(6);
    session.dispose();
  });

  it('uses the Mega’s own I²C pins for the OLED', async () => {
    const { session, doc } = await start('mega-oled');
    run(session, 0.4);
    expect(lit(screenOf(session, doc, 'oled'), 0, 0)).toBe(true);
    session.dispose();
  });

  it('blinks, fades and talks on the ATtiny85', async () => {
    const blink = await start('tiny-blink');
    run(blink.session, 0.25);
    const board = partOf(blink.doc, 'attiny85').id;
    expect(blink.session.mcu(board)?.mode(1)).toBe('high');
    run(blink.session, 0.5);
    expect(blink.session.mcu(board)?.mode(1)).toBe('low');
    blink.session.dispose();

    const talk = await start('tiny-serial');
    run(talk.session, 1.2);
    expect(talk.serial()).toContain('ATtiny85 count 0\r\nATtiny85 count 1');
    talk.session.dispose();
  });

  it('drives NeoPixels from the ATtiny85 at 8 MHz', async () => {
    const { session, doc } = await start('tiny-neopixel');
    run(session, 0.3);
    const strip = deviceOf<NeoPixels>(session, doc, 'neopixel-strip');
    expect(strip.colours.filter((c) => c > 0)).toHaveLength(3);
    session.dispose();
  });
});
