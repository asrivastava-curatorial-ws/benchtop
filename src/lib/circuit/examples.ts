/**
 * Example circuits for the Circuit Simulator.  Each is drawn with a small
 * builder that places parts on the grid and runs wires between their
 * terminals, so the wiring always lands on the pins.
 */
import { type CircuitDoc, type FirmwareRef, type PlacedPart, terminalPoints, type WireSegment } from './netlist';
import { defaultProps, PART_BY_TYPE, type PropValue } from './parts';

type Point = readonly [number, number];

class Placed {
  constructor(readonly part: PlacedPart) {}
  /** The grid point of a terminal, by name. */
  pin(name: string): Point {
    const def = PART_BY_TYPE.get(this.part.type);
    const index = def?.terminals.findIndex((t) => t.name === name) ?? -1;
    if (!def || index < 0) throw new Error(`${this.part.type} has no terminal ${name}`);
    return terminalPoints(this.part, def)[index] as Point;
  }
}

class Builder {
  readonly parts: PlacedPart[] = [];
  readonly wires: WireSegment[] = [];
  readonly firmware: Record<string, FirmwareRef> = {};

  add(type: string, x: number, y: number, props: Record<string, PropValue> = {}, rot = 0, flip = false): Placed {
    const def = PART_BY_TYPE.get(type);
    if (!def) throw new Error(`Unknown part ${type}`);
    const part: PlacedPart = { id: `p${this.parts.length + 1}`, type, x, y, rot, ...(flip ? { flip } : {}), props: { ...defaultProps(def), ...props } };
    this.parts.push(part);
    return new Placed(part);
  }

  /** Straight wires through the points in turn (each step horizontal or vertical). */
  wire(...points: Point[]): void {
    for (let i = 1; i < points.length; i++) {
      const [x1, y1] = points[i - 1] as Point;
      const [x2, y2] = points[i] as Point;
      if (x1 !== x2 && y1 !== y2) throw new Error(`Wire from ${x1},${y1} to ${x2},${y2} is not straight`);
      if (x1 === x2 && y1 === y2) continue;
      this.wires.push({ id: `w${this.wires.length + 1}`, x1, y1, x2, y2 });
    }
  }

  /** Two wires with one bend: across then down ('hv') or down then across ('vh'). */
  link(a: Point, b: Point, bend: 'hv' | 'vh' = 'hv'): void {
    const corner: Point = bend === 'hv' ? [b[0], a[1]] : [a[0], b[1]];
    this.wire(a, corner, b);
  }

  /** Value labels are left off where parts sit a grid square apart. */
  labels = true;

  doc(title: string, dt: number, speed: number): CircuitDoc {
    return {
      version: 1,
      title,
      parts: this.parts,
      wires: this.wires,
      dt,
      speed,
      ...(Object.keys(this.firmware).length ? { firmware: this.firmware } : {}),
      ...(this.labels ? {} : { labels: false }),
    };
  }
}

export interface Example {
  readonly id: string;
  readonly title: string;
  readonly group: 'Basics' | 'Analog' | 'Digital' | 'Arduino Uno' | 'ESP32';
  readonly description: string;
  /** Oscilloscope time window, seconds. */
  readonly scope?: number;
  readonly make: () => CircuitDoc;
}

/* ------------------------------------------------------------------ basics -- */

function ledAndResistor(): CircuitDoc {
  const b = new Builder();
  const battery = b.add('battery', 4, 4, { v: 9 });
  const sw = b.add('switch', 6, 2, { closed: true });
  const r = b.add('resistor', 11, 2, { r: 470 });
  const led = b.add('led', 16, 3, { colour: 'red' }, 1);
  b.add('ground', 4, 9);
  b.link(battery.pin('+'), sw.pin('a'), 'vh');
  b.wire(sw.pin('b'), r.pin('a'));
  b.link(r.pin('b'), led.pin('anode'));
  b.wire(led.pin('cathode'), [16, 9], [4, 9]);
  b.wire(battery.pin('−'), [4, 9]);
  return b.doc('LED and resistor', 1e-4, 1);
}

