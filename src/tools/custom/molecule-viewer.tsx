/**
 * Molecule Viewer: a molecule from SMILES (drawn in 2D and built in 3D with
 * OpenChemLib) or from an XYZ, Molfile, SDF, PDB or MOL2 file, turned in 3D
 * with three.js as balls and sticks, space-filling spheres, sticks or a
 * protein backbone; click atoms to measure distances and angles.
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { elementBySymbol } from '../../lib/elements';
import { type Atom, angle, covalentRadius, distance, hillFormula, type Molecule3D, molecularMass, parseMolecule, toXyz, vdwRadius } from '../../lib/molecules';
import { saveFile } from '../../platform';
import { Icon } from '../../ui/icons';
import { attempt, notify } from '../../ui/toast';
import { defineCustomTool, type Values } from '../types';
import { MultiDrop } from './_files';
import { Segmented, usePersistentState } from './_shared';

type Style = 'ball' | 'spacefill' | 'sticks' | 'trace';

const SAMPLES: readonly [string, string][] = [
  ['Water', 'O'],
  ['Carbon dioxide', 'O=C=O'],
  ['Ethanol', 'CCO'],
  ['Benzene', 'c1ccccc1'],
  ['Caffeine', 'CN1C=NC2=C1C(=O)N(C(=O)N2C)C'],
  ['Aspirin', 'CC(=O)OC1=CC=CC=C1C(=O)O'],
  ['Paracetamol', 'CC(=O)NC1=CC=C(O)C=C1'],
  ['Glucose', 'OC[C@H]1O[C@@H](O)[C@H](O)[C@@H](O)[C@@H]1O'],
  ['Vanillin', 'COc1cc(C=O)ccc1O'],
  ['Dopamine', 'NCCc1ccc(O)c(O)c1'],
  ['Capsaicin', 'COc1cc(CNC(=O)CCCC/C=C/C(C)C)ccc1O'],
  ['Adenine', 'Nc1ncnc2[nH]cnc12'],
];

interface OclFacts {
  readonly svg: string;
  readonly formula: string;
  readonly mass: number;
  readonly exactMass: number;
  readonly logP: number;
  readonly tpsa: number;
  readonly donors: number;
  readonly acceptors: number;
  readonly rotatable: number;
  readonly stereo: number;
  readonly molfile: string;
}

type Ocl = typeof import('openchemlib');
let oclReady: Promise<Ocl> | null = null;

/** OpenChemLib with its torsion tables registered (needed to build 3D shapes). */
function loadOcl(): Promise<Ocl> {
  oclReady ??= (async () => {
    const OCL = await import('openchemlib');
    const response = await fetch(new URL('openchemlib/resources.json', document.baseURI));
    if (!response.ok) throw new Error('The chemistry tables could not be loaded.');
    OCL.Resources.register(await response.text());
    return OCL;
  })().catch((error: unknown) => {
    oclReady = null;
    throw error;
  });
  return oclReady;
}

