/**
 * Local network tools: LAN Scanner, Wake-on-LAN, LAN Speed Test and LAN File
 * Sharing.  Scans, packets and servers run in the desktop app.
 */
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { errorMessage } from '../../lib/errors';
import { devicesCsv, formatRate, guessDevice, normaliseMac, rateMeaning, serviceName, webAddress } from '../../lib/lan';
import { isRandomMac, vendorOf } from '../../lib/oui';
import { parsePorts } from '../../lib/ports';
import { copyText, isDesktop, openLink, saveFile } from '../../platform';
import { pickFolder } from '../../platform/convert';
import { onServerRequest, type ServeRequest, type ServeStarted, startServer, stopServer } from '../../platform/devnet';
import { cancelScan, checkPorts, type LanHost, lanInfo, onLanHost, onLanProgress, type PortState, type SpeedResult, scanLan, speedTest, wakeOnLan } from '../../platform/lan';
import { scrollRegion } from '../../ui/a11y';
import { Icon } from '../../ui/icons';
import { attempt, notify } from '../../ui/toast';
import { defineCustomTool, type Values } from '../types';
import { Segmented, usePersistentState } from './_shared';

const DesktopNote = ({ what }: { what: string }) => (isDesktop ? null : <p class="recipe-error">{what} works in the desktop app; a browser cannot reach other devices on the network.</p>);

