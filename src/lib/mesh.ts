/**
 * Triangle meshes for the 3D Model Toolbox: welding, analysis (open edges,
 * holes, non-manifold edges, flipped faces), repair, measurements, checks for
 * 3D printing, and writers for STL, OBJ, PLY, 3MF and GLB.
 */
import { strToU8, zipSync } from 'fflate';

export interface Mesh {
  /** x, y, z of every vertex. */
  readonly positions: Float32Array;
  /** Three vertex numbers per triangle. */
  readonly indices: Uint32Array;
}

export type Vec3 = [number, number, number];

export interface Bounds {
  readonly min: Vec3;
  readonly max: Vec3;
  readonly size: Vec3;
}

export function boundsOf(positions: Float32Array): Bounds {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let axis = 0; axis < 3; axis++) {
      const value = positions[i + axis] as number;
      if (value < (min[axis] as number)) min[axis] = value;
      if (value > (max[axis] as number)) max[axis] = value;
    }
  }
  if (!positions.length) return { min: [0, 0, 0], max: [0, 0, 0], size: [0, 0, 0] };
  return { min, max, size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] };
}

/* ---------------------------------------------------------------- reading -- */

/** The triangles of an STL file (binary or text) as loose corners: nine numbers per triangle. */
export function parseStl(bytes: Uint8Array): Float32Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length >= 84) {
    const count = view.getUint32(80, true);
    if (84 + count * 50 === bytes.length) {
      const out = new Float32Array(count * 9);
      for (let t = 0; t < count; t++) {
        const at = 84 + t * 50 + 12;
        for (let k = 0; k < 9; k++) out[t * 9 + k] = view.getFloat32(at + k * 4, true);
      }
      return out;
    }
  }
  const text = new TextDecoder().decode(bytes);
  if (!/^\s*solid\b/i.test(text)) throw new Error('This is not an STL file.');
  const numbers: number[] = [];
  for (const match of text.matchAll(/vertex\s+(\S+)\s+(\S+)\s+(\S+)/gi)) numbers.push(Number(match[1]), Number(match[2]), Number(match[3]));
  if (numbers.length % 9 !== 0 || numbers.some((n) => !Number.isFinite(n))) throw new Error('The STL file is damaged: its triangles are incomplete.');
  return Float32Array.from(numbers);
}

/**
 * Joins corners that are in the same place (within `tolerance`) into shared vertices.
 * `corners` holds loose triangle corners, or the vertices of `indices` when given.
 */
export function weld(corners: Float32Array, tolerance: number, indices?: Uint32Array): Mesh {
  const count = corners.length / 3;
  const bounds = boundsOf(corners);
  const diagonal = Math.hypot(...bounds.size) || 1;
  // At most 2^17 cells along an axis, so three cell numbers fit one exact number.
  const cell = Math.max(tolerance, diagonal / 131000);
  const SPAN = 131072;
  const seen = new Map<number, number>();
  const remap = new Uint32Array(count);
  const kept: number[] = [];
  for (let i = 0; i < count; i++) {
    const x = corners[i * 3] as number;
    const y = corners[i * 3 + 1] as number;
    const z = corners[i * 3 + 2] as number;
    const key = Math.round((x - bounds.min[0]) / cell) + Math.round((y - bounds.min[1]) / cell) * SPAN + Math.round((z - bounds.min[2]) / cell) * SPAN * SPAN;
    let index = seen.get(key);
    if (index === undefined) {
      index = kept.length / 3;
      seen.set(key, index);
      kept.push(x, y, z);
    }
    remap[i] = index;
  }
  const out = indices ? Uint32Array.from(indices, (i) => remap[i] as number) : remap;
  return { positions: Float32Array.from(kept), indices: out };
}

/* --------------------------------------------------------------- analysis -- */

export interface Analysis {
  readonly triangles: number;
  readonly vertices: number;
  readonly bounds: Bounds;
  /** Surface area and the volume enclosed (negative when the faces point inwards). */
  readonly area: number;
  readonly volume: number;
  /** Edges with a face on one side only. */
  readonly openEdges: number;
  readonly holes: number;
  /** Edges shared by more than two faces. */
  readonly nonManifoldEdges: number;
  /** Edges whose two faces run the same way round: one of them is flipped. */
  readonly flippedEdges: number;
  readonly degenerate: number;
  readonly duplicates: number;
  readonly shells: number;
  readonly watertight: boolean;
}