async function fromSmiles(smiles: string): Promise<{ molecule: Molecule3D; facts: OclFacts }> {
  const OCL = await loadOcl();
  let mol: InstanceType<Ocl['Molecule']>;
  try {
    mol = OCL.Molecule.fromSmiles(smiles.trim());
  } catch {
    throw new Error('That SMILES could not be read. Examples: CCO (ethanol), c1ccccc1 (benzene).');
  }
  if (mol.getAllAtoms() === 0) throw new Error('Enter a SMILES string, such as CCO for ethanol.');
  const formula = mol.getMolecularFormula();
  const properties = new OCL.MoleculeProperties(mol);
  const svg = mol.toSVG(360, 260, undefined, { autoCrop: true, autoCropMargin: 14, suppressChiralText: true });
  const shape = mol.getCompactCopy();
  const built = new OCL.ConformerGenerator(42).getOneConformerAsMolecule(shape);
  if (!built) throw new Error('A 3D shape could not be built for this molecule.');
  const atoms: Atom[] = [];
  for (let i = 0; i < built.getAllAtoms(); i++) atoms.push({ element: built.getAtomLabel(i), x: built.getAtomX(i), y: built.getAtomY(i), z: built.getAtomZ(i) });
  const bonds: [number, number, number][] = [];
  for (let b = 0; b < built.getAllBonds(); b++) bonds.push([built.getBondAtom(0, b), built.getBondAtom(1, b), built.isAromaticBond(b) ? 4 : built.getBondOrder(b)]);
  return {
    molecule: { title: smiles, atoms, bonds, format: 'SMILES' },
    facts: {
      svg,
      formula: formula.formula,
      mass: formula.relativeWeight,
      exactMass: formula.absoluteWeight,
      logP: properties.logP,
      tpsa: properties.polarSurfaceArea,
      donors: properties.donorCount,
      acceptors: properties.acceptorCount,
      rotatable: properties.rotatableBondCount,
      stereo: properties.stereoCenterCount,
      molfile: built.toMolfile(),
    },
  };
}

/* ---------------------------------------------------------------- 3D view -- */

interface Scene {
  readonly dispose: () => void;
  readonly snapshot: () => string;
}

const CHAIN_COLOURS = [0x0072b2, 0xe69f00, 0x009e73, 0xcc79a7, 0x56b4e9, 0xd55e00, 0xf0e442, 0x999999];

function colourOf(symbol: string): number {
  const hex = elementBySymbol(symbol)?.cpk;
  if (symbol === 'C') return 0x909090;
  return hex ? Number.parseInt(hex, 16) : 0xff1493;
}

