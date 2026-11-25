/**
 * The modules of the circuit editor's parts library: displays, sensors,
 * controls and motors.  Each becomes a device that talks to the boards
 * (devices/*.ts) and solver elements for its supply and outputs.
 */
import type { Device } from './bus';
import { Encoder, KEYPAD_KEYS, KEYPAD_TERMINALS, Keypad, ldrResistance, ntcResistance, Pir, SERVO_TERMINALS, Servo, SHIFT_TERMINALS, ShiftRegister, Stepper } from './devices/actuators';
import { Ili9341, LCD_I2C_TERMINALS, LCD_TERMINALS, LcdI2c, LcdParallel, MATRIX_TERMINALS, Max7219, NeoPixels, OLED_TERMINALS, PIXEL_TERMINALS, Ssd1306, TFT_TERMINALS } from './devices/displays';
import { BME_TERMINALS, Bme280, DHT_TERMINALS, Dht, MPU_TERMINALS, Mpu6050, RTC_TERMINALS, Rtc, SONAR_TERMINALS, Ultrasonic } from './devices/sensors';
import { Diode, ledModel, Potentiometer } from './elements';
import type { Element } from './engine';
import { bool, num, Output, type Props, Sense, Supply, str, Variable } from './modules';
import type { PartContext, PartDef, PropDef, Runtime, Terminal } from './parts';

/** The device this part had before the circuit was rebuilt (the same kind and shape), or a new one. */
function keep<T extends Device>(context: PartContext | undefined, make: () => T, shape = ''): T {
  return context ? context.keep(make, shape) : make();
}

/** The module's supply: a load between two of its terminals that also tells whether it is powered. */
function supplyOf(nodes: readonly number[], vcc: number, gnd: number, ohms: number): Supply {
  const s = new Supply(ohms);
  s.nodes = [nodes[vcc] as number, nodes[gnd] as number];
  return s;
}

/** Terminals in a column on the left edge, from y = first. */
const left = (names: readonly string[], first = 1): Terminal[] => names.map((name, i) => ({ x: 0, y: first + i, name }));

const ADDRESS = (choices: readonly string[]): PropDef => ({
  key: 'address',
  label: 'I²C address',
  kind: 'choice',
  default: choices[0] as string,
  choices: choices.map((c) => [c, `0x${c.slice(2).toUpperCase()}`] as const),
});

const live = (key: string, label: string, def: number, min: number, max: number, unit?: string, extra: Partial<PropDef> = {}): PropDef => ({
  key,
  label,
  kind: 'number',
  default: def,
  min,
  max,
  live: true,
  ...(unit ? { unit } : {}),
  ...extra,
});

/** A module with a device: its runtime shows the device's view, and live readings go to the device. */
function moduleRuntime(device: Device, elements: Element[], extra: Partial<Runtime> = {}): Runtime {
  return {
    elements,
    device,
    view: () => device.view(),
    live: (props: Props) => device.configure(props),
    ...extra,
  };
}

const lcdSize = (props: Props): readonly [number, number, number, number] => (str(props, 'size', '16x2') === '20x4' ? [0, 0, 16, 7] : [0, 0, 14, 5]);