interface EdgeUse {
  count: number;
  forward: number;
  faces: number[];
}

function edgeMap(mesh: Mesh): Map<number, EdgeUse> {
  const span = mesh.positions.length / 3;
  const edges = new Map<number, EdgeUse>();
  const { indices } = mesh;
  for (let face = 0; face < indices.length / 3; face++) {
    for (let k = 0; k < 3; k++) {
      const a = indices[face * 3 + k] as number;
      const b = indices[face * 3 + ((k + 1) % 3)] as number;
      if (a === b) continue;
      const key = a < b ? a * span + b : b * span + a;
      let use = edges.get(key);
      if (!use) {
        use = { count: 0, forward: 0, faces: [] };
        edges.set(key, use);
      }
      use.count += 1;
      if (a < b) use.forward += 1;
      use.faces.push(face);
    }
  }
  return edges;
}

const corner = (mesh: Mesh, index: number): Vec3 => [mesh.positions[index * 3] as number, mesh.positions[index * 3 + 1] as number, mesh.positions[index * 3 + 2] as number];

function faceArea(mesh: Mesh, face: number): number {
  const [ax, ay, az] = corner(mesh, mesh.indices[face * 3] as number);
  const [bx, by, bz] = corner(mesh, mesh.indices[face * 3 + 1] as number);
  const [cx, cy, cz] = corner(mesh, mesh.indices[face * 3 + 2] as number);
  const ux = bx - ax;
  const uy = by - ay;
  const uz = bz - az;
  const vx = cx - ax;
  const vy = cy - ay;
  const vz = cz - az;
  return Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
}

function signedVolume(mesh: Mesh, faces?: Iterable<number>): number {
  let six = 0;
  const add = (face: number) => {
    const [ax, ay, az] = corner(mesh, mesh.indices[face * 3] as number);
    const [bx, by, bz] = corner(mesh, mesh.indices[face * 3 + 1] as number);
    const [cx, cy, cz] = corner(mesh, mesh.indices[face * 3 + 2] as number);
    six += ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);
  };
  if (faces) for (const face of faces) add(face);
  else for (let face = 0; face < mesh.indices.length / 3; face++) add(face);
  return six / 6;
}

/** The open edges of a mesh as loops of vertex numbers, each in the direction of its faces. */
export function openLoops(mesh: Mesh, edges = edgeMap(mesh)): number[][] {
  const span = mesh.positions.length / 3;
  const next = new Map<number, number[]>();
  const { indices } = mesh;
  for (let face = 0; face < indices.length / 3; face++) {
    for (let k = 0; k < 3; k++) {
      const a = indices[face * 3 + k] as number;
      const b = indices[face * 3 + ((k + 1) % 3)] as number;
      if (a === b) continue;
      if (edges.get(a < b ? a * span + b : b * span + a)?.count === 1) next.set(a, [...(next.get(a) ?? []), b]);
    }
  }
  const loops: number[][] = [];
  for (const start of [...next.keys()]) {
    while (next.get(start)?.length) {
      const loop = [start];
      let at = start;
      for (let guard = 0; guard < 1_000_000; guard++) {
        const to = next.get(at)?.pop();
        if (to === undefined || to === start) break;
        loop.push(to);
        at = to;
      }
      if (loop.length >= 3) loops.push(loop);
    }
  }
  return loops;
}

/** Groups of faces that are joined through shared edges. */
function shellsOf(mesh: Mesh, edges: Map<number, EdgeUse>): number[][] {
  const faces = mesh.indices.length / 3;
  const parent = new Uint32Array(faces).map((_, i) => i);
  const find = (i: number): number => {
    let root = i;
    while (parent[root] !== root) root = parent[root] as number;
    while (parent[i] !== root) {
      const up = parent[i] as number;
      parent[i] = root;
      i = up;
    }
    return root;
  };
  for (const use of edges.values()) {
    const first = find(use.faces[0] as number);
    for (let k = 1; k < use.faces.length; k++) parent[find(use.faces[k] as number)] = first;
  }
  const groups = new Map<number, number[]>();
  for (let face = 0; face < faces; face++) {
    const root = find(face);
    const group = groups.get(root);
    if (group) group.push(face);
    else groups.set(root, [face]);
  }
  return [...groups.values()];
}

