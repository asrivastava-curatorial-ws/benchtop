import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  analyse,
  boundsOf,
  glb,
  type Mesh,
  objText,
  openLoops,
  parseStl,
  plyBinary,
  printReport,
  problemEdges,
  repair,
  scaleMesh,
  soupOf,
  stlBinary,
  stlText,
  threeMf,
  wallThickness,
  weld,
} from '../../src/lib/mesh';
import { simplifyMesh } from '../../src/lib/mesh-simplify';

/** A cube of side `s` with its corner at the origin, faces pointing outwards. */
function cube(s = 10): Mesh {
  const positions = Float32Array.from([0, 0, 0, s, 0, 0, s, s, 0, 0, s, 0, 0, 0, s, s, 0, s, s, s, s, 0, s, s]);
  const indices = Uint32Array.from([0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7]);
  return { positions, indices };
}

/** A sphere made by splitting an octahedron `levels` times. */
function sphere(levels: number, radius = 10): Mesh {
  let points: number[][] = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
  ];
  let faces = [
    [0, 2, 4],
    [2, 1, 4],
    [1, 3, 4],
    [3, 0, 4],
    [2, 0, 5],
    [1, 2, 5],
    [3, 1, 5],
    [0, 3, 5],
  ];
  for (let level = 0; level < levels; level++) {
    const cache = new Map<string, number>();
    const next: number[][] = [];
    const middle = (a: number, b: number) => {
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      let index = cache.get(key);
      if (index === undefined) {
        const p = (points[a] as number[]).map((value, i) => value + ((points[b] as number[])[i] as number));
        const length = Math.hypot(...p);
        index = points.length;
        points = [...points, p.map((value) => value / length)];
        cache.set(key, index);
      }
      return index;
    };
    for (const [a, b, c] of faces as [number, number, number][]) {
      const ab = middle(a, b);
      const bc = middle(b, c);
      const ca = middle(c, a);
      next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
    }
    faces = next;
  }
  return { positions: Float32Array.from(points.flat().map((value) => value * radius)), indices: Uint32Array.from(faces.flat()) };
}

describe('reading and welding', () => {
  it('reads binary and text STL to the same corners', () => {
    const binary = parseStl(stlBinary(cube()));
    const ascii = parseStl(new TextEncoder().encode(stlText(cube(), 'my cube')));
    expect(binary.length).toBe(108);
    expect(Array.from(ascii)).toEqual(Array.from(binary));
    expect(() => parseStl(new TextEncoder().encode('not a model'))).toThrow('not an STL');
    expect(() => parseStl(new TextEncoder().encode('solid x\nvertex 1 2 3\nendsolid x'))).toThrow('damaged');
  });

  it('joins corners in the same place', () => {
    const mesh = weld(soupOf(cube()), 0);
    expect(mesh.positions.length / 3).toBe(8);
    expect(mesh.indices.length).toBe(36);
    const loose = weld(Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0, 0.0004, 0, 0, 1, 0, 0, 0, 0, 1]), 0.001);
    expect(loose.positions.length / 3).toBe(4);
  });
});

describe('analysis', () => {
  it('measures a clean cube', () => {
    const report = analyse(cube());
    expect(report).toMatchObject({ triangles: 12, vertices: 8, openEdges: 0, holes: 0, nonManifoldEdges: 0, flippedEdges: 0, degenerate: 0, duplicates: 0, shells: 1, watertight: true });
    expect(report.volume).toBeCloseTo(1000, 6);
    expect(report.area).toBeCloseTo(600, 6);
    expect(report.bounds.size).toEqual([10, 10, 10]);
    expect(boundsOf(new Float32Array(0)).size).toEqual([0, 0, 0]);
  });

  it('finds holes, flipped faces, doubled and empty triangles, and loose shells', () => {
    const whole = cube();
    const open = { positions: whole.positions, indices: whole.indices.slice(6) }; // the bottom is missing
    const opened = analyse(open);
    expect(opened).toMatchObject({ openEdges: 4, holes: 1, watertight: false });
    expect(openLoops(open)[0]).toHaveLength(4);
    expect(problemEdges(open).open.length).toBe(4 * 6);

    const flipped = Uint32Array.from(whole.indices);
    [flipped[7], flipped[8]] = [flipped[8] as number, flipped[7] as number];
    expect(analyse({ positions: whole.positions, indices: flipped }).flippedEdges).toBe(3);

    const messy = { positions: whole.positions, indices: Uint32Array.from([...whole.indices, 0, 2, 1, 4, 4, 5]) };
    expect(analyse(messy)).toMatchObject({ duplicates: 1, degenerate: 1 });
    // The doubled triangle's three edges, and the edge the empty triangle runs along twice.
    expect(analyse(messy).nonManifoldEdges).toBe(4);

    const two = weld(Float32Array.from([...soupOf(cube()), ...soupOf(cube()).map((value) => value + 50)]), 0);
    expect(analyse(two).shells).toBe(2);
  });
});

