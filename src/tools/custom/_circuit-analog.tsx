/**
 * Drawings of the analysis parts: controlled sources, the transfer-function
 * block, transformer, JFETs, comparator and regulator.
 */
import type { ComponentChildren } from 'preact';
import type { PlacedPart } from '../../lib/circuit/netlist';
import { box, flag, g, L, type Live, P, path, T } from './_circuit-svg';

/** A diamond source on the right between out+ (0) and out− (4), with + and − or an arrow inside. */
function diamond(current: boolean): ComponentChildren {
  return (
    <>
      <L x1={4} y1={0} x2={4} y2={1.1} />
      <L x1={4} y1={2.9} x2={4} y2={4} />
      <P
        d={path([
          [4, 1.1],
          [4.9, 2],
          [4, 2.9],
          [3.1, 2],
          [4, 1.1],
        ])}
        cls="cs-fill"
      />
      {current ? (
        <>
          <L x1={4} y1={2.5} x2={4} y2={1.5} w={1.4} />
          <P
            d={path([
              [3.75, 1.8],
              [4, 1.45],
              [4.25, 1.8],
            ])}
            w={1.4}
          />
        </>
      ) : (
        <>
          <T x={4} y={1.62} size={10}>
            +
          </T>
          <T x={4} y={2.4} size={11}>
            −
          </T>
        </>
      )}
    </>
  );
}

/** The controlling side: a voltage pair (+ and − marks) or a sensing wire with an arrow. */
function control(current: boolean): ComponentChildren {
  if (current)
    return (
      <>
        <L x1={0} y1={0} x2={0} y2={4} />
        <P
          d={path([
            [-0.3, 1.7],
            [0, 2.2],
            [0.3, 1.7],
          ])}
          w={1.4}
        />
        <T x={0.55} y={2} size={9} anchor="start" cls="cs-text cs-muted">
          i
        </T>
      </>
    );
  return (
    <>
      <L x1={0} y1={0} x2={1} y2={0} />
      <L x1={0} y1={4} x2={1} y2={4} />
      <T x={1.35} y={0.55} size={10}>
        +
      </T>
      <T x={1.35} y={3.4} size={11}>
        −
      </T>
    </>
  );
}

function controlled(kind: 'vcvs' | 'vccs' | 'ccvs' | 'cccs'): ComponentChildren {
  const currentOut = kind === 'vccs' || kind === 'cccs';
  const currentIn = kind === 'ccvs' || kind === 'cccs';
  const label = { vcvs: 'E', vccs: 'G', ccvs: 'H', cccs: 'F' }[kind];
  return (
    <>
      {control(currentIn)}
      <line x1={g(currentIn ? 0.6 : 1.6)} y1={g(2)} x2={g(3)} y2={g(2)} stroke="currentColor" stroke-width={1} stroke-dasharray="3 3" />
      {diamond(currentOut)}
      <T x={2.2} y={1.2} size={9} cls="cs-text cs-muted">
        {label}
      </T>
    </>
  );
}

function coil(x: number, mirror: boolean): ComponentChildren {
  // Four bumps from y = 0.6 to 3.4, bulging toward the core.
  const r = 0.35;
  const sweep = mirror ? 0 : 1;
  let d = `M${g(x)} ${g(0.6)}`;
  for (let i = 0; i < 4; i++) d += ` a${g(r)} ${g(r)} 0 0 ${sweep} 0 ${g(0.7)}`;
  return <P d={d} />;
}