export function analyse(mesh: Mesh): Analysis {
  const edges = edgeMap(mesh);
  const faces = mesh.indices.length / 3;
  let open = 0;
  let nonManifold = 0;
  let flipped = 0;
  for (const use of edges.values()) {
    if (use.count === 1) open += 1;
    else if (use.count > 2) nonManifold += 1;
    else if (use.forward !== 1) flipped += 1;
  }
  const bounds = boundsOf(mesh.positions);
  const tiny = (Math.hypot(...bounds.size) || 1) ** 2 * 1e-14;
  let degenerate = 0;
  let duplicates = 0;
  let area = 0;
  const seen = new Set<string>();
  for (let face = 0; face < faces; face++) {
    const a = mesh.indices[face * 3] as number;
    const b = mesh.indices[face * 3 + 1] as number;
    const c = mesh.indices[face * 3 + 2] as number;
    const size = faceArea(mesh, face);
    area += size;
    if (a === b || b === c || a === c || size <= tiny) {
      degenerate += 1;
      continue;
    }
    const key = [a, b, c].sort((p, q) => p - q).join(',');
    if (seen.has(key)) duplicates += 1;
    else seen.add(key);
  }
  return {
    triangles: faces,
    vertices: mesh.positions.length / 3,
    bounds,
    area,
    volume: signedVolume(mesh),
    openEdges: open,
    holes: openLoops(mesh, edges).length,
    nonManifoldEdges: nonManifold,
    flippedEdges: flipped,
    degenerate,
    duplicates,
    shells: faces ? shellsOf(mesh, edges).length : 0,
    watertight: faces > 0 && open === 0 && nonManifold === 0,
  };
}

/** Line segments (six numbers each) along the open and the non-manifold edges, for showing them. */
export function problemEdges(mesh: Mesh): { open: Float32Array; nonManifold: Float32Array } {
  const span = mesh.positions.length / 3;
  const open: number[] = [];
  const bad: number[] = [];
  for (const [key, use] of edgeMap(mesh)) {
    if (use.count === 2) continue;
    const a = Math.floor(key / span);
    const b = key - a * span;
    (use.count === 1 ? open : bad).push(...corner(mesh, a), ...corner(mesh, b));
  }
  return { open: Float32Array.from(open), nonManifold: Float32Array.from(bad) };
}

/* ----------------------------------------------------------------- repair -- */

export interface RepairOptions {
  /** Corners closer than this are one vertex; 0 picks a hundred-thousandth of the model's size. */
  readonly tolerance: number;
  readonly fixWinding: boolean;
  readonly fillHoles: boolean;
  /** Shells with fewer faces than this are removed (0 keeps all). */
  readonly dropShellsBelow: number;
}

export const DEFAULT_REPAIR: RepairOptions = { tolerance: 0, fixWinding: true, fillHoles: true, dropShellsBelow: 0 };

function compact(positions: Float32Array, faces: readonly number[]): Mesh {
  const remap = new Map<number, number>();
  const kept: number[] = [];
  const indices = new Uint32Array(faces.length);
  faces.forEach((vertex, i) => {
    let index = remap.get(vertex);
    if (index === undefined) {
      index = kept.length / 3;
      remap.set(vertex, index);
      kept.push(positions[vertex * 3] as number, positions[vertex * 3 + 1] as number, positions[vertex * 3 + 2] as number);
    }
    indices[i] = index;
  });
  return { positions: Float32Array.from(kept), indices };
}