describe('repair', () => {
  it('closes holes, turns flipped faces, and removes doubles', () => {
    const whole = cube();
    const indices = Array.from(whole.indices.slice(6));
    [indices[1], indices[2]] = [indices[2] as number, indices[1] as number]; // one top triangle flipped
    indices.push(indices[3] as number, indices[4] as number, indices[5] as number); // one triangle twice
    const broken = { positions: soupOf({ positions: whole.positions, indices: Uint32Array.from(indices) }), indices: Uint32Array.from(indices.map((_, i) => i)) };
    const before = analyse(weld(broken.positions, 0));
    expect(before.watertight).toBe(false);
    const { mesh, log } = repair(broken);
    const after = analyse(mesh);
    expect(after).toMatchObject({ openEdges: 0, holes: 0, flippedEdges: 0, duplicates: 0, degenerate: 0, shells: 1, watertight: true });
    expect(after.volume).toBeCloseTo(1000, 4);
    expect(log.join(' ')).toMatch(/joined.*doubled.*turned.*1 hole closed/);
  });

  it('turns an inside-out shell outwards and leaves a good mesh alone', () => {
    const whole = cube();
    const inside = Uint32Array.from(whole.indices);
    for (let i = 0; i < inside.length; i += 3) [inside[i + 1], inside[i + 2]] = [inside[i + 2] as number, inside[i + 1] as number];
    expect(analyse({ positions: whole.positions, indices: inside }).volume).toBeCloseTo(-1000, 6);
    const turned = repair({ positions: whole.positions, indices: inside });
    expect(analyse(turned.mesh).volume).toBeCloseTo(1000, 6);
    expect(turned.log).toEqual(['1 shell was inside out and turned outwards.']);
    expect(repair(cube()).log).toEqual(['Nothing needed mending.']);
  });

  it('drops loose bits when asked', () => {
    const two = weld(Float32Array.from([...soupOf(sphere(2)), 100, 100, 100, 101, 100, 100, 100, 101, 100]), 0);
    const { mesh, log } = repair(two, { tolerance: 0, fixWinding: true, fillHoles: false, dropShellsBelow: 10 });
    expect(analyse(mesh).shells).toBe(1);
    expect(log.join(' ')).toContain('1 loose bits of fewer than 10 triangles removed');
  });
});

describe('simplifying', () => {
  it('keeps the shape with a fraction of the triangles', async () => {
    const ball = sphere(4);
    expect(ball.indices.length / 3).toBe(2048);
    const { mesh } = await simplifyMesh(ball, { keep: 0.25, maxError: 1, lockBorder: false });
    const report = analyse(mesh);
    expect(report.triangles).toBeLessThanOrEqual(512);
    expect(report.triangles).toBeGreaterThan(300);
    expect(report.watertight).toBe(true);
    // A sphere of radius 10 holds 4189; a coarser one a little less.
    expect(report.volume).toBeGreaterThan(3900);
    expect(report.volume).toBeLessThan(4200);
    expect(report.vertices).toBeLessThan(ball.positions.length / 3);
  });
});

