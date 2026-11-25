/**
 * Cams and followers, the Geneva drive and gear trains (simple, compound and
 * planetary): the kinematics behind the Machine Elements lab.
 */

/* ---------------------------------------------------------------- cams -- */

export type MotionLaw = 'uniform' | 'shm' | 'parabolic' | 'cycloidal' | 'poly345' | 'poly4567';
export type SegmentKind = 'rise' | 'dwell' | 'return';

export interface CamSegment {
  readonly kind: SegmentKind;
  /** Degrees of cam rotation. */
  readonly angle: number;
  readonly law: MotionLaw;
}

export const LAW_NAMES: Readonly<Record<MotionLaw, string>> = {
  uniform: 'Uniform velocity',
  shm: 'Simple harmonic',
  parabolic: 'Uniform acceleration (parabolic)',
  cycloidal: 'Cycloidal',
  poly345: '3-4-5 polynomial',
  poly4567: '4-5-6-7 polynomial',
};

/** The normalised law f(t) for t from 0 to 1, with its first three derivatives. */
export function law(kind: MotionLaw, t: number): [number, number, number, number] {
  const PI = Math.PI;
  switch (kind) {
    case 'uniform':
      return [t, 1, 0, 0];
    case 'shm':
      return [(1 - Math.cos(PI * t)) / 2, (PI / 2) * Math.sin(PI * t), ((PI * PI) / 2) * Math.cos(PI * t), -((PI * PI * PI) / 2) * Math.sin(PI * t)];
    case 'parabolic':
      return t < 0.5 ? [2 * t * t, 4 * t, 4, 0] : [1 - 2 * (1 - t) ** 2, 4 * (1 - t), -4, 0];
    case 'cycloidal':
      return [t - Math.sin(2 * PI * t) / (2 * PI), 1 - Math.cos(2 * PI * t), 2 * PI * Math.sin(2 * PI * t), 4 * PI * PI * Math.cos(2 * PI * t)];
    case 'poly345':
      return [10 * t ** 3 - 15 * t ** 4 + 6 * t ** 5, 30 * t ** 2 - 60 * t ** 3 + 30 * t ** 4, 60 * t - 180 * t ** 2 + 120 * t ** 3, 60 - 360 * t + 360 * t ** 2];
    case 'poly4567':
      return [
        35 * t ** 4 - 84 * t ** 5 + 70 * t ** 6 - 20 * t ** 7,
        140 * t ** 3 - 420 * t ** 4 + 420 * t ** 5 - 140 * t ** 6,
        420 * t ** 2 - 1680 * t ** 3 + 2100 * t ** 4 - 840 * t ** 5,
        840 * t - 5040 * t ** 2 + 8400 * t ** 3 - 4200 * t ** 4,
      ];
  }
}

export interface FollowerMotion {
  /** Lift (length unit), dy/dθ, d²y/dθ², d³y/dθ³ (per radian). */
  readonly y: number;
  readonly v: number;
  readonly a: number;
  readonly j: number;
}

/** Follower lift and its derivatives at cam angle θ (degrees) for a program of segments and a total lift h. */
export function followerAt(segments: readonly CamSegment[], h: number, theta: number): FollowerMotion {
  const total = segments.reduce((s, g) => s + g.angle, 0) || 360;
  let angle = ((theta % total) + total) % total;
  let level = 0;
  for (const seg of segments) {
    if (angle <= seg.angle || seg === segments[segments.length - 1]) {
      const beta = (Math.max(seg.angle, 1e-9) * Math.PI) / 180;
      const t = Math.min(1, Math.max(0, angle / Math.max(seg.angle, 1e-9)));
      if (seg.kind === 'dwell') return { y: level, v: 0, a: 0, j: 0 };
      const [f, f1, f2, f3] = law(seg.law, t);
      const sign = seg.kind === 'rise' ? 1 : -1;
      const start = level;
      return { y: start + sign * h * f, v: (sign * h * f1) / beta, a: (sign * h * f2) / beta ** 2, j: (sign * h * f3) / beta ** 3 };
    }
    angle -= seg.angle;
    if (seg.kind === 'rise') level += h;
    else if (seg.kind === 'return') level -= h;
  }
  return { y: level, v: 0, a: 0, j: 0 };
}

