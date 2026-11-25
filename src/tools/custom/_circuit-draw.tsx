/**
 * Drawings of the circuit simulator's parts, in grid units of GRID pixels
 * with the part's origin at (0, 0) before rotation.  Live readings change
 * what is drawn: LED glow, switch positions, logic levels, displays.
 */
import type { ComponentChildren } from 'preact';
import { BOARD_SPECS } from '../../lib/circuit/boards';
import { LED_COLOURS, SEGMENTS } from '../../lib/circuit/elements';
import type { PlacedPart } from '../../lib/circuit/netlist';
import { PART_BY_TYPE } from '../../lib/circuit/parts';
import { drawAnalog } from './_circuit-analog';
import { drawBoard, drawModule } from './_circuit-modules';
import { box, flag, GRID, g, L, type Live, num, P, path, pins, T } from './_circuit-svg';

export { GRID };

function resistor(x0: number, x1: number) {
  const points: [number, number][] = [[x0, 0]];
  const n = 8;
  for (let i = 1; i < n; i++) points.push([x0 + ((x1 - x0) * i) / n, i % 2 ? -0.3 : 0.3]);
  points.push([x1, 0]);
  return <P d={path(points)} />;
}

function diodeBody(zener: boolean) {
  return (
    <>
      <L x1={0} y1={0} x2={1.1} y2={0} />
      <L x1={1.9} y1={0} x2={3} y2={0} />
      <P
        d={path([
          [1.1, -0.55],
          [1.9, 0],
          [1.1, 0.55],
          [1.1, -0.55],
        ])}
        fill="currentColor"
      />
      {zener ? (
        <P
          d={path([
            [1.7, -0.7],
            [1.9, -0.55],
            [1.9, 0.55],
            [2.1, 0.7],
          ])}
        />
      ) : (
        <L x1={1.9} y1={-0.55} x2={1.9} y2={0.55} />
      )}
    </>
  );
}

function gateBody(type: string) {
  const bubble = ['nand', 'nor', 'xnor', 'not'].includes(type);
  const single = type === 'not' || type === 'buffer';
  let body: ComponentChildren;
  if (single)
    body = (
      <P
        d={path([
          [1, -1],
          [2.8, 0],
          [1, 1],
          [1, -1],
        ])}
        cls="cs-fill"
      />
    );
  else if (type === 'and' || type === 'nand') body = <P d={`M${g(1)} ${g(-1.4)} H${g(1.8)} A${g(1.4)} ${g(1.4)} 0 0 1 ${g(1.8)} ${g(1.4)} H${g(1)} Z`} cls="cs-fill" />;
  else {
    body = (
      <>
        <P d={`M${g(0.9)} ${g(-1.4)} Q${g(1.5)} 0 ${g(0.9)} ${g(1.4)} Q${g(2.4)} ${g(1.4)} ${g(3.2)} 0 Q${g(2.4)} ${g(-1.4)} ${g(0.9)} ${g(-1.4)} Z`} cls="cs-fill" />
        {(type === 'xor' || type === 'xnor') && <P d={`M${g(0.6)} ${g(-1.4)} Q${g(1.2)} 0 ${g(0.6)} ${g(1.4)}`} />}
      </>
    );
  }
  const end = single ? 2.8 : 3.2;
  return (
    <>
      {single ? (
        <L x1={0} y1={0} x2={1} y2={0} />
      ) : (
        <>
          <L x1={0} y1={-1} x2={1.2} y2={-1} />
          <L x1={0} y1={1} x2={1.2} y2={1} />
        </>
      )}
      {body}
      {bubble && <circle cx={g(end + 0.2)} cy={0} r={g(0.2)} fill="var(--panel)" stroke="currentColor" stroke-width={1.6} />}
      <L x1={bubble ? end + 0.4 : end} y1={0} x2={4} y2={0} />
    </>
  );
}

function segmentPaths(x: number, y: number, w: number, h: number): string[] {
  const t = 0.18;
  const half = h / 2;
  const hs = (yy: number) => `M${g(x + t)} ${g(yy)} H${g(x + w - t)}`;
  const vs = (xx: number, y0: number, y1: number) => `M${g(xx)} ${g(y0 + t)} V${g(y1 - t)}`;
  return [hs(y), vs(x + w, y, y + half), vs(x + w, y + half, y + h), hs(y + h), vs(x, y + half, y + h), vs(x, y, y + half), hs(y + half)];
}

