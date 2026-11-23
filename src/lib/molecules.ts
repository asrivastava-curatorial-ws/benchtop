/**
 * Molecule files for the 3D viewer: XYZ, MDL Molfile and SDF (V2000 and
 * V3000), PDB and Tripos MOL2.  Bonds missing from a file are worked out
 * from covalent radii.
 */
import { elementBySymbol } from './elements';

export interface Atom {
  readonly element: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** PDB atom name such as "CA". */
  readonly name?: string;
  readonly residue?: string;
  readonly residueNumber?: number;
  readonly chain?: string;
  /** HETATM records in PDB files (ligands, water). */
  readonly hetero?: boolean;
}

export interface Molecule3D {
  readonly title: string;
  readonly atoms: readonly Atom[];
  /** [first atom, second atom, order] with 0-based indices; order 4 is aromatic. */
  readonly bonds: readonly (readonly [number, number, number])[];
  readonly format: string;
}

const tidyElement = (s: string): string => {
  const letters = s.replace(/[^A-Za-z]/g, '');
  if (!letters) return 'X';
  return letters[0]?.toUpperCase() + (letters[1] ?? '').toLowerCase();
};

/** A symbol for a raw element field, falling back to its first letter (as PDB files often need). */
function element(raw: string): string {
  const two = tidyElement(raw).slice(0, 2);
  if (elementBySymbol(two)) return two;
  const one = two.slice(0, 1);
  return elementBySymbol(one) ? one : two;
}

export function parseXyz(text: string): Molecule3D {
  const lines = text.split(/\r?\n/);
  const count = Number.parseInt(lines[0] ?? '', 10);
  const body = Number.isFinite(count) ? lines.slice(2, 2 + count) : lines;
  const atoms: Atom[] = [];
  for (const line of body) {
    const f = line.trim().split(/\s+/);
    if (f.length < 4) continue;
    const [sym, x, y, z] = f;
    if (![x, y, z].every((v) => Number.isFinite(Number(v)))) continue;
    atoms.push({ element: element(sym ?? 'X'), x: Number(x), y: Number(y), z: Number(z) });
  }
  if (atoms.length === 0) throw new Error('No atoms were found: an XYZ file lists an element and x, y, z on each line.');
  return { title: Number.isFinite(count) ? (lines[1] ?? '').trim() : '', atoms, bonds: inferBonds(atoms), format: 'XYZ' };
}

export function parseMolfile(text: string): Molecule3D {
  const lines = text.split(/\r?\n/);
  const title = (lines[0] ?? '').trim();
  const counts = lines[3] ?? '';
  if (/V3000/.test(counts)) return parseV3000(lines, title);
  const atomCount = Number.parseInt(counts.slice(0, 3), 10);
  const bondCount = Number.parseInt(counts.slice(3, 6), 10);
  if (!Number.isFinite(atomCount)) throw new Error('This does not look like a Molfile: the fourth line should give the atom and bond counts.');
  const atoms: Atom[] = [];
  for (let i = 0; i < atomCount; i++) {
    const l = lines[4 + i] ?? '';
    atoms.push({ element: element(l.slice(31, 34).trim()), x: Number(l.slice(0, 10)), y: Number(l.slice(10, 20)), z: Number(l.slice(20, 30)) });
  }
  const bonds: [number, number, number][] = [];
  for (let i = 0; i < bondCount; i++) {
    const l = lines[4 + atomCount + i] ?? '';
    const a = Number.parseInt(l.slice(0, 3), 10) - 1;
    const b = Number.parseInt(l.slice(3, 6), 10) - 1;
    const order = Number.parseInt(l.slice(6, 9), 10) || 1;
    if (a >= 0 && b >= 0 && a < atoms.length && b < atoms.length) bonds.push([a, b, order]);
  }
  return { title, atoms, bonds, format: 'Molfile' };
}

function parseV3000(lines: readonly string[], title: string): Molecule3D {
  const atoms: Atom[] = [];
  const index = new Map<number, number>();
  const bonds: [number, number, number][] = [];
  let block = '';
  for (const raw of lines) {
    const line = raw.replace(/^M {2}V30 /, '').trim();
    if (/^BEGIN (ATOM|BOND)/.test(line)) block = line.slice(6);
    else if (/^END (ATOM|BOND)/.test(line)) block = '';
    else if (block === 'ATOM') {
      const f = line.split(/\s+/);
      index.set(Number(f[0]), atoms.length);
      atoms.push({ element: element(f[1] ?? 'X'), x: Number(f[2]), y: Number(f[3]), z: Number(f[4]) });
    } else if (block === 'BOND') {
      const f = line.split(/\s+/);
      const a = index.get(Number(f[2]));
      const b = index.get(Number(f[3]));
      if (a !== undefined && b !== undefined) bonds.push([a, b, Number(f[1]) || 1]);
    }
  }
  if (atoms.length === 0) throw new Error('No atoms were found in the V3000 Molfile.');
  return { title, atoms, bonds, format: 'Molfile V3000' };
}

/** The first record of an SD file. */
export const parseSdf = (text: string): Molecule3D => ({ ...parseMolfile(text.split(/^\$\$\$\$/m)[0] ?? text), format: 'SDF' });

