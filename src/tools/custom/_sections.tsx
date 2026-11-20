/** Pieces shared by the section-properties tool and the beam calculator. */
import { SectionError, type SectionProperties, type ShapeId, sectionProperties } from '../../lib/beam/sections';

export type SectionUnits = 'mm' | 'cm' | 'in';

export const SECTION_MATERIALS = [
  { id: 'steel', name: 'Structural steel', density: 7850, E: 200 },
  { id: 'stainless', name: 'Stainless steel', density: 8000, E: 193 },
  { id: 'aluminium', name: 'Aluminium alloy', density: 2700, E: 69 },
  { id: 'timber', name: 'Timber (typical hardwood)', density: 650, E: 12 },
  { id: 'concrete', name: 'Concrete (M25)', density: 2500, E: 25 },
  { id: 'gfrp', name: 'Glass-fibre reinforced plastic', density: 1900, E: 25 },
] as const;

export function readNumber(text: string | undefined): number | null {
  if (text === undefined) return null;
  const value = Number(text.replace(/[,_\s]/g, ''));
  return text.trim() === '' || !Number.isFinite(value) ? null : value;
}

/** Properties from typed dimensions in mm, or the reason they cannot be worked out. */
export function sectionFromInputs(shape: ShapeId, dims: Readonly<Record<string, string>>): SectionProperties | { readonly error: string } {
  const values: Record<string, number> = {};
  for (const [key, text] of Object.entries(dims)) {
    const value = readNumber(text);
    if (value === null) return { error: `Type a number for ${key}.` };
    values[key] = value;
  }
  try {
    return sectionProperties(shape, values);
  } catch (error) {
    if (error instanceof SectionError) return { error: error.message };
    throw error;
  }
}

/** Five significant figures, grouped for reading. */
export function figure(value: number, digits = 5): string {
  if (!Number.isFinite(value)) return '—';
  if (value === 0) return '0';
  if (Math.abs(value) >= 1e12 || Math.abs(value) < 1e-6) return value.toExponential(digits - 1).replace(/\.?0+e/, 'e');
  return Number(value.toPrecision(digits)).toLocaleString('en-US', { maximumFractionDigits: 12 });
}

export interface PropertyRow {
  readonly label: string;
  readonly symbol?: string;
  readonly value: string;
  readonly unit: string;
}

export function sectionRows(p: SectionProperties, units: SectionUnits, density: number): PropertyRow[] {
  const k = units === 'mm' ? 1 : units === 'cm' ? 0.1 : 1 / 25.4;
  const u = units;
  const len = (v: number) => figure(v * k);
  const pow = (v: number, n: number) => figure(v * k ** n);
  const rows: PropertyRow[] = [
    { label: 'Area', symbol: 'A', value: pow(p.area, 2), unit: `${u}²` },
    units === 'in'
      ? { label: 'Weight per length', value: figure(p.area * 1e-6 * density * 0.671968975), unit: 'lb/ft' }
      : { label: 'Mass per metre', value: figure(p.area * 1e-6 * density), unit: 'kg/m' },
    units === 'in' ? { label: 'Surface per length', value: figure((p.perimeter / 304.8) * 1), unit: 'ft²/ft' } : { label: 'Surface per metre', value: figure(p.perimeter / 1000), unit: 'm²/m' },
    { label: 'Centroid from the left', symbol: 'x̄', value: len(p.cx), unit: u },
    { label: 'Centroid from the bottom', symbol: 'ȳ', value: len(p.cy), unit: u },
    { label: 'Second moment about x', symbol: 'Ix', value: pow(p.Ix, 4), unit: `${u}⁴` },
    { label: 'Second moment about y', symbol: 'Iy', value: pow(p.Iy, 4), unit: `${u}⁴` },
  ];
  const skew = Math.abs(p.Ixy) > 1e-9 * (p.Ix + p.Iy);
  if (skew) {
    rows.push(
      { label: 'Product moment', symbol: 'Ixy', value: pow(p.Ixy, 4), unit: `${u}⁴` },
      { label: 'Major principal moment', symbol: 'Iu', value: pow(p.I1, 4), unit: `${u}⁴` },
      { label: 'Minor principal moment', symbol: 'Iv', value: pow(p.I2, 4), unit: `${u}⁴` },
      { label: 'Major axis from x, anticlockwise', symbol: 'α', value: figure(p.angle, 4), unit: '°' },
    );
  }
  const sameX = Math.abs(p.SxTop - p.SxBottom) <= 1e-9 * p.SxTop;
  const sameY = Math.abs(p.SyLeft - p.SyRight) <= 1e-9 * p.SyLeft;
  rows.push(
    ...(sameX
      ? [{ label: 'Elastic modulus about x', symbol: 'Sx', value: pow(p.SxTop, 3), unit: `${u}³` }]
      : [
          { label: 'Elastic modulus about x, top fibre', symbol: 'Sx', value: pow(p.SxTop, 3), unit: `${u}³` },
          { label: 'Elastic modulus about x, bottom fibre', symbol: 'Sx', value: pow(p.SxBottom, 3), unit: `${u}³` },
        ]),
    ...(sameY
      ? [{ label: 'Elastic modulus about y', symbol: 'Sy', value: pow(p.SyLeft, 3), unit: `${u}³` }]
      : [
          { label: 'Elastic modulus about y, left fibre', symbol: 'Sy', value: pow(p.SyLeft, 3), unit: `${u}³` },
          { label: 'Elastic modulus about y, right fibre', symbol: 'Sy', value: pow(p.SyRight, 3), unit: `${u}³` },
        ]),
    { label: 'Plastic modulus about x', symbol: 'Zx', value: pow(p.Zx, 3), unit: `${u}³` },
    { label: 'Plastic modulus about y', symbol: 'Zy', value: pow(p.Zy, 3), unit: `${u}³` },
    { label: 'Shape factor about x', value: figure(p.Zx / Math.min(p.SxTop, p.SxBottom), 4), unit: '' },
    { label: 'Radius of gyration about x', symbol: 'rx', value: len(p.rx), unit: u },
    { label: 'Radius of gyration about y', symbol: 'ry', value: len(p.ry), unit: u },
  );
  if (skew) rows.push({ label: 'Least radius of gyration', symbol: 'rv', value: len(p.r2), unit: u });
  rows.push({ label: 'Torsion constant', symbol: 'J', value: pow(p.J, 4), unit: `${u}⁴` });
  return rows;
}