/** Mends a mesh for printing, and says what was done. */
export function repair(input: Mesh, options: RepairOptions = DEFAULT_REPAIR): { mesh: Mesh; log: string[] } {
  const log: string[] = [];
  const diagonal = Math.hypot(...boundsOf(input.positions).size) || 1;
  const tolerance = options.tolerance > 0 ? options.tolerance : diagonal * 1e-5;
  let mesh = weld(input.positions, tolerance, input.indices);
  const merged = input.positions.length / 3 - mesh.positions.length / 3;
  if (merged > 0) log.push(`${merged.toLocaleString()} corners joined into shared vertices.`);

  // Triangles without area, and second copies of the same triangle.
  const tiny = diagonal ** 2 * 1e-14;
  const seen = new Set<string>();
  let faces: number[] = [];
  let degenerate = 0;
  let duplicate = 0;
  for (let face = 0; face < mesh.indices.length / 3; face++) {
    const a = mesh.indices[face * 3] as number;
    const b = mesh.indices[face * 3 + 1] as number;
    const c = mesh.indices[face * 3 + 2] as number;
    if (a === b || b === c || a === c || faceArea(mesh, face) <= tiny) {
      degenerate += 1;
      continue;
    }
    const key = [a, b, c].sort((p, q) => p - q).join(',');
    if (seen.has(key)) {
      duplicate += 1;
      continue;
    }
    seen.add(key);
    faces.push(a, b, c);
  }
  if (degenerate) log.push(`${degenerate.toLocaleString()} triangles without area removed.`);
  if (duplicate) log.push(`${duplicate.toLocaleString()} doubled triangles removed.`);
  mesh = { positions: mesh.positions, indices: Uint32Array.from(faces) };

  if (options.dropShellsBelow > 0) {
    const shells = shellsOf(mesh, edgeMap(mesh));
    const small = shells.filter((shell) => shell.length < options.dropShellsBelow);
    if (small.length && small.length < shells.length) {
      const drop = new Set(small.flat());
      faces = [];
      for (let face = 0; face < mesh.indices.length / 3; face++)
        if (!drop.has(face)) faces.push(mesh.indices[face * 3] as number, mesh.indices[face * 3 + 1] as number, mesh.indices[face * 3 + 2] as number);
      mesh = { positions: mesh.positions, indices: Uint32Array.from(faces) };
      log.push(`${small.length.toLocaleString()} loose bits of fewer than ${options.dropShellsBelow} triangles removed.`);
    }
  }

  if (options.fixWinding) {
    const span = mesh.positions.length / 3;
    const edges = edgeMap(mesh);
    const indices = Uint32Array.from(mesh.indices);
    const visited = new Uint8Array(indices.length / 3);
    let turned = 0;
    let inverted = 0;
    // Does face `f` run from a to b along its edge?
    const runs = (f: number, a: number, b: number) => {
      for (let k = 0; k < 3; k++) if (indices[f * 3 + k] === a && indices[f * 3 + ((k + 1) % 3)] === b) return true;
      return false;
    };
    for (let seed = 0; seed < visited.length; seed++) {
      if (visited[seed]) continue;
      const shell = [seed];
      visited[seed] = 1;
      for (let head = 0; head < shell.length; head++) {
        const face = shell[head] as number;
        for (let k = 0; k < 3; k++) {
          const a = indices[face * 3 + k] as number;
          const b = indices[face * 3 + ((k + 1) % 3)] as number;
          const use = edges.get(a < b ? a * span + b : b * span + a);
          if (!use) continue;
          if (use.count !== 2) continue;
          const other = use.faces[0] === face ? (use.faces[1] as number) : (use.faces[0] as number);
          if (visited[other]) continue;
          visited[other] = 1;
          // Neighbours must run opposite ways along the edge they share.
          if (runs(other, a, b)) {
            const swap = indices[other * 3 + 1] as number;
            indices[other * 3 + 1] = indices[other * 3 + 2] as number;
            indices[other * 3 + 2] = swap;
            turned += 1;
          }
          shell.push(other);
        }
      }
      // A closed shell that encloses negative volume is inside out.
      if (signedVolume({ positions: mesh.positions, indices }, shell) < 0) {
        for (const face of shell) {
          const swap = indices[face * 3 + 1] as number;
          indices[face * 3 + 1] = indices[face * 3 + 2] as number;
          indices[face * 3 + 2] = swap;
        }
        inverted += 1;
      }
    }
    mesh = { positions: mesh.positions, indices };
    if (turned) log.push(`${turned.toLocaleString()} flipped triangles turned to match their neighbours.`);
    if (inverted) log.push(`${inverted.toLocaleString()} ${inverted === 1 ? 'shell was' : 'shells were'} inside out and turned outwards.`);
  }

  if (options.fillHoles) {
    const loops = openLoops(mesh);
    if (loops.length) {
      const positions = Array.from(mesh.positions);
      const added = Array.from(mesh.indices);
      for (const loop of loops) {
        if (loop.length === 3) {
          added.push(loop[2] as number, loop[1] as number, loop[0] as number);
          continue;
        }
        // A fan around the middle of the hole; new faces run against the open edges.
        const centre: Vec3 = [0, 0, 0];
        for (const vertex of loop) {
          centre[0] += positions[vertex * 3] as number;
          centre[1] += positions[vertex * 3 + 1] as number;
          centre[2] += positions[vertex * 3 + 2] as number;
        }
        const hub = positions.length / 3;
        positions.push(centre[0] / loop.length, centre[1] / loop.length, centre[2] / loop.length);
        for (let i = 0; i < loop.length; i++) added.push(loop[(i + 1) % loop.length] as number, loop[i] as number, hub);
      }
      mesh = { positions: Float32Array.from(positions), indices: Uint32Array.from(added) };
      log.push(`${loops.length.toLocaleString()} ${loops.length === 1 ? 'hole' : 'holes'} closed.`);
    }
  }

  mesh = compact(mesh.positions, Array.from(mesh.indices));
  if (!log.length) log.push('Nothing needed mending.');
  return { mesh, log };
}