function voltageDivider(): CircuitDoc {
  const b = new Builder();
  const battery = b.add('battery', 4, 3, { v: 12 });
  const r1 = b.add('resistor', 10, 2, { r: 10_000 }, 1);
  const r2 = b.add('resistor', 10, 6, { r: 4700 }, 1);
  const meter = b.add('voltmeter', 14, 6, {}, 1);
  b.add('ground', 4, 11);
  b.link(battery.pin('+'), r1.pin('a'), 'vh');
  b.wire(r1.pin('b'), r2.pin('a'));
  b.wire(r2.pin('a'), meter.pin('+'));
  b.wire(r2.pin('b'), meter.pin('−'));
  b.wire(r2.pin('b'), [10, 11], [4, 11]);
  b.wire(battery.pin('−'), [4, 11]);
  return b.doc('Voltage divider', 1e-4, 1);
}

function rcCharging(): CircuitDoc {
  const b = new Builder();
  const gen = b.add('ac-source', 4, 3, { shape: 'pulse', amplitude: 5, f: 1, duty: 0.5 });
  const r = b.add('resistor', 7, 2, { r: 10_000 });
  const c = b.add('capacitor', 12, 3, { c: 10e-6 }, 1);
  b.add('probe', 4, 2, { trace: '1' });
  b.add('probe', 12, 2, { trace: '2' });
  b.add('ground', 4, 8);
  b.link(gen.pin('+'), r.pin('a'), 'vh');
  b.link(r.pin('b'), c.pin('a'));
  b.wire(c.pin('b'), [12, 8], [4, 8]);
  b.wire(gen.pin('−'), [4, 8]);
  return b.doc('RC charging and discharging', 1e-3, 1);
}

/* ------------------------------------------------------------------ analog -- */

function transistorSwitch(): CircuitDoc {
  const b = new Builder();
  const battery = b.add('battery', 3, 4, { v: 9 });
  const button = b.add('pushbutton', 10, 3, {}, 1);
  // The LED's resistor and the LED touch end to end, and the LED's cathode touches the collector.
  b.add('resistor', 16, 2, { r: 470 }, 1);
  b.add('led', 16, 5, { colour: 'green' }, 1);
  const rBase = b.add('resistor', 11, 10, { r: 10_000 });
  const q = b.add('npn', 14, 10, { beta: 100 });
  b.add('ground', 3, 14);
  b.wire(battery.pin('+'), [3, 2], [10, 2], [16, 2]);
  b.wire([10, 2], button.pin('a'));
  b.link(button.pin('b'), rBase.pin('a'), 'vh');
  b.wire(q.pin('emitter'), [16, 14], [3, 14]);
  b.wire(battery.pin('−'), [3, 14]);
  return b.doc('Transistor switch', 1e-4, 1);
}

function invertingAmplifier(): CircuitDoc {
  const b = new Builder();
  const gen = b.add('ac-source', 3, 6, { shape: 'sine', amplitude: 1, f: 1000 });
  const rin = b.add('resistor', 5, 5, { r: 10_000 });
  const amp = b.add('opamp', 10, 6, { vpos: 15, vneg: -15 });
  const rf = b.add('resistor', 10, 2, { r: 47_000 });
  b.add('probe', 3, 5, { trace: '1' });
  b.add('probe', 15, 6, { trace: '2' });
  b.add('ground', 3, 11);
  b.link(gen.pin('+'), rin.pin('a'), 'vh');
  b.wire(rin.pin('b'), [9, 5], amp.pin('−'));
  b.link([9, 5], rf.pin('a'), 'vh');
  b.wire(rf.pin('b'), [15, 2], [15, 6]);
  b.wire(amp.pin('out'), [15, 6]);
  b.wire(amp.pin('+'), [10, 11], [3, 11]);
  b.wire(gen.pin('−'), [3, 11]);
  return b.doc('Op-amp inverting amplifier (gain −4.7)', 5e-6, 0.02);
}