export const MODULE_PARTS: readonly PartDef[] = [
  /* ------------------------------------------------------------ displays -- */
  {
    type: 'oled',
    name: 'OLED display (SSD1306)',
    group: 'Displays',
    terminals: OLED_TERMINALS.map((name, i) => ({ x: 2 + i, y: 0, name })),
    box: [0, 0, 8, 6.4],
    props: [
      ADDRESS(['0x3c', '0x3d']),
      {
        key: 'height',
        label: 'Size',
        kind: 'choice',
        default: '64',
        choices: [
          ['64', '128 × 64'],
          ['32', '128 × 32'],
        ],
      },
      {
        key: 'colour',
        label: 'Colour',
        kind: 'choice',
        default: 'white',
        choices: [
          ['white', 'White'],
          ['blue', 'Blue'],
          ['yellow-blue', 'Yellow top, blue below'],
        ],
      },
    ],
    keywords: 'oled ssd1306 display screen i2c 128x64 0.96 graphic',
    create(props, nodes, context) {
      const device = keep(context, () => new Ssd1306(props), str(props, 'height', '64'));
      const supply = supplyOf(nodes, 1, 0, 250);
      device.supply = supply;
      return moduleRuntime(device, [supply]);
    },
  },
  {
    type: 'lcd-i2c',
    name: 'LCD with I²C backpack',
    group: 'Displays',
    terminals: left(LCD_I2C_TERMINALS),
    box: [0, 0, 14, 5],
    sizeFor: lcdSize,
    props: [
      ADDRESS(['0x27', '0x3f']),
      {
        key: 'size',
        label: 'Size',
        kind: 'choice',
        default: '16x2',
        choices: [
          ['16x2', '16 × 2'],
          ['20x4', '20 × 4'],
        ],
      },
      {
        key: 'colour',
        label: 'Backlight',
        kind: 'choice',
        default: 'green',
        choices: [
          ['green', 'Yellow-green'],
          ['blue', 'Blue'],
        ],
      },
    ],
    keywords: 'lcd 1602 2004 hd44780 pcf8574 i2c character display liquidcrystal',
    create(props, nodes, context) {
      const device = keep(context, () => new LcdI2c(props), str(props, 'size', '16x2'));
      const supply = supplyOf(nodes, 1, 0, 200);
      device.supply = supply;
      return moduleRuntime(device, [supply]);
    },
  },
  {
    type: 'lcd',
    name: 'Character LCD (16 pins)',
    group: 'Displays',
    terminals: LCD_TERMINALS.map((name, i) => ({ x: 1 + i, y: 7, name })),
    box: [0, 0, 17, 7],
    props: [
      {
        key: 'size',
        label: 'Size',
        kind: 'choice',
        default: '16x2',
        choices: [
          ['16x2', '16 × 2'],
          ['20x4', '20 × 4'],
        ],
      },
      {
        key: 'colour',
        label: 'Backlight',
        kind: 'choice',
        default: 'green',
        choices: [
          ['green', 'Yellow-green'],
          ['blue', 'Blue'],
        ],
      },
    ],
    keywords: 'lcd 1602 2004 hd44780 parallel character display liquidcrystal',
    create(props, nodes, context) {
      const device = keep(context, () => new LcdParallel(props), str(props, 'size', '16x2'));
      const supply = supplyOf(nodes, 1, 0, 2500);
      device.supply = supply;
      // The backlight is an LED between A and K.
      const backlight = new Diode(ledModel('white'));
      backlight.nodes = [nodes[14] as number, nodes[15] as number];
      device.backlight = () => backlight.average;
      return moduleRuntime(device, [supply, backlight]);
    },
  },
  {
    type: 'tft',
    name: 'Colour TFT (ILI9341)',
    group: 'Displays',
    terminals: left(TFT_TERMINALS),
    box: [0, 0, 14, 17],
    props: [],
    keywords: 'tft ili9341 lcd colour color spi 240x320 2.8 graphic display',
    create(props, nodes, context) {
      const device = keep(context, () => new Ili9341(props));
      const supply = supplyOf(nodes, 0, 1, 100);
      device.supply = supply;
      // The backlight pin draws a little current; it lights the screen when high.
      const led = new Variable(1000);
      led.nodes = [nodes[7] as number, nodes[1] as number];
      return moduleRuntime(device, [supply, led]);
    },
  },
  {
    type: 'led-matrix',
    name: 'LED matrix (MAX7219)',
    group: 'Displays',
    terminals: left(MATRIX_TERMINALS),
    box: [0, 0, 8.6, 6.4],
    sizeFor: (props) => {
      const n = Math.max(1, Math.min(8, Math.round(num(props, 'modules', 1))));
      return str(props, 'display', 'matrix') === 'digits' ? [0, 0, 12, 6.4] : [0, 0, 2.6 + 6 * n, 6.4];
    },
    props: [
      {
        key: 'display',
        label: 'Display',
        kind: 'choice',
        default: 'matrix',
        choices: [
          ['matrix', '8 × 8 dot matrix'],
          ['digits', '8 seven-segment digits'],
        ],
      },
      { key: 'modules', label: 'Modules in the chain', kind: 'number', default: 1, min: 1, max: 8 },
      {
        key: 'colour',
        label: 'Colour',
        kind: 'choice',
        default: 'red',
        choices: [
          ['red', 'Red'],
          ['green', 'Green'],
          ['blue', 'Blue'],
          ['white', 'White'],
        ],
      },
    ],
    keywords: 'max7219 led matrix 8x8 dot seven segment 7-segment ledcontrol spi',
    create(props, nodes, context) {
      const device = keep(context, () => new Max7219(props));
      const supply = supplyOf(nodes, 0, 1, 50);
      device.supply = supply;
      return moduleRuntime(device, [supply]);
    },
  },
  ...(['ring', 'strip', 'matrix'] as const).map(
    (layout): PartDef => ({
      type: `neopixel-${layout}`,
      name: layout === 'ring' ? 'NeoPixel ring' : layout === 'strip' ? 'NeoPixel strip' : 'NeoPixel 8×8 matrix',
      group: 'Outputs',
      terminals: left(PIXEL_TERMINALS),
      box: layout === 'ring' ? [0, 0, 9, 7] : layout === 'strip' ? [0, 0, 10, 5] : [0, 0, 11, 10],
      sizeFor: (props) => {
        const n = Math.round(num(props, 'count', 8));
        if (layout === 'ring') {
          const d = Math.max(4, n * 0.36 + 1);
          return [0, 0, 3 + d, Math.max(5, d + 1)];
        }
        if (layout === 'strip') return [0, 0, 2 + Math.max(2, n), 5];
        return [0, 0, 11, 10];
      },
      props:
        layout === 'matrix'
          ? []
          : [
              layout === 'ring'
                ? {
                    key: 'count',
                    label: 'LEDs',
                    kind: 'choice',
                    default: '16',
                    choices: [
                      ['8', '8'],
                      ['12', '12'],
                      ['16', '16'],
                      ['24', '24'],
                    ],
                  }
                : { key: 'count', label: 'LEDs', kind: 'number', default: 8, min: 1, max: 60 },
            ],
      keywords: 'neopixel ws2812 ws2812b rgb addressable led ring strip matrix',
      create(props, nodes, context) {
        const count = layout === 'matrix' ? 64 : Number(props.count ?? 8);
        const device = keep(context, () => new NeoPixels({ ...props, count }));
        device.configure({ ...props, count });
        // About 1 mA per LED doing nothing.
        const supply = supplyOf(nodes, 1, 2, 5000 / count);
        device.supply = supply;
        return moduleRuntime(device, [supply], { live: (p) => device.configure({ ...p, count }) });
      },
    }),
  ),
  /* ------------------------------------------------------------- sensors -- */
  {
    type: 'dht22',
    name: 'Temperature and humidity (DHT22)',
    group: 'Sensors',
    terminals: left(DHT_TERMINALS),
    box: [0, 0, 4.6, 4.4],
    props: [
      {
        key: 'model',
        label: 'Sensor',
        kind: 'choice',
        default: 'dht22',
        choices: [
          ['dht22', 'DHT22 (AM2302)'],
          ['dht11', 'DHT11'],
        ],
      },
      live('temperature', 'Temperature', 24, -40, 80, '°C', { step: 0.1 }),
      live('humidity', 'Humidity', 50, 0, 100, '%', { step: 0.1 }),
    ],
    keywords: 'dht22 dht11 am2302 temperature humidity sensor',
    create(props, nodes, context) {
      const device = keep(context, () => new Dht(props));
      const supply = supplyOf(nodes, 0, 2, 3300);
      device.supply = supply;
      return moduleRuntime(device, [supply]);
    },
  },
  {
    type: 'bme280',
    name: 'Weather sensor (BME280)',
    group: 'Sensors',
    terminals: left(BME_TERMINALS),
    box: [0, 0, 5, 5],
    props: [
      ADDRESS(['0x76', '0x77']),
      live('temperature', 'Temperature', 24, -40, 85, '°C', { step: 0.1 }),
      live('humidity', 'Humidity', 50, 0, 100, '%', { step: 0.1 }),
      live('pressure', 'Pressure', 1013.25, 300, 1100, 'hPa', { step: 0.1 }),
    ],
    keywords: 'bme280 bmp280 pressure barometer temperature humidity weather i2c',
    create(props, nodes, context) {
      const device = keep(context, () => new Bme280(props));
      const supply = supplyOf(nodes, 0, 1, 5000);
      device.supply = supply;
      return moduleRuntime(device, [supply]);
    },
  },
  {
    type: 'mpu6050',
    name: 'Motion sensor (MPU6050)',
    group: 'Sensors',
    terminals: left(MPU_TERMINALS),
    box: [0, 0, 6, 5],
    props: [
      ADDRESS(['0x68', '0x69']),
      live('ax', 'Acceleration X', 0, -2, 2, 'g', { step: 0.01 }),
      live('ay', 'Acceleration Y', 0, -2, 2, 'g', { step: 0.01 }),
      live('az', 'Acceleration Z', 1, -2, 2, 'g', { step: 0.01 }),
      live('gx', 'Rotation X', 0, -250, 250, '°/s'),
      live('gy', 'Rotation Y', 0, -250, 250, '°/s'),
      live('gz', 'Rotation Z', 0, -250, 250, '°/s'),
      live('temperature', 'Temperature', 24, -40, 85, '°C', { step: 0.1 }),
    ],
    keywords: 'mpu6050 gy-521 accelerometer gyroscope imu motion tilt i2c',
    create(props, nodes, context) {
      const device = keep(context, () => new Mpu6050(props));
      const supply = supplyOf(nodes, 0, 1, 1200);
      device.supply = supply;
      return moduleRuntime(device, [supply]);
    },
  },
  {
    type: 'rtc',
    name: 'Real-time clock (DS1307 / DS3231)',
    group: 'Sensors',
    terminals: left(RTC_TERMINALS),
    box: [0, 0, 6, 5],
    props: [
      {
        key: 'chip',
        label: 'Chip',
        kind: 'choice',
        default: 'ds1307',
        choices: [
          ['ds1307', 'DS1307'],
          ['ds3231', 'DS3231'],
        ],
      },
      live('temperature', 'Temperature (DS3231)', 25, -40, 85, '°C'),
    ],
    keywords: 'rtc ds1307 ds3231 real time clock date i2c',
    create(props, nodes, context) {
      const device = keep(context, () => new Rtc(props));
      const supply = supplyOf(nodes, 1, 0, 25_000);
      device.supply = supply;
      return moduleRuntime(device, [supply]);
    },
  },
  {
    type: 'ultrasonic',
    name: 'Ultrasonic distance (HC-SR04)',
    group: 'Sensors',
    terminals: SONAR_TERMINALS.map((name, i) => ({ x: 2 + i, y: 4, name })),
    box: [0, 0, 8, 4],
    props: [live('distance', 'Distance', 100, 1, 450, 'cm')],
    keywords: 'hc-sr04 ultrasonic sonar distance range sensor ping',
    create(props, nodes, context) {
      const device = keep(context, () => new Ultrasonic(props));
      const supply = supplyOf(nodes, 0, 3, 333);
      device.supply = supply;
      return moduleRuntime(device, [supply]);
    },
  },
  {
    type: 'pir',
    name: 'Motion detector (PIR)',
    group: 'Sensors',
    terminals: left(['VCC', 'OUT', 'GND']),
    box: [0, 0, 4.6, 4.4],
    props: [
      { key: 'motion', label: 'Motion', kind: 'boolean', default: false },
      { key: 'hold', label: 'Hold time', kind: 'number', default: 3, unit: 's', min: 0.1, max: 300 },
    ],
    interactive: 'toggle',
    toggleProp: 'motion',
    keywords: 'pir hc-sr501 motion detector infrared presence sensor',
    create(props, nodes) {
      const pir = new Pir(num(props, 'hold', 3));
      pir.nodes = [nodes[0] as number, nodes[1] as number, nodes[2] as number];
      pir.motion = bool(props, 'motion', false);
      return {
        elements: [pir],
        view: () => ({ motion: pir.motion, high: pir.high }),
        interact: (action) => {
          if (action === 'toggle') pir.motion = !pir.motion;
        },
      };
    },
  },
  {
    type: 'ldr',
    name: 'Light sensor (LDR)',
    group: 'Sensors',
    terminals: [
      { x: 0, y: 0, name: 'a' },
      { x: 3, y: 0, name: 'b' },
    ],
    box: [0, -1.1, 3, 0.8],
    props: [live('light', 'Light', 300, 0.1, 100_000, 'lx', { scale: 'log' })],
    keywords: 'ldr photoresistor photocell light dependent resistor gl5528',
    create(props, nodes) {
      const r = new Variable(ldrResistance(num(props, 'light', 300)));
      r.nodes = [nodes[0] as number, nodes[1] as number];
      return {
        elements: [r],
        view: () => ({ resistance: r.resistance }),
        live: (p) => {
          r.resistance = ldrResistance(num(p, 'light', 300));
        },
      };
    },
  },
  {
    type: 'ntc',
    name: 'Thermistor (NTC)',
    group: 'Sensors',
    terminals: [
      { x: 0, y: 0, name: 'a' },
      { x: 3, y: 0, name: 'b' },
    ],
    box: [0, -1.1, 3, 0.8],
    props: [
      live('temperature', 'Temperature', 25, -40, 125, '°C', { step: 0.1 }),
      { key: 'r25', label: 'Resistance at 25 °C', kind: 'number', default: 10_000, unit: 'Ω', min: 1 },
      { key: 'beta', label: 'B constant', kind: 'number', default: 3950, unit: 'K', min: 100 },
    ],
    keywords: 'ntc thermistor temperature sensor 10k 3950',
    create(props, nodes) {
      const resistance = (p: Props) => ntcResistance(num(p, 'temperature', 25), num(p, 'r25', 10_000), num(p, 'beta', 3950));
      const r = new Variable(resistance(props));
      r.nodes = [nodes[0] as number, nodes[1] as number];
      return {
        elements: [r],
        view: () => ({ resistance: r.resistance }),
        live: (p) => {
          r.resistance = resistance(p);
        },
      };
    },
  },
  /* ------------------------------------------------------------ controls -- */
  {
    type: 'keypad',
    name: 'Keypad 4×4',
    group: 'Controls',
    terminals: KEYPAD_TERMINALS.map((name, i) => ({ x: 1 + i, y: 11, name })),
    box: [0, 0, 9, 11],
    props: [],
    interactive: 'point',
    keywords: 'keypad membrane matrix 4x4 keys buttons',
    create(props, nodes, context) {
      const device = keep(context, () => new Keypad(props));
      // The circuit sees a pressed key as a closed contact between its row and column.
      const keys: Element = {
        nodes: [...nodes],
        stamp(s) {
          for (const key of device.pressed) s.conductance(nodes[Math.floor(key / 4)] as number, nodes[4 + (key % 4)] as number, 100);
        },
      };
      return moduleRuntime(device, [keys], {
        interact: (action, at) => {
          if (action === 'release') device.release();
          else if (at) {
            const column = Math.floor((at[0] - 0.5) / 2);
            const row = Math.floor((at[1] - 0.5) / 2.4);
            if (row >= 0 && row < 4 && column >= 0 && column < 4) device.press(row * 4 + column);
          }
        },
      });
    },
  },
  {
    type: 'encoder',
    name: 'Rotary encoder (KY-040)',
    group: 'Controls',
    terminals: left(['CLK', 'DT', 'SW', '+', 'GND']),
    box: [0, 0, 7, 6],
    props: [],
    interactive: 'point',
    keywords: 'rotary encoder ky-040 knob quadrature',
    create(_props, nodes) {
      const e = new Encoder();
      e.nodes = [0, 1, 2, 3, 4].map((i) => nodes[i] as number);
      return {
        elements: [e],
        view: () => ({ position: e.position, pressed: e.pressed }),
        interact: (action, at) => {
          if (action === 'release') e.press(false);
          else if (at && at[0] < 3.2) e.turn(false);
          else if (at && at[0] > 5.4) e.turn(true);
          else e.press(true);
        },
      };
    },
  },
  {
    type: 'joystick',
    name: 'Joystick',
    group: 'Controls',
    terminals: left(['VCC', 'GND', 'VRx', 'VRy', 'SW']),
    box: [0, 0, 7, 6],
    props: [live('x', 'Horizontal (0–1)', 0.5, 0, 1, undefined, { step: 0.01 }), live('y', 'Vertical (0–1)', 0.5, 0, 1, undefined, { step: 0.01 })],
    interactive: 'press',
    keywords: 'joystick thumbstick analog xy ky-023 gamepad',
    create(props, nodes) {
      const [vcc, gnd, vrx, vry, sw] = [0, 1, 2, 3, 4].map((i) => nodes[i] as number) as [number, number, number, number, number];
      const px = new Potentiometer(10_000, num(props, 'x', 0.5));
      px.nodes = [gnd, vrx, vcc];
      const py = new Potentiometer(10_000, num(props, 'y', 0.5));
      py.nodes = [gnd, vry, vcc];
      let pressed = false;
      const button: Element = {
        nodes: [sw, gnd],
        stamp(s) {
          s.conductance(sw, gnd, pressed ? 100 : 1e-9);
        },
      };
      return {
        elements: [px, py, button],
        view: () => ({ x: px.position, y: py.position, pressed }),
        interact: (action) => {
          pressed = action === 'press';
        },
        live: (p) => {
          px.position = num(p, 'x', 0.5);
          py.position = num(p, 'y', 0.5);
        },
      };
    },
  },
  /* ------------------------------------------------------------- motors -- */
  {
    type: 'servo',
    name: 'Servo motor',
    group: 'Motors',
    terminals: left(SERVO_TERMINALS, 0),
    box: [0, -2, 7.5, 4],
    props: [],
    keywords: 'servo sg90 mg996r motor angle pwm',
    create(props, nodes, context) {
      const device = keep(context, () => new Servo(props));
      // An idle servo draws about 10 mA.
      const supply = supplyOf(nodes, 1, 0, 500);
      device.supply = supply;
      const sense = new Sense();
      sense.nodes = [nodes[2] as number, nodes[1] as number, nodes[0] as number];
      device.sense = sense;
      return moduleRuntime(device, [supply, sense]);
    },
  },
  {
    type: 'stepper',
    name: 'Stepper motor (28BYJ-48, ULN2003)',
    group: 'Motors',
    terminals: left(['IN1', 'IN2', 'IN3', 'IN4', '+', '−']),
    box: [0, 0, 9, 7],
    props: [],
    keywords: 'stepper 28byj-48 uln2003 motor steps',
    create(_props, nodes) {
      const s = new Stepper();
      s.nodes = [0, 1, 2, 3, 4, 5].map((i) => nodes[i] as number);
      return { elements: [s], view: () => ({ angle: s.shaft, coils: s.coils.map((c) => (c ? 1 : 0)), steps: s.steps }) };
    },
  },
  /* -------------------------------------------------------------- logic -- */
  {
    type: 'shift-register',
    name: 'Shift register (74HC595)',
    group: 'Logic',
    terminals: [
      ...SHIFT_TERMINALS.slice(0, 5).map((name, i) => ({ x: 0, y: 1 + i, name })),
      ...SHIFT_TERMINALS.slice(5, 14).map((name, i) => ({ x: 6, y: 1 + i, name })),
      { x: 3, y: -1, name: 'VCC' },
      { x: 3, y: 11, name: 'GND' },
    ],
    box: [0, -1, 6, 11],
    props: [],
    keywords: '74hc595 595 shift register serial parallel output spi',
    create(props, nodes, context) {
      const device = keep(context, () => new ShiftRegister(props));
      const vcc = nodes[14] as number;
      const gnd = nodes[15] as number;
      const supply = supplyOf(nodes, 14, 15, 50_000);
      device.supply = supply;
      // MR and OE are held at their working levels when left unconnected.
      const senses = [0, 1, 2, 3, 4].map((i) => {
        const s = new Sense(i === 3);
        s.nodes = [nodes[i] as number, vcc, gnd];
        return s;
      });
      device.senses = senses;
      const mrPull = new Variable(1e6);
      mrPull.nodes = [nodes[3] as number, vcc];
      const oePull = new Variable(1e6);
      oePull.nodes = [nodes[4] as number, gnd];
      const outputs = Array.from({ length: 9 }, (_, i) => {
        const o = new Output(() => device.output(i));
        o.nodes = [nodes[5 + i] as number, vcc, gnd];
        return o;
      });
      return moduleRuntime(device, [supply, mrPull, oePull, ...senses, ...outputs]);
    },
  },
  /* ------------------------------------------------------------- outputs -- */
  {
    type: 'rgb-led',
    name: 'RGB LED',
    group: 'Outputs',
    terminals: [
      { x: 0, y: -1, name: 'R' },
      { x: 0, y: 0, name: 'G' },
      { x: 0, y: 1, name: 'B' },
      { x: 4, y: 0, name: 'COM' },
    ],
    box: [0, -1.6, 4, 1.6],
    props: [{ key: 'anode', label: 'Common anode', kind: 'boolean', default: false }],
    keywords: 'rgb led colour color common cathode anode',
    create(props, nodes) {
      const anode = bool(props, 'anode', false);
      const leds = (['red', 'green', 'blue'] as const).map((colour, i) => {
        const d = new Diode(ledModel(colour));
        d.nodes = anode ? [nodes[3] as number, nodes[i] as number] : [nodes[i] as number, nodes[3] as number];
        return d;
      });
      return { elements: leds, view: () => ({ rgb: leds.map((d) => d.average) }) };
    },
  },
];

export { KEYPAD_KEYS };