export function parsePdb(text: string): Molecule3D {
  const atoms: Atom[] = [];
  const serials = new Map<number, number>();
  const bonds: [number, number, number][] = [];
  let title = '';
  for (const line of text.split(/\r?\n/)) {
    const record = line.slice(0, 6).trim();
    if (record === 'ENDMDL') break;
    if (record === 'TITLE' || (record === 'HEADER' && !title)) title = `${title} ${line.slice(10).trim()}`.trim();
    if (record === 'ATOM' || record === 'HETATM') {
      const name = line.slice(12, 16).trim();
      const symbol = line.slice(76, 78).trim() || name.replace(/^\d+/, '').slice(0, record === 'HETATM' ? 2 : 1);
      serials.set(Number.parseInt(line.slice(6, 11), 10), atoms.length);
      atoms.push({
        element: element(symbol),
        x: Number(line.slice(30, 38)),
        y: Number(line.slice(38, 46)),
        z: Number(line.slice(46, 54)),
        name,
        residue: line.slice(17, 20).trim(),
        residueNumber: Number.parseInt(line.slice(22, 26), 10),
        chain: line.slice(21, 22).trim() || 'A',
        hetero: record === 'HETATM',
      });
    }
    if (record === 'CONECT') {
      const from = serials.get(Number.parseInt(line.slice(6, 11), 10));
      for (let k = 11; k + 5 <= Math.min(line.length, 31); k += 5) {
        const to = serials.get(Number.parseInt(line.slice(k, k + 5), 10));
        if (from !== undefined && to !== undefined && from < to) bonds.push([from, to, 1]);
      }
    }
  }
  if (atoms.length === 0) throw new Error('No ATOM or HETATM records were found in the PDB file.');
  // Standard residues have no CONECT records, so their bonds come from distances.
  const known = new Set(bonds.map(([a, b]) => `${a},${b}`));
  for (const bond of inferBonds(atoms)) if (!known.has(`${bond[0]},${bond[1]}`)) bonds.push(bond);
  return { title: title || 'PDB structure', atoms, bonds, format: 'PDB' };
}

export function parseMol2(text: string): Molecule3D {
  const atoms: Atom[] = [];
  const index = new Map<number, number>();
  const bonds: [number, number, number][] = [];
  let section = '';
  let title = '';
  let titleNext = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('@<TRIPOS>')) {
      section = line.slice(9);
      titleNext = section === 'MOLECULE';
      continue;
    }
    if (!line || line.startsWith('#')) continue;
    if (titleNext) {
      title = line;
      titleNext = false;
      continue;
    }
    const f = line.split(/\s+/);
    if (section === 'ATOM' && f.length >= 6) {
      index.set(Number(f[0]), atoms.length);
      atoms.push({ element: element((f[5] ?? 'X').split('.')[0] ?? 'X'), x: Number(f[2]), y: Number(f[3]), z: Number(f[4]), name: f[1], residue: f[7] });
    } else if (section === 'BOND' && f.length >= 4) {
      const a = index.get(Number(f[1]));
      const b = index.get(Number(f[2]));
      const order = f[3] === 'ar' ? 4 : Number(f[3]) || 1;
      if (a !== undefined && b !== undefined) bonds.push([a, b, order]);
    }
  }
  if (atoms.length === 0) throw new Error('No atoms were found in the MOL2 file.');
  return { title, atoms, bonds, format: 'MOL2' };
}

export function parseMolecule(text: string, name: string): Molecule3D {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'xyz') return parseXyz(text);
  if (ext === 'pdb' || ext === 'ent') return parsePdb(text);
  if (ext === 'mol2') return parseMol2(text);
  if (ext === 'sdf' || ext === 'sd') return parseSdf(text);
  if (ext === 'mol') return parseMolfile(text);
  if (/^(ATOM|HETATM|HEADER)/m.test(text)) return parsePdb(text);
  if (/@<TRIPOS>/.test(text)) return parseMol2(text);
  if (/V[23]000/.test(text)) return parseSdf(text);
  return parseXyz(text);
}

/* ------------------------------------------------------------------ radii -- */

/** Covalent radii in ångströms (Cordero et al. 2008), for common elements. */
const COVALENT: Readonly<Record<string, number>> = {
  H: 0.31,
  He: 0.28,
  Li: 1.28,
  Be: 0.96,
  B: 0.84,
  C: 0.76,
  N: 0.71,
  O: 0.66,
  F: 0.57,
  Ne: 0.58,
  Na: 1.66,
  Mg: 1.41,
  Al: 1.21,
  Si: 1.11,
  P: 1.07,
  S: 1.05,
  Cl: 1.02,
  Ar: 1.06,
  K: 2.03,
  Ca: 1.76,
  Sc: 1.7,
  Ti: 1.6,
  V: 1.53,
  Cr: 1.39,
  Mn: 1.39,
  Fe: 1.32,
  Co: 1.26,
  Ni: 1.24,
  Cu: 1.32,
  Zn: 1.22,
  Ga: 1.22,
  Ge: 1.2,
  As: 1.19,
  Se: 1.2,
  Br: 1.2,
  Kr: 1.16,
  Rb: 2.2,
  Sr: 1.95,
  Y: 1.9,
  Zr: 1.75,
  Mo: 1.54,
  Ru: 1.46,
  Rh: 1.42,
  Pd: 1.39,
  Ag: 1.45,
  Cd: 1.44,
  In: 1.42,
  Sn: 1.39,
  Sb: 1.39,
  Te: 1.38,
  I: 1.39,
  Xe: 1.4,
  Cs: 2.44,
  Ba: 2.15,
  La: 2.07,
  Gd: 1.96,
  W: 1.62,
  Re: 1.51,
  Os: 1.44,
  Ir: 1.41,
  Pt: 1.36,
  Au: 1.36,
  Hg: 1.32,
  Tl: 1.45,
  Pb: 1.46,
  Bi: 1.48,
  U: 1.96,
};