function blinker555(): CircuitDoc {
  const b = new Builder();
  const battery = b.add('battery', 2, 4, { v: 9 });
  const chip = b.add('timer555', 9, 3);
  const r1 = b.add('resistor', 7, 1, { r: 1000 }, 1);
  const r2 = b.add('resistor', 4, 8, { r: 10_000 });
  const c = b.add('capacitor', 4, 9, { c: 47e-6 }, 1);
  const r3 = b.add('resistor', 17, 4, { r: 470 });
  const led = b.add('led', 20, 5, { colour: 'red' }, 1);
  b.add('ground', 2, 13);
  // Supply rail to VCC and RESET.
  b.wire(battery.pin('+'), [2, 1], r1.pin('a'), [12, 1], chip.pin('VCC'));
  b.wire([12, 1], [16, 1], [16, 8], chip.pin('RESET'));
  // R1 to DIS; R2 from DIS to THR and TRIG; C from there to ground.
  b.wire(r1.pin('b'), [7, 8], chip.pin('DIS'));
  b.wire(r2.pin('b'), [7, 8]);
  b.wire(r2.pin('a'), [4, 6], [8, 6], chip.pin('THR'));
  b.wire(chip.pin('TRIG'), [8, 4], [8, 6]);
  b.wire(r2.pin('a'), c.pin('a'));
  // Output through R3 to the LED.
  b.wire(chip.pin('OUT'), r3.pin('a'));
  b.link(r3.pin('b'), led.pin('anode'));
  // Ground line.
  b.wire(battery.pin('−'), [2, 13], [4, 13], [12, 13], [20, 13]);
  b.wire(c.pin('b'), [4, 13]);
  b.wire(chip.pin('GND'), [12, 13]);
  b.wire(led.pin('cathode'), [20, 13]);
  return b.doc('555 timer blinker', 1e-3, 1);
}

function relayMotor(): CircuitDoc {
  const b = new Builder();
  const battery = b.add('battery', 2, 4, { v: 9 });
  const button = b.add('pushbutton', 5, 1);
  const relay = b.add('relay', 10, 2, { coil: 100, pull: 0.03 });
  const diode = b.add('diode', 8, 6, {}, 3);
  const motor = b.add('motor', 15, 2, { r: 10 });
  const supply = b.add('battery', 20, 3, { v: 12 });
  b.add('ground', 2, 9);
  b.wire(battery.pin('+'), [2, 1], button.pin('a'));
  b.wire(button.pin('b'), [10, 1], relay.pin('coil +'));
  b.wire(diode.pin('cathode'), [8, 2], relay.pin('coil +'));
  b.wire(diode.pin('anode'), relay.pin('coil −'));
  b.wire(relay.pin('NO'), motor.pin('a'));
  b.wire(motor.pin('b'), [20, 2], supply.pin('+'));
  b.wire(battery.pin('−'), [2, 9], [10, 9], [13, 9], [20, 9]);
  b.wire(relay.pin('coil −'), [10, 9]);
  b.wire(relay.pin('COM'), [13, 9]);
  b.wire(supply.pin('−'), [20, 9]);
  return b.doc('Relay switching a motor', 1e-4, 1);
}

/* ----------------------------------------------------------------- digital -- */

function halfAdder(): CircuitDoc {
  const b = new Builder();
  const a = b.add('logic-input', 2, 2, { high: true });
  const bIn = b.add('logic-input', 2, 6, { high: false });
  const xor = b.add('xor', 10, 3);
  const and = b.add('and', 10, 8);
  const sum = b.add('logic-probe', 16, 3);
  const carry = b.add('logic-probe', 16, 8);
  b.wire(a.pin('out'), [7, 2], xor.pin('A'));
  b.wire([7, 2], [7, 7], and.pin('A'));
  b.wire(bIn.pin('out'), [8, 6]);
  b.wire([8, 6], [8, 4], xor.pin('B'));
  b.wire([8, 6], [8, 9], and.pin('B'));
  b.wire(xor.pin('Y'), sum.pin('in'));
  b.wire(and.pin('Y'), carry.pin('in'));
  return b.doc('Half adder (logic gates)', 1e-3, 1);
}