/** Removes vertices no triangle uses. */
export const tidy = (mesh: Mesh): Mesh => compact(mesh.positions, Array.from(mesh.indices));

export function scaleMesh(mesh: Mesh, factor: number): Mesh {
  return { positions: mesh.positions.map((value) => value * factor), indices: mesh.indices };
}

/** A quarter turn about the x (0), y (1) or z (2) axis. */
export function turnMesh(mesh: Mesh, axis: 0 | 1 | 2): Mesh {
  const positions = new Float32Array(mesh.positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    const x = mesh.positions[i] as number;
    const y = mesh.positions[i + 1] as number;
    const z = mesh.positions[i + 2] as number;
    const turned = axis === 0 ? [x, -z, y] : axis === 1 ? [z, y, -x] : [-y, x, z];
    positions.set(turned, i);
  }
  return { positions, indices: mesh.indices };
}

/** Moves the model so that it stands on z = 0 with its middle over the origin. */
export function dropOnBed(mesh: Mesh): Mesh {
  const { min, max } = boundsOf(mesh.positions);
  const shift = [-(min[0] + max[0]) / 2, -(min[1] + max[1]) / 2, -min[2]];
  return { positions: mesh.positions.map((value, i) => value + (shift[i % 3] as number)), indices: mesh.indices };
}

/* ----------------------------------------------------------- print checks -- */

export interface PrintOptions {
  /** Build volume in millimetres. */
  readonly bed: Vec3;
  /** Faces steeper than this from the vertical need support (45 is usual). */
  readonly overhang: number;
  /** Grams per cubic centimetre. */
  readonly density: number;
  /** Filament diameter in millimetres. */
  readonly filament: number;
  readonly minWall: number;
}

export const DEFAULT_PRINT: PrintOptions = { bed: [220, 220, 250], overhang: 45, density: 1.24, filament: 1.75, minWall: 0.8 };

export interface PrintReport {
  readonly fits: boolean;
  /** Fits when turned to lie differently on the bed. */
  readonly fitsTurned: boolean;
  /** Area of faces that hang over, and its share of all faces. */
  readonly overhangArea: number;
  readonly overhangShare: number;
  /** Area resting on the bed. */
  readonly contactArea: number;
  readonly volumeCm3: number;
  readonly massGrams: number;
  readonly filamentMetres: number;
  /** One flag per triangle: 1 when it hangs over. */
  readonly overhanging: Uint8Array;
}