/** Problems with a motion program: angles that do not add to 360°, or rises and returns that do not balance. */
export function programProblems(segments: readonly CamSegment[]): string[] {
  const out: string[] = [];
  const total = segments.reduce((s, g) => s + g.angle, 0);
  if (Math.abs(total - 360) > 1e-6) out.push(`The segments add up to ${total.toFixed(1)}°, not 360°.`);
  const rises = segments.filter((s) => s.kind === 'rise').length;
  const returns = segments.filter((s) => s.kind === 'return').length;
  if (rises !== returns) out.push('Each rise needs a return, or the follower does not come back to where it started.');
  return out;
}

export type FollowerKind = 'knife' | 'roller' | 'flat';

export interface CamDesign {
  readonly segments: readonly CamSegment[];
  /** Total lift */
  readonly h: number;
  /** Base circle radius */
  readonly base: number;
  /** Roller radius (roller follower) */
  readonly roller: number;
  /** Offset of the follower's line of motion from the cam centre (knife and roller) */
  readonly offset: number;
  readonly follower: FollowerKind;
}

export interface CamPoint {
  /** Cam angle, degrees */
  readonly theta: number;
  readonly motion: FollowerMotion;
  /** The cam surface, in the cam's own frame. */
  readonly x: number;
  readonly y: number;
  /** The roller centre (pitch curve), in the cam's frame. */
  readonly px: number;
  readonly py: number;
  /** Pressure angle, degrees (0 for a flat-faced follower) */
  readonly pressure: number;
  /** Radius of curvature of the cam surface (negative where it is concave) */
  readonly curvature: number;
}

/**
 * The cam profile for a translating follower; the cam turns anticlockwise.
 * Knife-edge and roller followers use the pitch curve and its inward offset;
 * the flat-faced follower uses the envelope of the face.
 */
export function camProfile(d: CamDesign, steps = 720): CamPoint[] {
  const rp = d.base + (d.follower === 'roller' ? d.roller : 0);
  const e = d.follower === 'flat' ? 0 : d.offset;
  const s0 = Math.sqrt(Math.max(rp * rp - e * e, 0));
  const pitch = (theta: number) => {
    const m = followerAt(d.segments, d.h, theta);
    const t = (theta * Math.PI) / 180;
    const dist = s0 + m.y;
    return { m, x: e * Math.cos(t) + dist * Math.sin(t), y: -e * Math.sin(t) + dist * Math.cos(t) };
  };
  const out: CamPoint[] = [];
  for (let i = 0; i < steps; i++) {
    const theta = (i * 360) / steps;
    const t = (theta * Math.PI) / 180;
    const p = pitch(theta);
    const m = p.m;
    if (d.follower === 'flat') {
      const r = d.base + m.y;
      out.push({
        theta,
        motion: m,
        x: r * Math.sin(t) + m.v * Math.cos(t),
        y: r * Math.cos(t) - m.v * Math.sin(t),
        px: r * Math.sin(t),
        py: r * Math.cos(t),
        pressure: 0,
        curvature: r + m.a,
      });
      continue;
    }
    // Tangent and curvature of the pitch curve from its analytic derivatives.
    const dist = s0 + m.y;
    const dx = -e * Math.sin(t) + m.v * Math.sin(t) + dist * Math.cos(t);
    const dy = -e * Math.cos(t) + m.v * Math.cos(t) - dist * Math.sin(t);
    const ddx = -e * Math.cos(t) + m.a * Math.sin(t) + 2 * m.v * Math.cos(t) - dist * Math.sin(t);
    const ddy = e * Math.sin(t) + m.a * Math.cos(t) - 2 * m.v * Math.sin(t) - dist * Math.cos(t);
    const speed = Math.hypot(dx, dy) || 1e-12;
    // Normal pointing out of the cam (away from its centre).
    let nx = dy / speed;
    let ny = -dx / speed;
    if (nx * p.x + ny * p.y < 0) {
      nx = -nx;
      ny = -ny;
    }
    const rho = speed ** 3 / (dx * ddy - dy * ddx);
    const pitchRadius = -rho;
    const rr = d.follower === 'roller' ? d.roller : 0;
    out.push({
      theta,
      motion: m,
      x: p.x - nx * rr,
      y: p.y - ny * rr,
      px: p.x,
      py: p.y,
      pressure: (Math.atan2(m.v - e, dist) * 180) / Math.PI,
      curvature: pitchRadius - rr,
    });
  }
  return out;
}

