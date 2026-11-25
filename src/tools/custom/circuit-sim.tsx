/**
 * Circuit Simulator: draw a circuit on a grid and run it.  Resistors,
 * capacitors, transistors, op-amps and the 555 are solved as analog parts;
 * gates, flip-flops, counters and displays as logic; meters and an
 * oscilloscope show what happens; Arduino Uno, Nano and Mega and ATtiny85
 * boards (emulated here) and ESP32 boards (in the desktop app's emulator)
 * run real firmware against it, with displays, sensors and motors wired to
 * their pins and their I²C and SPI buses.  The analysis panel works out
 * DC operating points, DC sweeps, time-domain runs and frequency response
 * (Bode plots), with stepped part values, cursors and measurements.
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { sendToTool } from '../../app/handoff';
import { formatValue, mainTerminal, type OperatingPoint, partNames } from '../../lib/circuit/analysis';
import { AvrMcu, isAvrChip } from '../../lib/circuit/avr';
import { BOARD_SPECS, type BoardKind, isBoard } from '../../lib/circuit/boards';
import { ESP_IMAGE_ADVICE, EspMcu, espImageKind } from '../../lib/circuit/esp32';
import { ESP32_DEMO } from '../../lib/circuit/esp32-demo';
import { EXAMPLE_GROUPS, EXAMPLES, type Example, MICROPYTHON_BLINK } from '../../lib/circuit/examples';
import { type CircuitDoc, type Connectivity, connect, type FirmwareRef, onSegment, type PlacedPart, parseDoc, rotate, terminalPoints, toSpice, type WireSegment } from '../../lib/circuit/netlist';
import { defaultProps, GROUPS, PART_BY_TYPE, PARTS, type PartDef, type PropDef, type PropValue, partOutline } from '../../lib/circuit/parts';
import { PicoMcu, picoFlashImage } from '../../lib/circuit/rp2040';
import { examplesFor, firmwareFor, firmwareName, picoImages, Session } from '../../lib/circuit/session';
import { writeVcd } from '../../lib/logic';
import { formatSi, minus, parseSi } from '../../lib/si';
import { niceScale } from '../../lib/svg-chart';
import { isDesktop, pickFile, readBinaryFile, readTextFile, saveFile } from '../../platform';
import {
  type ArduinoInfo,
  arduinoBoards,
  arduinoCompile,
  arduinoInfo,
  arduinoUpload,
  type DetectedBoard,
  type Esp32Info,
  esp32Firmware,
  esp32Info,
  esp32Send,
  esp32Start,
  esp32Stop,
  onEsp32Lines,
} from '../../platform/esp32';
import { CodeEditor } from '../../ui/CodeEditor';
import { Icon } from '../../ui/icons';
import { attempt, notify } from '../../ui/toast';
import { defineCustomTool, type Values } from '../types';
import { AnalysisPanel } from './_circuit-analysis';
import { drawPart, GRID, TRACE_COLOURS } from './_circuit-draw';
import { Segmented, usePersistentState } from './_shared';

type Point = readonly [number, number];

/* ------------------------------------------------------------------- state -- */

interface SimState {
  readonly doc: CircuitDoc;
  readonly scope: number;
  readonly panel: 'scope' | 'serial' | 'analysis';
}

const firstExample = EXAMPLES[0] as Example;

const readSim = (v: Values | undefined): SimState => {
  const parsed = v?.doc ? parseDoc(v.doc) : null;
  return {
    doc: parsed?.doc ?? firstExample.make(),
    scope: typeof v?.scope === 'number' && v.scope > 0 ? v.scope : 0.02,
    panel: v?.panel === 'serial' || v?.panel === 'analysis' ? v.panel : 'scope',
  };
};

const writeSim = (s: SimState): Values => ({ doc: s.doc, scope: s.scope, panel: s.panel });

const SPEEDS: readonly (readonly [number, string])[] = [
  [0.001, '1/1000 speed'],
  [0.01, '1/100 speed'],
  [0.02, '1/50 speed'],
  [0.1, '1/10 speed'],
  [0.5, 'Half speed'],
  [1, 'Real time'],
  [10, '10× faster'],
  [100, '100× faster'],
];

const WINDOWS: readonly (readonly [number, string])[] = [
  [0.001, '1 ms'],
  [0.004, '4 ms'],
  [0.01, '10 ms'],
  [0.02, '20 ms'],
  [0.1, '100 ms'],
  [0.5, '0.5 s'],
  [2, '2 s'],
  [10, '10 s'],
];

/* ---------------------------------------------------------------- geometry -- */

/** A part's outline in grid units after turning and flipping: [x0, y0, x1, y1]. */
function partBox(part: PlacedPart, def = PART_BY_TYPE.get(part.type)): [number, number, number, number] {
  const [bx0, by0, bx1, by1] = def ? partOutline(def, part.props) : [0, -1, 3, 1];
  const corners = [rotate(bx0, by0, part.rot, part.flip), rotate(bx1, by0, part.rot, part.flip), rotate(bx0, by1, part.rot, part.flip), rotate(bx1, by1, part.rot, part.flip)];
  const xs = corners.map((c) => c[0] + part.x);
  const ys = corners.map((c) => c[1] + part.y);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

function distanceToSegment(w: WireSegment, x: number, y: number): number {
  const dx = w.x2 - w.x1;
  const dy = w.y2 - w.y1;
  const length = dx * dx + dy * dy;
  const t = length ? Math.max(0, Math.min(1, ((x - w.x1) * dx + (y - w.y1) * dy) / length)) : 0;
  return Math.hypot(x - (w.x1 + t * dx), y - (w.y1 + t * dy));
}

function hitTerminal(doc: CircuitDoc, x: number, y: number): Point | null {
  let best: Point | null = null;
  let distance = 0.45;
  for (const part of doc.parts) {
    for (const p of terminalPoints(part)) {
      const d = Math.hypot(p[0] - x, p[1] - y);
      if (d < distance) {
        distance = d;
        best = p;
      }
    }
  }
  return best;
}

/** A point on the drawing in a part's own grid units (before it was turned and mirrored). */
function localPoint(part: PlacedPart, [wx, wy]: Point): [number, number] {
  let x = wx - part.x;
  let y = wy - part.y;
  for (let i = 0; i < ((part.rot % 4) + 4) % 4; i++) [x, y] = [y, -x];
  return [part.flip ? -x : x, y];
}

function hitPart(doc: CircuitDoc, x: number, y: number): PlacedPart | null {
  for (let i = doc.parts.length - 1; i >= 0; i--) {
    const part = doc.parts[i] as PlacedPart;
    const [x0, y0, x1, y1] = partBox(part);
    if (x >= x0 - 0.25 && x <= x1 + 0.25 && y >= y0 - 0.25 && y <= y1 + 0.25) return part;
  }
  return null;
}

function hitWire(doc: CircuitDoc, x: number, y: number): WireSegment | null {
  let best: WireSegment | null = null;
  let distance = 0.35;
  for (const w of doc.wires) {
    const d = distanceToSegment(w, x, y);
    if (d < distance) {
      distance = d;
      best = w;
    }
  }
  return best;
}

/** Whether a wire may end here: a terminal, another wire's end or a point on a wire. */
function joinsSomething(doc: CircuitDoc, [x, y]: Point): boolean {
  if (doc.parts.some((part) => terminalPoints(part).some((p) => p[0] === x && p[1] === y))) return true;
  return doc.wires.some((w) => onSegment(w, x, y));
}

function bounds(doc: CircuitDoc): [number, number, number, number] | null {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const part of doc.parts) {
    const [a, b, c, d] = partBox(part);
    x0 = Math.min(x0, a);
    y0 = Math.min(y0, b);
    x1 = Math.max(x1, c);
    y1 = Math.max(y1, d);
  }
  for (const w of doc.wires) {
    x0 = Math.min(x0, w.x1, w.x2);
    y0 = Math.min(y0, w.y1, w.y2);
    x1 = Math.max(x1, w.x1, w.x2);
    y1 = Math.max(y1, w.y1, w.y2);
  }
  return Number.isFinite(x0) ? [x0, y0, x1, y1] : null;
}

/** Wires for a run from `a` to `b`, bending once. */
function route(a: Point, b: Point, horizontalFirst: boolean, ids: () => string): WireSegment[] {
  if (a[0] === b[0] && a[1] === b[1]) return [];
  if (a[0] === b[0] || a[1] === b[1]) return [{ id: ids(), x1: a[0], y1: a[1], x2: b[0], y2: b[1] }];
  const corner: Point = horizontalFirst ? [b[0], a[1]] : [a[0], b[1]];
  return [
    { id: ids(), x1: a[0], y1: a[1], x2: corner[0], y2: corner[1] },
    { id: ids(), x1: corner[0], y1: corner[1], x2: b[0], y2: b[1] },
  ];
}

function idMaker(doc: CircuitDoc, prefix: string): () => string {
  const taken = new Set([...doc.parts.map((p) => p.id), ...doc.wires.map((w) => w.id)]);
  let n = 1;
  return () => {
    while (taken.has(`${prefix}${n}`)) n++;
    const id = `${prefix}${n}`;
    taken.add(id);
    return id;
  };
}

/** Moves parts and wires in `ids` by (dx, dy); wire ends attached to them follow. */
function moveItems(doc: CircuitDoc, ids: ReadonlySet<string>, dx: number, dy: number): CircuitDoc {
  if (!dx && !dy) return doc;
  const anchors = new Set<string>();
  for (const part of doc.parts) if (ids.has(part.id)) for (const [x, y] of terminalPoints(part)) anchors.add(`${x},${y}`);
  for (const w of doc.wires) {
    if (!ids.has(w.id)) continue;
    anchors.add(`${w.x1},${w.y1}`);
    anchors.add(`${w.x2},${w.y2}`);
  }
  return {
    ...doc,
    parts: doc.parts.map((p) => (ids.has(p.id) ? { ...p, x: p.x + dx, y: p.y + dy } : p)),
    wires: doc.wires.map((w) => {
      if (ids.has(w.id)) return { ...w, x1: w.x1 + dx, y1: w.y1 + dy, x2: w.x2 + dx, y2: w.y2 + dy };
      const a = anchors.has(`${w.x1},${w.y1}`);
      const b = anchors.has(`${w.x2},${w.y2}`);
      if (!a && !b) return w;
      return { ...w, ...(a ? { x1: w.x1 + dx, y1: w.y1 + dy } : {}), ...(b ? { x2: w.x2 + dx, y2: w.y2 + dy } : {}) };
    }),
  };
}

/* ------------------------------------------------------------------ labels -- */

const num = (part: PlacedPart, key: string) => (typeof part.props[key] === 'number' ? (part.props[key] as number) : 0);

function valueLabel(part: PlacedPart): string {
  switch (part.type) {
    case 'resistor':
      return formatSi(num(part, 'r'), 'Ω');
    case 'capacitor':
      return formatSi(num(part, 'c'), 'F');
    case 'inductor':
      return formatSi(num(part, 'l'), 'H');
    case 'potentiometer':
      return formatSi(num(part, 'r'), 'Ω');
    case 'battery':
    case 'rail':
      return formatSi(num(part, 'v'), 'V');
    case 'ac-source':
      return `${formatSi(num(part, 'amplitude'), 'V')} ${formatSi(num(part, 'f'), 'Hz')}`;
    case 'current-source':
      return formatSi(num(part, 'i'), 'A');
    case 'zener':
      return formatSi(num(part, 'vz'), 'V');
    case 'clock':
      return formatSi(num(part, 'f'), 'Hz');
    case 'lamp':
      return `${formatSi(num(part, 'v'), 'V')} ${formatSi(num(part, 'w'), 'W')}`;
    case 'motor':
    case 'buzzer':
      return formatSi(num(part, 'r'), 'Ω');
    default:
      return '';
  }
}

function liveLabel(part: PlacedPart, live: Readonly<Record<string, unknown>> | null): string {
  if (!live) return '';
  const reading = typeof live.reading === 'number' ? live.reading : null;
  if (part.type === 'voltmeter' && reading !== null) return minus(formatSi(reading, 'V'));
  if (part.type === 'ammeter' && reading !== null) return minus(formatSi(reading, 'A'));
  return '';
}