/** Checks for printing with z pointing up and millimetres as units. */
export function printReport(mesh: Mesh, options: PrintOptions = DEFAULT_PRINT): PrintReport {
  const bounds = boundsOf(mesh.positions);
  const [sx, sy, sz] = bounds.size;
  const sorted = [...bounds.size].sort((a, b) => a - b);
  const bed = [...options.bed].sort((a, b) => a - b);
  const fits = Math.max(sx, sy) <= Math.max(options.bed[0], options.bed[1]) + 1e-6 && Math.min(sx, sy) <= Math.min(options.bed[0], options.bed[1]) + 1e-6 && sz <= options.bed[2] + 1e-6;
  const limit = Math.sin((options.overhang * Math.PI) / 180);
  const faces = mesh.indices.length / 3;
  const overhanging = new Uint8Array(faces);
  const floor = bounds.min[2] + Math.max(1e-4, sz * 1e-5);
  let over = 0;
  let total = 0;
  let contact = 0;
  for (let face = 0; face < faces; face++) {
    const a = corner(mesh, mesh.indices[face * 3] as number);
    const b = corner(mesh, mesh.indices[face * 3 + 1] as number);
    const c = corner(mesh, mesh.indices[face * 3 + 2] as number);
    const nx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]);
    const ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
    const nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const length = Math.hypot(nx, ny, nz);
    if (length === 0) continue;
    const area = length / 2;
    total += area;
    const down = -nz / length;
    if (down <= limit) continue;
    // Faces lying on the bed are held by it.
    if (a[2] <= floor && b[2] <= floor && c[2] <= floor) contact += area;
    else {
      over += area;
      overhanging[face] = 1;
    }
  }
  const volume = Math.abs(signedVolume(mesh));
  const strand = Math.PI * (options.filament / 2) ** 2;
  return {
    fits,
    fitsTurned: !fits && sorted.every((value, index) => value <= (bed[index] as number) + 1e-6),
    overhangArea: over,
    overhangShare: total > 0 ? over / total : 0,
    contactArea: contact,
    volumeCm3: volume / 1000,
    massGrams: (volume / 1000) * options.density,
    filamentMetres: strand > 0 ? volume / strand / 1000 : 0,
    overhanging,
  };
}

/**
 * Wall thickness at a sample of faces: from the middle of a face, straight inwards to the
 * next face.  An estimate; `rays` bounds the work.  Returns the thicknesses found, ascending.
 */
export function wallThickness(mesh: Mesh, rays = 300): number[] {
  const faces = mesh.indices.length / 3;
  if (!faces) return [];
  const step = Math.max(1, Math.floor(faces / Math.min(rays, Math.max(1, Math.floor(20_000_000 / faces)))));
  const found: number[] = [];
  for (let face = 0; face < faces; face += step) {
    const a = corner(mesh, mesh.indices[face * 3] as number);
    const b = corner(mesh, mesh.indices[face * 3 + 1] as number);
    const c = corner(mesh, mesh.indices[face * 3 + 2] as number);
    let nx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]);
    let ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
    let nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const length = Math.hypot(nx, ny, nz);
    if (length === 0) continue;
    nx /= -length;
    ny /= -length;
    nz /= -length;
    const ox = (a[0] + b[0] + c[0]) / 3;
    const oy = (a[1] + b[1] + c[1]) / 3;
    const oz = (a[2] + b[2] + c[2]) / 3;
    let nearest = Infinity;
    for (let other = 0; other < faces; other++) {
      if (other === face) continue;
      // Möller–Trumbore.
      const p = corner(mesh, mesh.indices[other * 3] as number);
      const q = corner(mesh, mesh.indices[other * 3 + 1] as number);
      const r = corner(mesh, mesh.indices[other * 3 + 2] as number);
      const e1x = q[0] - p[0];
      const e1y = q[1] - p[1];
      const e1z = q[2] - p[2];
      const e2x = r[0] - p[0];
      const e2y = r[1] - p[1];
      const e2z = r[2] - p[2];
      const hx = ny * e2z - nz * e2y;
      const hy = nz * e2x - nx * e2z;
      const hz = nx * e2y - ny * e2x;
      const det = e1x * hx + e1y * hy + e1z * hz;
      if (Math.abs(det) < 1e-12) continue;
      const inv = 1 / det;
      const sx = ox - p[0];
      const sy = oy - p[1];
      const sz = oz - p[2];
      const u = (sx * hx + sy * hy + sz * hz) * inv;
      if (u < 0 || u > 1) continue;
      const qx = sy * e1z - sz * e1y;
      const qy = sz * e1x - sx * e1z;
      const qz = sx * e1y - sy * e1x;
      const v = (nx * qx + ny * qy + nz * qz) * inv;
      if (v < 0 || u + v > 1) continue;
      const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
      if (t > 1e-7 && t < nearest) nearest = t;
    }
    if (nearest < Infinity) found.push(nearest);
  }
  return found.sort((p, q) => p - q);
}