export interface CamCheck {
  readonly maxPressure: number;
  readonly minCurvature: number;
  readonly undercut: boolean;
  /** Width a flat face needs to keep contact: twice the largest |dy/dθ|. */
  readonly faceWidth: number;
}

export function checkCam(d: CamDesign, profile: readonly CamPoint[]): CamCheck {
  const convex = profile.map((p) => p.curvature).filter((c) => c > 0);
  const minCurvature = Math.min(...profile.map((p) => p.curvature));
  const faceWidth = 2 * Math.max(...profile.map((p) => Math.abs(p.motion.v)));
  // A roller undercuts where the pitch curve is sharper than the roller; a flat face where ρ = r + y″ goes negative.
  const undercut = d.follower === 'flat' ? minCurvature <= 0 : d.follower === 'roller' ? profile.some((p) => p.curvature + d.roller > 0 && p.curvature < 0) : false;
  return { maxPressure: Math.max(...profile.map((p) => Math.abs(p.pressure))), minCurvature: convex.length ? Math.min(...convex) : minCurvature, undercut, faceWidth };
}

/* ---------------------------------------------------------------- Geneva -- */

export interface Geneva {
  readonly slots: number;
  /** Crank (driving pin) radius */
  readonly crank: number;
  /** Centre distance */
  readonly centres: number;
  /** Radius of the wheel at the slot mouths */
  readonly wheel: number;
  /** Fraction of a turn of the crank spent moving the wheel */
  readonly indexing: number;
  /** Half the crank angle over which the pin is in a slot, radians */
  readonly engage: number;
}

export function geneva(slots: number, crank: number): Geneva {
  const centres = crank / Math.sin(Math.PI / slots);
  return { slots, crank, centres, wheel: crank / Math.tan(Math.PI / slots), indexing: 0.5 - 1 / slots, engage: Math.PI / 2 - Math.PI / slots };
}

/**
 * The wheel's motion for a crank angle α (radians) measured from the line of
 * centres: angle, and angular velocity and acceleration per unit crank speed.
 * Outside the engagement the wheel is locked (0, 0, 0) at its last position.
 */
export function genevaAt(g: Geneva, alpha: number): { beta: number; velocity: number; acceleration: number; engaged: boolean } {
  const a = Math.atan2(Math.sin(alpha), Math.cos(alpha));
  const l = g.crank / g.centres;
  if (Math.abs(a) > g.engage) return { beta: (Math.sign(a) * Math.PI) / g.slots, velocity: 0, acceleration: 0, engaged: false };
  const denominator = 1 - 2 * l * Math.cos(a) + l * l;
  return {
    beta: Math.atan2(l * Math.sin(a), 1 - l * Math.cos(a)),
    velocity: (l * (Math.cos(a) - l)) / denominator,
    acceleration: (l * (l * l - 1) * Math.sin(a)) / denominator ** 2,
    engaged: true,
  };
}

/* ----------------------------------------------------------- gear trains -- */