/** Where a part's value goes: beside a tall part (on the side without terminals), above a wide one. */
function labelPlace(part: PlacedPart, [x0, y0, x1, y1]: readonly [number, number, number, number]): { x: number; y: number; anchor: 'start' | 'middle' | 'end' } {
  if (part.type === 'rail') {
    // Beside the bar, clear of the wire the rail feeds.
    const [bx, by] = rotate(0, -0.8, part.rot, part.flip);
    return { x: part.x + bx + 0.8, y: part.y + by, anchor: 'start' };
  }
  if (part.type === 'probe') {
    // Beside the flag, clear of its trace number.
    const [bx, by] = rotate(1.9, -1.1, part.rot, part.flip);
    return { x: part.x + bx, y: part.y + by, anchor: 'start' };
  }
  const top = { x: (x0 + x1) / 2, y: y0 - 0.45, anchor: 'middle' as const };
  if (y1 - y0 <= x1 - x0) return top;
  const cx = (x0 + x1) / 2;
  const points = terminalPoints(part);
  const right = points.some(([x]) => x > cx + 0.5);
  const left = points.some(([x]) => x < cx - 0.5);
  if (!right) return { x: x1 + 0.4, y: (y0 + y1) / 2, anchor: 'start' };
  if (!left) return { x: x0 - 0.4, y: (y0 + y1) / 2, anchor: 'end' };
  return top;
}

/* -------------------------------------------------- operating point labels -- */

interface OpLabel {
  readonly key: string;
  readonly kind: 'node' | 'part';
  readonly x: number;
  readonly y: number;
  readonly anchor: 'start' | 'middle' | 'end';
  readonly text: string;
}

/** Labels for an operating point: each node's voltage on a wire clear of the parts, each part's current beside its value (an arrow shows the way it flows). */
function operatingLabels(doc: CircuitDoc, op: OperatingPoint, connectivity: Connectivity): OpLabel[] {
  const out: OpLabel[] = [];
  const boxes = doc.parts.map((p) => partBox(p));
  /** How far a point is from the nearest part outline (0 inside one). */
  const clearance = (x: number, y: number) => {
    let best = 4;
    for (const [x0, y0, x1, y1] of boxes) {
      const dx = Math.max(x0 - x, 0, x - x1);
      const dy = Math.max(y0 - y, 0, y - y1);
      best = Math.min(best, Math.hypot(dx, dy));
    }
    return best;
  };
  const railNodes = new Set<number>();
  for (const p of doc.parts) if (p.type === 'rail') railNodes.add(connectivity.partNodes.get(p.id)?.[0] ?? -1);
  const candidates = new Map<number, { x: number; y: number; anchor: OpLabel['anchor']; score: number }>();
  for (const w of doc.wires) {
    const n = connectivity.wireNodes.get(w.id);
    if (n === undefined || n <= 0 || railNodes.has(n)) continue;
    const horizontal = w.y1 === w.y2;
    const length = Math.abs(w.x2 - w.x1) + Math.abs(w.y2 - w.y1);
    const mx = (w.x1 + w.x2) / 2;
    const my = (w.y1 + w.y2) / 2;
    const spots: { x: number; y: number; anchor: OpLabel['anchor'] }[] = horizontal
      ? [
          { x: mx, y: my - 0.45, anchor: 'middle' },
          { x: mx, y: my + 0.55, anchor: 'middle' },
        ]
      : [
          { x: mx + 0.3, y: my, anchor: 'start' },
          { x: mx - 0.3, y: my, anchor: 'end' },
        ];
    for (const spot of spots) {
      // Text runs about 1.6 grid squares: test its far end too.
      const reach = spot.anchor === 'start' ? 1.6 : spot.anchor === 'end' ? -1.6 : 0;
      const score =
        Math.min(
          clearance(spot.x, spot.y),
          clearance(spot.x + reach, spot.y),
          clearance(spot.x - (spot.anchor === 'middle' ? 0.8 : 0), spot.y),
          clearance(spot.x + (spot.anchor === 'middle' ? 0.8 : 0), spot.y),
        ) +
        0.05 * Math.min(length, 10);
      const previous = candidates.get(n);
      if (!previous || score > previous.score) candidates.set(n, { ...spot, score });
    }
  }
  for (let n = 1; n < op.nodes.length && n <= connectivity.nodeCount; n++) {
    const spot = candidates.get(n);
    if (!spot) continue;
    const raw = op.nodes[n] as number;
    out.push({ key: `n${n}`, kind: 'node', x: spot.x, y: spot.y, anchor: spot.anchor, text: minus(formatValue(Math.abs(raw) < 1e-9 ? 0 : raw, 'V', 3)) });
  }
  for (const part of doc.parts) {
    const r = op.parts.get(part.id);
    const def = PART_BY_TYPE.get(part.type);
    if (!r || !def || def.ground || def.terminals.length < 2 || BOARD_SPECS.has(part.type) || def.group === 'Meters') continue;
    const k = mainTerminal(part.type);
    const i = r.currents[k] as number;
    if (!Number.isFinite(i) || Math.abs(i) < 1e-12) continue;
    let text: string;
    if (def.terminals.length === 2) {
      const [a, b] = terminalPoints(part, def) as [[number, number], [number, number]];
      const dx = (b[0] - a[0]) * Math.sign(i);
      const dy = (b[1] - a[1]) * Math.sign(i);
      const arrow = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? '→' : '←') : dy > 0 ? '↓' : '↑';
      text = `${arrow} ${formatValue(Math.abs(i), 'A', 3)}`;
    } else {
      const which = def.terminals[k]?.name ?? '';
      const short = which === 'collector' ? 'Ic' : which === 'drain' ? 'Id' : which === 'out' ? 'Iout' : `I(${which})`;
      text = `${short} ${minus(formatValue(i, 'A', 3))}`;
    }
    const box = partBox(part, def);
    const [x0, , x1, y1] = box;
    const value = labelPlace(part, box);
    // Under the part's name and value: beside a tall part, below a wide one.
    const place: Pick<OpLabel, 'x' | 'y' | 'anchor'> = value.anchor === 'middle' ? { x: (x0 + x1) / 2, y: y1 + 0.5, anchor: 'middle' } : { x: value.x, y: value.y + 0.75, anchor: value.anchor };
    out.push({ key: `p${part.id}`, kind: 'part', ...place, text });
  }
  return out;
}

/* --------------------------------------------------------------- the boards -- */

/** ESP32 images opened in this session: name → prepared token (the files are too large to keep in the circuit). */
const espImages = new Map<string, string>();
let demoToken: Promise<string> | null = null;

