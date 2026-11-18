/** Toolpaths from G-code, for the 3D viewer. */

export interface GcodePath {
  readonly segments: Float32Array;
  readonly travel: Float32Array;
  readonly layers: number;
  readonly length: number;
  readonly box: readonly [number, number, number, number, number, number];
}

/** Toolpaths from G-code: G0/G1 lines and G2/G3 arcs, absolute or relative (G90/G91), mm or inches. */
export function parseGcode(text: string): GcodePath {
  const cut: number[] = [];
  const move: number[] = [];
  let [x, y, z, e] = [0, 0, 0, 0];
  let relative = false;
  let relativeE = false;
  let scale = 1;
  let length = 0;
  const zs = new Set<number>();
  const box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  const grow = (px: number, py: number, pz: number) => {
    box[0] = Math.min(box[0] as number, px);
    box[1] = Math.min(box[1] as number, py);
    box[2] = Math.min(box[2] as number, pz);
    box[3] = Math.max(box[3] as number, px);
    box[4] = Math.max(box[4] as number, py);
    box[5] = Math.max(box[5] as number, pz);
  };
  for (const raw of text.split('\n')) {
    const line = raw
      .replace(/;.*|\(.*?\)/g, '')
      .trim()
      .toUpperCase();
    if (!line) continue;
    const words = Object.fromEntries([...line.matchAll(/([A-Z])\s*(-?\d*\.?\d+)/g)].map((m) => [m[1], Number(m[2])])) as Record<string, number>;
    const g = words.G;
    if (/\bG90\b/.test(line)) relative = false;
    if (/\bG91\b/.test(line)) relative = true;
    if (/\bM82\b/.test(line)) relativeE = false;
    if (/\bM83\b/.test(line)) relativeE = true;
    if (/\bG20\b/.test(line)) scale = 25.4;
    if (/\bG21\b/.test(line)) scale = 1;
    if (g === 92) {
      if (words.E !== undefined) e = words.E;
      continue;
    }
    if (g === undefined || g > 3) continue;
    const target = (axis: string, current: number) => (words[axis] === undefined ? current : relative ? current + (words[axis] as number) * scale : (words[axis] as number) * scale);
    const nx = target('X', x);
    const ny = target('Y', y);
    const nz = target('Z', z);
    const ne = words.E === undefined ? e : relativeE || relative ? e + (words.E as number) : (words.E as number);
    const extruding = ne > e + 1e-6 || (words.E === undefined && g !== 0 && !/\bE/.test(text.slice(0, 2000)));
    const list = g === 0 || !extruding ? move : cut;
    if (g === 2 || g === 3) {
      const cx = x + (words.I ?? 0) * scale;
      const cy = y + (words.J ?? 0) * scale;
      const r = Math.hypot(x - cx, y - cy);
      let a0 = Math.atan2(y - cy, x - cx);
      let a1 = Math.atan2(ny - cy, nx - cx);
      if (g === 2 && a1 >= a0) a1 -= Math.PI * 2;
      if (g === 3 && a1 <= a0) a1 += Math.PI * 2;
      const steps = Math.max(4, Math.ceil(Math.abs(a1 - a0) * Math.max(1, r)) / 2);
      let [px, py, pz] = [x, y, z];
      for (let i = 1; i <= steps; i++) {
        const a = a0 + ((a1 - a0) * i) / steps;
        const qx = cx + r * Math.cos(a);
        const qy = cy + r * Math.sin(a);
        const qz = z + ((nz - z) * i) / steps;
        list.push(px, py, pz, qx, qy, qz);
        length += Math.hypot(qx - px, qy - py, qz - pz);
        [px, py, pz] = [qx, qy, qz];
        grow(qx, qy, qz);
      }
      a0 = a1;
    } else if (nx !== x || ny !== y || nz !== z) {
      list.push(x, y, z, nx, ny, nz);
      if (list === cut) length += Math.hypot(nx - x, ny - y, nz - z);
      grow(nx, ny, nz);
    }
    if (list === cut) zs.add(Math.round(nz * 100) / 100);
    [x, y, z, e] = [nx, ny, nz, ne];
  }
  return { segments: new Float32Array(cut), travel: new Float32Array(move), layers: zs.size, length, box: box.map((v) => (Number.isFinite(v) ? v : 0)) as unknown as GcodePath['box'] };
}
