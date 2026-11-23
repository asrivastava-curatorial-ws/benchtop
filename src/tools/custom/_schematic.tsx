/**
 * Small schematic symbols drawn with SVG lines, for circuits the tools
 * suggest (filter stages, LC ladders, matching networks).  Everything uses
 * currentColor so it follows the theme.
 */
import type { ComponentChildren } from 'preact';

export const Wire = ({ d }: { d: string }) => <path d={d} fill="none" stroke="currentColor" stroke-width={1.4} stroke-linejoin="round" />;

export const Dot = ({ x, y }: { x: number; y: number }) => <circle cx={x} cy={y} r={2.6} fill="currentColor" />;

export function Label({ x, y, children, anchor = 'middle', muted = false }: { x: number; y: number; children: ComponentChildren; anchor?: 'start' | 'middle' | 'end'; muted?: boolean }) {
  return (
    <text x={x} y={y} text-anchor={anchor} class={muted ? 'sch-muted' : 'sch-label'}>
      {children}
    </text>
  );
}

interface PartProps {
  readonly x: number;
  readonly y: number;
  readonly vertical?: boolean;
  readonly name: string;
  readonly value?: string;
  /** Vertical parts: labels on the left instead of the right.  Horizontal parts: both labels above. */
  readonly flip?: boolean;
}

/** Name and value beside a vertical part, or above and below (or both above) a horizontal one. */
function PartLabels({ x, y, vertical, name, value, flip, gap }: PartProps & { gap: number }) {
  if (vertical) {
    const lx = flip ? x - gap : x + gap;
    const anchor = flip ? 'end' : 'start';
    return (
      <>
        <Label x={lx} y={y + 18} anchor={anchor}>
          {name}
        </Label>
        {value && (
          <Label x={lx} y={y + 31} anchor={anchor} muted>
            {value}
          </Label>
        )}
      </>
    );
  }
  return (
    <>
      <Label x={x + 20} y={flip ? y - 22 : y - 11}>
        {name}
      </Label>
      {value && (
        <Label x={x + 20} y={flip ? y - 10 : y + 19} muted>
          {value}
        </Label>
      )}
    </>
  );
}

/** A resistor (IEC box) between two points on a horizontal or vertical line, 40 units long. */
export function Resistor(props: PartProps) {
  const { x, y, vertical } = props;
  return (
    <g>
      {vertical ? (
        <>
          <Wire d={`M${x} ${y}v10M${x} ${y + 30}v10`} />
          <rect x={x - 5} y={y + 10} width={10} height={20} fill="none" stroke="currentColor" stroke-width={1.4} />
        </>
      ) : (
        <>
          <Wire d={`M${x} ${y}h10M${x + 30} ${y}h10`} />
          <rect x={x + 10} y={y - 5} width={20} height={10} fill="none" stroke="currentColor" stroke-width={1.4} />
        </>
      )}
      <PartLabels {...props} gap={10} />
    </g>
  );
}

/** A capacitor, 40 units long. */
export function Capacitor(props: PartProps) {
  const { x, y, vertical } = props;
  return (
    <g>
      <Wire d={vertical ? `M${x} ${y}v17M${x - 9} ${y + 17}h18M${x - 9} ${y + 23}h18M${x} ${y + 23}v17` : `M${x} ${y}h17M${x + 17} ${y - 9}v18M${x + 23} ${y - 9}v18M${x + 23} ${y}h17`} />
      <PartLabels {...props} gap={13} />
    </g>
  );
}

/** An inductor (four bumps), 40 units long. */
export function Inductor(props: PartProps) {
  const { x, y, vertical } = props;
  const bumps = vertical
    ? `M${x} ${y}v6a3.5 3.5 0 0 1 0 7a3.5 3.5 0 0 1 0 7a3.5 3.5 0 0 1 0 7a3.5 3.5 0 0 1 0 7v6`
    : `M${x} ${y}h6a3.5 3.5 0 0 1 7 0a3.5 3.5 0 0 1 7 0a3.5 3.5 0 0 1 7 0a3.5 3.5 0 0 1 7 0h6`;
  return (
    <g>
      <Wire d={bumps} />
      <PartLabels {...props} gap={12} />
    </g>
  );
}

export const Ground = ({ x, y }: { x: number; y: number }) => <Wire d={`M${x} ${y}v4M${x - 8} ${y + 4}h16M${x - 5} ${y + 8}h10M${x - 2} ${y + 12}h4`} />;

/** An op-amp whose + input is at (x, y), − input at (x, y + 20) and output at (x + 50, y + 10). */
export function OpAmp({ x, y, swap = false }: { x: number; y: number; swap?: boolean }) {
  return (
    <g>
      <path d={`M${x} ${y - 12}L${x + 50} ${y + 10}L${x} ${y + 32}Z`} fill="none" stroke="currentColor" stroke-width={1.4} stroke-linejoin="round" />
      <Label x={x + 7} y={y + 4}>
        {swap ? '−' : '+'}
      </Label>
      <Label x={x + 7} y={y + 24}>
        {swap ? '+' : '−'}
      </Label>
    </g>
  );
}

export function Terminal({ x, y, label, end = false }: { x: number; y: number; label: string; end?: boolean }) {
  return (
    <g>
      <circle cx={x} cy={y} r={3} fill="none" stroke="currentColor" stroke-width={1.4} />
      <Label x={end ? x + 8 : x - 8} y={y + 4} anchor={end ? 'start' : 'end'}>
        {label}
      </Label>
    </g>
  );
}

/** Drawn 1.35 times its coordinate size so labels stay readable. */
export function Schematic({ width, height, label, children }: { width: number; height: number; label: string; children: ComponentChildren }) {
  return (
    <svg class="schematic" viewBox={`0 0 ${width} ${height}`} width={Math.round(width * 1.35)} height={Math.round(height * 1.35)} role="img" aria-label={label}>
      {children}
    </svg>
  );
}