describe('printing', () => {
  it('reports size, overhangs, volume, mass and filament', () => {
    const report = printReport(cube(), { bed: [220, 220, 250], overhang: 45, density: 1.24, filament: 1.75, minWall: 0.8 });
    expect(report.fits).toBe(true);
    // The bottom rests on the bed; nothing hangs over.
    expect(report.contactArea).toBeCloseTo(100, 6);
    expect(report.overhangArea).toBe(0);
    expect(report.volumeCm3).toBeCloseTo(1, 9);
    expect(report.massGrams).toBeCloseTo(1.24, 9);
    expect(report.filamentMetres).toBeCloseTo(1000 / (Math.PI * 0.875 ** 2) / 1000, 9);
    // Lifted off the bed, the bottom hangs over.
    const lifted = { positions: cube().positions.map((value, i) => (i % 3 === 2 ? value + 5 : value)), indices: Uint32Array.from([...cube().indices, 0, 1, 2]) };
    const hanging = printReport({ positions: Float32Array.from([...lifted.positions, 0, 0, 0, 1, 0, 0, 0, 1, 0]), indices: Uint32Array.from([...cube().indices, 8, 10, 9]) });
    expect(hanging.overhangArea).toBeCloseTo(100, 6);
    expect(Array.from(hanging.overhanging.slice(0, 3))).toEqual([1, 1, 0]);
    const tall = printReport(scaleMesh(cube(), 23), { bed: [220, 220, 250], overhang: 45, density: 1, filament: 1.75, minWall: 0.8 });
    expect(tall.fits).toBe(false);
    const plank = printReport(
      { positions: cube().positions.map((value, i) => (i % 3 === 2 ? value * 24 : value)), indices: cube().indices },
      { bed: [250, 220, 200], overhang: 45, density: 1, filament: 1.75, minWall: 0.8 },
    );
    expect([plank.fits, plank.fitsTurned]).toEqual([false, true]);
  });

  it('estimates wall thickness by looking inwards', () => {
    const slab = { positions: cube().positions.map((value, i) => (i % 3 === 2 ? value * 0.05 : value)), indices: cube().indices };
    const found = wallThickness(slab);
    expect(found[0]).toBeCloseTo(0.5, 5);
    expect(found.at(-1)).toBeCloseTo(10, 5);
    expect(wallThickness({ positions: new Float32Array(0), indices: new Uint32Array(0) })).toEqual([]);
  });
});

describe('writing', () => {
  it('writes OBJ and PLY', () => {
    const obj = objText(cube(), 'my cube');
    expect(obj.match(/^v /gm)).toHaveLength(8);
    expect(obj.match(/^f /gm)).toHaveLength(12);
    expect(obj).toContain('\nf 1 3 2\n');
    const ply = plyBinary(cube());
    const header = new TextDecoder().decode(ply.slice(0, 200));
    expect(header).toContain('element vertex 8');
    expect(header).toContain('element face 12');
    expect(ply.length).toBe(header.indexOf('end_header\n') + 11 + 8 * 12 + 12 * 13);
  });

  it('writes a 3MF package slicers can open', () => {
    const files = unzipSync(threeMf(cube(), 'millimeter'));
    expect(Object.keys(files).sort()).toEqual(['3D/3dmodel.model', '[Content_Types].xml', '_rels/.rels']);
    const model = strFromU8(files['3D/3dmodel.model'] as Uint8Array);
    expect(model).toContain('<model unit="millimeter"');
    expect(model.match(/<vertex /g)).toHaveLength(8);
    expect(model.match(/<triangle /g)).toHaveLength(12);
    expect(model).toContain('<triangle v1="0" v2="2" v3="1"/>');
    expect(strFromU8(files['_rels/.rels'] as Uint8Array)).toContain('Target="/3D/3dmodel.model"');
  });

  it('writes a valid binary glTF', () => {
    const bytes = glb(cube());
    const view = new DataView(bytes.buffer);
    expect(view.getUint32(0, true)).toBe(0x46546c67);
    expect(view.getUint32(8, true)).toBe(bytes.length);
    const jsonLength = view.getUint32(12, true);
    expect(jsonLength % 4).toBe(0);
    const json = JSON.parse(new TextDecoder().decode(bytes.slice(20, 20 + jsonLength)));
    expect(json.accessors[0].count).toBe(36);
    expect(json.accessors[1]).toMatchObject({ count: 8, min: [0, 0, 0], max: [10, 10, 10] });
    expect(json.buffers[0].byteLength).toBe(36 * 4 + 24 * 4);
    expect(bytes.length).toBe(12 + 8 + jsonLength + 8 + json.buffers[0].byteLength);
  });
});
