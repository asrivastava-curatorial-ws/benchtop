/**
 * Drawings of the circuit simulator's microcontroller boards and modules
 * (displays, sensors, controls, motors), in grid units with the part's
 * origin at (0, 0) before rotation.  Displays show the picture the
 * emulated controller holds.
 */
import type { ComponentChildren } from 'preact';
import { BOARD_SPECS } from '../../lib/circuit/boards';
import { KEYPAD_KEYS } from '../../lib/circuit/devices/actuators';
import type { PlacedPart } from '../../lib/circuit/netlist';
import { PART_BY_TYPE, partOutline } from '../../lib/circuit/parts';
import { flag, g, L, type Live, list, num, P, pins, ScreenImage, screenOf, T } from './_circuit-svg';

/* ---------------------------------------------------------------- boards -- */

interface BoardLook {
  readonly fill: string;
  readonly title: string;
  /** The title's centre, and the processor's outline and label. */
  readonly titleAt: readonly [number, number];
  readonly chip: readonly [number, number, number, number];
  readonly chipName: string;
  readonly led?: readonly [number, number];
  /** The title runs up the board (the Pico's is long and narrow). */
  readonly vertical?: boolean;
}

const LOOKS: Readonly<Record<string, BoardLook>> = {
  'arduino-uno': { fill: '#00878f', title: 'Arduino Uno', titleAt: [5, 12.6], chip: [3.2, 4.5, 3.2, 5.5], chipName: 'ATmega328P', led: [6.4, 13.8] },
  'arduino-nano': { fill: '#1d5fae', title: 'Arduino Nano', titleAt: [4, 14.1], chip: [2.5, 6.6, 3, 3], chipName: 'ATmega328P', led: [5.4, 12.6] },
  'arduino-mega': { fill: '#00878f', title: 'Arduino Mega 2560', titleAt: [18, 15.2], chip: [15, 6.5, 6, 6], chipName: 'ATmega2560', led: [26, 4] },
  attiny85: { fill: '#20242b', title: 'ATtiny85', titleAt: [3.5, 7.4], chip: [2.5, 2.2, 2.4, 3.2], chipName: 'ATtiny85', led: [5.2, 6.2] },
  'pi-pico': { fill: '#1e7a3c', title: 'Raspberry Pi Pico', titleAt: [6.2, 17], chip: [3, 12.6, 2.2, 2.2], chipName: 'RP2040', led: [3.75, 1.4], vertical: true },
  esp32: { fill: '#24292f', title: 'ESP32', titleAt: [5, 14.2], chip: [3.4, 5, 3.2, 4.2], chipName: 'ESP-WROOM-32' },
};