export function drawPart(part: PlacedPart, live: Live): ComponentChildren {
  const p = part.props;
  switch (part.type) {
    case 'resistor':
      return (
        <>
          <L x1={0} y1={0} x2={0.75} y2={0} />
          {resistor(0.75, 2.25)}
          <L x1={2.25} y1={0} x2={3} y2={0} />
        </>
      );
    case 'capacitor':
      return (
        <>
          <L x1={0} y1={0} x2={1.3} y2={0} />
          <L x1={1.3} y1={-0.65} x2={1.3} y2={0.65} w={2.2} />
          <L x1={1.7} y1={-0.65} x2={1.7} y2={0.65} w={2.2} />
          <L x1={1.7} y1={0} x2={3} y2={0} />
        </>
      );
    case 'inductor':
      return (
        <>
          <L x1={0} y1={0} x2={0.6} y2={0} />
          <P
            d={`M${g(0.6)} 0 a${g(0.225)} ${g(0.3)} 0 0 1 ${g(0.45)} 0 a${g(0.225)} ${g(0.3)} 0 0 1 ${g(0.45)} 0 a${g(0.225)} ${g(0.3)} 0 0 1 ${g(0.45)} 0 a${g(0.225)} ${g(0.3)} 0 0 1 ${g(0.45)} 0`}
          />
          <L x1={2.4} y1={0} x2={3} y2={0} />
        </>
      );
    case 'potentiometer': {
      const pos = live ? num(live, 'position') : typeof p.position === 'number' ? p.position : 0.5;
      const wx = 1 + 2 * Math.min(1, Math.max(0, pos));
      return (
        <>
          <L x1={0} y1={0} x2={1} y2={0} />
          {resistor(1, 3)}
          <L x1={3} y1={0} x2={4} y2={0} />
          <P
            d={path([
              [2, -1],
              [2, -0.75],
              [wx, -0.75],
              [wx, -0.4],
            ])}
          />
          <P
            d={path([
              [wx - 0.18, -0.6],
              [wx, -0.36],
              [wx + 0.18, -0.6],
            ])}
          />
        </>
      );
    }
    case 'switch': {
      const closed = live ? flag(live, 'closed') : p.closed === true;
      return (
        <>
          <L x1={0} y1={0} x2={0.9} y2={0} />
          <L x1={2.1} y1={0} x2={3} y2={0} />
          <circle cx={g(0.9)} cy={0} r={2.5} fill="currentColor" />
          <circle cx={g(2.1)} cy={0} r={2.5} fill="currentColor" />
          <L x1={0.9} y1={0} x2={closed ? 2.15 : 1.95} y2={closed ? -0.18 : -0.75} w={2} />
        </>
      );
    }
    case 'pushbutton': {
      const closed = flag(live, 'closed');
      const y = closed ? -0.1 : -0.5;
      return (
        <>
          <L x1={0} y1={0} x2={0.9} y2={0} />
          <L x1={2.1} y1={0} x2={3} y2={0} />
          <circle cx={g(0.9)} cy={0} r={2.5} fill="currentColor" />
          <circle cx={g(2.1)} cy={0} r={2.5} fill="currentColor" />
          <L x1={0.8} y1={y} x2={2.2} y2={y} w={2} />
          <L x1={1.5} y1={y} x2={1.5} y2={y - 0.6} />
          <L x1={1.2} y1={y - 0.6} x2={1.8} y2={y - 0.6} />
        </>
      );
    }
    case 'spdt': {
      const toB = live ? flag(live, 'toB') : p.toB === true;
      return (
        <>
          <L x1={0} y1={0} x2={0.9} y2={0} />
          <L x1={2.1} y1={-1} x2={3} y2={-1} />
          <L x1={2.1} y1={1} x2={3} y2={1} />
          <circle cx={g(0.9)} cy={0} r={2.5} fill="currentColor" />
          <circle cx={g(2.1)} cy={g(-1)} r={2.5} fill="currentColor" />
          <circle cx={g(2.1)} cy={g(1)} r={2.5} fill="currentColor" />
          <L x1={0.9} y1={0} x2={2.05} y2={toB ? 0.9 : -0.9} w={2} />
          <T x={2.6} y={-1.45} size={8}>
            A
          </T>
          <T x={2.6} y={1.5} size={8}>
            B
          </T>
        </>
      );
    }
    case 'relay': {
      const on = flag(live, 'on');
      return (
        <>
          <L x1={0} y1={0} x2={0} y2={1.2} />
          <rect x={g(-0.45)} y={g(1.2)} width={g(0.9)} height={g(1.6)} stroke="currentColor" stroke-width={1.6} class={on ? 'cs-coil-on' : 'cs-fill'} />
          <L x1={0} y1={2.8} x2={0} y2={4} />
          <L x1={3} y1={4} x2={3} y2={3.1} />
          <L x1={2} y1={0} x2={2} y2={1.1} />
          <L x1={4} y1={0} x2={4} y2={1.1} />
          <L x1={3} y1={3.1} x2={on ? 3.9 : 2.1} y2={1.25} w={2} />
          <line x1={g(0.5)} y1={g(2)} x2={g(on ? 3.4 : 2.6)} y2={g(2)} stroke="currentColor" stroke-width={1} stroke-dasharray="3 3" />
          <T x={2} y={-0.5} size={8}>
            NC
          </T>
          <T x={4} y={-0.5} size={8}>
            NO
          </T>
        </>
      );
    }
    case 'battery':
      return (
        <>
          <L x1={0} y1={0} x2={0} y2={1.3} />
          <L x1={-0.65} y1={1.3} x2={0.65} y2={1.3} w={2.2} />
          <L x1={-0.32} y1={1.7} x2={0.32} y2={1.7} w={3.2} />
          <L x1={0} y1={1.7} x2={0} y2={3} />
          <T x={0.65} y={0.9} size={11}>
            +
          </T>
        </>
      );
    case 'ac-source': {
      const shape = typeof p.shape === 'string' ? p.shape : 'sine';
      const glyph =
        shape === 'square' || shape === 'pulse'
          ? path([
              [-0.45, 1.75],
              [-0.45, 1.25],
              [0, 1.25],
              [0, 1.75],
              [0.45, 1.75],
              [0.45, 1.25],
            ])
          : shape === 'triangle'
            ? path([
                [-0.5, 1.5],
                [-0.25, 1.2],
                [0.25, 1.8],
                [0.5, 1.5],
              ])
            : shape === 'sawtooth'
              ? path([
                  [-0.5, 1.75],
                  [0, 1.25],
                  [0, 1.75],
                  [0.5, 1.25],
                ])
              : `M${g(-0.5)} ${g(1.5)} q${g(0.25)} ${g(-0.6)} ${g(0.5)} 0 t${g(0.5)} 0`;
      return (
        <>
          <L x1={0} y1={0} x2={0} y2={0.7} />
          <circle cx={0} cy={g(1.5)} r={g(0.8)} stroke="currentColor" stroke-width={1.6} class="cs-fill" />
          <P d={glyph} />
          <L x1={0} y1={2.3} x2={0} y2={3} />
          <T x={0.6} y={0.5} size={10}>
            +
          </T>
        </>
      );
    }
    case 'current-source':
      return (
        <>
          <L x1={0} y1={0} x2={0} y2={0.7} />
          <circle cx={0} cy={g(1.5)} r={g(0.8)} stroke="currentColor" stroke-width={1.6} class="cs-fill" />
          <L x1={0} y1={2} x2={0} y2={1.05} />
          <P
            d={path([
              [-0.25, 1.35],
              [0, 1.0],
              [0.25, 1.35],
            ])}
          />
          <L x1={0} y1={2.3} x2={0} y2={3} />
        </>
      );
    case 'rail':
      return (
        <>
          <L x1={0} y1={0} x2={0} y2={-0.8} />
          <L x1={-0.6} y1={-0.8} x2={0.6} y2={-0.8} w={2.2} />
        </>
      );
    case 'ground':
      return (
        <>
          <L x1={0} y1={0} x2={0} y2={0.4} />
          <L x1={-0.6} y1={0.4} x2={0.6} y2={0.4} />
          <L x1={-0.38} y1={0.7} x2={0.38} y2={0.7} />
          <L x1={-0.16} y1={1} x2={0.16} y2={1} />
        </>
      );
    case 'diode':
      return diodeBody(false);
    case 'zener':
      return diodeBody(true);
    case 'led': {
      const colour = typeof p.colour === 'string' ? p.colour : 'red';
      const hex = LED_COLOURS[colour]?.hex ?? '#ff2a2a';
      const glow = Math.min(1, Math.max(0, num(live, 'current') / 0.015));
      return (
        <>
          {glow > 0.02 && (
            <>
              <circle cx={g(1.5)} cy={0} r={g(0.95 + glow * 0.55)} fill={hex} opacity={0.16 * glow + 0.04} class="cs-glow" />
              <circle cx={g(1.5)} cy={0} r={g(0.72)} fill={hex} opacity={0.2 + 0.4 * glow} class="cs-glow" />
            </>
          )}
          {diodeBody(false)}
          <P
            d={path([
              [1.7, -0.75],
              [2.2, -1.25],
            ])}
            w={1.2}
          />
          <P
            d={path([
              [1.95, -1.25],
              [2.2, -1.25],
              [2.2, -1.0],
            ])}
            w={1.2}
          />
          <P
            d={path([
              [1.2, -0.85],
              [1.7, -1.35],
            ])}
            w={1.2}
          />
          <P
            d={path([
              [1.45, -1.35],
              [1.7, -1.35],
              [1.7, -1.1],
            ])}
            w={1.2}
          />
          <circle cx={g(1.5)} cy={g(0.75)} r={3} fill={hex} stroke="currentColor" stroke-width={0.8} />
        </>
      );
    }
    case 'npn':
    case 'pnp': {
      const npn = part.type === 'npn';
      return (
        <>
          <circle cx={g(1.35)} cy={0} r={g(1.15)} stroke="currentColor" stroke-width={1.2} class="cs-fill" />
          <L x1={0} y1={0} x2={0.9} y2={0} />
          <L x1={0.9} y1={-0.7} x2={0.9} y2={0.7} w={2.4} />
          <P
            d={path([
              [0.9, -0.35],
              [2, -1.1],
              [2, -2],
            ])}
          />
          <P
            d={path([
              [0.9, 0.35],
              [2, 1.1],
              [2, 2],
            ])}
          />
          {npn ? (
            <P
              d={path([
                [1.55, 0.6],
                [1.9, 1.03],
                [1.4, 1.03],
              ])}
              fill="currentColor"
            />
          ) : (
            <P
              d={path([
                [1.35, 0.4],
                [1.0, 0.45],
                [1.25, 0.82],
              ])}
              fill="currentColor"
            />
          )}
        </>
      );
    }
    case 'nmos':
    case 'pmos': {
      const n = part.type === 'nmos';
      return (
        <>
          <L x1={0} y1={0} x2={0.7} y2={0} />
          <L x1={0.7} y1={-0.8} x2={0.7} y2={0.8} w={2} />
          <L x1={1.0} y1={-0.9} x2={1.0} y2={-0.35} w={2.2} />
          <L x1={1.0} y1={-0.25} x2={1.0} y2={0.25} w={2.2} />
          <L x1={1.0} y1={0.35} x2={1.0} y2={0.9} w={2.2} />
          <P
            d={path([
              [1, -0.6],
              [2, -0.6],
              [2, -2],
            ])}
          />
          <P
            d={path([
              [1, 0.6],
              [2, 0.6],
              [2, 2],
            ])}
          />
          <P
            d={path([
              [1, 0],
              [2, 0],
              [2, 0.6],
            ])}
          />
          {n ? (
            <P
              d={path([
                [1.45, -0.2],
                [1.1, 0],
                [1.45, 0.2],
              ])}
              fill="currentColor"
            />
          ) : (
            <P
              d={path([
                [1.4, -0.2],
                [1.75, 0],
                [1.4, 0.2],
              ])}
              fill="currentColor"
            />
          )}
        </>
      );
    }
    case 'opamp':
      return (
        <>
          <L x1={0} y1={-1} x2={1} y2={-1} />
          <L x1={0} y1={1} x2={1} y2={1} />
          <P
            d={path([
              [1, -2],
              [3.6, 0],
              [1, 2],
              [1, -2],
            ])}
            cls="cs-fill"
          />
          <L x1={3.6} y1={0} x2={4} y2={0} />
          <T x={1.35} y={-1} size={13}>
            −
          </T>
          <T x={1.35} y={1} size={12}>
            +
          </T>
        </>
      );
    case 'timer555':
      return (
        <>
          {box(1, 0, 5, 6)}
          {pins(part, 1, 6)}
          <T x={3} y={3} size={13} cls="cs-text cs-strong">
            555
          </T>
        </>
      );
    case 'and':
    case 'or':
    case 'not':
    case 'nand':
    case 'nor':
    case 'xor':
    case 'xnor':
    case 'buffer':
      return gateBody(part.type);
    case 'd-flipflop':
    case 'jk-flipflop':
    case 't-flipflop':
    case 'sr-flipflop': {
      const def = PART_BY_TYPE.get(part.type);
      const clk = def?.terminals.find((t) => t.name === 'CLK');
      return (
        <>
          {box(1, 0, 4, 4)}
          {pins(part, 1, 5)}
          {clk && (
            <P
              d={path([
                [1, clk.y - 0.3],
                [1.35, clk.y],
                [1, clk.y + 0.3],
              ])}
            />
          )}
          <T x={2.5} y={4.55} size={8} cls="cs-text cs-muted">
            {def?.name.replace(' flip-flop', '').replace(' latch', '')}
          </T>
          {live && <circle cx={g(3.6)} cy={g(1)} r={3} class={flag(live, 'q') ? 'cs-led-on' : 'cs-led-off'} />}
        </>
      );
    }
    case 'counter':
      return (
        <>
          {box(1, 0, 4, 5)}
          {pins(part, 1, 5)}
          <T x={2.5} y={4.4} size={11} cls="cs-text cs-strong">
            {live ? String(num(live, 'count')) : 'CTR'}
          </T>
        </>
      );
    case 'decoder':
      return (
        <>
          {box(1, 0, 4, 8)}
          {pins(part, 1, 5)}
          <T x={2.5} y={7.5} size={8} cls="cs-text cs-muted">
            BCD→7
          </T>
        </>
      );
    case 'seven-segment': {
      const colour = typeof p.colour === 'string' ? p.colour : 'red';
      const hex = LED_COLOURS[colour]?.hex ?? '#ff2a2a';
      const lit = (live?.segments as readonly number[] | undefined) ?? [];
      const segs = segmentPaths(2, 1.5, 2.2, 5);
      return (
        <>
          {box(1, 0, 5, 9, 'cs-display')}
          {['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((name, i) => (
            <g key={name}>
              <L x1={0} y1={1 + i} x2={1} y2={1 + i} />
            </g>
          ))}
          <L x1={0} y1={8} x2={1} y2={8} />
          {segs.map((d, i) => {
            const on = Math.min(1, Math.max(0, ((lit[i] as number | undefined) ?? 0) / 0.01));
            return <path key={d} d={d} stroke={on > 0.05 ? hex : '#3a2a2a'} stroke-opacity={on > 0.05 ? 0.35 + 0.65 * on : 1} stroke-width={4} stroke-linecap="round" fill="none" />;
          })}
          <T x={3} y={8} size={7} cls="cs-text cs-display-text">
            {p.anode === true ? 'COM +' : 'COM −'}
          </T>
        </>
      );
    }
    case 'logic-input': {
      const high = live ? flag(live, 'high') : p.high === true;
      return (
        <>
          <rect x={0} y={g(-0.8)} width={g(2)} height={g(1.6)} rx={4} stroke="currentColor" stroke-width={1.6} class={high ? 'cs-high' : 'cs-low'} />
          <T x={1} y={0.05} size={12} cls="cs-text cs-strong">
            {high ? '1' : '0'}
          </T>
          <L x1={2} y1={0} x2={3} y2={0} />
        </>
      );
    }
    case 'logic-probe': {
      const high = flag(live, 'high');
      return (
        <>
          <L x1={0} y1={0} x2={1.1} y2={0} />
          <circle cx={g(1.9)} cy={0} r={g(0.75)} stroke="currentColor" stroke-width={1.6} class={live ? (high ? 'cs-high' : 'cs-low') : 'cs-fill'} />
          <T x={1.9} y={0.05} size={10} cls="cs-text cs-strong">
            {live ? (high ? 'H' : 'L') : '?'}
          </T>
        </>
      );
    }
    case 'clock': {
      const high = flag(live, 'high');
      return (
        <>
          <rect x={0} y={g(-0.8)} width={g(2)} height={g(1.6)} rx={4} stroke="currentColor" stroke-width={1.6} class={high ? 'cs-high' : 'cs-fill'} />
          <P
            d={path([
              [0.3, 0.4],
              [0.3, -0.4],
              [1, -0.4],
              [1, 0.4],
              [1.7, 0.4],
              [1.7, -0.4],
            ])}
            w={1.3}
          />
          <L x1={2} y1={0} x2={3} y2={0} />
        </>
      );
    }
    case 'lamp': {
      const glow = Math.min(1, Math.max(0, num(live, 'glow')));
      return (
        <>
          <L x1={0} y1={0} x2={0.75} y2={0} />
          {glow > 0.02 && <circle cx={g(1.5)} cy={0} r={g(0.75 + glow * 0.5)} fill="#ffd34d" opacity={0.3 + 0.6 * glow} class="cs-glow" />}
          <circle cx={g(1.5)} cy={0} r={g(0.75)} stroke="currentColor" stroke-width={1.6} class="cs-fill" fill-opacity={0.6} />
          <L x1={0.97} y1={-0.53} x2={2.03} y2={0.53} />
          <L x1={0.97} y1={0.53} x2={2.03} y2={-0.53} />
          <L x1={2.25} y1={0} x2={3} y2={0} />
        </>
      );
    }
    case 'motor': {
      const angle = num(live, 'angle');
      return (
        <>
          <L x1={0} y1={0} x2={0.75} y2={0} />
          <circle cx={g(1.5)} cy={0} r={g(0.75)} stroke="currentColor" stroke-width={1.6} class="cs-fill" />
          <T x={1.5} y={0.05} size={11} cls="cs-text cs-strong">
            M
          </T>
          {live && <line x1={g(1.5)} y1={0} x2={g(1.5) + g(0.6) * Math.cos((angle * Math.PI) / 180)} y2={g(0.6) * Math.sin((angle * Math.PI) / 180)} class="cs-rotor" stroke-width={2} />}
          <L x1={2.25} y1={0} x2={3} y2={0} />
        </>
      );
    }
    case 'buzzer': {
      const on = num(live, 'level') > 0.5;
      return (
        <>
          <L x1={0} y1={0} x2={1} y2={0} />
          <rect x={g(1)} y={g(-0.6)} width={g(1)} height={g(1.2)} rx={3} stroke="currentColor" stroke-width={1.6} class={on ? 'cs-high' : 'cs-fill'} />
          {on && <P d={`M${g(2.2)} ${g(-0.5)} q${g(0.3)} ${g(0.5)} 0 ${g(1)} M${g(2.45)} ${g(-0.7)} q${g(0.4)} ${g(0.7)} 0 ${g(1.4)}`} w={1.2} />}
          <L x1={2} y1={0} x2={3} y2={0} />
        </>
      );
    }
    case 'voltmeter':
    case 'ammeter':
      return (
        <>
          <L x1={0} y1={0} x2={0.75} y2={0} />
          <circle cx={g(1.5)} cy={0} r={g(0.75)} stroke="currentColor" stroke-width={1.6} class="cs-fill" />
          <T x={1.5} y={0.05} size={11} cls="cs-text cs-strong">
            {part.type === 'voltmeter' ? 'V' : 'A'}
          </T>
          <L x1={2.25} y1={0} x2={3} y2={0} />
        </>
      );
    case 'probe': {
      const trace = typeof p.trace === 'string' ? p.trace : '1';
      return (
        <>
          <L x1={0} y1={0} x2={0.5} y2={-0.5} />
          <P
            d={path([
              [0.5, -0.5],
              [0.5, -1.5],
              [1.5, -1.2],
              [0.5, -0.9],
            ])}
            fill={TRACE_COLOURS[Number(trace) - 1] ?? '#0072b2'}
            w={1.2}
          />
          <T x={1.05} y={-1.85} size={8} cls="cs-text cs-muted">
            {trace}
          </T>
        </>
      );
    }
    default:
      if (BOARD_SPECS.has(part.type)) return drawBoard(part, live);
      return drawAnalog(part, live) ?? drawModule(part, live) ?? box(0, -1, 3, 1);
  }
}

export const TRACE_COLOURS = ['#0072b2', '#e69f00', '#009e73', '#cc79a7'];
export { SEGMENTS };
