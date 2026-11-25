/**
 * 3D Model Toolbox: measure a model, mend it for printing, make it lighter,
 * check it against a printer, and save it in another format.
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useIncomingFiles } from '../../app/handoff';
import { formatBytes } from '../../lib/bytes';
import {
  type Analysis,
  analyse,
  DEFAULT_PRINT,
  DEFAULT_REPAIR,
  dropOnBed,
  glb,
  type Mesh,
  type ModelUnit,
  objText,
  type PrintOptions,
  plyBinary,
  printReport,
  problemEdges,
  type RepairOptions,
  repair,
  scaleMesh,
  stlBinary,
  stlText,
  threeMf,
  turnMesh,
  type Vec3,
  wallThickness,
  weld,
} from '../../lib/mesh';
import { simplifyMesh } from '../../lib/mesh-simplify';
import { pickFile, saveFile } from '../../platform';
import { Icon } from '../../ui/icons';
import { type MeshView, mountMeshView } from '../../ui/mesh-view';
import { loadTriangles, MESH_ACCEPT, MESH_EXTENSIONS } from '../../ui/model-load';
import { attempt, notify } from '../../ui/toast';
import { defineCustomTool } from '../types';
import { Segmented } from './_shared';

type Tab = 'measure' | 'repair' | 'simplify' | 'print';

const TABS: readonly { value: Tab; label: string }[] = [
  { value: 'measure', label: 'Measure' },
  { value: 'repair', label: 'Repair' },
  { value: 'simplify', label: 'Simplify' },
  { value: 'print', label: 'Print check' },
];

const UNITS: readonly { id: ModelUnit; label: string; mm: number }[] = [
  { id: 'millimeter', label: 'millimetres', mm: 1 },
  { id: 'centimeter', label: 'centimetres', mm: 10 },
  { id: 'meter', label: 'metres', mm: 1000 },
  { id: 'inch', label: 'inches', mm: 25.4 },
];

const FORMATS: readonly { id: string; label: string; ext: string; mime: string }[] = [
  { id: 'stl', label: 'STL (binary)', ext: 'stl', mime: 'model/stl' },
  { id: 'stl-text', label: 'STL (text)', ext: 'stl', mime: 'model/stl' },
  { id: '3mf', label: '3MF', ext: '3mf', mime: 'model/3mf' },
  { id: 'obj', label: 'OBJ', ext: 'obj', mime: 'model/obj' },
  { id: 'ply', label: 'PLY', ext: 'ply', mime: 'application/octet-stream' },
  { id: 'glb', label: 'GLB (glTF)', ext: 'glb', mime: 'model/gltf-binary' },
];

const MATERIALS: readonly { label: string; density: number }[] = [
  { label: 'PLA', density: 1.24 },
  { label: 'PETG', density: 1.27 },
  { label: 'ABS', density: 1.04 },
  { label: 'ASA', density: 1.07 },
  { label: 'TPU', density: 1.21 },
  { label: 'Nylon', density: 1.14 },
  { label: 'Resin', density: 1.15 },
];

const n = (value: number, digits = 2) => value.toLocaleString(undefined, { maximumFractionDigits: digits });

function Row({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <li class={ok === undefined ? '' : ok ? 'is-ok' : 'is-bad'}>
      {ok !== undefined && <Icon name={ok ? 'check' : 'alert'} size={14} />}
      <span>{label}</span>
      <strong>{value}</strong>
    </li>
  );
}

function Component() {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<MeshView | null>(null);
  const [name, setName] = useState('');
  const [mesh, setMesh] = useState<Mesh | null>(null);
  const [past, setPast] = useState<Mesh[]>([]);
  const [tab, setTab] = useState<Tab>('measure');
  const [unit, setUnit] = useState<ModelUnit>('millimeter');
  const [busy, setBusy] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [options, setOptions] = useState<RepairOptions>(DEFAULT_REPAIR);
  const [keep, setKeep] = useState(50);
  const [maxError, setMaxError] = useState(0.01);
  const [lockBorder, setLockBorder] = useState(true);
  const [reduced, setReduced] = useState('');
  const [print, setPrint] = useState<PrintOptions>(DEFAULT_PRINT);
  const [walls, setWalls] = useState<number[] | null>(null);
  const [picking, setPicking] = useState(false);
  const [points, setPoints] = useState<Vec3[]>([]);
  const [format, setFormat] = useState('stl');
  const [factor, setFactor] = useState(1);
  const fresh = useRef(true);

  useEffect(() => () => view.current?.dispose(), []);

  const mm = UNITS.find((u) => u.id === unit)?.mm ?? 1;
  const report: Analysis | null = useMemo(() => (mesh ? analyse(mesh) : null), [mesh]);
  // Print checks are in millimetres, whatever unit the file is in.
  const printed = useMemo(() => (mesh && tab === 'print' ? printReport(mm === 1 ? mesh : scaleMesh(mesh, mm), print) : null), [mesh, tab, print, mm]);

  // The picture follows the mesh, the tab (overhangs and the build volume belong to the print check) and the marks.
  useEffect(() => {
    if (!mesh || !host.current) return;
    let live = true;
    void attempt(async () => {
      if (!view.current) view.current = await mountMeshView(host.current as HTMLDivElement, Math.max(420, Math.round(((host.current as HTMLDivElement).clientWidth || 800) * 0.62)));
      if (!live) return;
      const edges = problemEdges(mesh);
      view.current.show(mesh, { open: edges.open, nonManifold: edges.nonManifold, overhanging: tab === 'print' ? (printed?.overhanging ?? null) : null }, !fresh.current);
      fresh.current = false;
      view.current.setBed(tab === 'print' ? (print.bed.map((value) => value / mm) as Vec3) : null);
      view.current.setMarkers(points);
    });
    return () => {
      live = false;
    };
  }, [mesh, tab, printed, print.bed, mm]);

  useEffect(() => {
    view.current?.setMarkers(points);
  }, [points]);
  useEffect(() => {
    view.current?.setPicking(picking ? (point) => setPoints((list) => [...list, point]) : null);
  }, [picking, mesh]);

  const change = (next: Mesh) => {
    if (mesh) setPast((list) => [...list.slice(-4), mesh]);
    setMesh(next);
    setWalls(null);
    setPoints([]);
  };

  const open = (file: File | null) =>
    attempt(async () => {
      if (!file) return;
      setBusy('Opening');
      try {
        const corners = await loadTriangles(await file.arrayBuffer(), file.name);
        fresh.current = true;
        setPast([]);
        setMesh(weld(corners, 0));
        setName(file.name);
        setLog([]);
        setReduced('');
        setWalls(null);
        setPoints([]);
      } finally {
        setBusy(null);
      }
    });
  useIncomingFiles(
    (files) => void open(files[0] ?? null),
    (file) => (MESH_EXTENSIONS as readonly string[]).includes(file.name.split('.').pop()?.toLowerCase() ?? ''),
  );

  const save = () =>
    attempt(async () => {
      if (!mesh) return;
      const kind = FORMATS.find((f) => f.id === format) ?? (FORMATS[0] as (typeof FORMATS)[number]);
      const stem = name.replace(/\.[^.]+$/, '') || 'model';
      const data =
        format === 'stl'
          ? stlBinary(mesh, stem)
          : format === 'stl-text'
            ? stlText(mesh, stem)
            : format === 'obj'
              ? objText(mesh, stem)
              : format === 'ply'
                ? plyBinary(mesh)
                : format === '3mf'
                  ? threeMf(mesh, unit)
                  : glb(mesh);
      const saved = await saveFile(`${stem}.${kind.ext}`, data, kind.mime);
      if (saved.saved) notify(`Saved to ${saved.location}`);
    });

  const size = report?.bounds.size ?? [0, 0, 0];
  const distances = [];
  for (let i = 0; i + 1 < points.length; i += 2) {
    const a = points[i] as Vec3;
    const b = points[i + 1] as Vec3;
    distances.push({ d: Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]), dx: Math.abs(b[0] - a[0]), dy: Math.abs(b[1] - a[1]), dz: Math.abs(b[2] - a[2]) });
  }
  const unitShort = unit === 'millimeter' ? 'mm' : unit === 'centimeter' ? 'cm' : unit === 'meter' ? 'm' : 'in';
  const thin = walls?.length ? { least: (walls[0] as number) * mm, low: (walls[Math.floor(walls.length * 0.05)] as number) * mm, count: walls.length } : null;
  const numberInput = (label: string, value: number, apply: (next: number) => void, min = 0, step = 'any') => (
    <label class="mt-field">
      <span class="control-label">{label}</span>
      <input class="input" type="number" min={min} step={step} value={value} onChange={(e) => apply(Number(e.currentTarget.value))} />
    </label>
  );

  return (
    <section class="tool mt" data-testid="tool" data-state={busy ? 'busy' : mesh ? 'done' : 'idle'}>
      <div class="mt-bar">
        <button type="button" class="button button-primary" onClick={() => attempt(async () => open(await pickFile(MESH_ACCEPT)))} data-testid="mt-open">
          <Icon name="open" size={14} /> Open a model
        </button>
        {mesh && report && (
          <>
            <span class="mt-info" data-testid="mt-info">
              <strong>{name}</strong> {report.triangles.toLocaleString()} triangles, {n(size[0])} × {n(size[1])} × {n(size[2])} {unitShort}
            </span>
            <button
              type="button"
              class="button button-small"
              disabled={!past.length}
              onClick={() => {
                const previous = past[past.length - 1];
                if (!previous) return;
                setPast(past.slice(0, -1));
                setMesh(previous);
                setWalls(null);
                setPoints([]);
              }}
              data-testid="mt-undo"
            >
              <Icon name="left" size={13} /> Undo
            </button>
            <label class="mt-field mt-inline">
              <span class="control-label">Save as</span>
              <select class="input" value={format} onChange={(e) => setFormat(e.currentTarget.value)} data-testid="mt-format">
                {FORMATS.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" class="button" onClick={() => void save()} data-testid="mt-save">
              <Icon name="save" size={14} /> Save
            </button>
          </>
        )}
        {busy && (
          <span class="tone-muted" role="status">
            {busy}…
          </span>
        )}
      </div>

      <div class="mt-main">
        <div class="mt-stage">
          <div ref={host} class="model-stage" role="img" aria-label="3D view: drag to turn, scroll to zoom, right-drag to move" />
          {!mesh && (
            <p class="tone-muted mt-hint">
              STL, OBJ, PLY, 3MF, glTF, GLB, AMF, Collada, FBX, VRML, VTK and 3DS models. Open edges are drawn red, edges shared by too many faces purple, and the inside of faces dark red.
            </p>
          )}
        </div>

        {mesh && report && (
          <aside class="mt-side">
            <Segmented value={tab} choices={TABS} onChange={setTab} label="What to do" />

            {tab === 'measure' && (
              <div class="mt-panel">
                <ul class="mt-list" data-testid="mt-size">
                  <Row label="Size (x × y × z)" value={`${n(size[0])} × ${n(size[1])} × ${n(size[2])} ${unitShort}`} />
                  <Row label="Volume" value={report.watertight ? `${n(Math.abs(report.volume))} ${unitShort}³` : 'not closed: repair first'} />
                  <Row label="Surface" value={`${n(report.area)} ${unitShort}²`} />
                  <Row label="Triangles and vertices" value={`${report.triangles.toLocaleString()}, ${report.vertices.toLocaleString()}`} />
                </ul>
                <div class="mt-row">
                  <label class="mt-field">
                    <span class="control-label">The file is in</span>
                    <select class="input" value={unit} onChange={(e) => setUnit(e.currentTarget.value as ModelUnit)} data-testid="mt-unit">
                      {UNITS.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  {unit !== 'millimeter' && (
                    <button
                      type="button"
                      class="button button-small"
                      onClick={() => {
                        change(scaleMesh(mesh, mm));
                        setUnit('millimeter');
                      }}
                    >
                      Convert to millimetres
                    </button>
                  )}
                </div>
                <div class="mt-row">
                  <button type="button" class={`button button-small${picking ? ' is-active' : ''}`} aria-pressed={picking} onClick={() => setPicking(!picking)} data-testid="mt-pick">
                    {picking ? 'Click two points on the model…' : 'Measure between two points'}
                  </button>
                  {points.length > 0 && (
                    <button type="button" class="button button-small" onClick={() => setPoints([])}>
                      Clear
                    </button>
                  )}
                </div>
                {distances.length > 0 && (
                  <ul class="mt-list">
                    {distances.map((d, index) => (
                      <Row key={index} label={`Distance ${index + 1}`} value={`${n(d.d, 3)} ${unitShort} (x ${n(d.dx)}, y ${n(d.dy)}, z ${n(d.dz)})`} />
                    ))}
                  </ul>
                )}
                <strong>Place and turn</strong>
                <div class="mt-row">
                  <button type="button" class="button button-small" onClick={() => change(turnMesh(mesh, 0))} data-testid="mt-turn-x">
                    Turn about x
                  </button>
                  <button type="button" class="button button-small" onClick={() => change(turnMesh(mesh, 1))}>
                    Turn about y
                  </button>
                  <button type="button" class="button button-small" onClick={() => change(turnMesh(mesh, 2))}>
                    Turn about z
                  </button>
                  <button type="button" class="button button-small" onClick={() => change(dropOnBed(mesh))} data-testid="mt-drop">
                    Stand on the bed
                  </button>
                </div>
                <div class="mt-row">
                  {numberInput('Scale by', factor, (next) => setFactor(next > 0 ? next : 1), 0.0001)}
                  <button type="button" class="button button-small" disabled={factor === 1} onClick={() => change(scaleMesh(mesh, factor))} data-testid="mt-scale">
                    Scale
                  </button>
                </div>
              </div>
            )}

            {tab === 'repair' && (
              <div class="mt-panel">
                <ul class="mt-list" data-testid="mt-analysis">
                  <Row label="Closed surface (watertight)" value={report.watertight ? 'yes' : 'no'} ok={report.watertight} />
                  <Row label="Open edges" value={`${report.openEdges.toLocaleString()} in ${report.holes.toLocaleString()} ${report.holes === 1 ? 'hole' : 'holes'}`} ok={report.openEdges === 0} />
                  <Row label="Edges shared by more than two faces" value={report.nonManifoldEdges.toLocaleString()} ok={report.nonManifoldEdges === 0} />
                  <Row label="Flipped faces (edges that disagree)" value={report.flippedEdges.toLocaleString()} ok={report.flippedEdges === 0} />
                  <Row label="Inside out" value={report.volume < 0 ? 'yes' : 'no'} ok={report.volume >= 0} />
                  <Row label="Triangles without area" value={report.degenerate.toLocaleString()} ok={report.degenerate === 0} />
                  <Row label="Doubled triangles" value={report.duplicates.toLocaleString()} ok={report.duplicates === 0} />
                  <Row label="Separate shells" value={report.shells.toLocaleString()} />
                </ul>
                <label class="mt-check">
                  <input type="checkbox" checked={options.fixWinding} onChange={(e) => setOptions({ ...options, fixWinding: e.currentTarget.checked })} />
                  <span>Turn flipped faces and inside-out shells</span>
                </label>
                <label class="mt-check">
                  <input type="checkbox" checked={options.fillHoles} onChange={(e) => setOptions({ ...options, fillHoles: e.currentTarget.checked })} />
                  <span>Close holes</span>
                </label>
                <div class="mt-row">
                  {numberInput('Join corners closer than (0 = automatic)', options.tolerance, (tolerance) => setOptions({ ...options, tolerance: Math.max(0, tolerance) }))}
                  {numberInput(
                    'Remove shells of fewer triangles than',
                    options.dropShellsBelow,
                    (dropShellsBelow) => setOptions({ ...options, dropShellsBelow: Math.max(0, Math.round(dropShellsBelow)) }),
                    0,
                    '1',
                  )}
                </div>
                <button
                  type="button"
                  class="button button-primary"
                  onClick={() => {
                    const mended = repair(mesh, options);
                    change(mended.mesh);
                    setLog(mended.log);
                  }}
                  data-testid="mt-repair"
                >
                  <Icon name="play" size={14} /> Repair
                </button>
                {log.length > 0 && (
                  <ul class="mt-log" data-testid="mt-log">
                    {log.map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                )}
                <p class="tone-muted">Holes are closed with a fan of triangles around their middle: right for flat or gently curved gaps, a rough patch for large ragged ones.</p>
              </div>
            )}

            {tab === 'simplify' && (
              <div class="mt-panel">
                <label class="mt-field">
                  <span class="control-label">
                    Keep {keep}% of the triangles (about {Math.round((report.triangles * keep) / 100).toLocaleString()})
                  </span>
                  <input type="range" min={2} max={100} value={keep} onInput={(e) => setKeep(Number(e.currentTarget.value))} data-testid="mt-keep" />
                </label>
                <label class="mt-field">
                  <span class="control-label">The surface may move by at most</span>
                  <select class="input" value={maxError} onChange={(e) => setMaxError(Number(e.currentTarget.value))}>
                    <option value={0.001}>0.1% of the model's size</option>
                    <option value={0.01}>1% of the model's size</option>
                    <option value={0.05}>5% of the model's size</option>
                    <option value={1}>any amount: reach the number of triangles</option>
                  </select>
                </label>
                <label class="mt-check">
                  <input type="checkbox" checked={lockBorder} onChange={(e) => setLockBorder(e.currentTarget.checked)} />
                  <span>Leave open edges where they are</span>
                </label>
                <button
                  type="button"
                  class="button button-primary"
                  disabled={busy !== null}
                  onClick={() =>
                    attempt(async () => {
                      setBusy('Simplifying');
                      try {
                        const made = await simplifyMesh(mesh, { keep: keep / 100, maxError, lockBorder });
                        setReduced(
                          `${report.triangles.toLocaleString()} triangles became ${(made.mesh.indices.length / 3).toLocaleString()}; the surface moved by up to ${n(made.error * 100, 2)}% of the model's size.`,
                        );
                        change(made.mesh);
                      } finally {
                        setBusy(null);
                      }
                    })
                  }
                  data-testid="mt-simplify"
                >
                  <Icon name="play" size={14} /> Simplify
                </button>
                {reduced && (
                  <p data-testid="mt-reduced" role="status">
                    {reduced}
                  </p>
                )}
                <p class="tone-muted">Flat areas lose triangles first, curves and corners last (quadric error simplification by meshoptimizer).</p>
              </div>
            )}

            {tab === 'print' && printed && (
              <div class="mt-panel">
                <div class="mt-row">
                  {numberInput('Bed x (mm)', print.bed[0], (x) => setPrint({ ...print, bed: [x, print.bed[1], print.bed[2]] }), 1)}
                  {numberInput('Bed y (mm)', print.bed[1], (y) => setPrint({ ...print, bed: [print.bed[0], y, print.bed[2]] }), 1)}
                  {numberInput('Height (mm)', print.bed[2], (z) => setPrint({ ...print, bed: [print.bed[0], print.bed[1], z] }), 1)}
                </div>
                <div class="mt-row">
                  <label class="mt-field">
                    <span class="control-label">Material</span>
                    <select class="input" value={print.density} onChange={(e) => setPrint({ ...print, density: Number(e.currentTarget.value) })}>
                      {MATERIALS.map((m) => (
                        <option key={m.label} value={m.density}>
                          {m.label} ({m.density} g/cm³)
                        </option>
                      ))}
                    </select>
                  </label>
                  <label class="mt-field">
                    <span class="control-label">Filament</span>
                    <select class="input" value={print.filament} onChange={(e) => setPrint({ ...print, filament: Number(e.currentTarget.value) })}>
                      <option value={1.75}>1.75 mm</option>
                      <option value={2.85}>2.85 mm</option>
                    </select>
                  </label>
                  {numberInput('Support beyond (degrees)', print.overhang, (overhang) => setPrint({ ...print, overhang: Math.min(89, Math.max(1, overhang)) }), 1, '1')}
                  {numberInput('Thinnest wall (mm)', print.minWall, (minWall) => setPrint({ ...print, minWall: Math.max(0, minWall) }))}
                </div>
                <ul class="mt-list" data-testid="mt-print">
                  <Row label="Closed surface" value={report.watertight ? 'yes' : 'no: repair it first'} ok={report.watertight} />
                  <Row label="Faces point outwards" value={report.volume >= 0 && report.flippedEdges === 0 ? 'yes' : 'no: repair it first'} ok={report.volume >= 0 && report.flippedEdges === 0} />
                  <Row label="One piece" value={report.shells === 1 ? 'yes' : `${report.shells} separate shells`} ok={report.shells === 1} />
                  <Row
                    label="Fits the printer"
                    value={
                      printed.fits ? `yes: ${n(size[0] * mm, 1)} × ${n(size[1] * mm, 1)} × ${n(size[2] * mm, 1)} mm` : printed.fitsTurned ? 'only when turned: use Place and turn' : 'no: too large'
                    }
                    ok={printed.fits}
                  />
                  <Row
                    label="Rests on the bed"
                    value={printed.contactArea > 0 ? `${n(printed.contactArea, 1)} mm² flat on the bed` : 'no flat face is down: stand it on the bed'}
                    ok={printed.contactArea > 0}
                  />
                  <Row
                    label="Overhangs (drawn orange)"
                    value={printed.overhangArea > 0 ? `${n(printed.overhangArea, 1)} mm², ${n(printed.overhangShare * 100, 1)}% of the surface: needs support` : 'none'}
                    ok={printed.overhangShare < 0.02}
                  />
                  {thin && <Row label={`Walls (looked at in ${thin.count} places)`} value={`thinnest ${n(thin.least, 2)} mm, most above ${n(thin.low, 2)} mm`} ok={thin.low >= print.minWall} />}
                  <Row label="Volume if printed solid" value={report.watertight ? `${n(printed.volumeCm3, 2)} cm³` : 'unknown'} />
                  <Row label="Mass if printed solid" value={report.watertight ? `${n(printed.massGrams, 1)} g` : 'unknown'} />
                  <Row label="Filament if printed solid" value={report.watertight ? `${n(printed.filamentMetres, 2)} m` : 'unknown'} />
                </ul>
                <button type="button" class="button button-small" onClick={() => setWalls(wallThickness(mesh))} data-testid="mt-walls">
                  Estimate wall thickness
                </button>
                <p class="tone-muted">
                  The model is taken to stand as shown, z up, in {UNITS.find((u) => u.id === unit)?.label}. Mass and filament are for a solid print, an upper limit; a slicer gives the figures for your
                  infill and supports. File size as STL: about {formatBytes(84 + report.triangles * 50)}.
                </p>
              </div>
            )}
          </aside>
        )}
      </div>
    </section>
  );
}

export default defineCustomTool(Component);