/** Van der Waals radii in ångströms (Bondi 1964, Alvarez 2013 for metals), for space-filling views. */
const VDW: Readonly<Record<string, number>> = {
  H: 1.2,
  He: 1.4,
  C: 1.7,
  N: 1.55,
  O: 1.52,
  F: 1.47,
  Ne: 1.54,
  Na: 2.27,
  Mg: 1.73,
  Si: 2.1,
  P: 1.8,
  S: 1.8,
  Cl: 1.75,
  Ar: 1.88,
  K: 2.75,
  Ca: 2.31,
  Fe: 2.0,
  Cu: 1.4,
  Zn: 1.39,
  Br: 1.85,
  I: 1.98,
  Se: 1.9,
  Kr: 2.02,
  Xe: 2.16,
  Au: 1.66,
  Ag: 1.72,
  Pt: 1.72,
  Hg: 1.55,
  Pb: 2.02,
};

export const covalentRadius = (symbol: string): number => COVALENT[symbol] ?? 1.5;
export const vdwRadius = (symbol: string): number => VDW[symbol] ?? 2;

/** Bonds between atoms closer than the sum of their covalent radii plus 0.45 Å (a grid keeps this fast for proteins). */
export function inferBonds(atoms: readonly Atom[]): [number, number, number][] {
  const cell = 2.4;
  const grid = new Map<string, number[]>();
  const key = (x: number, y: number, z: number) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
  atoms.forEach((a, i) => {
    const k = key(a.x, a.y, a.z);
    const list = grid.get(k);
    if (list) list.push(i);
    else grid.set(k, [i]);
  });
  const bonds: [number, number, number][] = [];
  atoms.forEach((a, i) => {
    const cx = Math.floor(a.x / cell);
    const cy = Math.floor(a.y / cell);
    const cz = Math.floor(a.z / cell);
    const ra = covalentRadius(a.element);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) {
          for (const j of grid.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) {
            if (j <= i) continue;
            const b = atoms[j] as Atom;
            if (a.element === 'H' && b.element === 'H') continue;
            const limit = ra + covalentRadius(b.element) + 0.45;
            const d2 = (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2;
            if (d2 > 0.16 && d2 < limit * limit) bonds.push([i, j, 1]);
          }
        }
  });
  return bonds;
}

/* ------------------------------------------------------------------ facts -- */

/** The formula in Hill order (C, H, then the rest alphabetically). */
export function hillFormula(atoms: readonly Atom[]): string {
  const counts = new Map<string, number>();
  for (const a of atoms) counts.set(a.element, (counts.get(a.element) ?? 0) + 1);
  const order = [...counts.keys()].sort((a, b) => {
    const rank = (s: string) => (counts.has('C') ? (s === 'C' ? 0 : s === 'H' ? 1 : 2) : 2);
    return rank(a) - rank(b) || a.localeCompare(b);
  });
  return order.map((s) => `${s}${(counts.get(s) ?? 0) > 1 ? counts.get(s) : ''}`).join('');
}

export function molecularMass(atoms: readonly Atom[]): number {
  return atoms.reduce((m, a) => m + (elementBySymbol(a.element)?.mass ?? 0), 0);
}

export const distance = (a: Atom, b: Atom): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** The angle at `b` in degrees. */
export function angle(a: Atom, b: Atom, c: Atom): number {
  const u = [a.x - b.x, a.y - b.y, a.z - b.z];
  const v = [c.x - b.x, c.y - b.y, c.z - b.z];
  const dot = (u[0] ?? 0) * (v[0] ?? 0) + (u[1] ?? 0) * (v[1] ?? 0) + (u[2] ?? 0) * (v[2] ?? 0);
  return (Math.acos(Math.max(-1, Math.min(1, dot / (Math.hypot(...u) * Math.hypot(...v))))) * 180) / Math.PI;
}

/** Writes atoms as an XYZ file. */
export function toXyz(m: Molecule3D): string {
  return `${m.atoms.length}\n${m.title}\n${m.atoms.map((a) => `${a.element.padEnd(2)} ${a.x.toFixed(5).padStart(12)} ${a.y.toFixed(5).padStart(12)} ${a.z.toFixed(5).padStart(12)}`).join('\n')}\n`;
}
