/**
 * Geometric and wave optics for the Optics Bench: thin lenses and mirrors
 * (with paraxial ray tracing through several lenses), refraction with
 * Fresnel's equations, prisms with dispersion, slits and gratings, and
 * polarisers.  Angles are in radians unless a name says degrees.
 */

/* ----------------------------------------------------- lenses and mirrors -- */

/**
 * The thin-lens (and mirror) equation, real-is-positive: an object `u` in
 * front gives an image `v` (positive: real, on the far side of a lens or in
 * front of a mirror) and magnification m = −v/u.
 */
export function thinLens(f: number, u: number): { v: number; m: number } {
  const inv = 1 / f - 1 / u;
  const v = Math.abs(inv) < 1e-12 ? Number.POSITIVE_INFINITY : 1 / inv;
  return { v, m: Number.isFinite(v) ? -v / u : Number.POSITIVE_INFINITY };
}

export interface ThinLens {
  /** Position along the axis and focal length (negative: diverging). */
  readonly x: number;
  readonly f: number;
}

/**
 * A paraxial ray from (x0, y0) with slope `slope`, refracted by each lens in
 * turn (y stays, slope becomes slope − y/f), and carried on to `xEnd`.
 * Returns the points where it bends, and its final slope.
 */
export function traceRay(lenses: readonly ThinLens[], x0: number, y0: number, slope: number, xEnd: number): { points: [number, number][]; slope: number } {
  const points: [number, number][] = [[x0, y0]];
  let x = x0;
  let y = y0;
  let s = slope;
  for (const l of [...lenses].sort((a, b) => a.x - b.x)) {
    if (l.x <= x) continue;
    y += s * (l.x - x);
    x = l.x;
    points.push([x, y]);
    s -= y / l.f;
  }
  points.push([xEnd, y + s * (xEnd - x)]);
  return { points, slope: s };
}

/** The final image of an object at height h, distance u in front of the first lens, through lenses in order. */
export function imageThrough(lenses: readonly ThinLens[], u: number, h: number): { x: number; h: number; m: number } {
  const sorted = [...lenses].sort((a, b) => a.x - b.x);
  let objectX = (sorted[0]?.x ?? 0) - u;
  let height = h;
  let m = 1;
  for (const l of sorted) {
    const { v, m: mi } = thinLens(l.f, l.x - objectX);
    objectX = l.x + v;
    height *= mi;
    m *= mi;
  }
  return { x: objectX, h: height, m };
}

/* ------------------------------------------------------------ refraction -- */

/** Snell's law; null for total internal reflection. */
export function snell(n1: number, n2: number, theta1: number): number | null {
  const s = (n1 / n2) * Math.sin(theta1);
  return Math.abs(s) > 1 ? null : Math.asin(s);
}

export const criticalAngle = (n1: number, n2: number): number | null => (n1 > n2 ? Math.asin(n2 / n1) : null);
export const brewster = (n1: number, n2: number) => Math.atan(n2 / n1);

/** Fresnel reflectance for s and p polarisation and for unpolarised light (1 when totally reflected). */
export function fresnel(n1: number, n2: number, theta1: number): { rs: number; rp: number; r: number; t: number } {
  const theta2 = snell(n1, n2, theta1);
  if (theta2 === null) return { rs: 1, rp: 1, r: 1, t: 0 };
  const c1 = Math.cos(theta1);
  const c2 = Math.cos(theta2);
  const rs = ((n1 * c1 - n2 * c2) / (n1 * c1 + n2 * c2)) ** 2;
  const rp = ((n1 * c2 - n2 * c1) / (n1 * c2 + n2 * c1)) ** 2;
  const r = (rs + rp) / 2;
  return { rs, rp, r, t: 1 - r };
}

/* --------------------------------------------------------------- prisms -- */

/** Cauchy's two-term fit n(λ) = A + B/λ² (λ in µm) for some transparent materials. */
export const GLASSES = {
  crown: { name: 'Crown glass (BK7)', a: 1.5046, b: 0.0042 },
  flint: { name: 'Flint glass (F2)', a: 1.5935, b: 0.0108 },
  dense: { name: 'Dense flint (SF11)', a: 1.7387, b: 0.0201 },
  water: { name: 'Water', a: 1.3242, b: 0.00306 },
  diamond: { name: 'Diamond', a: 2.3818, b: 0.0121 },
} as const;
export type Glass = keyof typeof GLASSES;