function useQr(text: string | null): string | null {
  const [qr, setQr] = useState<string | null>(null);
  useEffect(() => {
    if (!text) {
      setQr(null);
      return;
    }
    let cancelled = false;
    import('bwip-js/generic').then(
      ({ toSVG }) => {
        const svg = toSVG({ bcid: 'qrcode', text, scale: 4, backgroundcolor: 'FFFFFF', paddingwidth: 4, paddingheight: 4 } as never);
        if (!cancelled) setQr(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
      },
      () => setQr(null),
    );
    return () => {
      cancelled = true;
    };
  }, [text]);
  return qr;
}

/** The addresses of a running server, with a QR code of the network one for phones. */
function ServerAddress({ started, hint }: { started: ServeStarted; hint: string }) {
  const network = started.urls.find((u) => !u.includes('127.0.0.1')) ?? null;
  const qr = useQr(network);
  return (
    <div class="lan-address" data-testid="lan-address">
      {qr && <img src={qr} alt={`QR code for ${network}`} width={168} height={168} />}
      <div>
        {network ? (
          <>
            <p class="lan-url">
              <code>{network}</code>
              <button
                type="button"
                class="button button-small button-quiet"
                onClick={() =>
                  attempt(async () => {
                    await copyText(network);
                    notify('Address copied');
                  })
                }
              >
                <Icon name="copy" size={12} /> Copy
              </button>
            </p>
            <p class="control-help">{hint}</p>
          </>
        ) : (
          <p class="recipe-error">This computer does not seem to be on a network, so only it can open the address {started.urls[0]}.</p>
        )}
        <p class="control-help">If another device cannot open the address, allow Benchtop through this computer's firewall (Windows asks the first time a server starts).</p>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------- LAN Scanner -- */

const THOROUGH = [
  21, 22, 23, 25, 53, 80, 81, 88, 111, 135, 139, 443, 445, 515, 548, 554, 631, 873, 1883, 2049, 3000, 3306, 3389, 5000, 5001, 5353, 5432, 5900, 6000, 7000, 8000, 8008, 8009, 8080, 8081, 8443, 8883,
  8888, 9000, 9090, 9100, 32400, 49152, 62078,
];

const PORT_PRESETS = {
  common: [21, 22, 23, 25, 53, 80, 110, 135, 139, 143, 443, 445, 515, 548, 554, 631, 993, 1883, 3306, 3389, 5000, 5001, 5432, 5900, 7000, 8000, 8008, 8009, 8080, 8443, 9100, 32400, 62078],
  low: Array.from({ length: 1024 }, (_, i) => i + 1),
} as const;

interface ScanState {
  readonly range: string;
  readonly depth: 'quick' | 'thorough';
}
const readScan = (v: Values | undefined): ScanState => ({ range: typeof v?.range === 'string' ? v.range : '', depth: v?.depth === 'thorough' ? 'thorough' : 'quick' });

interface PortCheck {
  readonly ip: string;
  readonly results: readonly PortState[];
}

function LanScanner({ toolId }: { toolId: string }) {
  const [state, setState] = usePersistentState(toolId, readScan, (s) => ({ ...s }));
  const [own, setOwn] = useState<string | null>(null);
  const [hosts, setHosts] = useState<LanHost[]>([]);
  const [vendors, setVendors] = useState<Record<string, string | null>>({});
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [took, setTook] = useState<number | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [preset, setPreset] = useState<'common' | 'low' | 'custom'>('common');
  const [custom, setCustom] = useState('22, 80, 443, 8000-8100');
  const [checking, setChecking] = useState(false);
  const [check, setCheck] = useState<PortCheck | null>(null);
  const scanId = useRef<string | null>(null);

  useEffect(() => {
    void lanInfo().then((info) => {
      setOwn(info.address);
      if (info.cidr) setState((s) => (s.range ? s : { ...s, range: info.cidr ?? '' }));
    });
    const offHost = onLanHost((id, host) => {
      if (id === scanId.current) setHosts((list) => (list.some((h) => h.ip === host.ip) ? list : [...list, host]));
    });
    const offProgress = onLanProgress((id, done, total) => {
      if (id === scanId.current) setProgress({ done, total });
    });
    return () => {
      void offHost.then((stop) => stop());
      void offProgress.then((stop) => stop());
      if (scanId.current) void cancelScan(scanId.current);
    };
  }, []);

  const scan = () =>
    attempt(async () => {
      const id = `scan-${Date.now()}`;
      scanId.current = id;
      setHosts([]);
      setPicked(null);
      setCheck(null);
      setTook(null);
      setProgress({ done: 0, total: 1 });
      const started = performance.now();
      try {
        const found = await scanLan(id, state.range, state.depth === 'thorough' ? THOROUGH : []);
        if (scanId.current !== id) return;
        setHosts(found);
        setTook(performance.now() - started);
        const named: Record<string, string | null> = {};
        for (const h of found) if (h.mac) named[h.mac] = await vendorOf(h.mac).catch(() => null);
        setVendors((v) => ({ ...v, ...named }));
      } finally {
        if (scanId.current === id) {
          scanId.current = null;
          setProgress(null);
        }
      }
    });
  const stop = () => {
    if (scanId.current) void cancelScan(scanId.current);
  };

  const rows = useMemo(
    () =>
      [...hosts]
        .sort((a, b) => ipNumber(a.ip) - ipNumber(b.ip))
        .map((h) => {
          const vendor = h.mac ? (vendors[h.mac] ?? null) : null;
          return { ...h, vendor, kind: guessDevice({ ip: h.ip, open: h.open, vendor, name: h.name }) };
        }),
    [hosts, vendors],
  );
  const host = rows.find((r) => r.ip === picked) ?? null;

  const runCheck = () =>
    attempt(async () => {
      if (!host) return;
      const ports = preset === 'custom' ? parsePorts(custom, 2000) : [...PORT_PRESETS[preset]];
      setChecking(true);
      try {
        setCheck({ ip: host.ip, results: await checkPorts(host.ip, ports) });
      } finally {
        setChecking(false);
      }
    });

  const exportCsv = () =>
    attempt(async () => {
      const outcome = await saveFile(`network devices ${new Date().toISOString().slice(0, 10)}.csv`, devicesCsv(rows), 'text/csv');
      if (outcome.saved) notify(`Saved to ${outcome.location}`);
    });

  const scanning = progress !== null;
  const shownCheck = check && host && check.ip === host.ip ? check : null;
  const openPorts = shownCheck?.results.filter((r) => r.state === 'open') ?? [];

  return (
    <section class="tool lan-tool" data-testid="tool" data-state={scanning ? 'busy' : rows.length ? 'done' : 'idle'}>
      <DesktopNote what="Scanning the network" />
      <div class="button-row">
        <label class="control control-inline">
          <span class="control-label">Addresses</span>
          <input
            class="input lan-range"
            value={state.range}
            placeholder="192.168.1.0/24"
            spellcheck={false}
            onInput={(e) => setState((s) => ({ ...s, range: e.currentTarget.value }))}
            data-testid="lan-range"
          />
        </label>
        <Segmented
          label="How thorough"
          value={state.depth}
          onChange={(depth) => setState((s) => ({ ...s, depth }))}
          choices={[
            { value: 'quick', label: 'Quick (20 ports)' },
            { value: 'thorough', label: 'Thorough (45 ports)' },
          ]}
        />
        {scanning ? (
          <button type="button" class="button button-danger" onClick={stop} data-testid="lan-stop">
            Stop
          </button>
        ) : (
          <button type="button" class="button button-primary" disabled={!isDesktop || !state.range.trim()} onClick={scan} data-testid="lan-scan">
            <Icon name="search" size={14} /> Scan
          </button>
        )}
        {rows.length > 0 && !scanning && (
          <button type="button" class="button button-small" onClick={exportCsv}>
            <Icon name="save" size={12} /> Save as CSV
          </button>
        )}
      </div>
      <p class="control-help">
        {own ? (
          <>
            This computer is <code>{own}</code>.{' '}
          </>
        ) : null}
        Devices are found by trying to connect to common ports and by reading this computer's list of recently seen addresses; no administrator rights are needed. Devices with strict firewalls may
        appear only with their MAC address, or not at all. Scan only networks you look after.
      </p>
      {progress && <progress class="lan-progress" max={progress.total} value={progress.done} aria-label="Scan progress" />}
      {took !== null && (
        <p class="lan-summary" data-testid="lan-summary">
          {rows.length === 1 ? '1 device' : `${rows.length} devices`} found in {(took / 1000).toFixed(1)} s.
        </p>
      )}
      <div class="lan-layout">
        <div class="lan-table-wrap" {...scrollRegion('Devices')}>
          <table class="data-table lan-table" data-testid="lan-table">
            <thead>
              <tr>
                <th>Address</th>
                <th>Name</th>
                <th>Maker</th>
                <th>Probably</th>
                <th>Open ports</th>
                <th class="num">ms</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} class="tone-muted">
                    {scanning ? 'Looking…' : 'Devices appear here as they answer.'}
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <tr key={r.ip} class={r.ip === picked ? 'is-active' : ''}>
                  <td>
                    <button type="button" class="link-button" onClick={() => setPicked(r.ip)} aria-pressed={r.ip === picked}>
                      {r.ip}
                    </button>
                    {r.thisComputer && <span class="lan-tag">this computer</span>}
                  </td>
                  <td>{r.name ?? ''}</td>
                  <td>{r.mac && isRandomMac(r.mac) ? <span class="tone-muted">private address</span> : (r.vendor ?? '')}</td>
                  <td>{r.kind ?? ''}</td>
                  <td>
                    {r.open.map((p) => (
                      <span key={p} class="lan-port" title={serviceName(p)}>
                        {p}
                      </span>
                    ))}
                  </td>
                  <td class="num">{r.rtt ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {host && (
          <aside class="lan-detail" data-testid="lan-detail">
            <h3>
              {host.ip}
              {host.name && <span class="tone-muted"> {host.name}</span>}
            </h3>
            <dl class="lan-facts">
              <dt>MAC address</dt>
              <dd>{host.mac ? <code>{host.mac.toUpperCase()}</code> : <span class="tone-muted">Not known (the device may be beyond a router)</span>}</dd>
              <dt>Maker</dt>
              <dd>{host.mac && isRandomMac(host.mac) ? 'Private (random) address, used by phones and laptops for privacy' : (host.vendor ?? 'Not known')}</dd>
              <dt>Probably</dt>
              <dd>{host.kind ?? 'Not known'}</dd>
            </dl>
            <div class="button-row">
              {webAddress(host.ip, host.open) && (
                <button type="button" class="button button-small" onClick={() => attempt(() => openLink(webAddress(host.ip, host.open) ?? ''))}>
                  <Icon name="open" size={12} /> Open its web page
                </button>
              )}
              {host.mac && !host.thisComputer && (
                <button
                  type="button"
                  class="button button-small"
                  onClick={() =>
                    attempt(async () => {
                      await wakeOnLan(host.mac ?? '');
                      notify(`Wake-up packet sent to ${host.mac?.toUpperCase()}`);
                    })
                  }
                >
                  Wake
                </button>
              )}
              <button
                type="button"
                class="button button-small button-quiet"
                onClick={() =>
                  attempt(async () => {
                    await copyText(host.mac ? `${host.ip}\t${host.mac.toUpperCase()}` : host.ip);
                    notify('Copied');
                  })
                }
              >
                <Icon name="copy" size={12} /> Copy
              </button>
            </div>
            <h4>Check its ports</h4>
            <div class="button-row">
              <Segmented
                label="Ports"
                value={preset}
                onChange={setPreset}
                choices={[
                  { value: 'common', label: 'Common' },
                  { value: 'low', label: '1–1024' },
                  { value: 'custom', label: 'These' },
                ]}
              />
              {preset === 'custom' && <input class="input" aria-label="Ports to check" value={custom} onInput={(e) => setCustom(e.currentTarget.value)} />}
              <button type="button" class="button button-small button-primary" disabled={checking || !isDesktop} onClick={runCheck} data-testid="lan-check">
                {checking ? 'Checking…' : 'Check'}
              </button>
            </div>
            {shownCheck && (
              <div class="lan-ports" data-testid="lan-ports">
                {openPorts.length === 0 ? (
                  <p class="tone-muted">No open ports among the {shownCheck.results.length} checked.</p>
                ) : (
                  <ul>
                    {openPorts.map((r) => (
                      <li key={r.port}>
                        <strong>{r.port}</strong> {serviceName(r.port)}
                      </li>
                    ))}
                  </ul>
                )}
                <p class="control-help">
                  {shownCheck.results.filter((r) => r.state === 'closed').length} closed (the device refused), {shownCheck.results.filter((r) => r.state === 'filtered').length} with no answer (a
                  firewall, or nothing there).
                </p>
              </div>
            )}
          </aside>
        )}
      </div>
    </section>
  );
}

const ipNumber = (ip: string) => ip.split('.').reduce((n, part) => n * 256 + (Number(part) || 0), 0);

/* ----------------------------------------------------------- Wake-on-LAN -- */

interface Machine {
  readonly name: string;
  readonly mac: string;
  readonly broadcast: string;
  readonly port: number;
}

interface WakeState {
  readonly machines: readonly Machine[];
  readonly draft: Machine;
}

const EMPTY_MACHINE: Machine = { name: '', mac: '', broadcast: '', port: 9 };

const readWake = (v: Values | undefined): WakeState => {
  let machines: Machine[] = [];
  if (typeof v?.machines === 'string') {
    try {
      const parsed = JSON.parse(v.machines) as Machine[];
      if (Array.isArray(parsed)) machines = parsed.filter((m) => typeof m?.mac === 'string');
    } catch {
      // start empty
    }
  }
  return { machines, draft: EMPTY_MACHINE };
};
const writeWake = (s: WakeState): Values => ({ machines: JSON.stringify(s.machines) });

function WakeOnLan({ toolId }: { toolId: string }) {
  const [state, setState] = usePersistentState(toolId, readWake, writeWake);
  const [sent, setSent] = useState<string | null>(null);
  const draft = state.draft;
  const mac = normaliseMac(draft.mac);
  const setDraft = (patch: Partial<Machine>) => setState((s) => ({ ...s, draft: { ...s.draft, ...patch } }));

  const wake = (m: Machine) =>
    attempt(async () => {
      const address = normaliseMac(m.mac);
      if (!address) throw new Error(`“${m.mac}” is not a MAC address: it needs 12 hex digits, such as 3C:52:82:1A:2B:3C.`);
      await wakeOnLan(address, m.broadcast.trim() || undefined, m.port || 9);
      setSent(`${m.name || address} at ${new Date().toLocaleTimeString('en-IN', { hour12: false })}`);
      notify(`Wake-up packet sent to ${m.name || address}`);
    });
  const save = () => {
    if (!mac) return;
    setState((s) => ({ machines: [...s.machines.filter((m) => normaliseMac(m.mac) !== mac), { ...s.draft, mac, name: s.draft.name.trim() || mac }], draft: EMPTY_MACHINE }));
  };

  return (
    <section class="tool lan-tool" data-testid="tool" data-state={sent ? 'done' : 'idle'}>
      <DesktopNote what="Wake-on-LAN" />
      <div class="wol-form">
        <label class="control">
          <span class="control-label">Name</span>
          <input class="input" value={draft.name} placeholder="Gallery 2 kiosk" onInput={(e) => setDraft({ name: e.currentTarget.value })} data-testid="wol-name" />
        </label>
        <label class="control">
          <span class="control-label">MAC address</span>
          <input
            class={`input${draft.mac && !mac ? ' is-invalid' : ''}`}
            value={draft.mac}
            placeholder="3C:52:82:1A:2B:3C"
            spellcheck={false}
            onInput={(e) => setDraft({ mac: e.currentTarget.value })}
            data-testid="wol-mac"
            aria-invalid={draft.mac !== '' && !mac}
          />
        </label>
        <label class="control">
          <span class="control-label">Broadcast address</span>
          <input class="input" value={draft.broadcast} placeholder="Automatic" spellcheck={false} onInput={(e) => setDraft({ broadcast: e.currentTarget.value })} />
        </label>
        <label class="control">
          <span class="control-label">Port</span>
          <input class="input input-narrow" type="number" min={1} max={65535} value={draft.port} onInput={(e) => setDraft({ port: Number(e.currentTarget.value) || 9 })} />
        </label>
      </div>
      {draft.mac && !mac && <p class="recipe-error">A MAC address has 12 hex digits, such as 3C:52:82:1A:2B:3C or 3c-52-82-1a-2b-3c.</p>}
      <div class="button-row">
        <button type="button" class="button button-primary" disabled={!mac || !isDesktop} onClick={() => wake(draft)} data-testid="wol-wake">
          Wake
        </button>
        <button type="button" class="button" disabled={!mac} onClick={save} data-testid="wol-save">
          <Icon name="plus" size={14} /> Save to the list
        </button>
        {sent && <span class="tone-muted">Sent to {sent}</span>}
      </div>
      <ul class="wol-list" data-testid="wol-list">
        {state.machines.length === 0 && <li class="tone-muted">Saved computers appear here, so you can wake them with one click.</li>}
        {state.machines.map((m) => (
          <li key={m.mac} class="wol-item">
            <span class="wol-name">{m.name}</span>
            <code>{m.mac}</code>
            {m.broadcast && <span class="tone-muted">via {m.broadcast}</span>}
            <button type="button" class="button button-small button-primary" disabled={!isDesktop} onClick={() => wake(m)}>
              Wake
            </button>
            <button type="button" class="button button-small button-quiet" onClick={() => setState((s) => ({ ...s, draft: m }))}>
              Edit
            </button>
            <button type="button" class="icon-button" aria-label={`Remove ${m.name}`} onClick={() => setState((s) => ({ ...s, machines: s.machines.filter((x) => x.mac !== m.mac) }))}>
              <Icon name="trash" size={14} />
            </button>
          </li>
        ))}
      </ul>
      <details class="lan-help">
        <summary>When a computer does not wake</summary>
        <ul>
          <li>Turn on Wake-on-LAN (sometimes “Power on by PCI-E” or “Resume by LAN”) in the computer's BIOS or UEFI settings.</li>
          <li>On Windows, allow the network adapter to wake the computer (Device Manager → adapter → Power Management) and turn off Fast Startup.</li>
          <li>Most computers wake only over a network cable, not Wi-Fi, and only from sleep or a proper shutdown — not after the power was cut.</li>
          <li>Routers do not pass the packet between networks. From another network, enter that network's broadcast address and forward the port on its router.</li>
          <li>The LAN Scanner shows the MAC addresses of devices it finds.</li>
        </ul>
      </details>
    </section>
  );
}

/* -------------------------------------------------------- LAN Speed Test -- */

interface SpeedState {
  readonly mode: 'serve' | 'test';
  readonly address: string;
  readonly seconds: number;
  readonly port: number;
}
const readSpeed = (v: Values | undefined): SpeedState => ({
  mode: v?.mode === 'test' ? 'test' : 'serve',
  address: typeof v?.address === 'string' ? v.address : '',
  seconds: typeof v?.seconds === 'number' ? v.seconds : 6,
  port: typeof v?.port === 'number' ? v.port : 8765,
});

interface Visitor {
  readonly from: string;
  readonly down: number;
  readonly up: number;
  readonly last: number;
}

function SpeedTest({ toolId }: { toolId: string }) {
  const [state, setState] = usePersistentState(toolId, readSpeed, (s) => ({ ...s }));
  const [running, setRunning] = useState<ServeStarted | null>(null);
  const [visitors, setVisitors] = useState<Record<string, Visitor>>({});
  const [testing, setTesting] = useState(false);
  const [results, setResults] = useState<(SpeedResult & { address: string; at: number })[]>([]);
  const [failure, setFailure] = useState<string | null>(null);
  const id = `speed-${toolId}`;

  useEffect(() => {
    const off = onServerRequest((r: ServeRequest) => {
      if (r.id !== id) return;
      setVisitors((all) => {
        const v = all[r.from] ?? { from: r.from, down: 0, up: 0, last: 0 };
        const size = r.size ?? 0;
        return { ...all, [r.from]: { ...v, down: v.down + (r.path.startsWith('/speed/down') ? size : 0), up: v.up + (r.path.startsWith('/speed/up') ? size : 0), last: Date.now() } };
      });
    });
    return () => {
      void off.then((stop) => stop());
      void stopServer(id);
    };
  }, []);

  const serve = () =>
    attempt(async () => {
      setRunning(await startServer(id, { kind: 'speed', lan: true, port: state.port, cors: false }));
    });
  const stop = () =>
    attempt(async () => {
      await stopServer(id);
      setRunning(null);
    });
  const test = () =>
    attempt(async () => {
      setTesting(true);
      setFailure(null);
      try {
        const address = state.address.trim();
        const withPort = /:\d+\/?$/.test(address) || address.startsWith('http') ? address : `${address}:8765`;
        const result = await speedTest(withPort, state.seconds);
        setResults((r) => [{ ...result, address: withPort, at: Date.now() }, ...r].slice(0, 10));
      } catch (error) {
        setFailure(errorMessage(error));
      } finally {
        setTesting(false);
      }
    });
  const latest = results[0];

  return (
    <section class="tool lan-tool" data-testid="tool" data-state={testing ? 'busy' : latest ? 'done' : 'idle'}>
      <DesktopNote what="The speed test" />
      <Segmented
        label="What to do"
        value={state.mode}
        onChange={(mode) => setState((s) => ({ ...s, mode }))}
        choices={[
          { value: 'serve', label: 'Let other devices test this computer' },
          { value: 'test', label: 'Test the link to another computer' },
        ]}
      />
      {state.mode === 'serve' ? (
        <>
          <p class="control-help">Starts a small speed test page on this computer. Open it on a phone, tablet or another computer on the same network to measure the Wi-Fi or cable between them.</p>
          <div class="button-row">
            <label class="control control-inline">
              <span class="control-label">Port</span>
              <input
                class="input input-narrow"
                type="number"
                min={1024}
                max={65535}
                value={state.port}
                onInput={(e) => setState((s) => ({ ...s, port: Math.min(65535, Math.max(0, Number(e.currentTarget.value) || 8765)) }))}
              />
            </label>
            {running ? (
              <button type="button" class="button button-danger" onClick={stop} data-testid="speed-stop">
                Stop
              </button>
            ) : (
              <button type="button" class="button button-primary" disabled={!isDesktop} onClick={serve} data-testid="speed-serve">
                <Icon name="play" size={14} /> Start
              </button>
            )}
          </div>
          {running && (
            <ServerAddress started={running} hint="Scan the code with a phone, or type the address on the other device. Another Benchtop can test it from “Test the link to another computer”." />
          )}
          {Object.keys(visitors).length > 0 && (
            <table class="data-table lan-visitors">
              <thead>
                <tr>
                  <th>Device</th>
                  <th class="num">Downloaded</th>
                  <th class="num">Uploaded</th>
                  <th>Last test</th>
                </tr>
              </thead>
              <tbody>
                {Object.values(visitors).map((v) => (
                  <tr key={v.from}>
                    <td>{v.from}</td>
                    <td class="num">{(v.down / 1e6).toFixed(0)} MB</td>
                    <td class="num">{(v.up / 1e6).toFixed(0)} MB</td>
                    <td>{new Date(v.last).toLocaleTimeString('en-IN', { hour12: false })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      ) : (
        <>
          <p class="control-help">Start “Let other devices test this computer” in Benchtop on the other computer, then enter the address it shows.</p>
          <div class="button-row">
            <label class="control control-inline">
              <span class="control-label">Address</span>
              <input
                class="input lan-range"
                value={state.address}
                placeholder="192.168.1.20:8765"
                spellcheck={false}
                onInput={(e) => setState((s) => ({ ...s, address: e.currentTarget.value }))}
                data-testid="speed-address"
              />
            </label>
            <label class="control control-inline">
              <span class="control-label">Each direction</span>
              <select class="select" value={state.seconds} onChange={(e) => setState((s) => ({ ...s, seconds: Number(e.currentTarget.value) }))}>
                {[3, 6, 10, 20].map((n) => (
                  <option key={n} value={n}>
                    {n} s
                  </option>
                ))}
              </select>
            </label>
            <button type="button" class="button button-primary" disabled={!isDesktop || testing || !state.address.trim()} onClick={test} data-testid="speed-test">
              {testing ? 'Measuring…' : 'Start test'}
            </button>
          </div>
          {failure && <p class="recipe-error">{failure}</p>}
          {latest && (
            <div class="lan-speed" data-testid="speed-result">
              <div>
                <span class="lan-speed-label">Latency</span>
                <span class="lan-speed-value">{latest.latencyMs} ms</span>
              </div>
              <div>
                <span class="lan-speed-label">Download</span>
                <span class="lan-speed-value">{formatRate(latest.downloadMbps)}</span>
              </div>
              <div>
                <span class="lan-speed-label">Upload</span>
                <span class="lan-speed-value">{formatRate(latest.uploadMbps)}</span>
              </div>
              <p class="control-help">
                {rateMeaning(Math.min(latest.downloadMbps, latest.uploadMbps))} {latest.megabytes} MB moved.
              </p>
            </div>
          )}
          {results.length > 1 && (
            <table class="data-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Address</th>
                  <th class="num">Latency</th>
                  <th class="num">Download</th>
                  <th class="num">Upload</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <tr key={r.at}>
                    <td>{new Date(r.at).toLocaleTimeString('en-IN', { hour12: false })}</td>
                    <td>{r.address}</td>
                    <td class="num">{r.latencyMs} ms</td>
                    <td class="num">{formatRate(r.downloadMbps)}</td>
                    <td class="num">{formatRate(r.uploadMbps)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </section>
  );
}

/* ------------------------------------------------------- LAN File Sharing -- */

interface ShareState {
  readonly uploads: boolean;
  readonly port: number;
}
const readShare = (v: Values | undefined): ShareState => ({ uploads: v?.uploads === true, port: typeof v?.port === 'number' ? v.port : 8000 });

function FileShare({ toolId }: { toolId: string }) {
  const [state, setState] = usePersistentState(toolId, readShare, (s) => ({ ...s }));
  const [folder, setFolder] = useState<{ token: string; path: string } | null>(null);
  const [password, setPassword] = useState('');
  const [running, setRunning] = useState<ServeStarted | null>(null);
  const [log, setLog] = useState<ServeRequest[]>([]);
  const id = `share-${toolId}`;

  useEffect(() => {
    const off = onServerRequest((r) => {
      if (r.id === id) setLog((l) => [r, ...l].slice(0, 300));
    });
    return () => {
      void off.then((stop) => stop());
      void stopServer(id);
    };
  }, []);

  const start = () =>
    attempt(async () => {
      if (!folder) return;
      setRunning(await startServer(id, { kind: 'files', lan: true, port: state.port, cors: false, folder: folder.token, uploads: state.uploads, password }));
    });
  const stop = () =>
    attempt(async () => {
      await stopServer(id);
      setRunning(null);
    });
  const choose = () =>
    attempt(async () => {
      const picked = await pickFolder();
      if (picked) setFolder(picked);
    });

  return (
    <section class="tool lan-tool" data-testid="tool" data-state={running ? 'done' : 'idle'}>
      <DesktopNote what="Sharing a folder" />
      <p class="control-help">
        Shares one folder with phones and computers on the same network through their web browser: they can look through it, play videos and download files, and send files to it if you allow that.
        Nothing is installed on the other devices and nothing goes through the internet.
      </p>
      <div class="button-row">
        <button type="button" class="button" disabled={!isDesktop || running !== null} onClick={choose} data-testid="share-folder">
          <Icon name="open" size={14} /> {folder ? 'Change folder' : 'Choose a folder'}
        </button>
        {folder && <code class="lan-folder">{folder.path}</code>}
      </div>
      <div class="button-row">
        <label class="check">
          <input type="checkbox" checked={state.uploads} disabled={running !== null} onChange={(e) => setState((s) => ({ ...s, uploads: e.currentTarget.checked }))} /> Let others send files to this
          folder
        </label>
        <label class="control control-inline">
          <span class="control-label">Password</span>
          <input class="input" type="text" autocomplete="off" value={password} placeholder="None" disabled={running !== null} onInput={(e) => setPassword(e.currentTarget.value)} />
        </label>
        <label class="control control-inline">
          <span class="control-label">Port</span>
          <input
            class="input input-narrow"
            type="number"
            min={1024}
            max={65535}
            value={state.port}
            disabled={running !== null}
            onInput={(e) => setState((s) => ({ ...s, port: Math.min(65535, Math.max(0, Number(e.currentTarget.value) || 8000)) }))}
          />
        </label>
        {running ? (
          <button type="button" class="button button-danger" onClick={stop} data-testid="share-stop">
            Stop sharing
          </button>
        ) : (
          <button type="button" class="button button-primary" disabled={!isDesktop || !folder} onClick={start} data-testid="share-start">
            <Icon name="play" size={14} /> Start sharing
          </button>
        )}
      </div>
      {running && (
        <ServerAddress
          started={running}
          hint={`Anyone on this network with the address${password ? ' and the password' : ''} can open this folder and its subfolders until you stop sharing.${password ? ' Any user name works with the password.' : ''}`}
        />
      )}
      {log.length > 0 && (
        <div class="ng-log" {...scrollRegion('Requests')} data-testid="share-log">
          {log.map((r, i) => (
            <div key={`${r.path}-${i}`} class="ng-log-row">
              <span class={`ng-method ng-${r.method.toLowerCase()}`}>{r.method === 'PUT' ? 'SEND' : r.method}</span>
              <span class="ng-log-path">{decodePath(r.path)}</span>
              <span class={r.status >= 400 ? 'ng-bad' : 'ng-good'}>{r.status}</span>
              <span class="tone-muted">{r.from}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function decodePath(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

function LanTools({ toolId }: { toolId: string }) {
  if (toolId === 'wake-on-lan') return <WakeOnLan toolId={toolId} />;
  if (toolId === 'lan-speed-test') return <SpeedTest toolId={toolId} />;
  if (toolId === 'lan-file-share') return <FileShare toolId={toolId} />;
  return <LanScanner toolId={toolId} />;
}

export default defineCustomTool(LanTools);