/* ---------------------------------------------------------------- writers -- */

function normalOf(mesh: Mesh, face: number): Vec3 {
  const a = corner(mesh, mesh.indices[face * 3] as number);
  const b = corner(mesh, mesh.indices[face * 3 + 1] as number);
  const c = corner(mesh, mesh.indices[face * 3 + 2] as number);
  const nx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]);
  const ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
  const nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const length = Math.hypot(nx, ny, nz) || 1;
  return [nx / length, ny / length, nz / length];
}

export function stlBinary(mesh: Mesh, title = 'Benchtop'): Uint8Array {
  const faces = mesh.indices.length / 3;
  const out = new Uint8Array(84 + faces * 50);
  out.set(strToU8(title.replace(/[^\x20-\x7e]/g, '?').slice(0, 79)));
  const view = new DataView(out.buffer);
  view.setUint32(80, faces, true);
  for (let face = 0; face < faces; face++) {
    const at = 84 + face * 50;
    const normal = normalOf(mesh, face);
    for (let axis = 0; axis < 3; axis++) view.setFloat32(at + axis * 4, normal[axis] as number, true);
    for (let k = 0; k < 3; k++) {
      const point = corner(mesh, mesh.indices[face * 3 + k] as number);
      for (let axis = 0; axis < 3; axis++) view.setFloat32(at + 12 + k * 12 + axis * 4, point[axis] as number, true);
    }
  }
  return out;
}

const text = (value: number) => String(Math.round(value * 1e6) / 1e6);

export function stlText(mesh: Mesh, name = 'model'): string {
  const solid = name.replace(/\s+/g, '_').replace(/[^\w.-]/g, '') || 'model';
  const lines = [`solid ${solid}`];
  for (let face = 0; face < mesh.indices.length / 3; face++) {
    lines.push(` facet normal ${normalOf(mesh, face).map(text).join(' ')}`, '  outer loop');
    for (let k = 0; k < 3; k++)
      lines.push(
        `   vertex ${corner(mesh, mesh.indices[face * 3 + k] as number)
          .map(text)
          .join(' ')}`,
      );
    lines.push('  endloop', ' endfacet');
  }
  lines.push(`endsolid ${solid}`, '');
  return lines.join('\n');
}

export function objText(mesh: Mesh, name = 'model'): string {
  const lines = ['# Written by Benchtop', `o ${name.replace(/\s+/g, '_')}`];
  for (let i = 0; i < mesh.positions.length; i += 3) lines.push(`v ${text(mesh.positions[i] as number)} ${text(mesh.positions[i + 1] as number)} ${text(mesh.positions[i + 2] as number)}`);
  for (let i = 0; i < mesh.indices.length; i += 3) lines.push(`f ${(mesh.indices[i] as number) + 1} ${(mesh.indices[i + 1] as number) + 1} ${(mesh.indices[i + 2] as number) + 1}`);
  lines.push('');
  return lines.join('\n');
}

export function plyBinary(mesh: Mesh): Uint8Array {
  const vertices = mesh.positions.length / 3;
  const faces = mesh.indices.length / 3;
  const header = strToU8(
    `ply\nformat binary_little_endian 1.0\ncomment Written by Benchtop\nelement vertex ${vertices}\nproperty float x\nproperty float y\nproperty float z\nelement face ${faces}\nproperty list uchar int vertex_indices\nend_header\n`,
  );
  const out = new Uint8Array(header.length + vertices * 12 + faces * 13);
  out.set(header);
  const view = new DataView(out.buffer);
  let at = header.length;
  for (let i = 0; i < mesh.positions.length; i++, at += 4) view.setFloat32(at, mesh.positions[i] as number, true);
  for (let face = 0; face < faces; face++) {
    view.setUint8(at, 3);
    at += 1;
    for (let k = 0; k < 3; k++, at += 4) view.setInt32(at, mesh.indices[face * 3 + k] as number, true);
  }
  return out;
}

