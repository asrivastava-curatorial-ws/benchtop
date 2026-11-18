/**
 * Component Codes (resistor bands, SMD and capacitor markings, E-series),
 * WireGuard Config Generator, Time Zone Planner and Code Screenshot.
 */

import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useIncomingFiles } from '../../app/handoff';
import { toBase64 } from '../../lib/bytes';
import {
  bandsFor,
  COLOUR_HEX,
  type Colour,
  digitColours,
  E_SERIES,
  formatFarads,
  formatOhms,
  multiplierColours,
  nearest,
  parseOhms,
  readBands,
  readCapacitor,
  readSmd,
  tempcoColours,
  toleranceColours,
} from '../../lib/components';
import { instantIn, offsetMinutes, wireguardKeys } from '../../lib/engineering';
import { errorMessage } from '../../lib/errors';
import { copyText, saveFile } from '../../platform';
import { scrollRegion } from '../../ui/a11y';
import { CodeEditor } from '../../ui/CodeEditor';
import { attempt, notify } from '../../ui/toast';
import { defineCustomTool, type Values } from '../types';
import { Segmented, usePersistentState } from './_shared';

/* ----------------------------------------------------- component codes -- */

function ResistorPicture({ bands }: { bands: readonly Colour[] }) {
  const gaps = bands.length >= 5 ? [70, 92, 114, 136, 176, 198] : [80, 104, 128, 176];
  return (
    <svg class="resistor-svg" viewBox="0 0 300 80" role="img" aria-label={`Resistor with bands ${bands.join(', ')}`}>
      <line x1="0" y1="40" x2="300" y2="40" stroke="#9aa0a6" stroke-width="5" />
      <rect x="50" y="14" width="200" height="52" rx="22" fill="#e3c7a0" stroke="#b08d5f" />
      {bands.map((band, i) => (
        <rect key={i} x={gaps[i]} y="14" width="12" height="52" fill={COLOUR_HEX[band]} stroke="#0003" />
      ))}
    </svg>
  );
}