/** A board: its outline, its pins with labels on the inside, the processor and the LED on the board's LED pin. */
export function drawBoard(part: PlacedPart, live: Live): ComponentChildren {
  const def = PART_BY_TYPE.get(part.type);
  const spec = BOARD_SPECS.get(part.type);
  const look = LOOKS[part.type];
  if (!def || !spec || !look) return null;
  const [x0, y0, x1, y1] = def.box;
  const volts = list(live, 'volts');
  const ledOn = live?.led === true || (spec.led !== undefined && (volts[spec.led] ?? 0) > spec.logicHigh / 2);
  const top = (t: { y: number }) => t.y === y0;
  const bottom = (t: { y: number }) => t.y === y1;
  const right = (t: { x: number }) => t.x === x1;
  // The board itself sits one grid square inside the edges that carry pins.
  const hasTop = def.terminals.some(top);
  const hasBottom = def.terminals.some(bottom);
  const bx0 = x0 + 1;
  const bx1 = def.terminals.some(right) ? x1 - 1 : x1;
  const by0 = hasTop ? y0 + 1 : y0;
  const by1 = hasBottom ? y1 - 1 : y1;
  const [cx, cy, cw, ch] = look.chip;
  return (
    <>
      <rect
        x={g(bx0)}
        y={g(by0)}
        width={g(bx1 - bx0)}
        height={g(by1 - by0)}
        rx={8}
        fill={look.fill}
        class={part.type === 'esp32' ? 'cs-board-esp' : part.type === 'arduino-uno' ? 'cs-board-uno' : undefined}
      />
      {def.terminals.map((t) => {
        if (top(t) || bottom(t)) {
          const down = top(t);
          return (
            <g key={t.name}>
              <L x1={t.x} y1={t.y} x2={t.x} y2={down ? t.y + 1 : t.y - 1} />
              <rect x={g(t.x - 0.3)} y={g(down ? t.y + 1 : t.y - 1.4)} width={g(0.6)} height={g(0.4)} class="cs-header" />
              <text
                x={g(t.x)}
                y={g(down ? t.y + 1.6 : t.y - 1.6)}
                font-size={6.5}
                text-anchor={down ? 'end' : 'start'}
                transform={`rotate(-90 ${g(t.x)} ${g(down ? t.y + 1.6 : t.y - 1.6)})`}
                dominant-baseline="middle"
                class="cs-text cs-board-text"
              >
                {t.name}
              </text>
            </g>
          );
        }
        const onRight = right(t);
        return (
          <g key={t.name}>
            <L x1={t.x} y1={t.y} x2={onRight ? t.x - 1 : t.x + 1} y2={t.y} />
            <rect x={g(onRight ? t.x - 1.4 : t.x + 1)} y={g(t.y - 0.3)} width={g(0.4)} height={g(0.6)} class="cs-header" />
            <T x={onRight ? t.x - 1.6 : t.x + 1.6} y={t.y} size={8} anchor={onRight ? 'end' : 'start'} cls="cs-text cs-board-text">
              {t.name}
            </T>
          </g>
        );
      })}
      <rect x={g(cx)} y={g(cy)} width={g(cw)} height={g(ch)} rx={2} class="cs-chip" />
      <T x={cx + cw / 2} y={cy + ch / 2} size={part.type === 'arduino-mega' ? 9 : 6.5} cls="cs-text cs-board-text">
        {look.chipName}
      </T>
      {look.vertical ? (
        <text
          x={g(look.titleAt[0])}
          y={g(look.titleAt[1])}
          font-size={9}
          text-anchor="middle"
          dominant-baseline="middle"
          transform={`rotate(-90 ${g(look.titleAt[0])} ${g(look.titleAt[1])})`}
          class="cs-text cs-board-title"
        >
          {look.title}
        </text>
      ) : (
        <T x={look.titleAt[0]} y={look.titleAt[1]} size={part.type === 'attiny85' ? 9 : 12} cls="cs-text cs-board-title">
          {look.title}
        </T>
      )}
      {look.led && (
        <>
          <rect x={g(look.led[0])} y={g(look.led[1])} width={g(0.5)} height={g(0.3)} rx={1} fill={ledOn ? '#ffb000' : '#5b4b20'} />
          <T x={look.led[0] + 0.25} y={look.led[1] + 0.6} size={6} cls="cs-text cs-board-text">
            L
          </T>
        </>
      )}
    </>
  );
}

/* --------------------------------------------------------------- modules -- */

/** A module's circuit board, one grid square in from its left-hand pins, with the pins' labels printed on it. */
function board(part: PlacedPart, fill: string, x1: number, y1: number, x0 = 1, y0 = 0): ComponentChildren {
  const def = PART_BY_TYPE.get(part.type);
  return (
    <>
      <rect x={g(x0)} y={g(y0)} width={g(x1 - x0)} height={g(y1 - y0)} rx={5} fill={fill} stroke="currentColor" stroke-width={1.2} />
      {def?.terminals
        .filter((t) => t.x === 0)
        .map((t) => (
          <g key={t.name}>
            <L x1={0} y1={t.y} x2={x0} y2={t.y} />
            <T x={x0 + 0.2} y={t.y} size={6.5} anchor="start" cls="cs-text cs-board-text">
              {t.name}
            </T>
          </g>
        ))}
    </>
  );
}