export type ModelUnit = 'millimeter' | 'centimeter' | 'meter' | 'inch';

/** A 3MF package (the format slicers prefer): one object, in the given unit. */
export function threeMf(mesh: Mesh, unit: ModelUnit = 'millimeter'): Uint8Array {
  const parts = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<model unit="${unit}" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">`,
    ' <metadata name="Application">Benchtop</metadata>',
    ' <resources>',
    '  <object id="1" type="model">',
    '   <mesh>',
    '    <vertices>',
  ];
  for (let i = 0; i < mesh.positions.length; i += 3)
    parts.push(`     <vertex x="${text(mesh.positions[i] as number)}" y="${text(mesh.positions[i + 1] as number)}" z="${text(mesh.positions[i + 2] as number)}"/>`);
  parts.push('    </vertices>', '    <triangles>');
  for (let i = 0; i < mesh.indices.length; i += 3) parts.push(`     <triangle v1="${mesh.indices[i]}" v2="${mesh.indices[i + 1]}" v3="${mesh.indices[i + 2]}"/>`);
  parts.push('    </triangles>', '   </mesh>', '  </object>', ' </resources>', ' <build>', '  <item objectid="1"/>', ' </build>', '</model>', '');
  return zipSync({
    '[Content_Types].xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>\n',
    ),
    '_rels/.rels': strToU8(
      '<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>\n',
    ),
    '3D/3dmodel.model': strToU8(parts.join('\n')),
  });
}

/** A binary glTF with one mesh.  glTF has y pointing up, so the model (z up) is turned to stand the same way. */
export function glb(mesh: Mesh): Uint8Array {
  const bounds = boundsOf(mesh.positions);
  const indexBytes = mesh.indices.length * 4;
  const positionBytes = mesh.positions.length * 4;
  const json = JSON.stringify({
    asset: { version: '2.0', generator: 'Benchtop' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, rotation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2] }],
    meshes: [{ primitives: [{ attributes: { POSITION: 1 }, indices: 0, mode: 4 }] }],
    buffers: [{ byteLength: indexBytes + positionBytes }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: indexBytes, target: 34963 },
      { buffer: 0, byteOffset: indexBytes, byteLength: positionBytes, target: 34962 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5125, count: mesh.indices.length, type: 'SCALAR' },
      { bufferView: 1, componentType: 5126, count: mesh.positions.length / 3, type: 'VEC3', min: bounds.min, max: bounds.max },
    ],
  });
  const jsonBytes = strToU8(json.padEnd(Math.ceil(json.length / 4) * 4, ' '));
  const total = 12 + 8 + jsonBytes.length + 8 + indexBytes + positionBytes;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonBytes.length, true);
  view.setUint32(16, 0x4e4f534a, true);
  out.set(jsonBytes, 20);
  let at = 20 + jsonBytes.length;
  view.setUint32(at, indexBytes + positionBytes, true);
  view.setUint32(at + 4, 0x004e4942, true);
  at += 8;
  for (let i = 0; i < mesh.indices.length; i++, at += 4) view.setUint32(at, mesh.indices[i] as number, true);
  for (let i = 0; i < mesh.positions.length; i++, at += 4) view.setFloat32(at, mesh.positions[i] as number, true);
  return out;
}

/** Corner positions of every triangle, for drawing with flat shading. */
export function soupOf(mesh: Mesh): Float32Array {
  const out = new Float32Array(mesh.indices.length * 3);
  for (let i = 0; i < mesh.indices.length; i++) {
    const vertex = mesh.indices[i] as number;
    out[i * 3] = mesh.positions[vertex * 3] as number;
    out[i * 3 + 1] = mesh.positions[vertex * 3 + 1] as number;
    out[i * 3 + 2] = mesh.positions[vertex * 3 + 2] as number;
  }
  return out;
}