async function mountMolecule(host: HTMLElement, molecule: Molecule3D, style: Style, hydrogens: boolean, onPick: (atom: number | null) => void, picked: readonly number[]): Promise<Scene> {
  const THREE = await import('three');
  const { OrbitControls } = await import('three/examples/jsm/controls/OrbitControls.js');
  const width = host.clientWidth || 700;
  const height = Math.max(380, Math.round(width * 0.62));
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(width, height);
  host.replaceChildren(renderer.domElement);
  const scene = new THREE.Scene();
  const dark = document.documentElement.dataset.theme === 'dark';
  scene.background = new THREE.Color(dark ? 0x0d1117 : 0xf4f6f8);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x404040, 2.4));
  const light = new THREE.DirectionalLight(0xffffff, 1.6);
  scene.add(light);

  const atoms = molecule.atoms;
  const visible = atoms.map((a, i) => ({ a, i })).filter(({ a }) => hydrogens || a.element !== 'H');
  const centre = new THREE.Vector3();
  for (const { a } of visible) centre.add(new THREE.Vector3(a.x, a.y, a.z));
  centre.divideScalar(Math.max(1, visible.length));
  const position = (a: Atom) => new THREE.Vector3(a.x - centre.x, a.y - centre.y, a.z - centre.z);
  const disposables: { dispose(): void }[] = [];
  const group = new THREE.Group();
  scene.add(group);
  const sphere = new THREE.SphereGeometry(1, 24, 16);
  const cylinder = new THREE.CylinderGeometry(1, 1, 1, 12);
  cylinder.translate(0, 0.5, 0);
  disposables.push(sphere, cylinder);
  const material = new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.05 });
  disposables.push(material);

  const trace = style === 'trace';
  // In backbone view the protein is drawn through its alpha carbons; ligands stay as atoms.
  const shown = trace ? visible.filter(({ a }) => (a.hetero && a.residue !== 'HOH') || a.name === 'CA') : visible;
  const radius = (a: Atom) => {
    if (style === 'spacefill') return vdwRadius(a.element);
    if (style === 'sticks') return 0.16;
    if (trace && a.name === 'CA' && !a.hetero) return 0.45;
    return a.element === 'H' ? 0.22 : Math.max(0.28, covalentRadius(a.element) * 0.45);
  };
  const atomMesh = new THREE.InstancedMesh(sphere, material, Math.max(1, shown.length));
  const matrix = new THREE.Matrix4();
  const colour = new THREE.Color();
  const chainIndex = new Map<string, number>();
  shown.forEach(({ a }, k) => {
    matrix.makeScale(radius(a), radius(a), radius(a));
    matrix.setPosition(position(a));
    atomMesh.setMatrixAt(k, matrix);
    let c = colourOf(a.element);
    if (trace && a.name === 'CA' && !a.hetero) {
      if (!chainIndex.has(a.chain ?? 'A')) chainIndex.set(a.chain ?? 'A', chainIndex.size);
      c = CHAIN_COLOURS[(chainIndex.get(a.chain ?? 'A') ?? 0) % CHAIN_COLOURS.length] as number;
    }
    atomMesh.setColorAt(k, colour.setHex(c));
  });
  atomMesh.count = shown.length;
  group.add(atomMesh);

  // Bonds: two half cylinders per bond, each in its atom's colour; double and triple bonds side by side.
  const segments: { from: InstanceType<typeof THREE.Vector3>; to: InstanceType<typeof THREE.Vector3>; colour: number; r: number }[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  const addBond = (p: InstanceType<typeof THREE.Vector3>, q: InstanceType<typeof THREE.Vector3>, cp: number, cq: number, r: number) => {
    const mid = p.clone().add(q).multiplyScalar(0.5);
    segments.push({ from: p, to: mid, colour: cp, r }, { from: mid, to: q, colour: cq, r });
  };
  if (style !== 'spacefill') {
    const shownSet = new Set(shown.map(({ i }) => i));
    if (trace) {
      const cas = shown.filter(({ a }) => a.name === 'CA' && !a.hetero);
      for (let k = 1; k < cas.length; k++) {
        const prev = cas[k - 1]?.a as Atom;
        const next = cas[k]?.a as Atom;
        if (prev.chain === next.chain && distance(prev, next) < 4.6) {
          const c = CHAIN_COLOURS[(chainIndex.get(next.chain ?? 'A') ?? 0) % CHAIN_COLOURS.length] as number;
          addBond(position(prev), position(next), c, c, 0.3);
        }
      }
    }
    for (const [i, j, order] of molecule.bonds) {
      if (!shownSet.has(i) || !shownSet.has(j)) continue;
      const a = atoms[i] as Atom;
      const b = atoms[j] as Atom;
      if (trace && !(a.hetero && b.hetero)) continue;
      const p = position(a);
      const q = position(b);
      const r = style === 'sticks' ? 0.16 : 0.11;
      const ca = colourOf(a.element);
      const cb = colourOf(b.element);
      const lines = style === 'ball' ? (order === 2 || order === 4 ? 2 : order === 3 ? 3 : 1) : 1;
      if (lines === 1) {
        addBond(p, q, ca, cb, r);
        continue;
      }
      const axis = q.clone().sub(p).normalize();
      let side = new THREE.Vector3().crossVectors(axis, up);
      if (side.lengthSq() < 1e-6) side = new THREE.Vector3(1, 0, 0);
      side.normalize().multiplyScalar(0.13);
      const offsets = lines === 2 ? [-0.5, 0.5] : [-1, 0, 1];
      offsets.forEach((o, k) => {
        const shift = side.clone().multiplyScalar(o * 1.4);
        addBond(p.clone().add(shift), q.clone().add(shift), ca, cb, order === 4 && k === 1 ? r * 0.55 : r * 0.75);
      });
    }
  }
  if (segments.length) {
    const bondMesh = new THREE.InstancedMesh(cylinder, material, segments.length);
    const y = new THREE.Vector3(0, 1, 0);
    const q = new THREE.Quaternion();
    segments.forEach((s, k) => {
      const dir = s.to.clone().sub(s.from);
      const length = dir.length();
      q.setFromUnitVectors(y, dir.clone().normalize());
      matrix.compose(s.from, q, new THREE.Vector3(s.r, length, s.r));
      bondMesh.setMatrixAt(k, matrix);
      bondMesh.setColorAt(k, colour.setHex(s.colour));
    });
    group.add(bondMesh);
  }

  // Selected atoms get a translucent halo.
  const haloMaterial = new THREE.MeshBasicMaterial({ color: 0xffb000, transparent: true, opacity: 0.45, depthWrite: false });
  disposables.push(haloMaterial);
  for (const index of picked) {
    const a = atoms[index];
    if (!a) continue;
    const halo = new THREE.Mesh(sphere, haloMaterial);
    halo.position.copy(position(a));
    halo.scale.setScalar(radius(a) * 1.35 + 0.15);
    group.add(halo);
  }

  const box = new THREE.Box3().setFromObject(group);
  const size = box.getSize(new THREE.Vector3()).length() || 10;
  const camera = new THREE.PerspectiveCamera(40, width / height, 0.05, size * 50);
  camera.position.set(0, 0, size * 1.25);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  let frame = 0;
  const render = () => {
    controls.update();
    light.position.copy(camera.position);
    renderer.render(scene, camera);
    frame = requestAnimationFrame(render);
  };
  render();

  const ray = new THREE.Raycaster();
  let downAt: [number, number] | null = null;
  const onDown = (e: PointerEvent) => {
    downAt = [e.clientX, e.clientY];
  };
  const onUp = (e: PointerEvent) => {
    if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 4) return;
    const rect = renderer.domElement.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1), camera);
    const hit = ray.intersectObject(atomMesh)[0];
    onPick(hit?.instanceId !== undefined ? (shown[hit.instanceId]?.i ?? null) : null);
  };
  renderer.domElement.addEventListener('pointerdown', onDown);
  renderer.domElement.addEventListener('pointerup', onUp);

  return {
    dispose: () => {
      cancelAnimationFrame(frame);
      renderer.domElement.removeEventListener('pointerdown', onDown);
      renderer.domElement.removeEventListener('pointerup', onUp);
      controls.dispose();
      for (const d of disposables) d.dispose();
      renderer.dispose();
    },
    snapshot: () => renderer.domElement.toDataURL('image/png'),
  };
}