/** Pins along the bottom edge, with labels printed above them. */
function bottomPins(part: PlacedPart, edge: number): ComponentChildren {
  const def = PART_BY_TYPE.get(part.type);
  return def?.terminals.map((t) => (
    <g key={t.name}>
      <L x1={t.x} y1={t.y} x2={t.x} y2={edge} />
      <T x={t.x} y={edge - 0.45} size={6} cls="cs-text cs-board-text">
        {t.name}
      </T>
    </g>
  ));
}

/** An LED's colour for a 0–255 channel value, brightened as the eye sees it. */
const channel = (v: number) => Math.round(255 * (Math.max(0, Math.min(255, v)) / 255) ** 0.45);
const pixelFill = (rgb: number) => (rgb ? `rgb(${channel((rgb >> 16) & 255)}, ${channel((rgb >> 8) & 255)}, ${channel(rgb & 255)})` : '#2a2d33');

const MATRIX_COLOURS: Readonly<Record<string, readonly [string, string]>> = {
  red: ['#ff3b30', '#3a1414'],
  green: ['#34e36b', '#123a1c'],
  blue: ['#4aa3ff', '#14243a'],
  white: ['#f5f7ff', '#2c2f36'],
};

/** Seven segments (A to G as bits 6 to 0) and a decimal point (bit 7) of a small digit. */
function digit(x: number, y: number, bits: number, on: string, off: string): ComponentChildren {
  const w = 0.7;
  const h = 1.4;
  const segs: [number, number, number, number][] = [
    [x, y, x + w, y],
    [x + w, y, x + w, y + h / 2],
    [x + w, y + h / 2, x + w, y + h],
    [x, y + h, x + w, y + h],
    [x, y + h / 2, x, y + h],
    [x, y, x, y + h / 2],
    [x, y + h / 2, x + w, y + h / 2],
  ];
  return (
    <>
      {segs.map(([ax, ay, bx, by], i) => (
        <line key={`${ax},${ay},${bx},${by}`} x1={g(ax)} y1={g(ay)} x2={g(bx)} y2={g(by)} stroke={(bits >> (6 - i)) & 1 ? on : off} stroke-width={3} stroke-linecap="round" />
      ))}
      <circle cx={g(x + w + 0.2)} cy={g(y + h)} r={1.8} fill={bits & 0x80 ? on : off} />
    </>
  );
}