/** A scale drawing of the section with its centroid and centroidal axes. */
export function ShapeDrawing({ section, size = 260 }: { section: SectionProperties; size?: number }) {
  const pad = 0.14 * Math.max(section.width, section.height);
  const W = section.width + 2 * pad;
  const H = section.height + 2 * pad;
  const sx = (x: number) => x + pad;
  const sy = (y: number) => H - pad - y;
  const stroke = Math.max(section.width, section.height) / 160;
  const cx = sx(section.cx);
  const cy = sy(section.cy);
  const reach = Math.max(W, H);
  const rad = (section.angle * Math.PI) / 180;
  const skew = Math.abs(section.Ixy) > 1e-9 * (section.Ix + section.Iy);
  const font = Math.max(section.width, section.height) / 14;
  return (
    <svg class="sp-drawing" viewBox={`0 0 ${W} ${H}`} width={size} height={(size * H) / W} role="img" aria-label="Drawing of the cross-section">
      {section.circle ? (
        <path
          class="sp-fill"
          fill-rule="evenodd"
          stroke-width={stroke}
          d={`M ${cx - section.circle.d / 2} ${cy} a ${section.circle.d / 2} ${section.circle.d / 2} 0 1 0 ${section.circle.d} 0 a ${section.circle.d / 2} ${section.circle.d / 2} 0 1 0 ${-section.circle.d} 0 ${
            section.circle.inner > 0
              ? `M ${cx - section.circle.inner / 2} ${cy} a ${section.circle.inner / 2} ${section.circle.inner / 2} 0 1 0 ${section.circle.inner} 0 a ${section.circle.inner / 2} ${section.circle.inner / 2} 0 1 0 ${-section.circle.inner} 0`
              : ''
          }`}
        />
      ) : (
        section.rects.map((r) => <rect key={`${r.x},${r.y},${r.w},${r.h}`} class="sp-fill" x={sx(r.x)} y={sy(r.y + r.h)} width={r.w} height={r.h} stroke-width={stroke} />)
      )}
      <line class="sp-axis" x1={pad / 3} x2={W - pad / 3} y1={cy} y2={cy} stroke-width={stroke * 0.8} stroke-dasharray={`${stroke * 6} ${stroke * 3}`} />
      <line class="sp-axis" x1={cx} x2={cx} y1={pad / 3} y2={H - pad / 3} stroke-width={stroke * 0.8} stroke-dasharray={`${stroke * 6} ${stroke * 3}`} />
      {skew && (
        <line
          class="sp-principal"
          x1={cx - reach * Math.cos(rad)}
          y1={cy + reach * Math.sin(rad)}
          x2={cx + reach * Math.cos(rad)}
          y2={cy - reach * Math.sin(rad)}
          stroke-width={stroke * 0.8}
          stroke-dasharray={`${stroke} ${stroke * 2.5}`}
        />
      )}
      <circle class="sp-centroid" cx={cx} cy={cy} r={stroke * 3.2} stroke-width={stroke} />
      <text class="sp-label" x={W - pad / 3} y={cy - stroke * 3} font-size={font} text-anchor="end">
        x
      </text>
      <text class="sp-label" x={cx + stroke * 3} y={pad / 3 + font * 0.8} font-size={font}>
        y
      </text>
    </svg>
  );
}