/* -------------------------------------------------------------------- tool -- */

interface ViewerState {
  readonly smiles: string;
  readonly style: Style;
  readonly hydrogens: boolean;
}

const readViewer = (v: Values | undefined): ViewerState => ({
  smiles: typeof v?.smiles === 'string' ? v.smiles : 'CN1C=NC2=C1C(=O)N(C(=O)N2C)C',
  style: v?.style === 'spacefill' || v?.style === 'sticks' || v?.style === 'trace' ? v.style : 'ball',
  hydrogens: v?.hydrogens !== false,
});

function describeAtom(a: Atom, index: number): string {
  const name = elementBySymbol(a.element)?.name ?? a.element;
  const where = a.residue ? ` in ${a.residue}${a.residueNumber ?? ''}${a.chain ? ` chain ${a.chain}` : ''}` : '';
  return `${name} ${a.name ? `(${a.name}) ` : ''}#${index + 1}${where}`;
}

function MoleculeViewer({ toolId }: { toolId: string }) {
  const [state, setState] = usePersistentState(toolId, readViewer, (s) => ({ ...s }));
  const [molecule, setMolecule] = useState<Molecule3D | null>(null);
  const [facts, setFacts] = useState<OclFacts | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<number[]>([]);
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<Scene | null>(null);
  const [draft, setDraft] = useState(state.smiles);

  const build = (smiles: string) =>
    attempt(async () => {
      setBusy(true);
      setError(null);
      try {
        const result = await fromSmiles(smiles);
        setMolecule(result.molecule);
        setFacts(result.facts);
        setPicked([]);
        setState((s) => ({ ...s, smiles, style: s.style === 'trace' ? 'ball' : s.style }));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    });

  useEffect(() => {
    void build(state.smiles);
  }, []);

  useEffect(() => {
    const el = host.current;
    if (!el || !molecule) return;
    let cancelled = false;
    void mountMolecule(
      el,
      molecule,
      state.style,
      state.hydrogens,
      (atom) => {
        if (atom === null) return;
        setPicked((p) => (p.includes(atom) ? p.filter((x) => x !== atom) : [...p, atom].slice(-3)));
      },
      picked,
    ).then(
      (s) => {
        if (cancelled) s.dispose();
        else {
          scene.current?.dispose();
          scene.current = s;
        }
      },
      (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
    );
    return () => {
      cancelled = true;
    };
  }, [molecule, state.style, state.hydrogens, picked]);
  useEffect(() => () => scene.current?.dispose(), []);

  const openFile = (file: File) =>
    attempt(async () => {
      setError(null);
      try {
        const m = parseMolecule(await file.text(), file.name);
        setMolecule({ ...m, title: m.title || file.name });
        setFacts(null);
        setPicked([]);
        setState((s) => ({ ...s, style: m.atoms.length > 2500 ? 'trace' : s.style === 'trace' && m.atoms.length < 500 ? 'ball' : s.style }));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });

  const measure = useMemo(() => {
    if (!molecule) return null;
    const atoms = picked.map((i) => molecule.atoms[i]).filter((a): a is Atom => Boolean(a));
    if (atoms.length === 2) return `Distance ${distance(atoms[0] as Atom, atoms[1] as Atom).toFixed(3)} Å`;
    if (atoms.length === 3) return `Angle ${angle(atoms[0] as Atom, atoms[1] as Atom, atoms[2] as Atom).toFixed(1)}° (at the middle atom)`;
    return null;
  }, [picked, molecule]);
  const isProtein = molecule ? molecule.atoms.some((a) => a.name === 'CA' && !a.hetero) : false;

  return (
    <section class="tool mol-tool" data-testid="tool" data-state={molecule ? 'done' : busy ? 'busy' : 'idle'}>
      <form
        class="button-row"
        onSubmit={(e) => {
          e.preventDefault();
          void build(draft);
        }}
      >
        <label class="control control-inline mol-smiles">
          <span class="control-label">SMILES</span>
          <input class="input" value={draft} spellcheck={false} onInput={(e) => setDraft(e.currentTarget.value)} data-testid="mol-smiles" />
        </label>
        <button type="submit" class="button button-primary" disabled={busy} data-testid="mol-build">
          {busy ? 'Building…' : 'Show'}
        </button>
        <MultiDrop icon="file" compact accept=".pdb,.ent,.xyz,.mol,.sdf,.sd,.mol2" title="Open a file" onFiles={(f) => f[0] && openFile(f[0])} />
      </form>
      <p class="control-help">
        Try:{' '}
        {SAMPLES.map(([name, smiles], i) => (
          <span key={name}>
            {i > 0 && ', '}
            <button
              type="button"
              class="link-button"
              onClick={() => {
                setDraft(smiles);
                void build(smiles);
              }}
            >
              {name}
            </button>
          </span>
        ))}
        . Files: PDB, XYZ, Molfile, SDF and MOL2.
      </p>
      {error && <p class="recipe-error">{error}</p>}
      <div class="button-row">
        <Segmented
          label="Style"
          value={state.style}
          onChange={(style) => setState((s) => ({ ...s, style }))}
          choices={[
            { value: 'ball', label: 'Balls and sticks' },
            { value: 'spacefill', label: 'Space-filling' },
            { value: 'sticks', label: 'Sticks' },
            ...(isProtein ? [{ value: 'trace' as const, label: 'Backbone' }] : []),
          ]}
        />
        <label class="check">
          <input type="checkbox" checked={state.hydrogens} onChange={(e) => setState((s) => ({ ...s, hydrogens: e.currentTarget.checked }))} /> Hydrogens
        </label>
        {molecule && (
          <>
            <button
              type="button"
              class="button button-small"
              onClick={() =>
                attempt(async () => {
                  const data = scene.current?.snapshot();
                  if (!data) return;
                  const bytes = Uint8Array.from(atob(data.split(',')[1] ?? ''), (ch) => ch.charCodeAt(0));
                  const outcome = await saveFile(`${(molecule.title || 'molecule').slice(0, 40).replace(/[^\w-]+/g, '_')}.png`, bytes, 'image/png');
                  if (outcome.saved) notify(`Saved to ${outcome.location}`);
                })
              }
            >
              <Icon name="image" size={12} /> Save picture
            </button>
            <button
              type="button"
              class="button button-small"
              onClick={() =>
                attempt(async () => {
                  const outcome = facts ? await saveFile('molecule.mol', facts.molfile, 'chemical/x-mdl-molfile') : await saveFile('molecule.xyz', toXyz(molecule), 'chemical/x-xyz');
                  if (outcome.saved) notify(`Saved to ${outcome.location}`);
                })
              }
            >
              <Icon name="save" size={12} /> Save 3D coordinates
            </button>
          </>
        )}
      </div>
      <div class="mol-layout">
        <div class="mol-view" ref={host} data-testid="mol-view" />
        <aside class="mol-side">
          {facts && <img class="mol-2d" src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(facts.svg)}`} alt={`Structure of ${state.smiles}`} data-testid="mol-2d" />}
          {molecule && (
            <dl class="flt-facts mol-facts" data-testid="mol-facts">
              <div>
                <dt>Formula</dt>
                <dd>{facts?.formula ?? hillFormula(molecule.atoms)}</dd>
              </div>
              <div>
                <dt>Molar mass</dt>
                <dd>{(facts?.mass ?? molecularMass(molecule.atoms)).toFixed(3)} g/mol</dd>
              </div>
              {facts && (
                <>
                  <div>
                    <dt>Exact mass</dt>
                    <dd>{facts.exactMass.toFixed(4)}</dd>
                  </div>
                  <div>
                    <dt>logP</dt>
                    <dd>{facts.logP.toFixed(2)}</dd>
                  </div>
                  <div>
                    <dt>Polar surface</dt>
                    <dd>{facts.tpsa.toFixed(1)} Å²</dd>
                  </div>
                  <div>
                    <dt>H-bond donors, acceptors</dt>
                    <dd>
                      {facts.donors}, {facts.acceptors}
                    </dd>
                  </div>
                  <div>
                    <dt>Rotatable bonds</dt>
                    <dd>{facts.rotatable}</dd>
                  </div>
                  <div>
                    <dt>Stereo centres</dt>
                    <dd>{facts.stereo}</dd>
                  </div>
                </>
              )}
              <div>
                <dt>Atoms, bonds</dt>
                <dd>
                  {molecule.atoms.length}, {molecule.bonds.length}
                </dd>
              </div>
            </dl>
          )}
          <div class="mol-picked" data-testid="mol-picked">
            {picked.length === 0 ? (
              <p class="control-help">Drag to turn, scroll to zoom. Click two atoms for their distance, three for an angle.</p>
            ) : (
              <>
                <ol>
                  {picked.map((i) => (
                    <li key={i}>{molecule?.atoms[i] ? describeAtom(molecule.atoms[i] as Atom, i) : ''}</li>
                  ))}
                </ol>
                {measure && <strong>{measure}</strong>}
                <button type="button" class="link-button" onClick={() => setPicked([])}>
                  Clear the selection
                </button>
              </>
            )}
          </div>
          <p class="control-help">Built and drawn on this computer with OpenChemLib and three.js; 3D shapes from SMILES are good guesses, not measured structures.</p>
        </aside>
      </div>
    </section>
  );
}

export default defineCustomTool(MoleculeViewer);
