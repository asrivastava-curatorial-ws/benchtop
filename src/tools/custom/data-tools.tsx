/**
 * SQLite Browser (open .db files or load CSV files as tables, run SQL, export),
 * Certificate Maker (self-signed certificates and CAs, signing requests, PEM /
 * DER / PFX conversion) and 3D Model and G-code Viewer.
 */

import forge from 'node-forge';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Database, SqlJsStatic } from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm-browser.wasm?url';
import { useIncomingFiles } from '../../app/handoff';
import { formatBytes } from '../../lib/bytes';
import { errorMessage } from '../../lib/errors';
import { parseGcode } from '../../lib/gcode';
import { copyText, pickFile, pickFiles, saveFile } from '../../platform';
import { scrollRegion } from '../../ui/a11y';
import { CodeEditor } from '../../ui/CodeEditor';
import { attempt, notify } from '../../ui/toast';
import { defineCustomTool, type Values } from '../types';
import { Segmented, usePersistentState } from './_shared';

/* -------------------------------------------------------- SQLite browser -- */

let sqlLoaded: Promise<SqlJsStatic> | null = null;
const loadSql = () => {
  sqlLoaded ??= import('sql.js').then((m) => (m.default as unknown as (config: object) => Promise<SqlJsStatic>)({ locateFile: () => wasmUrl }));
  sqlLoaded.catch(() => {
    sqlLoaded = null;
  });
  return sqlLoaded;
};

interface Result {
  readonly columns: string[];
  readonly rows: unknown[][];
  readonly ms: number;
  readonly changes: number;
}

const quoteId = (name: string) => `"${name.replace(/"/g, '""')}"`;