function counterDisplay(): CircuitDoc {
  const b = new Builder();
  const clock = b.add('clock', 2, 3, { f: 2 });
  const counter = b.add('counter', 7, 2, { modulo: 10 });
  const decoder = b.add('decoder', 15, 2);
  const display = b.add('seven-segment', 23, 2, { colour: 'red' });
  b.add('ground', 23, 11);
  b.wire(clock.pin('out'), counter.pin('CLK'));
  ['Q0', 'Q1', 'Q2', 'Q3'].forEach((q, i) => {
    b.wire(counter.pin(q), decoder.pin('ABCD'[i] as string));
  });
  for (const s of 'abcdefg') b.wire(decoder.pin(s), display.pin(s));
  b.wire(display.pin('COM'), [23, 11]);
  return b.doc('Counter and 7-segment display', 1e-3, 1);
}

/* ------------------------------------------------------------- Arduino Uno -- */

/** An Uno at (2, 1) running an example, with its GND pin grounded on the left. */
function uno(b: Builder, program: string): Placed {
  const board = b.add('arduino-uno', 2, 1);
  b.firmware[board.part.id] = { kind: 'example', id: program };
  b.add('ground', 0, 3);
  b.wire(board.pin('GND'), [0, 2], [0, 3]);
  return board;
}

/** A resistor and LED from a pin to a ground symbol, heading right at the pin's row. */
function ledFrom(b: Builder, from: Point, colour = 'red', resistance = 220): void {
  const [x, y] = from;
  const r = b.add('resistor', x + 2, y, { r: resistance });
  const led = b.add('led', x + 5, y, { colour });
  b.wire(from, r.pin('a'));
  b.add('ground', led.pin('cathode')[0], y);
}

function unoBlink(): CircuitDoc {
  const b = new Builder();
  const board = uno(b, 'blink');
  ledFrom(b, board.pin('D13'));
  return b.doc('Arduino: blink', 5e-5, 1);
}

function unoTraffic(): CircuitDoc {
  const b = new Builder();
  b.labels = false;
  const board = uno(b, 'traffic-lights');
  const pins: [string, string][] = [
    ['D2', 'red'],
    ['D3', 'yellow'],
    ['D4', 'green'],
  ];
  for (const [pin, colour] of pins) {
    const [x, y] = board.pin(pin);
    const r = b.add('resistor', x + 2, y, { r: 220 });
    const led = b.add('led', x + 5, y, { colour });
    b.wire([x, y], r.pin('a'));
    b.wire(led.pin('cathode'), [x + 10, y]);
  }
  const [x] = board.pin('D2');
  b.wire([x + 10, 11], [x + 10, 12], [x + 10, 13], [x + 10, 14]);
  b.add('ground', x + 10, 14);
  return b.doc('Arduino: traffic lights', 5e-5, 1);
}

function unoButton(): CircuitDoc {
  const b = new Builder();
  const board = uno(b, 'button');
  ledFrom(b, board.pin('D13'));
  const [x, y] = board.pin('D2');
  const button = b.add('pushbutton', x + 2, y);
  b.wire([x, y], button.pin('a'));
  b.add('ground', button.pin('b')[0], y);
  return b.doc('Arduino: button and LED', 5e-5, 1);
}

function unoFade(): CircuitDoc {
  const b = new Builder();
  const board = uno(b, 'fade');
  ledFrom(b, board.pin('D9'));
  return b.doc('Arduino: fading LED (PWM)', 5e-5, 1);
}