export interface GearMesh {
  readonly driver: number;
  readonly driven: number;
  /** An internal (ring) gear keeps the direction. */
  readonly internal?: boolean;
}

/** A train of meshes; the driven gear of each mesh shares its shaft with the driver of the next. */
export function trainRatio(meshes: readonly GearMesh[]): { ratio: number; reverses: boolean } {
  let ratio = 1;
  let flips = 0;
  for (const m of meshes) {
    ratio *= m.driven / m.driver;
    if (!m.internal) flips++;
  }
  return { ratio, reverses: flips % 2 === 1 };
}

/** Reads "20-40, 15:45, 18/36i" (i marks an internal gear) as meshes. */
export function parseTrain(text: string): GearMesh[] {
  const meshes: GearMesh[] = [];
  for (const part of text
    .split(/[,;\n]+/)
    .map((p) => p.trim())
    .filter(Boolean)) {
    const m = /^(\d+)\s*[-:/x×]\s*(\d+)\s*(i?)$/i.exec(part);
    if (!m) throw new Error(`“${part}” is not a gear pair. Write the teeth of the driver and the driven gear, such as 20-40.`);
    const driver = Number(m[1]);
    const driven = Number(m[2]);
    if (driver < 6 || driven < 6) throw new Error(`“${part}”: a gear needs at least 6 teeth.`);
    meshes.push(m[3] ? { driver, driven, internal: true } : { driver, driven });
  }
  if (!meshes.length) throw new Error('Give at least one gear pair, such as 20-40.');
  return meshes;
}

export type Member = 'sun' | 'ring' | 'carrier';

export interface Planetary {
  readonly sun: number;
  readonly ring: number;
  readonly planet: number;
  readonly planets: number;
}

/** Speeds of a simple planetary set, by Willis's equation: (ωs − ωc)/(ωr − ωc) = −Zr/Zs. */
export function planetarySpeeds(p: Planetary, fixed: Member, input: Member, inputSpeed: number): { sun: number; ring: number; carrier: number; planet: number } {
  const k = p.ring / p.sun;
  const speeds: Record<Member, number> = { sun: Number.NaN, ring: Number.NaN, carrier: Number.NaN };
  speeds[fixed] = 0;
  speeds[input] = inputSpeed;
  const missing = (['sun', 'ring', 'carrier'] as const).find((m) => m !== fixed && m !== input);
  // ωs + k·ωr = (1 + k)·ωc
  if (missing === 'sun') speeds.sun = (1 + k) * speeds.carrier - k * speeds.ring;
  else if (missing === 'ring') speeds.ring = ((1 + k) * speeds.carrier - speeds.sun) / k;
  else if (missing === 'carrier') speeds.carrier = (speeds.sun + k * speeds.ring) / (1 + k);
  // The planet's own spin, relative to the frame: ωp = ωc − (Zs/Zp)(ωs − ωc).
  const planet = speeds.carrier - (p.sun / p.planet) * (speeds.sun - speeds.carrier);
  return { sun: speeds.sun, ring: speeds.ring, carrier: speeds.carrier, planet };
}

/** Problems with a planetary set: teeth that do not mesh, or planets that cannot be spaced evenly. */
export function planetaryProblems(p: Planetary): string[] {
  const out: string[] = [];
  if (p.ring !== p.sun + 2 * p.planet) out.push(`The ring needs Zs + 2·Zp = ${p.sun + 2 * p.planet} teeth for these gears to mesh at standard centres.`);
  if ((p.sun + p.ring) % p.planets !== 0) out.push(`${p.planets} planets cannot be spaced evenly: (Zs + Zr) / planets = ${((p.sun + p.ring) / p.planets).toFixed(2)} should be a whole number.`);
  // Neighbouring planets must not touch: their tip circles must clear.
  const centre = (p.sun + p.planet) / 2;
  if (2 * centre * Math.sin(Math.PI / p.planets) <= p.planet + 2) out.push('The planets are too big to fit side by side.');
  return out;
}