/** Loads parsed CSV rows into a new table, typing columns as INTEGER, REAL or TEXT. */
function importCsv(db: Database, name: string, rows: string[][]): string {
  const [header, ...data] = rows;
  if (!header?.length) throw new Error(`${name} has no header row.`);
  const table =
    name
      .replace(/\.[^.]+$/, '')
      .replace(/[^\w]+/g, '_')
      .replace(/^(\d)/, '_$1') || 'data';
  const columns = header.map((h, i) => (h.trim() || `column${i + 1}`).replace(/"/g, ''));
  const types = columns.map((_, i) => {
    const values = data.map((r) => r[i] ?? '').filter((v) => v !== '');
    if (values.length && values.every((v) => /^-?\d+$/.test(v))) return 'INTEGER';
    if (values.length && values.every((v) => /^-?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(v))) return 'REAL';
    return 'TEXT';
  });
  db.run(`DROP TABLE IF EXISTS ${quoteId(table)}`);
  db.run(`CREATE TABLE ${quoteId(table)} (${columns.map((c, i) => `${quoteId(c)} ${types[i]}`).join(', ')})`);
  const insert = db.prepare(`INSERT INTO ${quoteId(table)} VALUES (${columns.map(() => '?').join(', ')})`);
  db.run('BEGIN');
  for (const row of data) {
    if (row.length === 1 && row[0] === '') continue;
    insert.run(
      columns.map((_, i) => {
        const v = row[i] ?? '';
        if (v === '') return null;
        return types[i] === 'TEXT' ? v : Number(v);
      }),
    );
  }
  db.run('COMMIT');
  insert.free();
  return table;
}

function SqliteBrowser({ toolId }: { toolId: string }) {
  const [state, setState] = usePersistentState<{ sql: string }>(
    toolId,
    (s: Values | undefined) => ({ sql: typeof s?.sql === 'string' ? s.sql : "SELECT name, type FROM sqlite_schema WHERE type IN ('table', 'view') ORDER BY name;" }),
    (s) => ({ ...s }),
  );
  const db = useRef<Database | null>(null);
  const [name, setName] = useState('');
  const [tables, setTables] = useState<{ name: string; rows: number; sql: string }[]>([]);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState('');
  const refresh = () => {
    if (!db.current) return;
    const list = db.current.exec("SELECT name, sql FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")[0]?.values ?? [];
    setTables(list.map(([n, sql]) => ({ name: String(n), sql: String(sql ?? ''), rows: Number(db.current?.exec(`SELECT count(*) FROM ${quoteId(String(n))}`)[0]?.values[0]?.[0] ?? 0) })));
  };
  const openDb = async (bytes?: Uint8Array, label = 'new database') => {
    const SQL = await loadSql();
    db.current?.close();
    db.current = bytes ? new SQL.Database(bytes) : new SQL.Database();
    setName(label);
    setResult(null);
    setError('');
    refresh();
  };
  useEffect(() => () => db.current?.close(), []);
  const run = () => {
    if (!db.current) return;
    const started = performance.now();
    try {
      const results = db.current.exec(state.sql);
      const last = results[results.length - 1];
      setResult({ columns: last?.columns ?? [], rows: (last?.values ?? []).slice(0, 2000) as unknown[][], ms: performance.now() - started, changes: db.current.getRowsModified() });
      setError('');
      refresh();
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const csv = (columns: string[], rows: unknown[][]) =>
    [columns, ...rows].map((r) => r.map((v) => (v === null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))).join(',')).join('\n');
  useIncomingFiles((files) =>
    attempt(async () => {
      const file = files[0] as File;
      await openDb(new Uint8Array(await file.arrayBuffer()), file.name);
    }),
  );
  return (
    <div data-testid="tool" class="tool sqlite-tool">
      <div class="button-row">
        <button
          type="button"
          class="button button-primary"
          data-testid="sqlite-open"
          onClick={() =>
            attempt(async () => {
              const file = await pickFile('.db,.sqlite,.sqlite3,.db3,application/x-sqlite3');
              if (file) await openDb(new Uint8Array(await file.arrayBuffer()), file.name);
            })
          }
        >
          Open a database
        </button>
        <button type="button" class="button" onClick={() => attempt(() => openDb())}>
          New empty database
        </button>
        <button
          type="button"
          class="button"
          data-testid="sqlite-csv"
          onClick={() =>
            attempt(async () => {
              const files = await pickFiles('.csv,.tsv,text/csv');
              if (!files.length) return;
              if (!db.current) await openDb(undefined, 'CSV tables');
              const Papa = (await import('papaparse')).default;
              const made: string[] = [];
              for (const file of files) {
                const parsed = Papa.parse<string[]>(await file.text(), { skipEmptyLines: 'greedy' });
                made.push(importCsv(db.current as Database, file.name, parsed.data));
              }
              refresh();
              setState({ sql: `SELECT * FROM ${quoteId(made[0] as string)} LIMIT 100;` });
              notify(`Loaded ${made.join(', ')}.`);
            })
          }
        >
          Load CSV files as tables
        </button>
        {name && (
          <button
            type="button"
            class="button button-quiet"
            onClick={() =>
              attempt(async () => void (await saveFile(name.endsWith('.db') || name.endsWith('.sqlite') ? name : 'database.sqlite', db.current?.export() ?? new Uint8Array(), 'application/x-sqlite3')))
            }
          >
            Save the database
          </button>
        )}
        {name && <span class="tone-muted">{name}</span>}
      </div>
      {name && (
        <div class="sqlite-layout">
          <aside class="sqlite-tables" data-testid="sqlite-tables">
            <h3>Tables</h3>
            {tables.length === 0 && <p class="tone-muted">No tables yet.</p>}
            <ul>
              {tables.map((t) => (
                <li key={t.name}>
                  <button type="button" class="link-button" title={t.sql} onClick={() => setState({ sql: `SELECT * FROM ${quoteId(t.name)} LIMIT 100;` })}>
                    {t.name}
                  </button>{' '}
                  <span class="tone-muted">{t.rows} rows</span>
                </li>
              ))}
            </ul>
          </aside>
          <div class="sqlite-main">
            <div class="pane sqlite-editor">
              <div class="pane-body">
                <CodeEditor value={state.sql} onChange={(sql) => setState({ sql })} label="SQL" testId="sqlite-sql" />
              </div>
              <div class="pane-footer button-row">
                <button type="button" class="button button-primary" onClick={run} data-testid="sqlite-run">
                  Run
                </button>
                {result && (
                  <span class="tone-muted">
                    {result.rows.length === 2000 ? 'First 2000 rows' : `${result.rows.length} rows`}
                    {result.changes ? `, ${result.changes} changed` : ''} in {result.ms.toFixed(1)} ms
                  </span>
                )}
                {result && result.columns.length > 0 && (
                  <>
                    <button type="button" class="button button-small" onClick={() => attempt(async () => void (await saveFile('query.csv', csv(result.columns, result.rows), 'text/csv')))}>
                      CSV
                    </button>
                    <button
                      type="button"
                      class="button button-small"
                      onClick={() =>
                        attempt(async () => {
                          await copyText(
                            JSON.stringify(
                              result.rows.map((r) => Object.fromEntries(result.columns.map((c, i) => [c, r[i]]))),
                              null,
                              2,
                            ),
                          );
                          notify('Copied as JSON.');
                        })
                      }
                    >
                      Copy JSON
                    </button>
                  </>
                )}
              </div>
            </div>
            {error && <p class="recipe-error">{error}</p>}
            {result && result.columns.length > 0 && (
              <div class="sqlite-results" {...scrollRegion('Query results')}>
                <table class="data-table" data-testid="sqlite-results">
                  <thead>
                    <tr>
                      {result.columns.map((c) => (
                        <th key={c}>{c}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {result.rows.map((row, i) => (
                      <tr key={i}>
                        {row.map((v, j) => (
                          <td key={j} class={v === null ? 'is-null' : ''}>
                            {v === null ? 'NULL' : v instanceof Uint8Array ? `(${formatBytes(v.length)} blob)` : String(v)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
      {!name && <p class="tone-muted">Open SQLite files from apps and phones, or load CSV files and query them with SQL (joins, GROUP BY, window functions). Nothing leaves this computer.</p>}
    </div>
  );
}

/* --------------------------------------------------------- certificates -- */

const toBinary = (bytes: Uint8Array) => {
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return out;
};
const fromBinary = (text: string) => Uint8Array.from(text, (c) => c.charCodeAt(0));

async function rsaKey(bits: number): Promise<forge.pki.rsa.KeyPair> {
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: bits, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  const privateKey = forge.pki.privateKeyFromAsn1(forge.asn1.fromDer(forge.util.createBuffer(toBinary(pkcs8)))) as forge.pki.rsa.PrivateKey;
  return { privateKey, publicKey: forge.pki.setRsaPublicKey(privateKey.n, privateKey.e) };
}

interface CertForm {
  readonly cn: string;
  readonly sans: string;
  readonly org: string;
  readonly country: string;
  readonly days: number;
  readonly bits: number;
  readonly ca: boolean;
}

/** Subject Alternative Names: IP addresses and DNS names from a comma or space separated list. */
const altNames = (text: string) =>
  text
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((name) => (/^[\d.]+$|:/.test(name) ? { type: 7, ip: name } : { type: 2, value: name }));

function CertificateMaker({ toolId }: { toolId: string }) {
  const [tab, setTab] = useState<'make' | 'csr' | 'convert'>('make');
  const [f, setF] = usePersistentState<CertForm>(
    toolId,
    (v: Values | undefined) => ({
      cn: typeof v?.cn === 'string' ? v.cn : 'localhost',
      sans: typeof v?.sans === 'string' ? v.sans : 'localhost, 127.0.0.1, ::1',
      org: typeof v?.org === 'string' ? v.org : '',
      country: typeof v?.country === 'string' ? v.country : 'IN',
      days: typeof v?.days === 'number' ? v.days : 825,
      bits: typeof v?.bits === 'number' ? v.bits : 2048,
      ca: v?.ca === true,
    }),
    (v) => ({ ...v }),
  );
  const [out, setOut] = useState<{ cert?: string; key: string; csr?: string } | null>(null);
  const [password, setPassword] = useState('');
  const [convertInput, setConvertInput] = useState<{ name: string; bytes: Uint8Array } | null>(null);
  const subject = () => [
    { name: 'commonName', value: f.cn },
    ...(f.org ? [{ name: 'organizationName', value: f.org }] : []),
    ...(f.country ? [{ name: 'countryName', value: f.country.toUpperCase().slice(0, 2) }] : []),
  ];
  const make = () =>
    attempt(async () => {
      const keys = await rsaKey(f.bits);
      if (tab === 'csr') {
        const csr = forge.pki.createCertificationRequest();
        csr.publicKey = keys.publicKey;
        csr.setSubject(subject());
        const names = altNames(f.sans);
        if (names.length) csr.setAttributes([{ name: 'extensionRequest', extensions: [{ name: 'subjectAltName', altNames: names }] }]);
        csr.sign(keys.privateKey, forge.md.sha256.create());
        setOut({ csr: forge.pki.certificationRequestToPem(csr), key: forge.pki.privateKeyToPem(keys.privateKey) });
        return;
      }
      const cert = forge.pki.createCertificate();
      cert.publicKey = keys.publicKey;
      const serial = crypto.getRandomValues(new Uint8Array(16));
      serial[0] = (serial[0] as number) & 0x7f;
      cert.serialNumber = Array.from(serial, (b) => b.toString(16).padStart(2, '0')).join('');
      cert.validity.notBefore = new Date(Date.now() - 60_000);
      cert.validity.notAfter = new Date(Date.now() + f.days * 86_400_000);
      cert.setSubject(subject());
      cert.setIssuer(subject());
      const names = altNames(f.sans);
      cert.setExtensions([
        { name: 'basicConstraints', cA: f.ca, critical: f.ca },
        f.ca ? { name: 'keyUsage', keyCertSign: true, cRLSign: true, digitalSignature: true, critical: true } : { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, critical: true },
        ...(f.ca ? [] : [{ name: 'extKeyUsage', serverAuth: true, clientAuth: true }]),
        ...(names.length ? [{ name: 'subjectAltName', altNames: names }] : []),
        { name: 'subjectKeyIdentifier' },
      ]);
      cert.sign(keys.privateKey, forge.md.sha256.create());
      setOut({ cert: forge.pki.certificateToPem(cert), key: forge.pki.privateKeyToPem(keys.privateKey) });
    });
  const field = (key: 'cn' | 'sans' | 'org' | 'country', label: string) => (
    <label class="control">
      <span class="control-label">{label}</span>
      <input class="input" value={f[key]} onInput={(e) => setF((v) => ({ ...v, [key]: e.currentTarget.value }))} />
    </label>
  );
  const convert = (target: 'pem' | 'der' | 'pfx') =>
    attempt(async () => {
      if (!convertInput) return;
      const { bytes, name } = convertInput;
      const base = name.replace(/\.[^.]+$/, '');
      const text = new TextDecoder().decode(bytes);
      if (/\.(p12|pfx)$/i.test(name)) {
        const p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(forge.util.createBuffer(toBinary(bytes))), false, password);
        const certs = (p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? []).flatMap((b) => (b.cert ? [forge.pki.certificateToPem(b.cert)] : []));
        const keys = (p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] ?? []).flatMap((b) => (b.key ? [forge.pki.privateKeyToPem(b.key)] : []));
        await saveFile(`${base}.pem`, [...certs, ...keys].join(''), 'application/x-pem-file');
        return;
      }
      const pemCerts = text.match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g) ?? [];
      const pemKey = /-----BEGIN (?:RSA )?PRIVATE KEY-----[\s\S]+?-----END (?:RSA )?PRIVATE KEY-----/.exec(text)?.[0];
      if (target === 'der') {
        const cert = pemCerts[0] ? forge.pki.certificateFromPem(pemCerts[0]) : null;
        if (!cert) throw new Error('No PEM certificate found to convert.');
        await saveFile(`${base}.der`, fromBinary(forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes()), 'application/pkix-cert');
      } else if (target === 'pem') {
        const cert = forge.pki.certificateFromAsn1(forge.asn1.fromDer(forge.util.createBuffer(toBinary(bytes))));
        await saveFile(`${base}.pem`, forge.pki.certificateToPem(cert), 'application/x-pem-file');
      } else {
        if (!pemCerts.length || !pemKey) throw new Error('A .pfx needs a PEM file with both the certificate and its private key.');
        const asn1 = forge.pkcs12.toPkcs12Asn1(
          forge.pki.privateKeyFromPem(pemKey),
          pemCerts.map((c) => forge.pki.certificateFromPem(c)),
          password,
          { algorithm: '3des' },
        );
        await saveFile(`${base}.pfx`, fromBinary(forge.asn1.toDer(asn1).getBytes()), 'application/x-pkcs12');
      }
    });
  return (
    <div data-testid="tool" class="tool cert-tool">
      <Segmented
        label="Task"
        value={tab}
        onChange={(t) => {
          setTab(t);
          setOut(null);
        }}
        choices={[
          { value: 'make', label: 'Self-signed certificate' },
          { value: 'csr', label: 'Signing request (CSR)' },
          { value: 'convert', label: 'Convert formats' },
        ]}
      />
      {tab !== 'convert' && (
        <>
          <div class="control-row">
            {field('cn', 'Common name')}
            {field('sans', 'Other names (DNS names and IPs)')}
            {field('org', 'Organisation')}
            {field('country', 'Country')}
            {tab === 'make' && (
              <label class="control">
                <span class="control-label">Valid for (days)</span>
                <input class="input" type="number" min={1} max={36500} value={f.days} onInput={(e) => setF((v) => ({ ...v, days: Number(e.currentTarget.value) || 825 }))} />
              </label>
            )}
            <label class="control">
              <span class="control-label">RSA key size</span>
              <select class="input" value={f.bits} onChange={(e) => setF((v) => ({ ...v, bits: Number(e.currentTarget.value) }))}>
                <option value={2048}>2048</option>
                <option value={3072}>3072</option>
                <option value={4096}>4096</option>
              </select>
            </label>
            {tab === 'make' && (
              <label class="check">
                <input type="checkbox" checked={f.ca} onChange={(e) => setF((v) => ({ ...v, ca: e.currentTarget.checked }))} /> Certificate authority (to sign other certificates)
              </label>
            )}
          </div>
          <button type="button" class="button button-primary" onClick={make} data-testid="cert-make">
            {tab === 'csr' ? 'Make the request and key' : 'Make the certificate and key'}
          </button>
          {out && (
            <div class="cert-outputs">
              {[
                ['Certificate', out.cert, 'certificate.pem'],
                ['Signing request', out.csr, 'request.csr'],
                ['Private key (keep it secret)', out.key, 'private-key.pem'],
              ].map(([label, text, file]) =>
                text ? (
                  <section key={file} class="pane" data-testid="cert-output">
                    <div class="pane-header">
                      <h2 class="pane-title">{label}</h2>
                      <div class="pane-actions">
                        <button type="button" class="button button-small" onClick={() => attempt(async () => void (await copyText(text as string)))}>
                          Copy
                        </button>
                        <button type="button" class="button button-small" onClick={() => attempt(async () => void (await saveFile(file as string, text as string, 'application/x-pem-file')))}>
                          Save
                        </button>
                      </div>
                    </div>
                    <pre class="wg-text" {...scrollRegion('Text')}>
                      {text}
                    </pre>
                  </section>
                ) : null,
              )}
            </div>
          )}
        </>
      )}
      {tab === 'convert' && (
        <div class="cert-convert">
          <button
            type="button"
            class="button"
            onClick={() =>
              attempt(async () => {
                const file = await pickFile('.pem,.crt,.cer,.der,.key,.p12,.pfx');
                if (file) setConvertInput({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
              })
            }
          >
            {convertInput ? convertInput.name : 'Choose a certificate file'}
          </button>
          <label class="control">
            <span class="control-label">Password (for .pfx / .p12)</span>
            <input class="input" type="password" autoComplete="off" value={password} onInput={(e) => setPassword(e.currentTarget.value)} />
          </label>
          <div class="button-row">
            <button type="button" class="button" disabled={!convertInput} onClick={() => convert('der')}>
              PEM → DER
            </button>
            <button type="button" class="button" disabled={!convertInput} onClick={() => convert('pem')}>
              DER or PFX → PEM
            </button>
            <button type="button" class="button" disabled={!convertInput} onClick={() => convert('pfx')}>
              PEM (certificate + key) → PFX
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------- 3D models, G-code -- */

function ModelViewer() {
  const host = useRef<HTMLDivElement>(null);
  const [info, setInfo] = useState('');
  const [showTravel, setShowTravel] = useState(false);
  const scene = useRef<{ dispose: () => void; setTravel?: (on: boolean) => void } | null>(null);
  useEffect(() => () => scene.current?.dispose(), []);
  useEffect(() => scene.current?.setTravel?.(showTravel), [showTravel]);
  const open = (file: File | null) => {
    if (!file || !host.current) return;
    attempt(async () => {
      const THREE = await import('three');
      const { OrbitControls } = await import('three/examples/jsm/controls/OrbitControls.js');
      scene.current?.dispose();
      const element = host.current as HTMLDivElement;
      const width = element.clientWidth || 800;
      const height = Math.max(420, Math.round(width * 0.6));
      const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
      renderer.setPixelRatio(window.devicePixelRatio);
      renderer.setSize(width, height);
      element.replaceChildren(renderer.domElement);
      const world = new THREE.Scene();
      world.background = new THREE.Color(document.documentElement.dataset.theme === 'dark' ? 0x161b22 : 0xf4f6f8);
      const camera = new THREE.PerspectiveCamera(45, width / height, 0.01, 100000);
      world.add(new THREE.HemisphereLight(0xffffff, 0x444444, 2.2));
      const sun = new THREE.DirectionalLight(0xffffff, 2);
      sun.position.set(1, 2, 3);
      world.add(sun);
      const bytes = await file.arrayBuffer();
      const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
      let object: InstanceType<typeof THREE.Object3D>;
      let travel: InstanceType<typeof THREE.LineSegments> | null = null;
      const material = new THREE.MeshStandardMaterial({ color: 0x53c9a0, metalness: 0.1, roughness: 0.6, flatShading: false });
      if (ext === 'stl') {
        const { STLLoader } = await import('three/examples/jsm/loaders/STLLoader.js');
        const geometry = new STLLoader().parse(bytes);
        geometry.computeVertexNormals();
        object = new THREE.Mesh(geometry, material);
        setInfo(`${(geometry.attributes.position?.count ?? 0) / 3} triangles`);
      } else if (ext === 'ply') {
        const { PLYLoader } = await import('three/examples/jsm/loaders/PLYLoader.js');
        const geometry = new PLYLoader().parse(bytes);
        geometry.computeVertexNormals();
        object =
          geometry.index || geometry.attributes.normal
            ? new THREE.Mesh(geometry, geometry.attributes.color ? new THREE.MeshStandardMaterial({ vertexColors: true }) : material)
            : new THREE.Points(geometry, new THREE.PointsMaterial({ size: 0.01, vertexColors: Boolean(geometry.attributes.color) }));
        setInfo(`${geometry.attributes.position?.count ?? 0} points`);
      } else if (ext === 'obj') {
        const { OBJLoader } = await import('three/examples/jsm/loaders/OBJLoader.js');
        object = new OBJLoader().parse(new TextDecoder().decode(bytes));
        object.traverse((child) => {
          if ((child as InstanceType<typeof THREE.Mesh>).isMesh) (child as InstanceType<typeof THREE.Mesh>).material = material;
        });
        setInfo('OBJ model');
      } else if (ext === 'glb' || ext === 'gltf') {
        const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
        const gltf = await new GLTFLoader().parseAsync(ext === 'glb' ? bytes : new TextDecoder().decode(bytes), '');
        object = gltf.scene;
        setInfo(`glTF: ${gltf.scenes.length} scene(s), ${gltf.animations.length} animation(s)`);
      } else if (['gcode', 'gco', 'nc', 'ngc', 'tap', 'g'].includes(ext)) {
        const path = parseGcode(new TextDecoder().decode(bytes));
        const group = new THREE.Group();
        const cuts = new THREE.BufferGeometry();
        cuts.setAttribute('position', new THREE.BufferAttribute(path.segments, 3));
        const colours = new Float32Array(path.segments.length);
        const [, , z0, , , z1] = path.box;
        for (let i = 0; i < path.segments.length; i += 3) {
          const t = z1 > z0 ? ((path.segments[i + 2] as number) - z0) / (z1 - z0) : 0;
          const c = new THREE.Color().setHSL(0.6 - t * 0.6, 0.75, 0.5);
          colours.set([c.r, c.g, c.b], i);
        }
        cuts.setAttribute('color', new THREE.BufferAttribute(colours, 3));
        group.add(new THREE.LineSegments(cuts, new THREE.LineBasicMaterial({ vertexColors: true })));
        const moves = new THREE.BufferGeometry();
        moves.setAttribute('position', new THREE.BufferAttribute(path.travel, 3));
        travel = new THREE.LineSegments(moves, new THREE.LineBasicMaterial({ color: 0x888888, transparent: true, opacity: 0.35 }));
        travel.visible = showTravel;
        group.add(travel);
        group.rotation.x = -Math.PI / 2;
        object = group;
        const [x0, y0, , x1, y1] = path.box;
        setInfo(`${path.layers} layers, ${(path.length / 1000).toFixed(2)} m of moves, ${(x1 - x0).toFixed(1)} × ${(y1 - y0).toFixed(1)} × ${(z1 - z0).toFixed(1)} mm`);
      } else throw new Error('Open an STL, OBJ, PLY, GLB, glTF or G-code file.');
      world.add(object);
      const bounds = new THREE.Box3().setFromObject(object);
      const size = bounds.getSize(new THREE.Vector3()).length() || 1;
      const centre = bounds.getCenter(new THREE.Vector3());
      camera.position.copy(centre).add(new THREE.Vector3(size * 0.6, size * 0.5, size * 0.8));
      camera.near = size / 1000;
      camera.far = size * 100;
      camera.updateProjectionMatrix();
      const grid = new THREE.GridHelper(size * 1.5, 20, 0x888888, 0x444444);
      grid.position.y = bounds.min.y;
      world.add(grid);
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.target.copy(centre);
      controls.update();
      let frame = 0;
      const tick = () => {
        frame = requestAnimationFrame(tick);
        controls.update();
        renderer.render(world, camera);
      };
      tick();
      scene.current = {
        dispose: () => {
          cancelAnimationFrame(frame);
          controls.dispose();
          renderer.dispose();
        },
        setTravel: (on) => {
          if (travel) travel.visible = on;
        },
      };
    });
  };
  useIncomingFiles((files) => open(files[0] ?? null));

  return (
    <div data-testid="tool" class="tool model-tool">
      <div class="button-row">
        <button type="button" class="button button-primary" data-testid="model-open" onClick={() => attempt(async () => open(await pickFile('.stl,.obj,.ply,.glb,.gltf,.gcode,.gco,.nc,.ngc,.tap')))}>
          Open a model or G-code
        </button>
        <label class="check">
          <input type="checkbox" checked={showTravel} onChange={(e) => setShowTravel(e.currentTarget.checked)} /> Show travel moves (G-code)
        </label>
        {info && (
          <span class="tone-muted" data-testid="model-info">
            {info}
          </span>
        )}
      </div>
      <div ref={host} class="model-stage" role="img" aria-label="3D view: drag to turn, scroll to zoom, right-drag to move" />
      <p class="tone-muted">STL, OBJ, PLY, glTF and GLB models, and G-code from 3D printers and CNC machines (coloured by height). Drag to turn, scroll to zoom.</p>
    </div>
  );
}

function DataTools({ toolId }: { toolId: string }) {
  if (toolId === 'certificate-maker') return <CertificateMaker toolId={toolId} />;
  if (toolId === 'model-viewer') return <ModelViewer />;
  return <SqliteBrowser toolId={toolId} />;
}

export default defineCustomTool(DataTools);