export function drawModule(part: PlacedPart, live: Live): ComponentChildren | null {
  const p = part.props;
  const def = PART_BY_TYPE.get(part.type);
  const [, , bw, bh] = def ? partOutline(def, p) : [0, 0, 0, 0];
  switch (part.type) {
    case 'oled': {
      const short = p.height === '32';
      return (
        <>
          {[2, 3, 4, 5].map((x) => (
            <L key={x} x1={x} y1={0} x2={x} y2={0.7} />
          ))}
          <rect x={0} y={g(0.6)} width={g(8)} height={g(5.8)} rx={6} fill="#1d3f75" stroke="currentColor" stroke-width={1.2} />
          {['GND', 'VCC', 'SCL', 'SDA'].map((name, i) => (
            <T key={name} x={2 + i} y={1.15} size={5.5} cls="cs-text cs-board-text">
              {name}
            </T>
          ))}
          <ScreenImage screen={live ? screenOf(live) : null} x={0.5} y={short ? 2.6 : 1.7} w={7} h={short ? 1.75 : 3.5} scale={3} />
          {!live && (
            <T x={4} y={short ? 3.5 : 3.45} size={8} cls="cs-text cs-display-text">
              128 × {short ? 32 : 64} OLED
            </T>
          )}
        </>
      );
    }
    case 'lcd-i2c':
    case 'lcd': {
      const big = p.size === '20x4';
      const parallel = part.type === 'lcd';
      const [w, h] = big ? [123, 39] : [99, 21];
      const x0 = parallel ? 0.2 : 2.4;
      const x1 = parallel ? 16.8 : bw - 0.4;
      const top = parallel ? 0.6 : 0.6;
      const bottom = parallel ? 5.8 : bh - 0.6;
      const scale = Math.min((x1 - x0 - 0.8) / w, (bottom - top - 0.8) / h);
      const sw = w * scale;
      const sh = h * scale;
      const sx = (x0 + x1 - sw) / 2;
      const sy = (top + bottom - sh) / 2;
      return (
        <>
          {parallel ? (
            <>
              <rect x={0} y={0} width={g(17)} height={g(6.4)} rx={5} fill="#1f6b37" stroke="currentColor" stroke-width={1.2} />
              {bottomPins(part, 6.4)}
            </>
          ) : (
            board(part, '#1f6b37', bw, bh)
          )}
          <rect x={g(x0 + 0.1)} y={g(top)} width={g(x1 - x0 - 0.2)} height={g(bottom - top)} rx={3} fill="#111" />
          <ScreenImage screen={live ? screenOf(live) : null} x={sx} y={sy} w={sw} h={sh} scale={4} />
          {!live && (
            <T x={(x0 + x1) / 2} y={(top + bottom) / 2} size={9} cls="cs-text cs-display-text">
              {big ? '20 × 4' : '16 × 2'} LCD{parallel ? '' : ' · I²C'}
            </T>
          )}
        </>
      );
    }
    case 'tft': {
      const screen = live ? screenOf(live) : null;
      const on = live ? flag(live, 'on') : false;
      return (
        <>
          {board(part, '#a8231f', 14, 17)}
          <rect x={g(2.3)} y={g(0.8)} width={g(11.5)} height={g(15.4)} rx={2} fill="#0b0b0b" />
          {screen && on ? (
            <g style={live && flag(live, 'inverted') ? { filter: 'invert(1)' } : undefined}>
              <ScreenImage screen={screen} x={2.4} y={0.9} w={11.3} h={15.2} />
            </g>
          ) : (
            <T x={8.05} y={8.5} size={9} cls="cs-text cs-display-text">
              240 × 320 TFT
            </T>
          )}
        </>
      );
    }
    case 'led-matrix': {
      const [on, off] = MATRIX_COLOURS[String(p.colour)] ?? (MATRIX_COLOURS.red as readonly [string, string]);
      const leds = list(live, 'leds');
      const level = 0.45 + 0.55 * num(live, 'intensity');
      if (p.display === 'digits')
        return (
          <>
            {board(part, '#1c3f8f', bw, bh)}
            <rect x={g(2.4)} y={g(1.2)} width={g(bw - 3)} height={g(3.6)} rx={3} fill="#111" />
            {Array.from({ length: 8 }, (_, d) => (
              <g key={d} opacity={leds[d] ? level : 1}>
                {digit(2.9 + (7 - d) * 1.1, 2.2, leds[d] ?? 0, on, off)}
              </g>
            ))}
          </>
        );
      const n = Math.max(1, Math.round(Number(p.modules ?? 1)));
      return (
        <>
          {board(part, '#1c3f8f', bw, bh)}
          {Array.from({ length: n }, (_, k) => (
            <g key={k}>
              <rect x={g(2.5 + 6 * k)} y={g(0.4)} width={g(5.4)} height={g(5.4)} rx={2} fill="#141414" />
              {Array.from({ length: 64 }, (_, i) => {
                const r = Math.floor(i / 8);
                const c = i % 8;
                const lit = ((leds[k * 8 + r] ?? 0) >> (7 - c)) & 1;
                return <circle key={i} cx={g(2.95 + 6 * k + 0.645 * c)} cy={g(0.85 + 0.645 * r)} r={g(0.25)} fill={lit ? on : off} opacity={lit ? level : 1} />;
              })}
            </g>
          ))}
        </>
      );
    }
    case 'neopixel-ring':
    case 'neopixel-strip':
    case 'neopixel-matrix': {
      const colours = list(live, 'colours');
      const n = part.type === 'neopixel-matrix' ? 64 : Math.max(1, Math.round(Number(p.count ?? 8)));
      const at = (i: number): [number, number] => {
        if (part.type === 'neopixel-matrix') return [1.9 + (i % 8) * 1.15, 0.9 + Math.floor(i / 8) * 1.15];
        if (part.type === 'neopixel-strip') return [2 + i, 2.5];
        const d = bw - 3;
        const angle = -Math.PI / 2 + (i * 2 * Math.PI) / n;
        return [3 + d / 2 + (d / 2 - 0.55) * Math.cos(angle), bh / 2 + (d / 2 - 0.55) * Math.sin(angle)];
      };
      const d = bw - 3;
      return (
        <>
          {part.type === 'neopixel-ring' ? (
            <>
              {board(part, '#15171b', 3.2, 4.6, 1, 0.4)}
              <circle cx={g(3 + d / 2)} cy={g(bh / 2)} r={g(d / 2)} fill="#15171b" stroke="currentColor" stroke-width={1.2} />
              <circle cx={g(3 + d / 2)} cy={g(bh / 2)} r={g(Math.max(0.5, d / 2 - 1.1))} class="cs-fill" stroke="currentColor" stroke-width={1} />
            </>
          ) : (
            board(part, '#15171b', bw, bh)
          )}
          {Array.from({ length: n }, (_, i) => {
            const [x, y] = at(i);
            const c = colours[i] ?? 0;
            return (
              <g key={i}>
                {c ? <circle cx={g(x)} cy={g(y)} r={g(0.5)} fill={pixelFill(c)} opacity={0.35} class="cs-glow" /> : null}
                <rect x={g(x - 0.3)} y={g(y - 0.3)} width={g(0.6)} height={g(0.6)} rx={2} fill={pixelFill(c)} stroke="#555" stroke-width={0.6} />
              </g>
            );
          })}
        </>
      );
    }
    case 'dht22': {
      const dht11 = p.model === 'dht11';
      return (
        <>
          {board(part, dht11 ? '#1565c0' : '#e8ecef', 4.6, 4.4)}
          {[0, 1, 2, 3, 4].map((i) => (
            <rect key={i} x={g(2.4)} y={g(0.5 + i * 0.6)} width={g(1.8)} height={g(0.3)} rx={1.5} fill={dht11 ? '#0d3c78' : '#9aa3ab'} />
          ))}
          <T x={3.3} y={3.9} size={6.5} cls="cs-text cs-strong">
            {dht11 ? 'DHT11' : 'DHT22'}
          </T>
        </>
      );
    }
    case 'bme280':
      return (
        <>
          {board(part, '#5b2a86', 5, 5)}
          <rect x={g(3)} y={g(1.7)} width={g(1.2)} height={g(1.2)} rx={1.5} fill="#c9ccd1" />
          <T x={3.6} y={4.2} size={6.5} cls="cs-text cs-board-text">
            BME280
          </T>
        </>
      );
    case 'mpu6050':
      return (
        <>
          {board(part, '#1c4fa1', 6, 5)}
          <rect x={g(3.4)} y={g(1.3)} width={g(1.4)} height={g(1.4)} rx={1.5} fill="#16181b" />
          <P d={`M${g(3)} ${g(3.6)} h${g(1.6)} M${g(4.6)} ${g(3.6)} l${g(-0.3)} ${g(-0.2)} M${g(4.6)} ${g(3.6)} l${g(-0.3)} ${g(0.2)}`} w={1} />
          <P d={`M${g(3)} ${g(3.6)} v${g(-1.4)} M${g(3)} ${g(2.2)} l${g(-0.2)} ${g(0.3)} M${g(3)} ${g(2.2)} l${g(0.2)} ${g(0.3)}`} w={1} />
          <T x={4.7} y={3.3} size={5} cls="cs-text cs-board-text">
            X
          </T>
          <T x={3.3} y={2.1} size={5} cls="cs-text cs-board-text">
            Y
          </T>
          <T x={4} y={4.5} size={6.5} cls="cs-text cs-board-text">
            MPU6050
          </T>
        </>
      );
    case 'rtc':
      return (
        <>
          {board(part, '#1c4fa1', 6, 5)}
          <circle cx={g(4.3)} cy={g(2.1)} r={g(1.2)} fill="#c9ccd1" stroke="#7d848c" />
          <T x={4.3} y={2.1} size={5.5} cls="cs-text">
            CR2032
          </T>
          <T x={3.9} y={4.2} size={6} cls="cs-text cs-board-text">
            {live && typeof live.time === 'string' ? live.time.slice(11) : p.chip === 'ds3231' ? 'DS3231' : 'DS1307'}
          </T>
        </>
      );
    case 'ultrasonic':
      return (
        <>
          <rect x={0} y={0} width={g(8)} height={g(3.4)} rx={5} fill="#1c4fa1" stroke="currentColor" stroke-width={1.2} />
          {[1.9, 6.1].map((x) => (
            <g key={x}>
              <circle cx={g(x)} cy={g(1.4)} r={g(1.15)} fill="#c9ccd1" stroke="#7d848c" />
              <circle cx={g(x)} cy={g(1.4)} r={g(0.8)} fill="#3c4148" />
            </g>
          ))}
          <T x={4} y={0.5} size={5.5} cls="cs-text cs-board-text">
            HC-SR04
          </T>
          {bottomPins(part, 3.4)}
        </>
      );
    case 'pir': {
      const high = flag(live, 'high');
      const motion = live ? flag(live, 'motion') : p.motion === true;
      return (
        <>
          {board(part, '#1f6b37', 4.6, 4.4)}
          <circle cx={g(3)} cy={g(2.2)} r={g(1.4)} fill={high ? '#ffd166' : '#f3f4f6'} stroke="#9aa3ab" />
          <circle cx={g(3)} cy={g(2.2)} r={g(0.8)} fill="none" stroke="#c0c6cc" />
          {motion && <P d={`M${g(4.6)} ${g(1.2)} q${g(0.4)} ${g(1)} 0 ${g(2)}`} w={1.2} />}
        </>
      );
    }
    case 'ldr':
      return (
        <>
          <L x1={0} y1={0} x2={0.8} y2={0} />
          <rect x={g(0.8)} y={g(-0.35)} width={g(1.4)} height={g(0.7)} rx={2} class="cs-fill" stroke="currentColor" stroke-width={1.6} />
          <L x1={2.2} y1={0} x2={3} y2={0} />
          <P d={`M${g(0.6)} ${g(-1.05)} l${g(0.45)} ${g(0.5)} M${g(1.05)} ${g(-0.55)} l${g(-0.25)} ${g(-0.02)} M${g(1.05)} ${g(-0.55)} l${g(-0.02)} ${g(-0.25)}`} w={1.1} />
          <P d={`M${g(1.2)} ${g(-1.05)} l${g(0.45)} ${g(0.5)} M${g(1.65)} ${g(-0.55)} l${g(-0.25)} ${g(-0.02)} M${g(1.65)} ${g(-0.55)} l${g(-0.02)} ${g(-0.25)}`} w={1.1} />
        </>
      );
    case 'ntc':
      return (
        <>
          <L x1={0} y1={0} x2={0.8} y2={0} />
          <rect x={g(0.8)} y={g(-0.35)} width={g(1.4)} height={g(0.7)} rx={2} class="cs-fill" stroke="currentColor" stroke-width={1.6} />
          <L x1={2.2} y1={0} x2={3} y2={0} />
          <P d={`M${g(0.6)} ${g(0.6)} L${g(2.2)} ${g(-0.6)} h${g(0.4)}`} w={1.2} />
          <T x={1.5} y={-0.85} size={7} cls="cs-text cs-muted">
            −t°
          </T>
        </>
      );
    case 'keypad': {
      const pressed = new Set(list(live, 'pressed'));
      return (
        <>
          <rect x={0} y={0} width={g(9)} height={g(10.4)} rx={5} fill="#22262d" stroke="currentColor" stroke-width={1.2} />
          {KEYPAD_KEYS.map((key, i) => {
            const c = i % 4;
            const r = Math.floor(i / 4);
            const down = pressed.has(i);
            return (
              <g key={key}>
                <rect x={g(0.6 + 2 * c)} y={g(0.6 + 2.4 * r)} width={g(1.8)} height={g(2.1)} rx={4} fill={down ? '#58a6ff' : c === 3 ? '#c0392b' : '#3b414b'} />
                <T x={1.5 + 2 * c} y={1.65 + 2.4 * r} size={10} cls="cs-text cs-board-title">
                  {key}
                </T>
              </g>
            );
          })}
          {bottomPins(part, 10.4)}
        </>
      );
    }
    case 'encoder': {
      const position = num(live, 'position');
      const angle = ((position * 18 - 90) * Math.PI) / 180;
      const down = flag(live, 'pressed');
      return (
        <>
          {board(part, '#1a1d22', 7, 6)}
          <T x={2.4} y={3} size={12} cls="cs-text cs-board-text">
            ⟲
          </T>
          <T x={6.3} y={3} size={12} cls="cs-text cs-board-text">
            ⟳
          </T>
          <circle cx={g(4.3)} cy={g(3)} r={g(1.3)} fill={down ? '#58a6ff' : '#6b7079'} stroke="#2b2f36" stroke-width={2} />
          <line x1={g(4.3)} y1={g(3)} x2={g(4.3) + g(1.1) * Math.cos(angle)} y2={g(3) + g(1.1) * Math.sin(angle)} stroke="#f0f0f0" stroke-width={2} stroke-linecap="round" />
        </>
      );
    }
    case 'joystick': {
      const x = live ? num(live, 'x') : Number(p.x ?? 0.5);
      const y = live ? num(live, 'y') : Number(p.y ?? 0.5);
      const down = flag(live, 'pressed');
      return (
        <>
          {board(part, '#1a1d22', 7, 6)}
          <circle cx={g(4.4)} cy={g(3)} r={g(2.2)} fill="#2b2f36" stroke="#4b515a" />
          <circle cx={g(4.4 + (x - 0.5) * 2.4)} cy={g(3 + (0.5 - y) * 2.4)} r={g(1)} fill={down ? '#58a6ff' : '#5a606a'} stroke="#888" />
        </>
      );
    }
    case 'servo': {
      const angle = live ? num(live, 'angle') : 90;
      const wires = ['#6d4c41', '#d32f2f', '#f39c12'];
      return (
        <>
          {[0, 1, 2].map((i) => (
            <line key={i} x1={0} y1={g(i)} x2={g(1.2)} y2={g(i)} stroke={wires[i]} stroke-width={2.4} stroke-linecap="round" />
          ))}
          <rect x={g(1.2)} y={g(-1)} width={g(4.6)} height={g(4)} rx={4} fill="#1f5fae" stroke="currentColor" stroke-width={1.2} />
          <T x={2.9} y={2.4} size={6.5} cls="cs-text cs-board-text">
            SG90
          </T>
          <g transform={`rotate(${-angle} ${g(4.4)} ${g(1)})`}>
            <rect x={g(4.4) - 4} y={g(1) - 4} width={g(2.6) + 4} height={8} rx={4} fill="#f5f5f5" stroke="#888" />
            <circle cx={g(6.6)} cy={g(1)} r={2} fill="#bbb" />
          </g>
          <circle cx={g(4.4)} cy={g(1)} r={5} fill="#ddd" stroke="#888" />
          {live && (
            <T x={3.4} y={-1.6} size={8} cls="cs-text cs-muted">
              {Math.round(angle)}°
            </T>
          )}
        </>
      );
    }
    case 'stepper': {
      const coils = list(live, 'coils');
      const angle = ((num(live, 'angle') - 90) * Math.PI) / 180;
      return (
        <>
          {board(part, '#1f6b37', 4.6, 7)}
          {['A', 'B', 'C', 'D'].map((name, i) => (
            <g key={name}>
              <circle cx={g(3.7)} cy={g(1 + i)} r={4} fill={coils[i] ? '#ff3b30' : '#4a1d1a'} />
              <T x={4.2} y={1 + i} size={5.5} anchor="start" cls="cs-text cs-board-text">
                {name}
              </T>
            </g>
          ))}
          <T x={2.8} y={6.4} size={5.5} cls="cs-text cs-board-text">
            ULN2003
          </T>
          <circle cx={g(6.9)} cy={g(3.5)} r={g(2)} fill="#c9ccd1" stroke="currentColor" stroke-width={1.2} />
          <circle cx={g(6.9)} cy={g(3.5)} r={g(0.5)} fill="#f2c94c" stroke="#8a6d1d" />
          <line x1={g(6.9)} y1={g(3.5)} x2={g(6.9) + g(1.5) * Math.cos(angle)} y2={g(3.5) + g(1.5) * Math.sin(angle)} stroke="#1f2328" stroke-width={2.5} stroke-linecap="round" />
          <T x={6.9} y={6.1} size={5.5} cls="cs-text cs-muted">
            28BYJ-48
          </T>
        </>
      );
    }
    case 'shift-register': {
      const outputs = list(live, 'outputs');
      return (
        <>
          <rect x={g(1)} y={0} width={g(4)} height={g(10)} rx={3} stroke="currentColor" stroke-width={1.6} class="cs-fill" />
          {pins(part, 1, 6)}
          <text x={g(3)} y={g(6.6)} font-size={9} text-anchor="middle" dominant-baseline="middle" transform={`rotate(-90 ${g(3)} ${g(6.6)})`} class="cs-text cs-muted">
            74HC595
          </text>
          {live && Array.from({ length: 8 }, (_, i) => <circle key={i} cx={g(4.65)} cy={g(1 + i)} r={2.6} class={outputs[i] ? 'cs-led-on' : 'cs-led-off'} />)}
        </>
      );
    }
    case 'rgb-led': {
      const rgb = list(live, 'rgb');
      const c = (i: number) => Math.round(255 * Math.min(1, Math.max(0, (rgb[i] ?? 0) / 0.012)) ** 0.6);
      const lit = live && rgb.some((v) => v > 0.0005);
      const fill = lit ? `rgb(${c(0)}, ${c(1)}, ${c(2)})` : undefined;
      return (
        <>
          <P d={`M0 ${g(-1)} H${g(1.2)} L${g(1.5)} ${g(-0.5)}`} />
          <L x1={0} y1={0} x2={1.3} y2={0} />
          <P d={`M0 ${g(1)} H${g(1.2)} L${g(1.5)} ${g(0.5)}`} />
          <L x1={2.7} y1={0} x2={4} y2={0} />
          {lit && <circle cx={g(2)} cy={0} r={g(1.4)} fill={fill} opacity={0.35} class="cs-glow" />}
          <circle cx={g(2)} cy={0} r={g(0.85)} fill={fill ?? 'var(--panel)'} stroke="currentColor" stroke-width={1.6} class={fill ? undefined : 'cs-fill'} />
          {(['R', 'G', 'B'] as const).map((name, i) => (
            <T key={name} x={0.5} y={i - 1.35} size={6.5} cls="cs-text cs-muted">
              {name}
            </T>
          ))}
          <T x={3.4} y={-0.4} size={6} cls="cs-text cs-muted">
            {p.anode === true ? '+' : '−'}
          </T>
        </>
      );
    }
    default:
      return null;
  }
}