export function drawAnalog(part: PlacedPart, live: Live): ComponentChildren | null {
  switch (part.type) {
    case 'vcvs':
    case 'vccs':
    case 'ccvs':
    case 'cccs':
      return controlled(part.type);
    case 'laplace': {
      const h = typeof part.props.h === 'string' ? part.props.h : '';
      const shown = h.length > 16 ? `${h.slice(0, 15)}…` : h;
      return (
        <>
          <L x1={0} y1={0} x2={0.6} y2={0} />
          {box(0.6, -1.5, 5.4, 1.5)}
          <L x1={5.4} y1={0} x2={6} y2={0} />
          <T x={3} y={-0.5} size={11} cls="cs-text cs-strong">
            H(s)
          </T>
          <T x={3} y={0.6} size={8} cls="cs-text cs-muted">
            {shown}
          </T>
        </>
      );
    }
    case 'transformer':
      return (
        <>
          <L x1={0} y1={0} x2={1.2} y2={0} />
          <L x1={1.2} y1={0} x2={1.2} y2={0.6} />
          {coil(1.2, false)}
          <L x1={1.2} y1={3.4} x2={1.2} y2={4} />
          <L x1={0} y1={4} x2={1.2} y2={4} />
          <L x1={4} y1={0} x2={2.8} y2={0} />
          <L x1={2.8} y1={0} x2={2.8} y2={0.6} />
          {coil(2.8, true)}
          <L x1={2.8} y1={3.4} x2={2.8} y2={4} />
          <L x1={4} y1={4} x2={2.8} y2={4} />
          <L x1={1.88} y1={0.5} x2={1.88} y2={3.5} w={1.4} />
          <L x1={2.12} y1={0.5} x2={2.12} y2={3.5} w={1.4} />
          <circle cx={g(0.75)} cy={g(0.55)} r={2.2} fill="currentColor" />
          <circle cx={g(3.25)} cy={g(0.55)} r={2.2} fill="currentColor" />
        </>
      );
    case 'njfet':
    case 'pjfet': {
      const n = part.type === 'njfet';
      return (
        <>
          <circle cx={g(1.35)} cy={0} r={g(1.15)} stroke="currentColor" stroke-width={1.2} class="cs-fill" />
          <L x1={0} y1={0} x2={1} y2={0} />
          <L x1={1} y1={-0.8} x2={1} y2={0.8} w={2.4} />
          <P
            d={path([
              [1, -0.55],
              [2, -0.55],
              [2, -2],
            ])}
          />
          <P
            d={path([
              [1, 0.55],
              [2, 0.55],
              [2, 2],
            ])}
          />
          {n ? (
            <P
              d={path([
                [0.5, -0.22],
                [0.85, 0],
                [0.5, 0.22],
              ])}
              fill="currentColor"
            />
          ) : (
            <P
              d={path([
                [0.85, -0.22],
                [0.5, 0],
                [0.85, 0.22],
              ])}
              fill="currentColor"
            />
          )}
        </>
      );
    }
    case 'comparator': {
      const high = flag(live, 'high');
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
          <P
            d={path([
              [1.75, 0.35],
              [2.15, 0.35],
              [2.15, -0.35],
              [2.55, -0.35],
            ])}
            w={1.2}
          />
          {live && <circle cx={g(3.05)} cy={g(0.85)} r={2.6} class={high ? 'cs-high' : 'cs-low'} stroke="currentColor" stroke-width={0.8} />}
        </>
      );
    }
    case 'regulator': {
      const v = typeof part.props.v === 'number' ? part.props.v : 5;
      return (
        <>
          {box(0.6, 0, 5.4, 2.4)}
          <L x1={0} y1={1} x2={0.6} y2={1} />
          <L x1={5.4} y1={1} x2={6} y2={1} />
          <L x1={3} y1={2.4} x2={3} y2={3} />
          <T x={3} y={0.7} size={10} cls="cs-text cs-strong">
            {Number.isInteger(v) && v >= 1 && v <= 24 ? `78${String(v).padStart(2, '0')}` : 'REG'}
          </T>
          <T x={1.15} y={1.7} size={7} anchor="start" cls="cs-text cs-muted">
            IN
          </T>
          <T x={4.85} y={1.7} size={7} anchor="end" cls="cs-text cs-muted">
            OUT
          </T>
          <T x={3} y={2} size={7} cls="cs-text cs-muted">
            GND
          </T>
        </>
      );
    }
    default:
      return null;
  }
}