function base64Bytes(text: string): Uint8Array {
  const raw = atob(text);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

async function launchEsp(partId: string, ref: FirmwareRef): Promise<EspMcu> {
  const info = await esp32Info();
  if (!info.available) throw new Error(info.detail);
  let token: string;
  if (ref.kind === 'esp32-demo') {
    demoToken ??= esp32Firmware(base64Bytes(ESP32_DEMO.image), ESP32_DEMO.offset).catch((error: unknown) => {
      demoToken = null;
      throw error;
    });
    token = await demoToken;
  } else if (ref.kind === 'esp32-image') {
    const known = espImages.get(ref.name);
    if (!known) throw new Error(`Open ${ref.name} again: ESP32 firmware files are not kept in the circuit file.`);
    token = known;
  } else throw new Error('This program is not for the ESP32.');
  const id = `${partId}-${Math.random().toString(36).slice(2, 10)}`;
  let queue: string[] = [];
  let unlisten: (() => void) | null = null;
  const mcu = new EspMcu({
    send: (line) => queue.push(line),
    flush: () => {
      if (!queue.length) return;
      const lines = queue;
      queue = [];
      void esp32Send(id, lines).catch(() => undefined);
    },
    stop: () => {
      unlisten?.();
      void esp32Stop(id);
    },
  });
  unlisten = await onEsp32Lines((from, lines) => {
    if (from === id) mcu.receive(lines);
  });
  try {
    await esp32Start(id, token);
  } catch (error) {
    unlisten();
    throw error;
  }
  return mcu;
}

const sketchTitle = (sketch: string) => /^\/\/\s*([^\n:]+)/.exec(sketch)?.[1]?.trim() ?? '';

const BLANK_SKETCH = `void setup() {
  pinMode(LED_BUILTIN, OUTPUT);
  Serial.begin(115200);
}

void loop() {
  digitalWrite(LED_BUILTIN, HIGH);
  delay(500);
  digitalWrite(LED_BUILTIN, LOW);
  delay(500);
}
`;

const PICO_SKETCH = `// The Pico's LED (GP25) blinks; built with Earle Philhower's Arduino-Pico core.
// Serial is the USB port and Serial1 is UART0 on GP0 and GP1: the serial monitor reads both.
void setup() {
  pinMode(LED_BUILTIN, OUTPUT);
  Serial.begin(115200);
}

void loop() {
  digitalWrite(LED_BUILTIN, HIGH);
  Serial.println("on");
  delay(500);
  digitalWrite(LED_BUILTIN, LOW);
  Serial.println("off");
  delay(500);
}
`;

const ESP_SKETCH = `// GPIO2 blinks; messages appear in the serial monitor.
void setup() {
  pinMode(2, OUTPUT);
  Serial.begin(115200);
}

void loop() {
  digitalWrite(2, HIGH);
  Serial.println("on");
  delay(500);
  digitalWrite(2, LOW);
  Serial.println("off");
  delay(500);
}
`;

/** Real boards a sketch for the simulated one can be uploaded to, as arduino-cli names them. */
const REAL_BOARDS: Readonly<Record<BoardKind, readonly (readonly [string, string])[]>> = {
  uno: [
    ['arduino:avr:uno', 'Arduino Uno'],
    ['arduino:avr:nano', 'Arduino Nano'],
    ['arduino:avr:nano:cpu=atmega328old', 'Arduino Nano (old bootloader)'],
    ['arduino:avr:mega', 'Arduino Mega 2560'],
    ['arduino:avr:leonardo', 'Arduino Leonardo'],
  ],
  nano: [
    ['arduino:avr:nano', 'Arduino Nano'],
    ['arduino:avr:nano:cpu=atmega328old', 'Arduino Nano (old bootloader)'],
    ['arduino:avr:uno', 'Arduino Uno'],
  ],
  mega: [['arduino:avr:mega', 'Arduino Mega 2560']],
  pico: [
    ['rp2040:rp2040:rpipico', 'Raspberry Pi Pico (Arduino-Pico)'],
    ['rp2040:rp2040:rpipicow', 'Raspberry Pi Pico W (Arduino-Pico)'],
  ],
  attiny85: [
    ['ATTinyCore:avr:attinyx5:chip=85,clock=8internal', 'ATtiny85 at 8 MHz (ATTinyCore, with a programmer)'],
    ['digistump:avr:digispark-tiny', 'Digispark (Digistump core)'],
  ],
  esp32: [
    ['esp32:esp32:esp32', 'ESP32 Dev Module'],
    ['esp32:esp32:esp32doit-devkit-v1', 'DOIT ESP32 DevKit V1'],
    ['esp32:esp32:nodemcu-32s', 'NodeMCU-32S'],
  ],
};

function BoardProgram({
  part,
  doc,
  espInfo,
  onFirmware,
  recording,
  onRecord,
  onPython,
}: {
  part: PlacedPart;
  doc: CircuitDoc;
  espInfo: Esp32Info | null;
  onFirmware: (ref: FirmwareRef) => void;
  /** The simulated board's pins are being recorded for the Logic Analyser. */
  recording: boolean;
  onRecord: (seconds: number) => void;
  /** Runs a MicroPython program on the running Pico; false when it is not running. */
  onPython: (code: string) => boolean;
}) {
  const spec = BOARD_SPECS.get(part.type);
  const kind: BoardKind = spec?.kind ?? 'uno';
  /** AVR boards are emulated here and take Intel HEX; the ESP32 runs in the desktop app's emulator. */
  const uno = spec ? isAvrChip(spec.chip) : true;
  /** The Pico is emulated here too, and takes UF2, ELF or binary firmware. */
  const pico = spec?.chip === 'rp2040';
  const boardName = spec?.name ?? 'board';
  const examples = examplesFor(part.type);
  const [ports, setPorts] = useState<DetectedBoard[] | null>(null);
  const [port, setPort] = useState('');
  const [fqbn, setFqbn] = useState(REAL_BOARDS[kind][0]?.[0] ?? 'arduino:avr:uno');
  const [uploading, setUploading] = useState(false);
  const [recordFor, setRecordFor] = useState(0.5);
  const ref = firmwareFor(doc, part.id, part.type);
  const [code, setCode] = useState<'hidden' | 'view' | 'edit'>('hidden');
  const [draft, setDraft] = useState('');
  const [compiling, setCompiling] = useState(false);
  const [log, setLog] = useState('');
  const [cli, setCli] = useState<ArduinoInfo | null>(null);
  const [python, setPython] = useState(ref?.kind === 'pico-image' ? (ref.python ?? MICROPYTHON_BLINK) : MICROPYTHON_BLINK);

  const source = useMemo(() => {
    if (!ref) return '';
    if (ref.kind === 'example') return examples.find((e) => e.id === ref.id)?.sketch ?? '';
    if (ref.kind === 'esp32-demo') return ESP32_DEMO.source;
    return ref.sketch ?? '';
  }, [ref]);

  useEffect(() => {
    if (code === 'edit' && isDesktop && !cli) void arduinoInfo().then(setCli);
  }, [code, cli]);

  const openFile = () =>
    attempt(async () => {
      if (pico) {
        const file = await pickFile('.uf2,.elf,.bin');
        if (!file) return;
        const { bytes } = await readBinaryFile(file);
        picoImages.set(file.name, picoFlashImage(bytes));
        // A MicroPython program set up for this board stays with the new firmware.
        onFirmware({ kind: 'pico-image', name: file.name, ...(ref?.kind === 'pico-image' && ref.python ? { python: ref.python } : {}) });
        notify(`Loaded ${file.name}.`);
        return;
      }
      if (uno) {
        const file = await pickFile('.hex,.ihex,.ihx');
        if (!file) return;
        const hex = await readTextFile(file);
        if (!/^:[0-9A-Fa-f]{10}/m.test(hex)) throw new Error('This is not an Intel HEX file. In Arduino IDE use Sketch → Export Compiled Binary and choose the .hex file (without the bootloader).');
        onFirmware({ kind: 'hex', name: file.name, hex });
        notify(`Loaded ${file.name}.`);
        return;
      }
      const file = await pickFile('.bin');
      if (!file) return;
      const { bytes } = await readBinaryFile(file);
      const kind = espImageKind(bytes);
      if (kind === 'app' || kind === 'unknown') throw new Error(ESP_IMAGE_ADVICE[kind]);
      const token = await esp32Firmware(bytes, kind === 'bootloader' ? 0x1000 : 0);
      espImages.set(file.name, token);
      onFirmware({ kind: 'esp32-image', name: file.name });
      notify(`Loaded ${file.name}.`);
    });

  const compile = () =>
    attempt(async () => {
      setCompiling(true);
      setLog('Compiling…');
      try {
        const result = await arduinoCompile(kind, draft);
        setLog(result.log.trim() || (result.ok ? 'Compiled.' : 'The sketch did not compile.'));
        if (!result.ok) return;
        if (uno && result.hex) onFirmware({ kind: 'hex', name: 'Compiled sketch', hex: result.hex, sketch: draft });
        else if (pico && result.uf2) {
          const name = `Compiled sketch ${new Date().toLocaleTimeString()}`;
          picoImages.set(name, picoFlashImage(Uint8Array.from(atob(result.uf2), (c) => c.charCodeAt(0))));
          onFirmware({ kind: 'pico-image', name, sketch: draft });
        } else if (result.token) {
          const name = `Compiled sketch ${new Date().toLocaleTimeString()}`;
          espImages.set(name, result.token);
          onFirmware({ kind: 'esp32-image', name, sketch: draft });
        }
        notify('Compiled and loaded. Run the circuit to start it.');
      } finally {
        setCompiling(false);
      }
    });

  const findPorts = () =>
    attempt(async () => {
      const found = await arduinoBoards();
      setPorts(found);
      // A board that names itself is chosen, with its own kind.
      const family = uno ? 'arduino:avr:' : pico ? 'rp2040:' : 'esp32:';
      const known = found.find((b) => b.fqbn.startsWith(family)) ?? found[0];
      if (known && !found.some((b) => b.port === port)) {
        setPort(known.port);
        if (known.fqbn.startsWith(family)) setFqbn(known.fqbn);
      }
    });

  const upload = () =>
    attempt(async () => {
      setUploading(true);
      setLog('Compiling and uploading…');
      try {
        const result = await arduinoUpload({ fqbn, port, sketch: draft });
        setLog(result.log.trim() || (result.ok ? 'Uploaded.' : 'The upload failed.'));
        if (result.ok) notify('The sketch is on the board.');
      } finally {
        setUploading(false);
      }
    });

  const kinds = REAL_BOARDS[kind];

  const choices: [string, string][] = uno || pico ? examples.map((e) => [`example:${e.id}`, `Example: ${sketchTitle(e.sketch) || e.id}`]) : [['esp32-demo', `${ESP32_DEMO.name} (built in)`]];
  const current = !ref ? '' : ref.kind === 'example' ? `example:${ref.id}` : ref.kind === 'esp32-demo' ? 'esp32-demo' : 'custom';
  if (current === 'custom') choices.push(['custom', firmwareName(ref)]);

  const core = kind === 'attiny85' ? 'ATTinyCore:avr' : uno ? 'arduino:avr' : pico ? 'rp2040:rp2040' : 'esp32:esp32';
  const missingCore = cli?.path && !cli.cores.some((c) => c.id === core);

  return (
    <div class="cs-program" data-testid="cs-program">
      <label class="control">
        <span class="control-label">Program</span>
        <select
          class="select"
          value={current}
          onChange={(e) => {
            const v = e.currentTarget.value;
            if (v.startsWith('example:')) onFirmware({ kind: 'example', id: v.slice(8) });
            else if (v === 'esp32-demo') onFirmware({ kind: 'esp32-demo' });
          }}
          data-testid="cs-firmware"
        >
          {choices.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {!uno && espInfo && !espInfo.available && <p class="control-help cs-warning">{espInfo.detail}</p>}
      <div class="button-row">
        <button type="button" class="button button-small" onClick={openFile} disabled={!uno && !pico && !isDesktop} data-testid="cs-open-firmware">
          <Icon name="open" size={14} /> {uno ? 'Open .hex…' : pico ? 'Open .uf2…' : 'Open .bin…'}
        </button>
        {source && (
          <button type="button" class="button button-small" onClick={() => setCode(code === 'view' ? 'hidden' : 'view')} aria-pressed={code === 'view'}>
            <Icon name="eye" size={14} /> {uno || ref?.kind !== 'esp32-demo' ? 'Sketch' : 'Source'}
          </button>
        )}
        <button
          type="button"
          class="button button-small"
          onClick={() => {
            setDraft(ref && ref.kind !== 'esp32-demo' && source ? source : uno ? BLANK_SKETCH : pico ? PICO_SKETCH : ESP_SKETCH);
            setCode(code === 'edit' ? 'hidden' : 'edit');
          }}
          aria-pressed={code === 'edit'}
          data-testid="cs-compile-open"
        >
          <Icon name="settings" size={14} /> Write a sketch
        </button>
      </div>
      <p class="control-help">
        {uno
          ? `Examples run as built in. For your own sketch, export it from Arduino IDE for the ${boardName} (Sketch → Export Compiled Binary) and open the .hex, or write it here and compile with arduino-cli.`
          : pico
            ? 'Examples run as built in. Open a .uf2 (MicroPython or CircuitPython from their websites, or a sketch exported from Arduino IDE with the Arduino-Pico core), an .elf from the Pico SDK, or write a sketch here and compile it with arduino-cli.'
            : 'Open the .merged.bin that Arduino IDE 2 exports (Sketch → Export Compiled Binary), or write a sketch here and compile it with arduino-cli and the ESP32 boards package.'}
      </p>
      {pico && ref?.kind === 'pico-image' && (
        <div class="cs-python" data-testid="cs-python">
          <div class="cs-code">
            <CodeEditor value={python} onChange={setPython} language="python" label="MicroPython program" testId="cs-python-code" />
          </div>
          <div class="button-row">
            <button
              type="button"
              class="button button-small button-primary"
              onClick={() => {
                onFirmware({ ...ref, python });
                if (onPython(python)) notify('Sent to the Pico.');
                else notify('Kept with the board: it runs when the circuit runs and MicroPython starts.');
              }}
              data-testid="cs-python-run"
            >
              <Icon name="play" size={14} /> Run on the Pico
            </button>
          </div>
          <p class="control-help">
            For firmware with MicroPython: the program is pasted at its prompt (paste mode) when the board starts and whenever you press Run. Type at the prompt in the serial monitor too.
          </p>
        </div>
      )}
      {uno && (
        <div class="control-row cs-record">
          <label class="control">
            <span class="control-label">Record pins {kind === 'attiny85' ? '0 to 5' : '0 to 13'} for</span>
            <select class="select" value={recordFor} onChange={(e) => setRecordFor(Number(e.currentTarget.value))} data-testid="cs-record-for">
              <option value={0.05}>50 ms</option>
              <option value={0.2}>0.2 s</option>
              <option value={0.5}>0.5 s</option>
              <option value={1}>1 s</option>
              <option value={2}>2 s</option>
            </select>
          </label>
          <button type="button" class="button button-small" disabled={recording} onClick={() => onRecord(recordFor)} data-testid="cs-record">
            <Icon name="play" size={14} /> {recording ? 'Recording…' : 'Record, and open in the Logic Analyser'}
          </button>
        </div>
      )}
      {code === 'view' && source && (
        <div class="cs-code">
          <CodeEditor value={source} readOnly language={ref?.kind === 'esp32-demo' ? 'text' : 'cpp'} label="Program source" />
        </div>
      )}
      {code === 'edit' && (
        <div class="cs-compile">
          <div class="cs-code">
            <CodeEditor value={draft} onChange={setDraft} language="cpp" label="Arduino sketch" testId="cs-sketch" />
          </div>
          {!isDesktop && <p class="control-help cs-warning">Compiling needs the desktop app with Arduino IDE 2 or arduino-cli installed.</p>}
          {isDesktop && cli && !cli.path && (
            <p class="control-help cs-warning">arduino-cli was not found. Install Arduino IDE 2 or arduino-cli, or set BENCHTOP_ARDUINO_CLI to its path, then reopen this tool.</p>
          )}
          {isDesktop && missingCore && (
            <p class="control-help cs-warning">
              The {kind === 'attiny85' ? 'ATTinyCore' : uno ? 'Arduino AVR' : pico ? 'Raspberry Pi Pico (Arduino-Pico)' : 'ESP32'} boards package is not installed. Add it in Arduino IDE (Tools → Board
              → Boards Manager) or run: arduino-cli core install {core}
              {pico ? ' (after adding https://github.com/earlephilhower/arduino-pico/releases/download/global/package_rp2040_index.json to the board manager URLs)' : ''}
            </p>
          )}
          <div class="button-row">
            <button type="button" class="button button-primary button-small" onClick={compile} disabled={!isDesktop || compiling || !draft.trim()} data-testid="cs-compile">
              {compiling ? 'Compiling…' : 'Compile and load'}
            </button>
            {cli?.path && <span class="tone-muted">arduino-cli {cli.version}</span>}
          </div>
          {isDesktop && cli?.path && (
            <fieldset class="cs-upload" data-testid="cs-upload">
              <legend class="control-label">The same sketch on a real board</legend>
              <div class="control-row">
                <label class="control">
                  <span class="control-label">Port</span>
                  <select class="select" value={port} onChange={(e) => setPort(e.currentTarget.value)} data-testid="cs-upload-port">
                    {!ports?.length && <option value="">{ports ? 'no board found' : 'not looked for yet'}</option>}
                    {ports?.map((b) => (
                      <option key={b.port} value={b.port}>
                        {b.port}
                        {b.name ? ` (${b.name})` : ''}
                      </option>
                    ))}
                  </select>
                </label>
                <label class="control">
                  <span class="control-label">Board</span>
                  <select class="select" value={fqbn} onChange={(e) => setFqbn(e.currentTarget.value)} data-testid="cs-upload-board">
                    {!kinds.some(([id]) => id === fqbn) && <option value={fqbn}>{ports?.find((b) => b.fqbn === fqbn)?.name || fqbn}</option>}
                    {kinds.map(([id, name]) => (
                      <option key={id} value={id}>
                        {name}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="button" class="button button-small button-quiet" onClick={findPorts}>
                  <Icon name="refresh" size={14} /> Look for boards
                </button>
                <button type="button" class="button button-small" onClick={upload} disabled={uploading || compiling || !port || !draft.trim()} data-testid="cs-upload-go">
                  {uploading ? 'Uploading…' : 'Upload to the board'}
                </button>
              </div>
              <p class="control-help">The sketch is compiled for the board chosen here and written to it over USB. Pins and timing of other boards can differ from the simulated {boardName}.</p>
            </fieldset>
          )}
          {log && <pre class="cs-log">{log}</pre>}
        </div>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- properties -- */

function NumberField({ def, value, onCommit }: { def: PropDef; value: number; onCommit: (v: number) => void }) {
  const shown = def.unit ? formatSi(value, def.unit, 4) : String(Number(value.toPrecision(6)));
  const [text, setText] = useState(shown);
  const [error, setError] = useState(false);
  useEffect(() => {
    setText(shown);
    setError(false);
  }, [shown]);
  const commit = () => {
    const parsed = parseSi(text, def.unit ?? '');
    if (parsed === null || (def.min !== undefined && parsed < def.min) || (def.max !== undefined && parsed > def.max)) {
      setError(true);
      return;
    }
    setError(false);
    if (parsed !== value) onCommit(parsed);
  };
  return (
    <label class="control">
      <span class="control-label">{def.label}</span>
      <input
        class={`input${error ? ' is-invalid' : ''}`}
        value={text}
        onInput={(e) => setText(e.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
        }}
        aria-invalid={error}
        spellcheck={false}
      />
      {error && (
        <span class="control-help cs-warning">
          Enter a number{def.unit ? ` in ${def.unit} (prefixes such as k, m, µ work)` : ''}
          {def.min !== undefined ? `, at least ${def.min}` : ''}
          {def.max !== undefined ? `, at most ${def.max}` : ''}.
        </span>
      )}
    </label>
  );
}

/** A reading that changes while the circuit runs (a sensor's temperature): a slider and a box for an exact value. */
function LiveField({ def, value, onChange }: { def: PropDef; value: number; onChange: (v: number) => void }) {
  const lo = def.min ?? 0;
  const hi = def.max ?? 100;
  const log = def.scale === 'log';
  const toSlider = (x: number) => (log ? Math.log10(Math.max(lo, x)) : x);
  const fromSlider = (x: number) => (log ? Number((10 ** x).toPrecision(3)) : Math.round(x / (def.step ?? 1)) * (def.step ?? 1));
  const decimals = log ? 0 : Math.max(0, -Math.floor(Math.log10(def.step ?? 1)));
  const shown = log && value < 10 ? String(Number(value.toPrecision(2))) : value.toFixed(decimals);
  const [text, setText] = useState(shown);
  useEffect(() => setText(shown), [shown]);
  const commit = () => {
    const v = Number(text.replace(',', '.'));
    if (Number.isFinite(v) && v >= lo && v <= hi) onChange(v);
    else setText(shown);
  };
  return (
    <div class="control cs-live">
      <span class="control-label">{def.label}</span>
      <div class="cs-live-row">
        <input
          type="range"
          min={toSlider(lo)}
          max={toSlider(hi)}
          step={log ? 0.01 : (def.step ?? 1)}
          value={toSlider(value)}
          onInput={(e) => onChange(fromSlider(Number(e.currentTarget.value)))}
          aria-label={def.label}
          data-testid={`cs-live-${def.key}`}
        />
        <input
          class="input cs-live-value"
          value={text}
          onInput={(e) => setText(e.currentTarget.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
          }}
          aria-label={`${def.label}${def.unit ? ` in ${def.unit}` : ''}`}
          inputMode="decimal"
          spellcheck={false}
        />
        {def.unit && <span class="tone-muted">{def.unit}</span>}
      </div>
    </div>
  );
}

/** A text property (a transfer function), with the part's own check of what is typed. */
function TextField({ def, value, onCommit }: { def: PropDef; value: string; onCommit: (v: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const problem = def.check?.(text) ?? null;
  const commit = () => {
    if (text !== value) onCommit(text);
  };
  return (
    <label class="control">
      <span class="control-label">{def.label}</span>
      <input
        class={`input${problem ? ' is-invalid' : ''}`}
        value={text}
        onInput={(e) => setText(e.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
        }}
        aria-invalid={!!problem}
        spellcheck={false}
        data-testid={`cs-text-${def.key}`}
      />
      {problem ? <span class="control-help cs-warning">{problem}</span> : <span class="control-help">In s, for example 1/(1 + s/1k) or 100/(s^2 + 10s + 100); k, M, m, u, n and p work.</span>}
    </label>
  );
}

function PartProps({ part, onProp, onLive }: { part: PlacedPart; onProp: (key: string, value: PropValue) => void; onLive: (key: string, value: PropValue) => void }) {
  const def = PART_BY_TYPE.get(part.type);
  if (!def?.props.length) return null;
  return (
    <div class="cs-props">
      {def.props.map((p) => {
        const value = part.props[p.key] ?? p.default;
        if (p.kind === 'boolean')
          return (
            <label key={p.key} class="check">
              <input type="checkbox" checked={value === true} onChange={(e) => onLive(p.key, e.currentTarget.checked)} />
              <span>{p.label}</span>
            </label>
          );
        if (p.kind === 'choice')
          return (
            <label key={p.key} class="control">
              <span class="control-label">{p.label}</span>
              <select class="select" value={String(value)} onChange={(e) => onProp(p.key, e.currentTarget.value)}>
                {(p.choices ?? []).map(([v, label]) => (
                  <option key={v} value={v}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          );
        if (p.kind === 'text') return <TextField key={p.key} def={p} value={typeof value === 'string' ? value : String(p.default)} onCommit={(v) => onProp(p.key, v)} />;
        if (p.kind === 'number' && p.live) return <LiveField key={p.key} def={p} value={typeof value === 'number' ? value : (p.default as number)} onChange={(v) => onLive(p.key, v)} />;
        if (p.key === 'position')
          return (
            <label key={p.key} class="control">
              <span class="control-label">
                {p.label}: {Math.round((value as number) * 100)} %
              </span>
              <input type="range" min={0} max={1} step={0.01} value={value as number} onInput={(e) => onLive(p.key, Number(e.currentTarget.value))} data-testid="cs-position" />
            </label>
          );
        return <NumberField key={p.key} def={p} value={typeof value === 'number' ? value : (p.default as number)} onCommit={(v) => onProp(p.key, v)} />;
      })}
    </div>
  );
}

/** Live readings for the selected part. */
function readings(part: PlacedPart, session: Session): [string, string][] {
  const built = session.built;
  const nodes = built.connectivity.partNodes.get(part.id) ?? [];
  const def = PART_BY_TYPE.get(part.type);
  const v = (n: number) => built.circuit.v(n);
  const rows: [string, string][] = [];
  const live = built.runtimes.get(part.id)?.view() ?? {};
  const a = nodes[0] ?? 0;
  const b = nodes[1] ?? 0;
  const amps = (i: number) => minus(formatSi(i, 'A'));
  const volts = (x: number) => minus(formatSi(x, 'V'));
  switch (part.type) {
    case 'resistor': {
      const drop = v(a) - v(b);
      const r = num(part, 'r');
      rows.push(['Voltage across', volts(drop)], ['Current', amps(drop / r)], ['Power', formatSi((drop * drop) / r, 'W')]);
      break;
    }
    case 'capacitor':
    case 'inductor':
    case 'lamp':
    case 'motor':
    case 'buzzer':
      rows.push(['Voltage across', volts(v(a) - v(b))]);
      break;
    case 'diode':
    case 'zener':
    case 'led':
      rows.push(['Voltage across', volts(v(a) - v(b))], ['Current', amps(typeof live.current === 'number' ? live.current : 0)]);
      break;
    case 'npn':
    case 'pnp':
      rows.push(['Collector current', amps(typeof live.ic === 'number' ? live.ic : 0)], ['Base current', amps(typeof live.ib === 'number' ? live.ib : 0)]);
      break;
    case 'nmos':
    case 'pmos':
      rows.push(['Drain current', amps(typeof live.id === 'number' ? live.id : 0)]);
      break;
    case 'voltmeter':
    case 'ammeter':
    case 'probe':
      if (typeof live.reading === 'number') rows.push(['Reading', part.type === 'ammeter' ? amps(live.reading) : volts(live.reading)]);
      break;
    default:
      break;
  }
  // Modules: what their devices report.
  if (live.powered === false) rows.push(['Power', 'none: connect its supply and ground']);
  if (typeof live.angle === 'number') rows.push(['Angle', `${live.angle.toFixed(1)}°`]);
  if (typeof live.pulse === 'number' && live.pulse > 0) rows.push(['Pulse', formatSi(live.pulse, 's')]);
  if (typeof live.steps === 'number') rows.push(['Steps', String(live.steps)]);
  if (typeof live.time === 'string') rows.push(['Clock', live.time]);
  if (typeof live.reads === 'number') rows.push(['Readings sent', String(live.reads)]);
  if (typeof live.pings === 'number') rows.push(['Pings answered', String(live.pings)]);
  if (typeof live.resistance === 'number') rows.push(['Resistance', formatSi(live.resistance, 'Ω')]);
  if (typeof live.position === 'number' && part.type === 'encoder') rows.push(['Position', `${live.position} steps`]);
  if (def && !isBoard(part.type))
    def.terminals.forEach((t, i) => {
      const n = nodes[i] ?? 0;
      if (n >= 0) rows.push([`Voltage at ${t.name}`, volts(v(n))]);
    });
  return rows;
}

/* --------------------------------------------------------------- the scope -- */

const SCOPE_W = 800;
const SCOPE_H = 200;

function frequency(t: readonly number[], v: readonly number[]): number | null {
  if (v.length < 8) return null;
  const mean = v.reduce((s, x) => s + x, 0) / v.length;
  const span = Math.max(...v) - Math.min(...v);
  if (span < 1e-3) return null;
  const crossings: number[] = [];
  let below = (v[0] as number) < mean - span * 0.05;
  for (let i = 1; i < v.length; i++) {
    const x = v[i] as number;
    if (below && x > mean + span * 0.05) {
      crossings.push(t[i] as number);
      below = false;
    } else if (!below && x < mean - span * 0.05) below = true;
  }
  if (crossings.length < 2) return null;
  return (crossings.length - 1) / ((crossings.at(-1) as number) - (crossings[0] as number));
}

function ScopeView({ session, window }: { session: Session | null; window: number }) {
  const now = session?.time ?? 0;
  const from = now - window;
  const data = session?.scope.traces.map((trace) => (trace.active || trace.count ? trace.since(Math.max(0, from)) : { t: [], v: [] })) ?? [];
  const all = data.flatMap((d) => d.v);
  const { lo, hi, ticks } = niceScale(all.length ? Math.min(...all) : -1, all.length ? Math.max(...all) : 5, true);
  const x = (t: number) => ((t - from) / window) * SCOPE_W;
  const y = (v: number) => SCOPE_H - ((v - lo) / (hi - lo || 1)) * SCOPE_H;
  const hasProbe = session ? session.doc.parts.some((p) => p.type === 'probe') : false;
  return (
    <div class="cs-scope" data-testid="cs-scope">
      <svg viewBox={`-44 -8 ${SCOPE_W + 52} ${SCOPE_H + 26}`} class="cs-scope-svg" role="img" aria-label="Oscilloscope traces">
        <rect x={0} y={0} width={SCOPE_W} height={SCOPE_H} class="cs-scope-screen" />
        {Array.from({ length: 11 }, (_, i) => (
          <line key={`v${i}`} x1={(i * SCOPE_W) / 10} y1={0} x2={(i * SCOPE_W) / 10} y2={SCOPE_H} class="cs-scope-grid" />
        ))}
        {ticks.map((t) => (
          <g key={`h${t}`}>
            <line x1={0} y1={y(t)} x2={SCOPE_W} y2={y(t)} class={t === 0 ? 'cs-scope-zero' : 'cs-scope-grid'} />
            <text x={-6} y={y(t)} text-anchor="end" dominant-baseline="middle" class="cs-scope-label">
              {minus(formatSi(t, 'V', 2))}
            </text>
          </g>
        ))}
        <text x={SCOPE_W} y={SCOPE_H + 16} text-anchor="end" class="cs-scope-label">
          {formatSi(window / 10, 's')} per division
        </text>
        {data.map((d, i) =>
          d.t.length > 1 ? (
            <polyline
              key={i}
              points={d.t.map((t, k) => `${x(t).toFixed(1)},${y(d.v[k] as number).toFixed(1)}`).join(' ')}
              fill="none"
              stroke={TRACE_COLOURS[i]}
              stroke-width={1.6}
              stroke-linejoin="round"
            />
          ) : null,
        )}
      </svg>
      <div class="cs-scope-readouts">
        {!hasProbe && <span class="tone-muted">Add a scope probe (in Meters) to a wire to plot its voltage here.</span>}
        {data.map((d, i) => {
          if (!d.v.length) return null;
          const f = frequency(d.t, d.v);
          return (
            <span key={i} class="cs-readout">
              <span class="cs-swatch" style={{ background: TRACE_COLOURS[i] }} />
              {minus(formatSi(d.v.at(-1) as number, 'V'))}
              <span class="tone-muted">
                {' '}
                {minus(formatSi(Math.min(...d.v), 'V'))} to {minus(formatSi(Math.max(...d.v), 'V'))}
                {f ? `, ${formatSi(f, 'Hz')}` : ''}
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ serial -- */

const ENDINGS: readonly (readonly [string, string])[] = [
  ['\n', 'Newline'],
  ['', 'No line ending'],
  ['\r', 'Carriage return'],
  ['\r\n', 'Both'],
];

function SerialView({
  boards,
  logs,
  version,
  onSend,
  onClear,
}: {
  boards: readonly PlacedPart[];
  logs: ReadonlyMap<string, string>;
  version: number;
  onSend: (partId: string, text: string) => void;
  onClear: (partId: string) => void;
}) {
  const [chosen, setChosen] = useState('');
  const [text, setText] = useState('');
  const [ending, setEnding] = useState('\n');
  const box = useRef<HTMLPreElement>(null);
  const board = boards.find((b) => b.id === chosen) ?? boards[0];
  const log = board ? (logs.get(board.id) ?? '') : '';
  useEffect(() => {
    if (box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [version, board?.id]);
  if (!board) return <p class="tone-muted cs-empty">Add a board (an Arduino, an ATtiny85 or an ESP32) to see what it prints here.</p>;
  const send = () => {
    onSend(board.id, text + ending);
    setText('');
  };
  return (
    <div class="cs-serial" data-testid="cs-serial">
      <div class="button-row">
        {boards.length > 1 && (
          <select class="select" value={board.id} onChange={(e) => setChosen(e.currentTarget.value)} aria-label="Board">
            {boards.map((b) => (
              <option key={b.id} value={b.id}>
                {PART_BY_TYPE.get(b.type)?.name} {b.id}
              </option>
            ))}
          </select>
        )}
        <input
          class="input cs-serial-input"
          value={text}
          placeholder="Text to send"
          onInput={(e) => setText(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') send();
          }}
          aria-label="Text to send"
          data-testid="cs-serial-input"
        />
        <select class="select" value={ending} onChange={(e) => setEnding(e.currentTarget.value)} aria-label="Line ending">
          {ENDINGS.map(([v, label]) => (
            <option key={label} value={v}>
              {label}
            </option>
          ))}
        </select>
        <button type="button" class="button button-small" onClick={send}>
          Send
        </button>
        <button type="button" class="button button-small" onClick={() => onClear(board.id)}>
          Clear
        </button>
      </div>
      <pre class="cs-serial-log" ref={box} data-testid="cs-serial-log">
        {log || <span class="tone-muted">Nothing received yet. Run the circuit; what the board prints on its serial port appears here.</span>}
      </pre>
    </div>
  );
}

/* ----------------------------------------------------------------- palette -- */

function PaletteIcon({ def }: { def: PartDef }) {
  const part: PlacedPart = { id: 'icon', type: def.type, x: 0, y: 0, rot: 0, props: defaultProps(def) };
  const [x0, y0, x1, y1] = partOutline(def, part.props);
  const pad = 0.4;
  return (
    <svg class="cs-icon" viewBox={`${(x0 - pad) * GRID} ${(y0 - pad) * GRID} ${(x1 - x0 + 2 * pad) * GRID} ${(y1 - y0 + 2 * pad) * GRID}`} aria-hidden="true">
      {drawPart(part, null)}
    </svg>
  );
}

function Palette({ placing, onPick }: { placing: string | null; onPick: (type: string) => void }) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const match = (def: PartDef) => !q || def.name.toLowerCase().includes(q) || def.type.includes(q) || (def.keywords ?? '').includes(q);
  return (
    <aside class="cs-palette" aria-label="Parts">
      <input class="input" type="search" placeholder="Find a part" value={query} onInput={(e) => setQuery(e.currentTarget.value)} aria-label="Find a part" />
      {GROUPS.map((group) => {
        const defs = PARTS.filter((d) => d.group === group && match(d));
        if (!defs.length) return null;
        return (
          <section key={group} class="cs-palette-group">
            <h3 class="cs-palette-title">{group}</h3>
            <div class="cs-palette-grid">
              {defs.map((def) => (
                <button
                  key={def.type}
                  type="button"
                  class={`cs-palette-item${placing === def.type ? ' is-active' : ''}`}
                  onClick={() => onPick(def.type)}
                  title={`Add ${def.name.toLowerCase()}`}
                  data-testid={`cs-add-${def.type}`}
                >
                  <PaletteIcon def={def} />
                  <span>{def.name}</span>
                </button>
              ))}
            </div>
          </section>
        );
      })}
    </aside>
  );
}

/* ------------------------------------------------------------------ editor -- */

type Drag =
  | { readonly kind: 'move'; readonly start: Point; readonly ids: ReadonlySet<string>; readonly base: CircuitDoc; moved: boolean }
  | { readonly kind: 'pan'; readonly client: Point; readonly view: View; moved: boolean }
  | { readonly kind: 'box'; readonly from: Point; to: Point }
  | { readonly kind: 'press'; readonly partId: string }
  | { readonly kind: 'adjust'; readonly partId: string; readonly startY: number; readonly start: number };

interface WireDraft {
  readonly from: Point;
  to: Point;
  horizontalFirst: boolean | null;
  sticky: boolean;
  added: WireSegment[];
}

interface View {
  readonly x: number;
  readonly y: number;
  readonly scale: number;
}

interface Placing {
  readonly type: string;
  readonly rot: number;
  readonly flip: boolean;
}

function CircuitSimulator({ toolId }: { toolId: string }) {
  const [sim, setSim] = usePersistentState(toolId, readSim, writeSim);
  const doc = sim.doc;
  const [preview, setPreview] = useState<CircuitDoc | null>(null);
  const shown = preview ?? doc;
  const history = useRef<{ past: CircuitDoc[]; future: CircuitDoc[]; key: string; at: number }>({ past: [], future: [], key: '', at: 0 });
  const [selection, setSelection] = useState<ReadonlySet<string>>(new Set());
  const [tool, setTool] = useState<'select' | 'wire'>('select');
  const [placing, setPlacing] = useState<Placing | null>(null);
  const [pointer, setPointer] = useState<Point | null>(null);
  const [draft, setDraft] = useState<WireDraft | null>(null);
  const [view, setView] = useState<View>({ x: -40, y: -60, scale: 1 });
  const [size, setSize] = useState({ w: 800, h: 520 });
  const [running, setRunning] = useState(false);
  const [, setTick] = useState(0);
  const [serialVersion, setSerialVersion] = useState(0);
  const [espInfo, setEspInfo] = useState<Esp32Info | null>(null);
  const [boardProblems, setBoardProblems] = useState<Record<string, string>>({});
  const session = useRef<Session | null>(null);
  /** An operating point to label on the drawing (from the analysis panel). */
  const [opOverlay, setOpOverlay] = useState<OperatingPoint | null>(null);
  const [recordingPart, setRecordingPart] = useState('');
  /** Records the simulated Uno's pins for a while, then hands the recording to the Logic Analyser as a VCD file. */
  const recordPins = (partId: string, seconds: number) => {
    const mcu = session.current?.mcu(partId);
    if (!(mcu instanceof AvrMcu)) {
      notify('Run the circuit first: the board has to be running for its pins to be recorded.', 'error');
      return;
    }
    setRecordingPart(partId);
    mcu.record(seconds, (capture) => {
      setRecordingPart('');
      sendToTool('logic-analyser', {
        files: [new File([writeVcd(capture, new Date().toISOString())], `${docRef.current.parts.find((p) => p.id === partId)?.type ?? 'board'}-pins.vcd`, { type: 'text/plain' })],
      });
    });
  };
  const serialLogs = useRef(new Map<string, string>());
  const drag = useRef<Drag | null>(null);
  const clipboard = useRef<{ parts: PlacedPart[]; wires: WireSegment[] } | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const docRef = useRef(doc);
  docRef.current = doc;

  useEffect(() => {
    void esp32Info().then(setEspInfo);
  }, []);

  // Canvas size.
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setSize({ w: el.clientWidth || 800, h: el.clientHeight || 520 }));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const fitView = (target: CircuitDoc = docRef.current) => {
    const b = bounds(target);
    const el = svg.current;
    const w = el?.clientWidth || size.w;
    const h = el?.clientHeight || size.h;
    if (!b) {
      setView({ x: -w / 2, y: -h / 2, scale: 1 });
      return;
    }
    const [x0, y0, x1, y1] = b;
    const margin = 2;
    const scale = Math.max(0.3, Math.min(1.6, w / ((x1 - x0 + 2 * margin) * GRID), h / ((y1 - y0 + 2 * margin) * GRID)));
    const cx = ((x0 + x1) / 2) * GRID;
    const cy = ((y0 + y1) / 2) * GRID;
    setView({ x: cx - w / scale / 2, y: cy - h / scale / 2, scale });
  };

  useEffect(() => {
    const t = setTimeout(() => fitView(), 30);
    return () => clearTimeout(t);
  }, []);

  /* ---- documents and history ---- */

  const apply = (next: CircuitDoc, options: { key?: string; history?: boolean; rebuild?: boolean } = {}) => {
    const h = history.current;
    if (options.history !== false) {
      const now = performance.now();
      if (!(options.key && h.key === options.key && now - h.at < 1500)) {
        h.past.push(docRef.current);
        if (h.past.length > 200) h.past.shift();
      }
      h.future = [];
      h.key = options.key ?? '';
      h.at = now;
    }
    docRef.current = next;
    setSim((s) => ({ ...s, doc: next }));
    if (options.rebuild !== false) session.current?.update(next);
  };

  const undo = () => {
    const h = history.current;
    const previous = h.past.pop();
    if (!previous) return;
    h.future.push(docRef.current);
    h.key = '';
    apply(previous, { history: false });
    setSelection(new Set());
  };

  const redo = () => {
    const h = history.current;
    const next = h.future.pop();
    if (!next) return;
    h.past.push(docRef.current);
    h.key = '';
    apply(next, { history: false });
    setSelection(new Set());
  };

  /* ---- running ---- */

  const stop = () => {
    session.current?.dispose();
    session.current = null;
    setRunning(false);
    setBoardProblems({});
    setTick((t) => t + 1);
  };

  const start = () => {
    if (!session.current) {
      serialLogs.current = new Map();
      setSerialVersion((v) => v + 1);
      setBoardProblems({});
      const s = new Session(docRef.current, {
        launchEsp,
        onSerial: (partId, text) => {
          const log = (serialLogs.current.get(partId) ?? '') + text;
          serialLogs.current.set(partId, log.length > 65_536 ? log.slice(-49_152) : log);
          setSerialVersion((v) => v + 1);
        },
        onBoardProblem: (partId, message) => setBoardProblems((p) => ({ ...p, [partId]: message })),
      });
      s.scope.window = sim.scope;
      session.current = s;
    }
    setRunning(true);
  };

  useEffect(() => () => session.current?.dispose(), []);

  useEffect(() => {
    if (session.current) session.current.scope.window = sim.scope;
  }, [sim.scope]);

  useEffect(() => {
    if (!running) return;
    let frame = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const s = session.current;
      if (!s) return;
      s.advance((now - last) / 1000, docRef.current.speed, 12);
      last = now;
      if (s.failure) {
        setRunning(false);
        notify(s.failure, 'error');
      }
      setTick((t) => t + 1);
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [running]);

  const live = (id: string) => (session.current ? (session.current.built.runtimes.get(id)?.view() ?? null) : null);

  /** A switch or input changed while running: the part changes at once and the circuit keeps going. */
  const interactProp = (part: PlacedPart, key: string, value: PropValue) => {
    apply(
      { ...docRef.current, parts: docRef.current.parts.map((p) => (p.id === part.id ? { ...p, props: { ...p.props, [key]: value } } : p)) },
      { key: `prop:${part.id}:${key}`, rebuild: !session.current },
    );
  };

  const interact = (part: PlacedPart) => {
    const def = PART_BY_TYPE.get(part.type);
    if (!def?.interactive || !session.current) return;
    if (def.interactive === 'toggle') {
      session.current.interact(part.id, 'toggle');
      const key = def.toggleProp ?? 'high';
      interactProp(part, key, part.props[key] !== true);
    }
  };

  /* ---- editing ---- */

  const deleteSelection = () => {
    if (!selection.size) return;
    const d = docRef.current;
    const firmware = d.firmware ? Object.fromEntries(Object.entries(d.firmware).filter(([id]) => !selection.has(id))) : undefined;
    apply({ ...d, parts: d.parts.filter((p) => !selection.has(p.id)), wires: d.wires.filter((w) => !selection.has(w.id)), ...(firmware ? { firmware } : {}) });
    setSelection(new Set());
  };

  const turn = (by: number, mirror = false) => {
    if (placing) {
      setPlacing({ ...placing, rot: (placing.rot + by + 4) % 4, flip: mirror ? !placing.flip : placing.flip });
      return;
    }
    if (![...selection].some((id) => docRef.current.parts.some((p) => p.id === id))) return;
    apply({ ...docRef.current, parts: docRef.current.parts.map((p) => (selection.has(p.id) ? { ...p, rot: (p.rot + by + 4) % 4, ...(mirror ? { flip: !p.flip } : {}) } : p)) });
  };

  const copy = () => {
    const d = docRef.current;
    clipboard.current = { parts: d.parts.filter((p) => selection.has(p.id)), wires: d.wires.filter((w) => selection.has(w.id)) };
  };

  const paste = (offset = 2) => {
    const c = clipboard.current;
    if (!c || (!c.parts.length && !c.wires.length)) return;
    const d = docRef.current;
    const nextPart = idMaker(d, 'p');
    const nextWire = idMaker(d, 'w');
    const parts = c.parts.map((p) => ({ ...p, id: nextPart(), x: p.x + offset, y: p.y + offset }));
    const wires = c.wires.map((w) => ({ ...w, id: nextWire(), x1: w.x1 + offset, y1: w.y1 + offset, x2: w.x2 + offset, y2: w.y2 + offset }));
    apply({ ...d, parts: [...d.parts, ...parts], wires: [...d.wires, ...wires] });
    setSelection(new Set([...parts.map((p) => p.id), ...wires.map((w) => w.id)]));
    clipboard.current = { parts, wires };
  };

  const loadExample = (e: Example) => {
    stop();
    const next = e.make();
    apply(next);
    if (e.scope) setSim((s) => ({ ...s, scope: e.scope as number }));
    setSim((s) => ({ ...s, panel: e.analysis ? 'analysis' : next.parts.some((p) => isBoard(p.type)) ? 'serial' : 'scope' }));
    setSelection(new Set());
    setTimeout(() => fitView(next), 0);
  };

  const setFirmware = (partId: string, ref: FirmwareRef) => {
    const d = docRef.current;
    apply({ ...d, firmware: { ...(d.firmware ?? {}), [partId]: ref } });
    setBoardProblems((p) => {
      const { [partId]: _gone, ...rest } = p;
      return rest;
    });
  };

  /* ---- pointer ---- */

  const toWorld = (clientX: number, clientY: number): Point => {
    const rect = svg.current?.getBoundingClientRect();
    if (!rect) return [0, 0];
    return [(view.x + (clientX - rect.left) / view.scale) / GRID, (view.y + (clientY - rect.top) / view.scale) / GRID];
  };
  const snap = ([x, y]: Point): Point => [Math.round(x), Math.round(y)];

  const finishDraft = (d: WireDraft, end: Point, keepGoing: boolean) => {
    const base = docRef.current;
    const ids = idMaker(base, 'w');
    const added = route(d.from, end, d.horizontalFirst ?? true, ids);
    if (added.length) apply({ ...base, wires: [...base.wires, ...added] }, { key: `wire:${d.added[0]?.id ?? added[0]?.id}` });
    const joined = joinsSomething(base, end);
    if (keepGoing && added.length && !joined) setDraft({ from: end, to: end, horizontalFirst: null, sticky: true, added: [...d.added, ...added] });
    else setDraft(null);
  };

  const onPointerDown = (e: PointerEvent) => {
    if (e.button === 2) {
      setDraft(null);
      setPlacing(null);
      return;
    }
    wrap.current?.focus({ preventScroll: true });
    const world = toWorld(e.clientX, e.clientY);
    const grid = snap(world);
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    const d = docRef.current;

    if (e.button === 1) {
      drag.current = { kind: 'pan', client: [e.clientX, e.clientY], view, moved: false };
      return;
    }
    if (placing) {
      const def = PART_BY_TYPE.get(placing.type);
      if (!def) return;
      const id = idMaker(d, 'p')();
      const part: PlacedPart = { id, type: def.type, x: grid[0], y: grid[1], rot: placing.rot, ...(placing.flip ? { flip: true } : {}), props: defaultProps(def) };
      apply({ ...d, parts: [...d.parts, part] });
      setSelection(new Set([id]));
      if (!e.shiftKey) setPlacing(null);
      return;
    }
    if (draft?.sticky) {
      finishDraft(draft, grid, true);
      return;
    }
    if (session.current) {
      const part = hitPart(d, world[0], world[1]);
      const def = part ? PART_BY_TYPE.get(part.type) : undefined;
      if (part && def?.interactive) {
        if (def.interactive === 'toggle') interact(part);
        else if (def.interactive === 'press' || def.interactive === 'point') {
          session.current.interact(part.id, 'press', def.interactive === 'point' ? localPoint(part, world) : undefined);
          drag.current = { kind: 'press', partId: part.id };
        } else drag.current = { kind: 'adjust', partId: part.id, startY: e.clientY, start: typeof part.props.position === 'number' ? part.props.position : 0.5 };
        setSelection(new Set([part.id]));
        return;
      }
    }
    const terminal = hitTerminal(d, world[0], world[1]);
    if (tool === 'wire' || (terminal && !e.shiftKey)) {
      const from = terminal ?? grid;
      setDraft({ from, to: from, horizontalFirst: null, sticky: false, added: [] });
      return;
    }
    const part = hitPart(d, world[0], world[1]);
    const wire = part ? null : hitWire(d, world[0], world[1]);
    const hit = part?.id ?? wire?.id;
    if (hit) {
      let next = selection;
      if (e.shiftKey) {
        const toggled = new Set(selection);
        if (toggled.has(hit)) toggled.delete(hit);
        else toggled.add(hit);
        next = toggled;
      } else if (!selection.has(hit)) next = new Set([hit]);
      setSelection(next);
      drag.current = { kind: 'move', start: grid, ids: next, base: d, moved: false };
      return;
    }
    if (e.shiftKey) drag.current = { kind: 'box', from: world, to: world };
    else drag.current = { kind: 'pan', client: [e.clientX, e.clientY], view, moved: false };
  };

  const onPointerMove = (e: PointerEvent) => {
    const world = toWorld(e.clientX, e.clientY);
    const grid = snap(world);
    setPointer(world);
    const g = drag.current;
    if (draft) {
      const dx = grid[0] - draft.from[0];
      const dy = grid[1] - draft.from[1];
      const horizontalFirst = draft.horizontalFirst ?? (Math.abs(dx) + Math.abs(dy) >= 1 ? Math.abs(dx) >= Math.abs(dy) : null);
      if (grid[0] !== draft.to[0] || grid[1] !== draft.to[1] || horizontalFirst !== draft.horizontalFirst) setDraft({ ...draft, to: grid, horizontalFirst });
      return;
    }
    if (!g) return;
    if (g.kind === 'move') {
      const dx = grid[0] - g.start[0];
      const dy = grid[1] - g.start[1];
      if (dx || dy) g.moved = true;
      setPreview(g.moved ? moveItems(g.base, g.ids, dx, dy) : null);
    } else if (g.kind === 'pan') {
      const dx = e.clientX - g.client[0];
      const dy = e.clientY - g.client[1];
      if (Math.abs(dx) + Math.abs(dy) > 3) g.moved = true;
      setView({ ...g.view, x: g.view.x - dx / g.view.scale, y: g.view.y - dy / g.view.scale });
    } else if (g.kind === 'box') {
      g.to = world;
      setTick((t) => t + 1);
    } else if (g.kind === 'adjust') {
      const value = Math.max(0, Math.min(1, g.start + (g.startY - e.clientY) / 150));
      session.current?.adjust(g.partId, value);
      const part = docRef.current.parts.find((p) => p.id === g.partId);
      if (part) interactProp(part, 'position', Math.round(value * 100) / 100);
    }
  };

  const onPointerUp = (e: PointerEvent) => {
    const g = drag.current;
    drag.current = null;
    const grid = snap(toWorld(e.clientX, e.clientY));
    if (draft) {
      if (grid[0] === draft.from[0] && grid[1] === draft.from[1]) {
        // A click: keep drawing from here until the next click.
        if (!draft.sticky) setDraft({ ...draft, sticky: true });
      } else if (!draft.sticky) finishDraft(draft, grid, false);
      return;
    }
    if (!g) return;
    if (g.kind === 'move') {
      if (g.moved && preview) apply(preview);
      setPreview(null);
    } else if (g.kind === 'pan') {
      if (!g.moved) setSelection(new Set());
    } else if (g.kind === 'box') {
      const [ax, ay] = g.from;
      const [bx, by] = g.to;
      const x0 = Math.min(ax, bx);
      const x1 = Math.max(ax, bx);
      const y0 = Math.min(ay, by);
      const y1 = Math.max(ay, by);
      const d = docRef.current;
      const inside = (x: number, y: number) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
      const ids = [
        ...d.parts.filter((p) => {
          const [a, b, c, dd] = partBox(p);
          return inside(a, b) && inside(c, dd);
        }),
        ...d.wires.filter((w) => inside(w.x1, w.y1) && inside(w.x2, w.y2)),
      ].map((x) => x.id);
      setSelection(new Set(ids));
    } else if (g.kind === 'press') {
      session.current?.interact(g.partId, 'release');
    }
  };

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    if (e.shiftKey) {
      setView({ ...view, x: view.x + e.deltaY / view.scale, y: view.y });
      return;
    }
    const rect = svg.current?.getBoundingClientRect();
    if (!rect) return;
    const factor = Math.exp(-e.deltaY * 0.0015);
    const scale = Math.max(0.25, Math.min(4, view.scale * factor));
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const wx = view.x + px / view.scale;
    const wy = view.y + py / view.scale;
    setView({ x: wx - px / scale, y: wy - py / scale, scale });
  };

  // Wheel needs a non-passive listener to stop the page scrolling.
  const wheelRef = useRef(onWheel);
  wheelRef.current = onWheel;
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const handler = (e: WheelEvent) => wheelRef.current(e);
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, []);

  const zoomBy = (factor: number) => {
    const scale = Math.max(0.25, Math.min(4, view.scale * factor));
    const cx = view.x + size.w / view.scale / 2;
    const cy = view.y + size.h / view.scale / 2;
    setView({ x: cx - size.w / scale / 2, y: cy - size.h / scale / 2, scale });
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (key === 'escape') {
      setDraft(null);
      setPlacing(null);
      setSelection(new Set());
    } else if (mod && key === 'z') {
      if (e.shiftKey) redo();
      else undo();
    } else if (mod && key === 'y') redo();
    else if (mod && key === 'c') copy();
    else if (mod && key === 'v') paste();
    else if (mod && key === 'd') {
      copy();
      paste();
    } else if (mod && key === 'a') setSelection(new Set([...docRef.current.parts.map((p) => p.id), ...docRef.current.wires.map((w) => w.id)]));
    else if (mod) return;
    else if (key === 'r') turn(e.shiftKey ? -1 : 1);
    else if (key === 'f') turn(0, true);
    else if (key === 'delete' || key === 'backspace') deleteSelection();
    else if (key === 'w') setTool(tool === 'wire' ? 'select' : 'wire');
    else if (key === 's' || key === 'v') setTool('select');
    else if (key === ' ') {
      if (running) setRunning(false);
      else start();
    } else if (key === '+' || key === '=') zoomBy(1.25);
    else if (key === '-') zoomBy(0.8);
    else if (key === '0') fitView();
    else if (key.startsWith('arrow') && selection.size) {
      const dx = key === 'arrowleft' ? -1 : key === 'arrowright' ? 1 : 0;
      const dy = key === 'arrowup' ? -1 : key === 'arrowdown' ? 1 : 0;
      apply(moveItems(docRef.current, selection, dx, dy), { key: 'nudge' });
    } else return;
    e.preventDefault();
  };

  /* ---- files ---- */

  const saveCircuit = () =>
    attempt(async () => {
      const name = `${(doc.title || 'circuit').replace(/[^\w\- ]+/g, '').trim() || 'circuit'}.circuit.json`;
      const outcome = await saveFile(name, `${JSON.stringify(doc, null, 2)}\n`, 'application/json');
      if (outcome.saved) notify(`Saved ${outcome.location}.`);
    });

  const openCircuit = () =>
    attempt(async () => {
      const file = await pickFile('.json,application/json');
      if (!file) return;
      let json: unknown;
      try {
        json = JSON.parse(await readTextFile(file));
      } catch {
        throw new Error(`${file.name} is not a circuit file (it is not valid JSON).`);
      }
      const parsed = parseDoc(json);
      if (!parsed) throw new Error(`${file.name} is not a Benchtop circuit file.`);
      stop();
      apply(parsed.doc);
      setSelection(new Set());
      setTimeout(() => fitView(parsed.doc), 0);
      notify(parsed.dropped ? `Opened ${file.name}; ${parsed.dropped} unknown parts or wires were left out.` : `Opened ${file.name}.`);
    });

  const exportSpice = () =>
    attempt(async () => {
      const outcome = await saveFile(`${(doc.title || 'circuit').replace(/[^\w\- ]+/g, '').trim() || 'circuit'}.cir`, toSpice(doc), 'text/plain');
      if (outcome.saved) notify(`Saved ${outcome.location}.`);
    });

  const exportPicture = () =>
    attempt(async () => {
      const el = svg.current;
      const b = bounds(doc);
      if (!el || !b) throw new Error('Add some parts first.');
      const clone = el.cloneNode(true) as SVGSVGElement;
      for (const node of clone.querySelectorAll('.cs-overlay')) node.remove();
      const [x0, y0, x1, y1] = b;
      const m = 1.5;
      clone.setAttribute('viewBox', `${(x0 - m) * GRID} ${(y0 - m - 1) * GRID} ${(x1 - x0 + 2 * m) * GRID} ${(y1 - y0 + 2 * m + 1) * GRID}`);
      clone.setAttribute('width', String((x1 - x0 + 2 * m) * GRID));
      clone.setAttribute('height', String((y1 - y0 + 2 * m + 1) * GRID));
      clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      clone.removeAttribute('class');
      const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
      style.textContent = PICTURE_STYLE;
      clone.insertBefore(style, clone.firstChild);
      const outcome = await saveFile(`${(doc.title || 'circuit').replace(/[^\w\- ]+/g, '').trim() || 'circuit'}.svg`, new XMLSerializer().serializeToString(clone), 'image/svg+xml');
      if (outcome.saved) notify(`Saved ${outcome.location}.`);
    });

  /* ---- what to draw ---- */

  const s = session.current;
  const connectivity = useMemo(() => connect(shown), [shown]);
  const voltages = new Map<string, number>();
  let vmax = 1;
  if (s && !preview) {
    for (const w of shown.wires) {
      const n = s.built.connectivity.wireNodes.get(w.id);
      if (n === undefined || n < 0) continue;
      const v = s.built.circuit.v(n);
      voltages.set(w.id, v);
      vmax = Math.max(vmax, Math.abs(v));
    }
  }
  const selectedParts = shown.parts.filter((p) => selection.has(p.id));
  const selectedWires = shown.wires.filter((w) => selection.has(w.id));
  const one = selectedParts.length === 1 && selectedWires.length === 0 ? selectedParts[0] : null;
  const oneWire = selectedWires.length === 1 && selectedParts.length === 0 ? selectedWires[0] : null;
  const boards = shown.parts.filter((p) => isBoard(p.type));
  const hasEsp = boards.some((p) => p.type === 'esp32');
  const labels = shown.labels !== false;
  const analysing = sim.panel === 'analysis';
  const showNames = shown.names === true || analysing;
  const names = useMemo(() => partNames(shown), [shown.parts]);
  const overlay = analysing && opOverlay && !preview ? operatingLabels(shown, opOverlay, connectivity) : null;

  const problems: string[] = [];
  if (!connectivity.grounded && shown.parts.some((p) => p.type === 'battery' || p.type === 'ac-source' || p.type === 'current-source'))
    problems.push('Add a ground symbol to the negative side of the supply.');
  for (const part of shown.parts) {
    const def = PART_BY_TYPE.get(part.type);
    for (const p of def?.props ?? []) {
      if (p.kind !== 'text' || !p.check) continue;
      const value = part.props[p.key];
      const why = p.check(typeof value === 'string' ? value : String(p.default));
      if (why) problems.push(`${def?.name}: ${why}`);
    }
  }
  if (hasEsp && espInfo && !espInfo.available) problems.push(espInfo.detail);
  for (const [id, message] of Object.entries(boardProblems)) problems.push(`${PART_BY_TYPE.get(shown.parts.find((p) => p.id === id)?.type ?? '')?.name ?? 'Board'}: ${message}`);
  for (const h of s?.halted() ?? []) problems.push(`ESP32: ${h.reason}`);
  for (const c of s?.clashes() ?? []) problems.push(`Two devices answer at I²C address 0x${c.address.toString(16).toUpperCase()} on the same board; change one's address.`);
  if (s)
    for (const part of shown.parts) {
      if (s.built.runtimes.get(part.id)?.view().powered === false) problems.push(`${PART_BY_TYPE.get(part.type)?.name ?? part.type} has no power: wire its supply and ground terminals.`);
    }
  if (s?.failure) problems.push(s.failure);

  // Hovered node voltage while running.
  let hover = '';
  if (s && pointer && !preview) {
    const [px, py] = pointer;
    const t = hitTerminal(shown, px, py);
    const w = t ? null : hitWire(shown, px, py);
    const n = t ? connectivity.nodeAt.get(`${t[0]},${t[1]}`) : w ? s.built.connectivity.wireNodes.get(w.id) : undefined;
    if (n !== undefined && n >= 0) hover = minus(formatSi(s.built.circuit.v(n), 'V'));
  }

  const ghost: PlacedPart | null =
    placing && pointer
      ? {
          id: 'ghost',
          type: placing.type,
          x: Math.round(pointer[0]),
          y: Math.round(pointer[1]),
          rot: placing.rot,
          ...(placing.flip ? { flip: true } : {}),
          props: defaultProps(PART_BY_TYPE.get(placing.type) as PartDef),
        }
      : null;
  const draftWires = draft ? route(draft.from, draft.to, draft.horizontalFirst ?? true, () => 'draft') : [];
  const g = drag.current;
  const box = g?.kind === 'box' ? g : null;

  const speedName = SPEEDS.find(([v]) => v === shown.speed)?.[1].toLowerCase() ?? `${shown.speed}× speed`;
  const pace = !s ? '' : s.realTime ? 'real time' : s.ratio < 0.95 * shown.speed ? `${s.ratio.toFixed(s.ratio < 0.1 ? 3 : 2)}× real time (the computer cannot keep up)` : speedName;
  const status = s ? (running ? `Running · ${formatSi(s.time, 's')} · ${pace}${s.loading ? ' · loading programs' : ''}` : `Paused at ${formatSi(s.time, 's')}`) : 'Editing';

  return (
    <section class="tool cs-tool" data-testid="tool" data-state={problems.length ? 'error' : 'done'}>
      <div class="button-row cs-toolbar">
        <label class="control control-inline">
          <span class="control-label">Examples</span>
          <select
            class="select"
            value=""
            onChange={(e) => {
              const ex = EXAMPLES.find((x) => x.id === e.currentTarget.value);
              if (ex) loadExample(ex);
              e.currentTarget.value = '';
            }}
            data-testid="cs-examples"
          >
            <option value="">Choose…</option>
            {EXAMPLE_GROUPS.map((group) => (
              <optgroup key={group} label={group}>
                {EXAMPLES.filter((x) => x.group === group).map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.title}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <button
          type="button"
          class="button button-small"
          onClick={() => {
            stop();
            apply({ version: 1, title: '', parts: [], wires: [], dt: 1e-4, speed: 1 });
            setSelection(new Set());
          }}
        >
          <Icon name="plus" size={14} /> New
        </button>
        <button type="button" class="button button-small" onClick={openCircuit}>
          <Icon name="open" size={14} /> Open
        </button>
        <button type="button" class="button button-small" onClick={saveCircuit} data-testid="cs-save">
          <Icon name="save" size={14} /> Save
        </button>
        <button type="button" class="button button-small" onClick={exportSpice} title="Save the analog parts as a SPICE netlist">
          SPICE
        </button>
        <button type="button" class="button button-small" onClick={exportPicture} title="Save the drawing as an SVG picture">
          <Icon name="image" size={14} /> Picture
        </button>
        <span class="cs-sep" />
        <button type="button" class="button button-small" onClick={undo} disabled={!history.current.past.length} title="Undo (Ctrl+Z)">
          Undo
        </button>
        <button type="button" class="button button-small" onClick={redo} disabled={!history.current.future.length} title="Redo (Ctrl+Y)">
          Redo
        </button>
        <span class="cs-sep" />
        <Segmented
          label="Tool"
          value={tool}
          onChange={(t) => {
            setTool(t);
            setPlacing(null);
          }}
          choices={[
            { value: 'select', label: 'Select' },
            { value: 'wire', label: 'Wire' },
          ]}
        />
        <button type="button" class="button button-small" onClick={() => turn(1)} disabled={!placing && !selectedParts.length} title="Rotate (R)">
          Rotate
        </button>
        <button type="button" class="button button-small" onClick={() => turn(0, true)} disabled={!placing && !selectedParts.length} title="Mirror (F)">
          Mirror
        </button>
        <button type="button" class="button button-small" onClick={deleteSelection} disabled={!selection.size} title="Delete (Del)">
          <Icon name="trash" size={14} /> Delete
        </button>
        <span class="cs-sep" />
        {running ? (
          <button type="button" class={`button ${s?.realTime ? 'button-danger' : ''}`} onClick={() => (s?.realTime ? stop() : setRunning(false))} data-testid="cs-pause">
            {s?.realTime ? 'Stop' : 'Pause'}
          </button>
        ) : (
          <button type="button" class="button button-primary" onClick={start} data-testid="cs-run">
            <Icon name="play" size={14} /> {s ? 'Resume' : 'Run'}
          </button>
        )}
        <button type="button" class="button" onClick={stop} disabled={!s} data-testid="cs-reset">
          <Icon name="refresh" size={14} /> Reset
        </button>
        <label class="control control-inline">
          <span class="control-label">Speed</span>
          <select
            class="select"
            value={String(shown.speed)}
            onChange={(e) => apply({ ...docRef.current, speed: Number(e.currentTarget.value) }, { rebuild: false })}
            disabled={hasEsp}
            title={hasEsp ? 'An ESP32 runs in real time' : undefined}
          >
            {SPEEDS.map(([v, label]) => (
              <option key={v} value={String(v)}>
                {label}
              </option>
            ))}
            {!SPEEDS.some(([v]) => v === shown.speed) && <option value={String(shown.speed)}>{shown.speed}×</option>}
          </select>
        </label>
      </div>

      <div class="cs-layout">
        <Palette
          placing={placing?.type ?? null}
          onPick={(type) => {
            setPlacing(placing?.type === type ? null : { type, rot: 0, flip: false });
            setDraft(null);
            wrap.current?.focus({ preventScroll: true });
          }}
        />

        <div class="cs-main">
          <div
            class="cs-canvas-wrap"
            ref={wrap}
            // biome-ignore lint/a11y/noNoninteractiveTabindex: the drawing takes keyboard shortcuts
            tabIndex={0}
            onKeyDown={onKeyDown}
            role="group"
            aria-label="Circuit drawing. R rotates, W draws wires, Delete removes, Space runs."
            data-testid="cs-canvas"
          >
            <svg
              ref={svg}
              class={`cs-canvas${placing ? ' is-placing' : tool === 'wire' || draft ? ' is-wiring' : ''}`}
              viewBox={`${view.x} ${view.y} ${size.w / view.scale} ${size.h / view.scale}`}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerLeave={() => setPointer(null)}
              onContextMenu={(e) => e.preventDefault()}
              onDblClick={() => setDraft(null)}
              role="application"
              aria-label="Circuit"
            >
              <defs>
                <pattern id="cs-grid" width={GRID} height={GRID} patternUnits="userSpaceOnUse">
                  <circle cx={0} cy={0} r={1} class="cs-grid-dot" />
                </pattern>
              </defs>
              <rect class="cs-overlay cs-grid" x={view.x} y={view.y} width={size.w / view.scale} height={size.h / view.scale} fill="url(#cs-grid)" />
              {shown.wires.map((w) => {
                const v = voltages.get(w.id);
                const selected = selection.has(w.id);
                return (
                  <g key={w.id}>
                    <line x1={w.x1 * GRID} y1={w.y1 * GRID} x2={w.x2 * GRID} y2={w.y2 * GRID} class={`cs-wire${selected ? ' is-selected' : ''}`} />
                    {v !== undefined && Math.abs(v) > 1e-3 && (
                      <line
                        x1={w.x1 * GRID}
                        y1={w.y1 * GRID}
                        x2={w.x2 * GRID}
                        y2={w.y2 * GRID}
                        class={v > 0 ? 'cs-wire-pos' : 'cs-wire-neg'}
                        opacity={Math.min(1, 0.25 + (0.75 * Math.abs(v)) / vmax)}
                      />
                    )}
                  </g>
                );
              })}
              {connectivity.junctions.map(([x, y]) => (
                <circle key={`j${x},${y}`} cx={x * GRID} cy={y * GRID} r={3.2} class="cs-junction" />
              ))}
              {shown.parts.map((part) => {
                const selected = selection.has(part.id);
                const [x0, y0, x1, y1] = partBox(part);
                const value = liveLabel(part, live(part.id)) || (labels ? valueLabel(part) : '');
                const name = showNames && !PART_BY_TYPE.get(part.type)?.ground ? (names.get(part.id) ?? '') : '';
                const text = [name, value].filter(Boolean).join(' ');
                const place = text ? labelPlace(part, [x0, y0, x1, y1]) : null;
                const flipScale = part.flip ? ' scale(-1 1)' : '';
                return (
                  <g key={part.id} class={`cs-part${selected ? ' is-selected' : ''}`} data-part={part.type}>
                    {selected && <rect class="cs-overlay cs-select-box" x={(x0 - 0.3) * GRID} y={(y0 - 0.3) * GRID} width={(x1 - x0 + 0.6) * GRID} height={(y1 - y0 + 0.6) * GRID} rx={4} />}
                    <g transform={`translate(${part.x * GRID} ${part.y * GRID}) rotate(${part.rot * 90})${flipScale}`}>{drawPart(part, live(part.id))}</g>
                    {text && place && (
                      <text x={place.x * GRID} y={place.y * GRID} text-anchor={place.anchor} dominant-baseline="middle" class="cs-label">
                        {text}
                      </text>
                    )}
                  </g>
                );
              })}
              {overlay && (
                <g class="cs-op" data-testid="cs-op-labels">
                  {overlay.map((l) => (
                    <text key={l.key} x={l.x * GRID} y={l.y * GRID} text-anchor={l.anchor} dominant-baseline="middle" class={l.kind === 'node' ? 'cs-op-volts' : 'cs-op-amps'}>
                      {l.text}
                    </text>
                  ))}
                </g>
              )}
              {ghost && (
                <g class="cs-overlay cs-ghost" transform={`translate(${ghost.x * GRID} ${ghost.y * GRID}) rotate(${ghost.rot * 90})${ghost.flip ? ' scale(-1 1)' : ''}`}>
                  {drawPart(ghost, null)}
                </g>
              )}
              {draftWires.map((w, i) => (
                <line key={`d${i}`} x1={w.x1 * GRID} y1={w.y1 * GRID} x2={w.x2 * GRID} y2={w.y2 * GRID} class="cs-overlay cs-draft" />
              ))}
              {draft && <circle class="cs-overlay cs-draft-end" cx={draft.to[0] * GRID} cy={draft.to[1] * GRID} r={4} />}
              {box && (
                <rect
                  class="cs-overlay cs-box"
                  x={Math.min(box.from[0], box.to[0]) * GRID}
                  y={Math.min(box.from[1], box.to[1]) * GRID}
                  width={Math.abs(box.to[0] - box.from[0]) * GRID}
                  height={Math.abs(box.to[1] - box.from[1]) * GRID}
                />
              )}
            </svg>
            <div class="cs-status" data-testid="cs-status">
              <span>{status}</span>
              {hover && <span class="cs-hover">{hover}</span>}
              {problems[0] && <span class="cs-warning">{problems[0]}</span>}
            </div>
            <div class="cs-zoom">
              <button type="button" class="button button-small" onClick={() => zoomBy(0.8)} aria-label="Zoom out">
                −
              </button>
              <button type="button" class="button button-small" onClick={() => fitView()}>
                Fit
              </button>
              <button type="button" class="button button-small" onClick={() => zoomBy(1.25)} aria-label="Zoom in">
                +
              </button>
            </div>
            {!shown.parts.length && <p class="cs-hint">Choose an example above, or pick a part on the left and click here to place it. Drag from a terminal to draw a wire.</p>}
          </div>

          <div class="cs-bottom">
            <div class="button-row">
              <Segmented
                label="Panel"
                value={sim.panel}
                onChange={(panel) => setSim((x) => ({ ...x, panel }))}
                choices={[
                  { value: 'scope', label: 'Oscilloscope' },
                  { value: 'serial', label: `Serial monitor${boards.length ? '' : ' (no boards)'}` },
                  { value: 'analysis', label: 'Analysis' },
                ]}
              />
              {sim.panel === 'scope' && (
                <label class="control control-inline">
                  <span class="control-label">Across the screen</span>
                  <select class="select" value={String(sim.scope)} onChange={(e) => setSim((x) => ({ ...x, scope: Number(e.currentTarget.value) }))}>
                    {WINDOWS.map(([v, label]) => (
                      <option key={v} value={String(v)}>
                        {label}
                      </option>
                    ))}
                    {!WINDOWS.some(([v]) => v === sim.scope) && <option value={String(sim.scope)}>{formatSi(sim.scope, 's')}</option>}
                  </select>
                </label>
              )}
            </div>
            {sim.panel === 'analysis' ? (
              <AnalysisPanel doc={shown} selected={one ?? null} onSettings={(analysis) => apply({ ...docRef.current, analysis }, { history: false, rebuild: false })} onOperatingPoint={setOpOverlay} />
            ) : sim.panel === 'scope' ? (
              <ScopeView session={s} window={sim.scope} />
            ) : (
              <SerialView
                boards={boards}
                logs={serialLogs.current}
                version={serialVersion}
                onSend={(id, text) => {
                  if (!session.current) {
                    notify('Run the circuit first.');
                    return;
                  }
                  session.current.serialSend(id, text);
                  const log = (serialLogs.current.get(id) ?? '') + `› ${text.replace(/[\r\n]+$/, '')}\n`;
                  serialLogs.current.set(id, log);
                  setSerialVersion((v) => v + 1);
                }}
                onClear={(id) => {
                  serialLogs.current.set(id, '');
                  setSerialVersion((v) => v + 1);
                }}
              />
            )}
          </div>
        </div>

        <aside class="cs-inspector" aria-label="Properties" data-testid="cs-inspector">
          {one ? (
            <>
              <h3 class="cs-inspector-title">{PART_BY_TYPE.get(one.type)?.name}</h3>
              {!PART_BY_TYPE.get(one.type)?.ground && (
                <label class="control">
                  <span class="control-label">Name</span>
                  <input
                    class="input"
                    value={one.name ?? ''}
                    placeholder={names.get(one.id)}
                    maxLength={40}
                    onInput={(e) => {
                      const name = e.currentTarget.value.trim();
                      apply(
                        {
                          ...docRef.current,
                          parts: docRef.current.parts.map((p) => {
                            if (p.id !== one.id) return p;
                            const { name: _, ...rest } = p;
                            return name ? { ...rest, name } : rest;
                          }),
                        },
                        { key: `name:${one.id}`, rebuild: false },
                      );
                    }}
                    spellcheck={false}
                    data-testid="cs-name"
                  />
                </label>
              )}
              <PartProps
                part={one}
                onProp={(key, value) =>
                  apply({ ...docRef.current, parts: docRef.current.parts.map((p) => (p.id === one.id ? { ...p, props: { ...p.props, [key]: value } } : p)) }, { key: `prop:${one.id}:${key}` })
                }
                onLive={(key, value) => {
                  const def = PART_BY_TYPE.get(one.type);
                  const prop = def?.props.find((d) => d.key === key);
                  if (session.current) {
                    const toggled = def?.toggleProp === key;
                    if (key === 'position') session.current.adjust(one.id, value as number);
                    else if (prop?.live) session.current.setLive(one.id, { ...one.props, [key]: value });
                    else if (toggled && one.props[key] !== value) session.current.interact(one.id, 'toggle');
                    interactProp(one, key, value);
                    if (key !== 'position' && !prop?.live && !toggled) session.current.update(docRef.current);
                  } else interactProp(one, key, value);
                }}
              />
              {isBoard(one.type) && (
                <BoardProgram
                  part={one}
                  doc={shown}
                  espInfo={espInfo}
                  onFirmware={(ref) => setFirmware(one.id, ref)}
                  recording={recordingPart === one.id}
                  onRecord={(seconds) => recordPins(one.id, seconds)}
                  onPython={(code) => {
                    const mcu = session.current?.mcu(one.id);
                    if (!(mcu instanceof PicoMcu) || !mcu.usbSerial) return false;
                    mcu.runPython(code);
                    return true;
                  }}
                />
              )}
              {s && (
                <dl class="cs-readings" data-testid="cs-readings">
                  {readings(one, s).map(([k, v]) => (
                    <div key={k}>
                      <dt>{k}</dt>
                      <dd>{v}</dd>
                    </div>
                  ))}
                  {isBoard(one.type) &&
                    (() => {
                      const volts = (live(one.id)?.volts as readonly number[] | undefined) ?? [];
                      const spec = BOARD_SPECS.get(one.type);
                      const base = spec?.power.length ?? 3;
                      const used = connectivity.partNodes.get(one.id) ?? [];
                      return volts.map((v, i) =>
                        (used[i + base] ?? -1) >= 0 ? (
                          <div key={`pin${i}`}>
                            <dt>{spec?.pins[i]?.name}</dt>
                            <dd>{minus(formatSi(v, 'V'))}</dd>
                          </div>
                        ) : null,
                      );
                    })()}
                </dl>
              )}
              <p class="control-help">{PART_BY_TYPE.get(one.type)?.interactive && 'While the circuit runs, click the part to use it. '}R rotates, F mirrors, Delete removes.</p>
            </>
          ) : oneWire ? (
            <>
              <h3 class="cs-inspector-title">Wire</h3>
              {s && <p>{hoverWire(oneWire, s)}</p>}
              <p class="control-help">Wires join where they end on a terminal or another wire; wires that only cross do not join. Delete removes the wire.</p>
            </>
          ) : selection.size > 1 ? (
            <>
              <h3 class="cs-inspector-title">{selection.size} items selected</h3>
              <p class="control-help">Drag to move them together; Ctrl+C and Ctrl+V copy; Delete removes.</p>
            </>
          ) : (
            <>
              <h3 class="cs-inspector-title">Circuit</h3>
              <label class="control">
                <span class="control-label">Title</span>
                <input class="input" value={shown.title} onInput={(e) => apply({ ...docRef.current, title: e.currentTarget.value }, { key: 'title', rebuild: false })} />
              </label>
              <NumberField
                def={{ key: 'dt', label: 'Time step', kind: 'number', default: 1e-4, unit: 's', min: 1e-7, max: 0.1 }}
                value={shown.dt}
                onCommit={(dt) => apply({ ...docRef.current, dt })}
              />
              <label class="check">
                <input type="checkbox" checked={labels} onChange={(e) => apply({ ...docRef.current, labels: e.currentTarget.checked }, { rebuild: false })} />
                <span>Show part values</span>
              </label>
              <label class="check">
                <input
                  type="checkbox"
                  checked={shown.names === true}
                  onChange={(e) => {
                    const { names: _, ...rest } = docRef.current;
                    apply(e.currentTarget.checked ? { ...rest, names: true } : rest, { rebuild: false });
                  }}
                />
                <span>Show part names (always shown with the analysis panel)</span>
              </label>
              <p class="control-help">
                {shown.parts.length} parts, {shown.wires.length} wires, {connectivity.nodeCount} connected points. A smaller time step is more accurate for fast signals but runs slower; the Arduino
                examples use 20 µs.
              </p>
              {problems.length > 0 && (
                <ul class="cs-problems">
                  {problems.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              )}
              <details class="cs-help">
                <summary>How to draw</summary>
                <ul>
                  <li>Pick a part on the left, then click on the drawing to place it (hold Shift to place several). R turns it, F mirrors it.</li>
                  <li>Drag from a terminal to draw a wire, or press W and drag anywhere. Click without dragging to draw a wire in steps, clicking at each corner.</li>
                  <li>Drag parts to move them; attached wires follow. Shift-drag on empty space selects an area. Drag empty space to pan; the wheel zooms.</li>
                  <li>Run the circuit with Space. While it runs, click switches and logic inputs, hold buttons down, and drag potentiometers up and down. Point at a wire to see its voltage.</li>
                </ul>
              </details>
            </>
          )}
        </aside>
      </div>
    </section>
  );
}

function hoverWire(w: WireSegment, s: Session): string {
  const n = s.built.connectivity.wireNodes.get(w.id);
  return n === undefined || n < 0 ? '' : `Voltage: ${minus(formatSi(s.built.circuit.v(n), 'V'))}`;
}

/** Colours for a saved picture, which has no access to the app's theme. */
const PICTURE_STYLE = `
svg { color: #1f2328; background: #ffffff; font-family: "JetBrains Mono", monospace; }
.cs-text { fill: #1f2328; } .cs-fill { fill: #ffffff; } .cs-strong { font-weight: 600; } .cs-muted { fill: #57606a; }
.cs-wire { stroke: #1f2328; stroke-width: 1.6; } .cs-wire-pos, .cs-wire-neg { display: none; }
.cs-junction { fill: #1f2328; } .cs-label { fill: #57606a; font-size: 10px; }
.cs-display { fill: #111; } .cs-display-text { fill: #888; } .cs-high { fill: #f6d55c; } .cs-low { fill: #ffffff; }
.cs-led-on { fill: #d1242f; } .cs-led-off { fill: #ddd; } .cs-coil-on { fill: #f6d55c; } .cs-rotor { stroke: #1f2328; }
.cs-board-uno { fill: #00878f; } .cs-board-esp { fill: #222; } .cs-header { fill: #111; } .cs-board-text { fill: #fff; }
.cs-board-title { fill: #fff; font-weight: 600; } .cs-chip { fill: #333; } .cs-glow { display: none; }
`;

export default defineCustomTool(CircuitSimulator);