export const refractiveIndex = (glass: Glass, nm: number) => GLASSES[glass].a + GLASSES[glass].b / (nm / 1000) ** 2;

/**
 * A ray through a prism of apex angle A at incidence i on the first face
 * (both measured from the face normals): the angles inside, the angle out,
 * and the deviation; `exit` is null when the ray is totally reflected at the
 * second face.
 */
export function prism(apex: number, n: number, i1: number): { r1: number; r2: number; exit: number | null; deviation: number | null } {
  const r1 = Math.asin(Math.sin(i1) / n);
  const r2 = apex - r1;
  const s = n * Math.sin(r2);
  if (Math.abs(s) > 1) return { r1, r2, exit: null, deviation: null };
  const exit = Math.asin(s);
  return { r1, r2, exit, deviation: i1 + exit - apex };
}

/** The least deviation a prism gives, and the incidence that gives it (the ray crosses symmetrically). */
export function minimumDeviation(apex: number, n: number): { deviation: number; incidence: number } {
  const half = Math.asin(Math.min(1, n * Math.sin(apex / 2)));
  return { deviation: 2 * half - apex, incidence: half };
}

/* ---------------------------------------------------- slits and gratings -- */

/**
 * Relative intensity at angle θ behind N slits of width a, centres d apart
 * (N = 1 for a single slit), lit by wavelength λ (all in the same units).
 */
export function slits(theta: number, lambda: number, a: number, d: number, n: number): number {
  const s = Math.sin(theta);
  const beta = (Math.PI * a * s) / lambda;
  const single = Math.abs(beta) < 1e-9 ? 1 : (Math.sin(beta) / beta) ** 2;
  if (n <= 1) return single;
  const alpha = (Math.PI * d * s) / lambda;
  const sa = Math.sin(alpha);
  const multi = Math.abs(sa) < 1e-9 ? 1 : (Math.sin(n * alpha) / (n * sa)) ** 2;
  return single * multi;
}

/** Angles of a grating's bright orders, d sin θ = mλ, as far as they go. */
export function gratingOrders(lambda: number, d: number): { m: number; angle: number }[] {
  const out: { m: number; angle: number }[] = [];
  for (let m = 0; m * lambda <= d; m++) out.push({ m, angle: Math.asin((m * lambda) / d) });
  return out;
}

/* ----------------------------------------------------------- polarisers -- */

/**
 * Unpolarised light of intensity I0 through polarisers at the given angles
 * (degrees): the first halves it, each next one passes cos² of the angle
 * between it and the one before (Malus's law).
 */
export function polarisers(i0: number, angles: readonly number[]): number[] {
  const out: number[] = [];
  let intensity = i0;
  let last: number | null = null;
  for (const a of angles) {
    // cos 90° is not quite zero in floating point: crossed polarisers pass nothing.
    const c = last === null ? 0 : Math.cos(((a - last) * Math.PI) / 180);
    intensity = last === null ? intensity / 2 : Math.abs(c) < 1e-12 ? 0 : intensity * c * c;
    out.push(intensity);
    last = a;
  }
  return out;
}

/* --------------------------------------------------------------- colour -- */

/** An sRGB colour for a visible wavelength in nanometres (Dan Bruton's approximation), dimmed at the ends of the eye's range. */
export function wavelengthColour(nm: number): [number, number, number] {
  let r = 0;
  let g = 0;
  let b = 0;
  if (nm >= 380 && nm < 440) {
    r = -(nm - 440) / 60;
    b = 1;
  } else if (nm < 490) {
    g = (nm - 440) / 50;
    b = 1;
  } else if (nm < 510) {
    g = 1;
    b = -(nm - 510) / 20;
  } else if (nm < 580) {
    r = (nm - 510) / 70;
    g = 1;
  } else if (nm < 645) {
    r = 1;
    g = -(nm - 645) / 65;
  } else if (nm <= 780) r = 1;
  const fade = nm < 420 ? 0.3 + (0.7 * (nm - 380)) / 40 : nm > 700 ? 0.3 + (0.7 * (780 - nm)) / 80 : 1;
  const k = (c: number) => Math.round(255 * (c * Math.max(0, fade)) ** 0.8);
  return [k(r), k(g), k(b)];
}

export const colourCss = (nm: number) => {
  const [r, g, b] = wavelengthColour(nm);
  return `rgb(${r} ${g} ${b})`;
};