function BandSelect({ label, value, options, onChange }: { label: string; value: Colour; options: readonly Colour[]; onChange: (c: Colour) => void }) {
  return (
    <label class="control">
      <span class="control-label">{label}</span>
      <select class="input band-select" value={value} onChange={(e) => onChange(e.currentTarget.value as Colour)} style={{ borderLeft: `14px solid ${COLOUR_HEX[value]}` }}>
        {options.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>
    </label>
  );
}

function ComponentCodes({ toolId }: { toolId: string }) {
  const [s, set] = usePersistentState<{ tab: string; bands: Colour[]; value: string; smd: string; cap: string; series: string }>(
    toolId,
    (v: Values | undefined) => ({
      tab: typeof v?.tab === 'string' ? v.tab : 'bands',
      bands: Array.isArray(v?.bands) ? (v.bands as Colour[]) : ['yellow', 'violet', 'red', 'gold'],
      value: typeof v?.value === 'string' ? v.value : '4k7',
      smd: typeof v?.smd === 'string' ? v.smd : '472',
      cap: typeof v?.cap === 'string' ? v.cap : '104K',
      series: typeof v?.series === 'string' ? v.series : 'E24',
    }),
    (v) => ({ ...v }) as unknown as Values,
  );
  const count = s.bands.length;
  const setBand = (i: number, c: Colour) => set((v) => ({ ...v, bands: v.bands.map((b, j) => (j === i ? c : b)) }));
  const setCount = (n: number) =>
    set((v) => {
      const base: Colour[] = n === 4 ? ['yellow', 'violet', 'red', 'gold'] : ['yellow', 'violet', 'black', 'brown', 'brown'];
      return { ...v, bands: n === 6 ? [...base, 'brown'] : base };
    });
  const result = (() => {
    try {
      const r = readBands(s.bands);
      return `${formatOhms(r.ohms)}${r.tolerance ? ` ±${r.tolerance}%` : ''}${r.tempco ? `, ${r.tempco} ppm/K` : ''}`;
    } catch (e) {
      return errorMessage(e);
    }
  })();
  const reverse = (() => {
    try {
      const ohms = parseOhms(s.value);
      const four = bandsFor(ohms, 2);
      const five = bandsFor(ohms, 3);
      const near = nearest(ohms, s.series as keyof typeof E_SERIES);
      return { ohms, four, five, near };
    } catch (e) {
      return { error: errorMessage(e) };
    }
  })();
  const smd = (() => {
    try {
      const r = readSmd(s.smd);
      return `${formatOhms(r.ohms)} (${r.system})`;
    } catch (e) {
      return errorMessage(e);
    }
  })();
  const cap = (() => {
    try {
      const r = readCapacitor(s.cap);
      return `${formatFarads(r.picofarads)}${r.tolerance ? `, ${r.tolerance}` : ''}${r.volts ? `, ${r.volts} V` : ''}`;
    } catch (e) {
      return errorMessage(e);
    }
  })();
  return (
    <div data-testid="tool" class="tool component-tool">
      <Segmented
        label="Code"
        value={s.tab}
        onChange={(tab) => set((v) => ({ ...v, tab }))}
        choices={[
          { value: 'bands', label: 'Colour bands' },
          { value: 'value', label: 'Value to bands' },
          { value: 'smd', label: 'SMD resistors' },
          { value: 'cap', label: 'Capacitors' },
        ]}
      />
      {s.tab === 'bands' && (
        <section class="component-card">
          <Segmented label="Bands" value={String(count)} onChange={(n) => setCount(Number(n))} choices={['4', '5', '6'].map((n) => ({ value: n, label: `${n} bands` }))} />
          <ResistorPicture bands={s.bands} />
          <div class="control-row">
            {s.bands.map((band, i) => {
              const digits = count >= 5 ? 3 : 2;
              const role = i < digits ? `Digit ${i + 1}` : i === digits ? 'Multiplier' : i === digits + 1 ? 'Tolerance' : 'Temperature';
              const options = i < digits ? digitColours : i === digits ? multiplierColours : i === digits + 1 ? toleranceColours : tempcoColours;
              return <BandSelect key={i} label={role} value={band} options={options} onChange={(c) => setBand(i, c)} />;
            })}
          </div>
          <p class="component-result" data-testid="band-result">
            {result}
          </p>
        </section>
      )}
      {s.tab === 'value' && (
        <section class="component-card">
          <div class="control-row">
            <label class="control">
              <span class="control-label">Resistance (4.7k, 4k7, 220, 1M)</span>
              <input class="input" value={s.value} onInput={(e) => set((v) => ({ ...v, value: e.currentTarget.value }))} data-testid="ohms-input" />
            </label>
            <label class="control">
              <span class="control-label">Preferred values</span>
              <select class="input" value={s.series} onChange={(e) => set((v) => ({ ...v, series: e.currentTarget.value }))}>
                {Object.keys(E_SERIES).map((k) => (
                  <option key={k}>{k}</option>
                ))}
              </select>
            </label>
          </div>
          {'error' in reverse ? (
            <p class="recipe-error">{reverse.error}</p>
          ) : (
            <>
              {reverse.four && (
                <>
                  <p>4 bands: {[...reverse.four, 'gold'].join(', ')}</p>
                  <ResistorPicture bands={[...reverse.four, 'gold']} />
                </>
              )}
              {reverse.five && <p>5 bands: {[...reverse.five, 'brown'].join(', ')}</p>}
              <p class="component-result" data-testid="nearest">
                Nearest {s.series} values: {formatOhms(reverse.near.below)} and {formatOhms(reverse.near.above)} (closest {formatOhms(reverse.near.closest)})
              </p>
            </>
          )}
        </section>
      )}
      {s.tab === 'smd' && (
        <section class="component-card">
          <label class="control">
            <span class="control-label">Marking (103, 4702, 4R7, 01C)</span>
            <input class="input" value={s.smd} onInput={(e) => set((v) => ({ ...v, smd: e.currentTarget.value }))} data-testid="smd-input" />
          </label>
          <p class="component-result" data-testid="smd-result">
            {smd}
          </p>
        </section>
      )}
      {s.tab === 'cap' && (
        <section class="component-card">
          <label class="control">
            <span class="control-label">Marking (104, 104K, 2A104J, 4n7, 0.1)</span>
            <input class="input" value={s.cap} onInput={(e) => set((v) => ({ ...v, cap: e.currentTarget.value }))} data-testid="cap-input" />
          </label>
          <p class="component-result" data-testid="cap-result">
            {cap}
          </p>
        </section>
      )}
    </div>
  );
}

/* ----------------------------------------------------------- WireGuard -- */

interface WgSettings {
  readonly endpoint: string;
  readonly port: number;
  readonly subnet: string;
  readonly clients: number;
  readonly dns: string;
  readonly allowed: string;
  readonly keepalive: number;
  readonly psk: boolean;
  readonly nat: string;
}

function hostAddress(subnet: string, n: number): string {
  const [ip, bits] = subnet.split('/');
  const parts = (ip ?? '10.8.0.0').split('.').map(Number);
  const base = ((parts[0] ?? 0) << 24) | ((parts[1] ?? 0) << 16) | ((parts[2] ?? 0) << 8) | (parts[3] ?? 0);
  const value = (base & ~((1 << (32 - Number(bits ?? 24))) - 1)) + n;
  return `${(value >>> 24) & 255}.${(value >>> 16) & 255}.${(value >>> 8) & 255}.${value & 255}`;
}

function WireGuard({ toolId }: { toolId: string }) {
  const [s, set] = usePersistentState<WgSettings>(
    toolId,
    (v: Values | undefined) => ({
      endpoint: typeof v?.endpoint === 'string' ? v.endpoint : 'vpn.example.org',
      port: typeof v?.port === 'number' ? v.port : 51820,
      subnet: typeof v?.subnet === 'string' ? v.subnet : '10.8.0.0/24',
      clients: typeof v?.clients === 'number' ? v.clients : 3,
      dns: typeof v?.dns === 'string' ? v.dns : '1.1.1.1',
      allowed: typeof v?.allowed === 'string' ? v.allowed : '0.0.0.0/0, ::/0',
      keepalive: typeof v?.keepalive === 'number' ? v.keepalive : 25,
      psk: v?.psk !== false,
      nat: typeof v?.nat === 'string' ? v.nat : 'eth0',
    }),
    (v) => ({ ...v }),
  );
  const [seed, setSeed] = useState(0);
  const [qr, setQr] = useState<Record<number, string>>({});
  const configs = useMemo(() => {
    const server = wireguardKeys();
    const bits = s.subnet.split('/')[1] ?? '24';
    const peers = Array.from({ length: Math.max(1, Math.min(250, s.clients)) }, (_, i) => ({
      keys: wireguardKeys(),
      psk: s.psk ? toBase64(crypto.getRandomValues(new Uint8Array(32))) : '',
      address: hostAddress(s.subnet, i + 2),
    }));
    const nat = s.nat.trim()
      ? `PostUp = iptables -A FORWARD -i %i -j ACCEPT; iptables -t nat -A POSTROUTING -o ${s.nat.trim()} -j MASQUERADE\nPostDown = iptables -D FORWARD -i %i -j ACCEPT; iptables -t nat -D POSTROUTING -o ${s.nat.trim()} -j MASQUERADE\n`
      : '';
    const serverConf = `[Interface]\n# Server\nAddress = ${hostAddress(s.subnet, 1)}/${bits}\nListenPort = ${s.port}\nPrivateKey = ${server.privateKey}\n${nat}${peers
      .map((p, i) => `\n[Peer]\n# Client ${i + 1}\nPublicKey = ${p.keys.publicKey}\n${p.psk ? `PresharedKey = ${p.psk}\n` : ''}AllowedIPs = ${p.address}/32\n`)
      .join('')}`;
    const clientConfs = peers.map(
      (p, i) =>
        `[Interface]\n# Client ${i + 1}\nPrivateKey = ${p.keys.privateKey}\nAddress = ${p.address}/${bits}\n${s.dns.trim() ? `DNS = ${s.dns.trim()}\n` : ''}\n[Peer]\nPublicKey = ${server.publicKey}\n${p.psk ? `PresharedKey = ${p.psk}\n` : ''}Endpoint = ${s.endpoint}:${s.port}\nAllowedIPs = ${s.allowed}\n${s.keepalive ? `PersistentKeepalive = ${s.keepalive}\n` : ''}`,
    );
    return { serverConf, clientConfs };
    // `seed` makes a fresh set of keys on request.
  }, [s, seed]);
  useEffect(() => setQr({}), [configs]);
  const showQr = (i: number) =>
    attempt(async () => {
      const { toSVG } = await import('bwip-js/generic');
      const svg = toSVG({ bcid: 'qrcode', text: configs.clientConfs[i] ?? '', scale: 3, eclevel: 'L', backgroundcolor: 'FFFFFF', paddingwidth: 3, paddingheight: 3 } as never);
      setQr((q) => ({ ...q, [i]: `data:image/svg+xml;base64,${btoa(svg)}` }));
    });
  const field = (key: keyof WgSettings, label: string, type: 'text' | 'number' = 'text') => (
    <label class="control" for={`wg-${key}`}>
      <span class="control-label">{label}</span>
      {type === 'number' ? (
        <input id={`wg-${key}`} class="input" type="number" value={String(s[key])} onInput={(e) => set((v) => ({ ...v, [key]: Number(e.currentTarget.value) || 0 }))} />
      ) : (
        <input id={`wg-${key}`} class="input" type="text" value={String(s[key])} onInput={(e) => set((v) => ({ ...v, [key]: e.currentTarget.value }))} />
      )}
    </label>
  );
  return (
    <div data-testid="tool" class="tool wg-tool">
      <div class="control-row">
        {field('endpoint', 'Server address (public)')}
        {field('port', 'Port', 'number')}
        {field('subnet', 'VPN subnet')}
        {field('clients', 'Clients', 'number')}
        {field('dns', 'DNS for clients')}
        {field('allowed', 'Routed through the VPN')}
        {field('keepalive', 'Keepalive (s, 0 for off)', 'number')}
        {field('nat', 'Server internet interface (blank: no NAT)')}
        <label class="check">
          <input type="checkbox" checked={s.psk} onChange={(e) => set((v) => ({ ...v, psk: e.currentTarget.checked }))} />
          Preshared keys (extra post-quantum layer)
        </label>
        <button type="button" class="button" onClick={() => setSeed((n) => n + 1)}>
          New keys
        </button>
      </div>
      <p class="tone-muted">Keys are made on this computer with X25519, like wg genkey. Install wg0.conf on the server and give each client its own file or QR code.</p>
      <div class="wg-configs">
        {[{ name: 'wg0.conf', text: configs.serverConf, index: -1 }, ...configs.clientConfs.map((text, i) => ({ name: `client${i + 1}.conf`, text, index: i }))].map((c) => (
          <section key={c.name} class="pane wg-config" data-testid="wg-config">
            <div class="pane-header">
              <h2 class="pane-title">{c.name}</h2>
              <div class="pane-actions">
                <button
                  type="button"
                  class="button button-small"
                  onClick={() =>
                    attempt(async () => {
                      await copyText(c.text);
                      notify(`Copied ${c.name}.`);
                    })
                  }
                >
                  Copy
                </button>
                <button type="button" class="button button-small" onClick={() => attempt(async () => void (await saveFile(c.name, c.text, 'text/plain')))}>
                  Save
                </button>
                {c.index >= 0 && (
                  <button type="button" class="button button-small" onClick={() => showQr(c.index)}>
                    QR
                  </button>
                )}
              </div>
            </div>
            <pre class="wg-text" {...scrollRegion(`${c.name} configuration`)}>
              {c.text}
            </pre>
            {c.index >= 0 && qr[c.index] && <img src={qr[c.index]} alt={`QR code for ${c.name}`} class="wg-qr" />}
          </section>
        ))}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------- time zones -- */

const DEFAULT_ZONES = ['Asia/Kolkata', 'Europe/London', 'America/New_York', 'America/Los_Angeles', 'Asia/Singapore', 'Australia/Sydney'];

const fmtOffset = (minutes: number) => `UTC${minutes >= 0 ? '+' : '−'}${String(Math.floor(Math.abs(minutes) / 60)).padStart(2, '0')}:${String(Math.abs(minutes) % 60).padStart(2, '0')}`;

function TimeZones({ toolId }: { toolId: string }) {
  const all = useMemo(() => (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? DEFAULT_ZONES, []);
  const [s, set] = usePersistentState<{ zones: string[]; base: string; start: number; end: number }>(
    toolId,
    (v: Values | undefined) => ({
      zones: Array.isArray(v?.zones) ? (v.zones as string[]) : DEFAULT_ZONES.slice(0, 4),
      base: typeof v?.base === 'string' ? v.base : 'Asia/Kolkata',
      start: typeof v?.start === 'number' ? v.start : 9,
      end: typeof v?.end === 'number' ? v.end : 18,
    }),
    (v) => ({ ...v }) as unknown as Values,
  );
  const [local, setLocal] = useState(() => {
    const now = new Date();
    const offset = offsetMinutes(s.base, now);
    return new Date(now.getTime() + offset * 60000).toISOString().slice(0, 16);
  });
  const [adding, setAdding] = useState('');
  const when = useMemo(() => instantIn(s.base, local), [s.base, local]);
  const day = local.slice(0, 10);
  const hours = Array.from({ length: 24 }, (_, h) => instantIn(s.base, `${day}T${String(h).padStart(2, '0')}:00`));
  const format = (zone: string, date: Date, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-GB', { timeZone: zone, ...options }).format(date);
  const zones = [s.base, ...s.zones.filter((z) => z !== s.base)];
  return (
    <div data-testid="tool" class="tool tz-tool">
      <div class="control-row">
        <label class="control">
          <span class="control-label">Date and time in</span>
          <select class="input" value={s.base} onChange={(e) => set((v) => ({ ...v, base: e.currentTarget.value }))}>
            {all.map((z) => (
              <option key={z}>{z}</option>
            ))}
          </select>
        </label>
        <label class="control">
          <span class="control-label">When</span>
          <input class="input" type="datetime-local" value={local} onInput={(e) => setLocal(e.currentTarget.value)} data-testid="tz-when" />
        </label>
        <form
          class="control-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (all.includes(adding) && !s.zones.includes(adding)) set((v) => ({ ...v, zones: [...v.zones, adding] }));
            setAdding('');
          }}
        >
          <label class="control">
            <span class="control-label">Add a place</span>
            <input class="input" list="tz-list" value={adding} placeholder="Europe/Berlin" onInput={(e) => setAdding(e.currentTarget.value)} />
          </label>
          <datalist id="tz-list">
            {all.map((z) => (
              <option key={z} value={z} />
            ))}
          </datalist>
          <button type="submit" class="button">
            Add
          </button>
        </form>
        <label class="control">
          <span class="control-label">Working hours</span>
          <span class="control-row">
            <input class="input tz-hour" type="number" min={0} max={23} value={s.start} onInput={(e) => set((v) => ({ ...v, start: Number(e.currentTarget.value) }))} aria-label="Working day starts" />
            <input class="input tz-hour" type="number" min={1} max={24} value={s.end} onInput={(e) => set((v) => ({ ...v, end: Number(e.currentTarget.value) }))} aria-label="Working day ends" />
          </span>
        </label>
      </div>
      <table class="data-table tz-table" data-testid="tz-table">
        <tbody>
          {zones.map((zone) => (
            <tr key={zone}>
              <th scope="row">
                <span>{zone.replace(/_/g, ' ')}</span>
                <small class="tone-muted"> {fmtOffset(offsetMinutes(zone, when))}</small>
                {zone !== s.base && (
                  <button type="button" class="icon-button tz-remove" aria-label={`Remove ${zone}`} onClick={() => set((v) => ({ ...v, zones: v.zones.filter((z) => z !== zone) }))}>
                    ×
                  </button>
                )}
              </th>
              <td class="tz-now">{format(zone, when, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
              {hours.map((hour, h) => {
                const there = Number(format(zone, hour, { hour: 'numeric', hourCycle: 'h23' }));
                const work = there >= s.start && there < s.end;
                return (
                  <td
                    key={h}
                    class={`tz-cell${work ? ' is-work' : there < 7 || there >= 22 ? ' is-night' : ''}${h === Number(local.slice(11, 13)) ? ' is-chosen' : ''}`}
                    title={`${zone}: ${there}:00`}
                  >
                    <button type="button" onClick={() => setLocal(`${day}T${String(h).padStart(2, '0')}:00`)} aria-label={`${h}:00 in ${s.base} is ${there}:00 in ${zone}`}>
                      {there}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p class="tone-muted">Green hours are inside everyone’s working day; click an hour to choose it. Daylight-saving changes come from this computer’s time zone data.</p>
    </div>
  );
}

/* ------------------------------------------------------ code screenshot -- */

const THEMES = {
  'GitHub Dark': {
    bg: '#0d1117',
    fg: '#e6edf3',
    keyword: '#ff7b72',
    string: '#a5d6ff',
    number: '#79c0ff',
    comment: '#8b949e',
    fn: '#d2a8ff',
    type: '#ffa657',
    prop: '#79c0ff',
    tag: '#7ee787',
    back: 'linear',
  },
  'GitHub Light': {
    bg: '#ffffff',
    fg: '#1f2328',
    keyword: '#cf222e',
    string: '#0a3069',
    number: '#0550ae',
    comment: '#6e7781',
    fn: '#8250df',
    type: '#953800',
    prop: '#0550ae',
    tag: '#116329',
    back: 'linear',
  },
  Dracula: {
    bg: '#282a36',
    fg: '#f8f8f2',
    keyword: '#ff79c6',
    string: '#f1fa8c',
    number: '#bd93f9',
    comment: '#6272a4',
    fn: '#50fa7b',
    type: '#8be9fd',
    prop: '#66d9ef',
    tag: '#ff79c6',
    back: 'linear',
  },
  'Solarized Light': {
    bg: '#fdf6e3',
    fg: '#586e75',
    keyword: '#859900',
    string: '#2aa198',
    number: '#d33682',
    comment: '#93a1a1',
    fn: '#268bd2',
    type: '#b58900',
    prop: '#268bd2',
    tag: '#cb4b16',
    back: 'linear',
  },
} as const;
type ThemeName = keyof typeof THEMES;

const BACKDROPS: Record<string, [string, string]> = { Sunrise: ['#ff9a8b', '#ff6a88'], Ocean: ['#2193b0', '#6dd5ed'], Forest: ['#134e5e', '#71b280'], Night: ['#232526', '#414345'], None: ['', ''] };

type Language = 'javascript' | 'typescript' | 'python' | 'rust' | 'go' | 'java' | 'cpp' | 'css' | 'html' | 'json' | 'sql' | 'yaml' | 'markdown' | 'php' | 'xml';

async function parserFor(language: Language) {
  switch (language) {
    case 'javascript':
    case 'typescript':
      return (await import('@codemirror/lang-javascript')).javascript({ typescript: language === 'typescript', jsx: true }).language.parser;
    case 'python':
      return (await import('@codemirror/lang-python')).python().language.parser;
    case 'rust':
      return (await import('@codemirror/lang-rust')).rust().language.parser;
    case 'go':
      return (await import('@codemirror/lang-go')).go().language.parser;
    case 'java':
      return (await import('@codemirror/lang-java')).java().language.parser;
    case 'cpp':
      return (await import('@codemirror/lang-cpp')).cpp().language.parser;
    case 'css':
      return (await import('@codemirror/lang-css')).css().language.parser;
    case 'html':
      return (await import('@codemirror/lang-html')).html().language.parser;
    case 'json':
      return (await import('@codemirror/lang-json')).json().language.parser;
    case 'sql':
      return (await import('@codemirror/lang-sql')).sql().language.parser;
    case 'yaml':
      return (await import('@codemirror/lang-yaml')).yaml().language.parser;
    case 'markdown':
      return (await import('@codemirror/lang-markdown')).markdown().language.parser;
    case 'php':
      return (await import('@codemirror/lang-php')).php().language.parser;
    default:
      return (await import('@codemirror/lang-xml')).xml().language.parser;
  }
}

/** Coloured runs per line: [text, colour role]. */
async function highlight(code: string, language: Language): Promise<[string, string][][]> {
  const { highlightTree, tagHighlighter, tags: t } = await import('@lezer/highlight');
  const parser = await parserFor(language);
  const highlighter = tagHighlighter([
    { tag: [t.keyword, t.controlKeyword, t.operatorKeyword, t.definitionKeyword, t.moduleKeyword, t.modifier], class: 'keyword' },
    { tag: [t.string, t.special(t.string), t.regexp, t.character], class: 'string' },
    { tag: [t.number, t.bool, t.null, t.atom], class: 'number' },
    { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], class: 'comment' },
    { tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName], class: 'fn' },
    { tag: [t.typeName, t.className, t.namespace], class: 'type' },
    { tag: [t.propertyName, t.attributeName], class: 'prop' },
    { tag: [t.tagName, t.heading], class: 'tag' },
  ]);
  const roles = new Array<string>(code.length).fill('fg');
  highlightTree(parser.parse(code), highlighter, (from, to, classes) => {
    for (let i = from; i < to; i++) roles[i] = classes.split(' ')[0] ?? 'fg';
  });
  const lines: [string, string][][] = [[]];
  let run = '';
  let role = 'fg';
  const flush = () => {
    if (run) (lines[lines.length - 1] as [string, string][]).push([run, role]);
    run = '';
  };
  for (let i = 0; i < code.length; i++) {
    const ch = code[i] as string;
    if (ch === '\n') {
      flush();
      lines.push([]);
      continue;
    }
    if (roles[i] !== role) {
      flush();
      role = roles[i] as string;
    }
    run += ch === '\t' ? '  ' : ch;
  }
  flush();
  return lines;
}

interface ShotSettings {
  readonly code: string;
  readonly language: Language;
  readonly theme: ThemeName;
  readonly backdrop: string;
  readonly title: string;
  readonly numbers: boolean;
  readonly size: number;
}

async function drawShot(canvas: HTMLCanvasElement, s: ShotSettings, scale: number): Promise<void> {
  const theme = THEMES[s.theme];
  const lines = await highlight(s.code.replace(/\s+$/, ''), s.language);
  const font = `${s.size}px "JetBrains Mono", "Cascadia Code", Consolas, ui-monospace, monospace`;
  await document.fonts?.load(font).catch(() => undefined);
  const probe = canvas.getContext('2d') as CanvasRenderingContext2D;
  probe.font = font;
  const charWidth = probe.measureText('M').width;
  const lineHeight = Math.round(s.size * 1.55);
  const gutter = s.numbers ? (String(lines.length).length + 2) * charWidth : 0;
  const longest = Math.max(20, ...lines.map((line) => line.reduce((n, [text]) => n + text.length, 0)));
  const pad = s.backdrop === 'None' ? 0 : 56;
  const winW = Math.ceil(gutter + longest * charWidth + 48);
  const winH = Math.ceil(lines.length * lineHeight + 44 + 36);
  canvas.width = (winW + pad * 2) * scale;
  canvas.height = (winH + pad * 2) * scale;
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  ctx.scale(scale, scale);
  const [a, b] = BACKDROPS[s.backdrop] ?? ['', ''];
  if (a) {
    const g = ctx.createLinearGradient(0, 0, winW + pad * 2, winH + pad * 2);
    g.addColorStop(0, a);
    g.addColorStop(1, b);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, winW + pad * 2, winH + pad * 2);
  }
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = pad ? 30 : 0;
  ctx.shadowOffsetY = pad ? 12 : 0;
  ctx.fillStyle = theme.bg;
  ctx.beginPath();
  ctx.roundRect(pad, pad, winW, winH, 10);
  ctx.fill();
  ctx.restore();
  ['#ff5f57', '#febc2e', '#28c840'].forEach((c, i) => {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.arc(pad + 20 + i * 20, pad + 20, 6, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.font = `13px system-ui, sans-serif`;
  ctx.fillStyle = theme.comment;
  ctx.textAlign = 'center';
  if (s.title) ctx.fillText(s.title, pad + winW / 2, pad + 24);
  ctx.textAlign = 'left';
  ctx.font = font;
  ctx.textBaseline = 'alphabetic';
  lines.forEach((line, i) => {
    const y = pad + 44 + (i + 1) * lineHeight - lineHeight * 0.3;
    let x = pad + 24;
    if (s.numbers) {
      ctx.fillStyle = theme.comment;
      ctx.fillText(String(i + 1).padStart(String(lines.length).length, ' '), x, y);
      x += gutter;
    }
    for (const [text, role] of line) {
      ctx.fillStyle = (theme as Record<string, string>)[role] ?? theme.fg;
      ctx.fillText(text, x, y);
      x += text.length * charWidth;
    }
  });
}

const SAMPLE_CODE = `// Benchtop works offline
function greet(name: string): string {
  const time = new Date().getHours();
  return \`\${time < 12 ? 'Good morning' : 'Hello'}, \${name}!\`;
}

console.log(greet('VITM'));`;

function CodeShot({ toolId }: { toolId: string }) {
  const [s, set] = usePersistentState<ShotSettings>(
    toolId,
    (v: Values | undefined) => ({
      code: typeof v?.code === 'string' ? v.code : SAMPLE_CODE,
      language: (typeof v?.language === 'string' ? v.language : 'typescript') as Language,
      theme: (typeof v?.theme === 'string' && v.theme in THEMES ? v.theme : 'GitHub Dark') as ThemeName,
      backdrop: typeof v?.backdrop === 'string' ? v.backdrop : 'Ocean',
      title: typeof v?.title === 'string' ? v.title : 'greet.ts',
      numbers: v?.numbers === true,
      size: typeof v?.size === 'number' ? v.size : 15,
    }),
    (v) => ({ ...v }),
  );
  useIncomingFiles((files) =>
    attempt(async () => {
      const file = files[0] as File;
      const code = (await file.text()).slice(0, 20_000);
      set((v) => ({ ...v, code, title: file.name }));
    }),
  );
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (canvas.current) void drawShot(canvas.current, s, 1).catch((e: unknown) => notify(errorMessage(e), 'error'));
  }, [s]);
  const save = () =>
    attempt(async () => {
      const out = document.createElement('canvas');
      await drawShot(out, s, 2);
      const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('Could not make the picture.');
      const saved = await saveFile(`${s.title.replace(/[^\w.-]+/g, '-') || 'code'}.png`, blob, 'image/png');
      if (saved.saved) notify(`Saved to ${saved.location}`);
    });
  return (
    <div data-testid="tool" class="tool split-tool">
      <div class="pane">
        <div class="pane-header">
          <select class="input" aria-label="Language" value={s.language} onChange={(e) => set((v) => ({ ...v, language: e.currentTarget.value as Language }))}>
            {(['javascript', 'typescript', 'python', 'rust', 'go', 'java', 'cpp', 'php', 'css', 'html', 'xml', 'json', 'yaml', 'sql', 'markdown'] as const).map((l) => (
              <option key={l}>{l}</option>
            ))}
          </select>
          <select class="input" aria-label="Theme" value={s.theme} onChange={(e) => set((v) => ({ ...v, theme: e.currentTarget.value as ThemeName }))}>
            {Object.keys(THEMES).map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
          <select class="input" aria-label="Background" value={s.backdrop} onChange={(e) => set((v) => ({ ...v, backdrop: e.currentTarget.value }))}>
            {Object.keys(BACKDROPS).map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </div>
        <div class="pane-body">
          <CodeEditor value={s.code} onChange={(code) => set((v) => ({ ...v, code }))} label="Code" testId="shot-code" />
        </div>
        <div class="pane-footer control-row">
          <input class="input" aria-label="Title" value={s.title} onInput={(e) => set((v) => ({ ...v, title: e.currentTarget.value }))} />
          <label class="check">
            <input type="checkbox" checked={s.numbers} onChange={(e) => set((v) => ({ ...v, numbers: e.currentTarget.checked }))} /> Line numbers
          </label>
          <input class="input tz-hour" type="number" min={10} max={28} aria-label="Font size" value={s.size} onInput={(e) => set((v) => ({ ...v, size: Number(e.currentTarget.value) || 15 }))} />
        </div>
      </div>
      <div class="pane">
        <div class="pane-header">
          <h2 class="pane-title">Picture</h2>
          <div class="pane-actions">
            <button type="button" class="button button-small button-primary" onClick={save} data-testid="shot-save">
              Save PNG
            </button>
          </div>
        </div>
        <div class="pane-body shot-stage" {...scrollRegion('Code picture')}>
          <canvas ref={canvas} class="shot-canvas" aria-label="Code picture preview" />
        </div>
      </div>
    </div>
  );
}

function EngineerTools({ toolId }: { toolId: string }) {
  switch (toolId) {
    case 'wireguard-config':
      return <WireGuard toolId={toolId} />;
    case 'time-zones':
      return <TimeZones toolId={toolId} />;
    case 'code-screenshot':
      return <CodeShot toolId={toolId} />;
    default:
      return <ComponentCodes toolId={toolId} />;
  }
}

export default defineCustomTool(EngineerTools);