function unoDimmer(): CircuitDoc {
  const b = new Builder();
  const board = b.add('arduino-uno', 2, 1);
  b.firmware[board.part.id] = { kind: 'example', id: 'dimmer' };
  // Turned this way up, a higher position moves the wiper towards 5 V.
  const pot = b.add('potentiometer', -3, 8, { r: 10_000, position: 0.3 }, 1, true);
  b.wire(pot.pin('wiper'), board.pin('A0'));
  b.wire(pot.pin('end 2'), [-3, 3], board.pin('5V'));
  b.wire(board.pin('GND'), [-5, 2], [-5, 8], pot.pin('end 1'));
  b.add('ground', -5, 8);
  ledFrom(b, board.pin('D9'));
  return b.doc('Arduino: dimmer (potentiometer and PWM)', 5e-5, 1);
}

function unoChaser(): CircuitDoc {
  const b = new Builder();
  b.labels = false;
  const board = uno(b, 'led-chaser');
  const [x] = board.pin('D2');
  for (let pin = 2; pin <= 9; pin++) {
    const [, y] = board.pin(`D${pin}`);
    const r = b.add('resistor', x + 2, y, { r: 220 });
    const led = b.add('led', x + 5, y, { colour: pin % 2 ? 'yellow' : 'red' });
    b.wire([x, y], r.pin('a'));
    b.wire(led.pin('cathode'), [x + 10, y]);
  }
  for (let y = 6; y < 14; y++) b.wire([x + 10, y], [x + 10, y + 1]);
  b.add('ground', x + 10, 14);
  return b.doc('Arduino: LED chaser', 5e-5, 1);
}

function unoSevenSegment(): CircuitDoc {
  const b = new Builder();
  const board = uno(b, 'seven-segment');
  const display = b.add('seven-segment', 20, 6, { colour: 'red' });
  'abcdefg'.split('').forEach((s, i) => {
    b.wire(board.pin(`D${8 - i}`), display.pin(s));
  });
  b.add('ground', 20, 16);
  b.wire(display.pin('COM'), [20, 16]);
  return b.doc('Arduino: seven-segment counter', 5e-5, 1);
}

function unoSerial(): CircuitDoc {
  const b = new Builder();
  const board = uno(b, 'serial-control');
  ledFrom(b, board.pin('D13'));
  return b.doc('Arduino: serial control', 5e-5, 1);
}

/* ------------------------------------------------------------------- ESP32 -- */

function esp32Demo(): CircuitDoc {
  const b = new Builder();
  const board = b.add('esp32', 2, 1);
  b.firmware[board.part.id] = { kind: 'esp32-demo' };
  b.add('ground', 0, 3);
  b.wire(board.pin('GND'), [0, 2], [0, 3]);
  // GPIO2 blinks.
  const [x2, y2] = board.pin('GPIO2');
  const r1 = b.add('resistor', x2 + 10, y2, { r: 220 });
  const led1 = b.add('led', x2 + 13, y2, { colour: 'blue' });
  b.wire([x2, y2], r1.pin('a'));
  b.add('ground', led1.pin('cathode')[0], y2);
  // GPIO14: button to ground with a pull-up to 3.3 V.
  const [x14, y14] = board.pin('GPIO14');
  const pull = b.add('resistor', x14 + 6, y14, { r: 10_000 }, 3);
  b.add('rail', x14 + 6, y14 - 3, { v: 3.3 });
  const button = b.add('pushbutton', x14 + 8, y14);
  b.wire([x14, y14], pull.pin('a'), button.pin('a'));
  b.add('ground', button.pin('b')[0], y14);
  // GPIO16 follows the button; GPIO19 fades.
  ledFrom(b, board.pin('GPIO16'), 'green');
  ledFrom(b, board.pin('GPIO19'), 'yellow');
  return b.doc('ESP32: blink, button and fade', 1e-4, 1);
}

export const EXAMPLES: readonly Example[] = [
  { id: 'led', title: 'LED and resistor', group: 'Basics', description: 'A 9 V battery lights an LED through a 470 Ω resistor. Click the switch to turn it off.', make: ledAndResistor },
  { id: 'divider', title: 'Voltage divider', group: 'Basics', description: 'Two resistors split 12 V; the voltmeter reads the lower one.', make: voltageDivider },
  {
    id: 'rc',
    title: 'RC charging and discharging',
    group: 'Basics',
    description: 'A 1 Hz square wave charges a capacitor through a resistor (time constant 0.1 s). Probes show both on the oscilloscope.',
    scope: 2,
    make: rcCharging,
  },
  {
    id: 'transistor',
    title: 'Transistor switch',
    group: 'Analog',
    description: 'Pressing the button sends a small base current that switches the LED on through the NPN transistor.',
    make: transistorSwitch,
  },
  {
    id: 'opamp',
    title: 'Op-amp inverting amplifier',
    group: 'Analog',
    description: 'A 1 kHz sine wave amplified 4.7 times and inverted. Runs in slow motion.',
    scope: 0.004,
    make: invertingAmplifier,
  },
  { id: '555', title: '555 timer blinker', group: 'Analog', description: 'The 555 in astable mode flashes an LED about 1.5 times a second.', make: blinker555 },
  {
    id: 'relay',
    title: 'Relay switching a motor',
    group: 'Analog',
    description: 'The button energises the relay coil, whose contact runs a motor from a second battery. The diode protects against the coil’s back-EMF.',
    make: relayMotor,
  },
  { id: 'half-adder', title: 'Half adder', group: 'Digital', description: 'XOR and AND gates add two bits. Click the inputs to change them.', make: halfAdder },
  { id: 'counter', title: 'Counter and 7-segment display', group: 'Digital', description: 'A 2 Hz clock drives a decade counter, decoded onto a seven-segment display.', make: counterDisplay },
  { id: 'uno-blink', title: 'Blink', group: 'Arduino Uno', description: 'The classic first sketch: the LED on pin 13 blinks every half second.', make: unoBlink },
  { id: 'uno-traffic', title: 'Traffic lights', group: 'Arduino Uno', description: 'Red, yellow and green LEDs on pins 2 to 4 run a traffic light sequence.', make: unoTraffic },
  { id: 'uno-button', title: 'Button and LED', group: 'Arduino Uno', description: 'Pin 2 reads the button using its internal pull-up; the LED on pin 13 lights while it is pressed.', make: unoButton },
  { id: 'uno-fade', title: 'Fading LED', group: 'Arduino Uno', description: 'analogWrite fades the LED on pin 9 up and down with PWM.', make: unoFade },
  {
    id: 'uno-dimmer',
    title: 'Dimmer',
    group: 'Arduino Uno',
    description: 'The potentiometer on A0 sets the LED’s brightness; the reading appears in the serial monitor. Drag the knob while it runs.',
    make: unoDimmer,
  },
  { id: 'uno-chaser', title: 'LED chaser', group: 'Arduino Uno', description: 'Eight LEDs on pins 2 to 9 light one after another.', make: unoChaser },
  { id: 'uno-7seg', title: 'Seven-segment counter', group: 'Arduino Uno', description: 'Pins 8 down to 2 drive the segments of a display counting 0 to 9.', make: unoSevenSegment },
  { id: 'uno-serial', title: 'Serial control', group: 'Arduino Uno', description: 'Type 1 or 0 in the serial monitor to switch the LED on pin 13.', make: unoSerial },
  {
    id: 'esp32-demo',
    title: 'Blink, button and fade',
    group: 'ESP32',
    description: 'Benchtop’s demo firmware: GPIO2 blinks, GPIO16 follows the button on GPIO14, GPIO19 fades with PWM, and messages appear in the serial monitor. Needs the desktop app.',
    make: esp32Demo,
  },
];
