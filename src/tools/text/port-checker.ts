import { ToolError } from '../../lib/errors';
import { esc, formatMs, html, note, pill, report, type Tone, table } from '../../lib/net/report';
import { net } from '../../platform/net';
import { defineTextTool } from '../types';
import { hostAndPort } from './_online';

export const SERVICES: Record<number, string> = {
  20: 'FTP data',
  21: 'FTP',
  22: 'SSH',
  23: 'Telnet',
  25: 'SMTP',
  53: 'DNS',
  80: 'HTTP',
  88: 'Kerberos',
  110: 'POP3',
  111: 'RPC',
  123: 'NTP',
  135: 'MS RPC',
  139: 'NetBIOS',
  143: 'IMAP',
  161: 'SNMP',
  389: 'LDAP',
  443: 'HTTPS',
  445: 'SMB',
  465: 'SMTPS',
  502: 'Modbus',
  514: 'Syslog',
  587: 'SMTP submission',
  631: 'IPP printing',
  636: 'LDAPS',
  853: 'DNS over TLS',
  873: 'rsync',
  993: 'IMAPS',
  995: 'POP3S',
  1080: 'SOCKS',
  1194: 'OpenVPN',
  1433: 'SQL Server',
  1521: 'Oracle',
  1723: 'PPTP',
  1883: 'MQTT',
  2049: 'NFS',
  2375: 'Docker (no TLS)',
  2376: 'Docker',
  3000: 'Dev server',
  3306: 'MySQL',
  3389: 'Remote Desktop',
  4840: 'OPC UA',
  5000: 'Dev server',
  5060: 'SIP',
  5173: 'Vite',
  5432: 'PostgreSQL',
  5672: 'AMQP',
  5900: 'VNC',
  6379: 'Redis',
  6443: 'Kubernetes API',
  8000: 'HTTP alt',
  8008: 'HTTP alt',
  8080: 'HTTP proxy / alt',
  8443: 'HTTPS alt',
  8883: 'MQTT over TLS',
  9000: 'App server',
  9090: 'Prometheus',
  9092: 'Kafka',
  9200: 'Elasticsearch',
  11211: 'Memcached',
  25565: 'Minecraft',
  27017: 'MongoDB',
  44818: 'EtherNet/IP',
  47808: 'BACnet',
};

const PRESETS: Record<string, number[]> = {
  common: [21, 22, 23, 25, 53, 80, 110, 143, 443, 445, 587, 993, 995, 3306, 3389, 5432, 5900, 8080, 8443],
  web: [80, 443, 3000, 5000, 5173, 8000, 8008, 8080, 8443, 9000],
  mail: [25, 110, 143, 465, 587, 993, 995],
  databases: [1433, 1521, 3306, 5432, 6379, 9200, 11211, 27017],
  remote: [22, 23, 3389, 5900, 5938, 2375, 2376, 6443],
  industrial: [102, 502, 1883, 4840, 8883, 20000, 44818, 47808],
};

/** "22, 80-90, 443" → ports. */
export function parsePorts(text: string, limit = 1024): number[] {
  const ports = new Set<number>();
  for (const part of text.split(/[\s,;]+/)) {
    if (part === '') continue;
    const range = /^(\d+)\s*-\s*(\d+)$/.exec(part);
    if (range) {
      const low = Number(range[1]);
      const high = Number(range[2]);
      if (low < 1 || high > 65535 || low > high) throw new ToolError(`"${part}" is not a valid port range.`);
      for (let port = low; port <= high; port++) {
        ports.add(port);
        if (ports.size > limit) throw new ToolError(`Check at most ${limit} ports at a time.`);
      }
      continue;
    }
    const port = Number(part);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new ToolError(`"${part}" is not a port number (1–65535).`);
    ports.add(port);
  }
  if (ports.size === 0) throw new ToolError('Enter at least one port.');
  if (ports.size > limit) throw new ToolError(`Check at most ${limit} ports at a time.`);
  return [...ports];
}

const STATES: Record<string, [string, Tone]> = {
  open: ['Open', 'ok'],
  closed: ['Closed', 'muted'],
  filtered: ['No answer', 'warn'],
  error: ['Error', 'bad'],
};

export default defineTextTool({
  input: false,
  output: { label: 'Table' },
  options: [
    { key: 'host', label: 'Host', type: 'text', default: '', placeholder: 'example.org or 192.0.2.10', mono: true, wide: true },
    {
      key: 'preset',
      label: 'Ports',
      type: 'select',
      choices: [
        { value: 'common', label: 'Common services' },
        { value: 'web', label: 'Web servers' },
        { value: 'mail', label: 'Mail' },
        { value: 'databases', label: 'Databases' },
        { value: 'remote', label: 'Remote access' },
        { value: 'industrial', label: 'Industrial (Modbus, OPC UA, BACnet…)' },
        { value: 'custom', label: 'Custom list' },
      ],
      default: 'common',
    },
    { key: 'ports', label: 'Port list', type: 'text', default: '80, 443', placeholder: '22, 80, 8000-8100', mono: true, showIf: (v) => v.preset === 'custom' },
    { key: 'timeout', label: 'Wait per port', type: 'number', default: 3, min: 1, max: 15, step: 1, unit: 's' },
  ],
  live: false,
  action: 'Check',
  mainThread: true,
  async run(_input, o) {
    const transport = net();
    if (o.host.trim() === '') throw new ToolError('Enter a host name or IP address.');
    const { host } = hostAndPort(o.host, 0);
    const ports = o.preset === 'custom' ? parsePorts(o.ports) : (PRESETS[o.preset] ?? []);
    const response = await transport.probe({ host, ports, timeoutMs: o.timeout * 1000 });
    const open = response.results.filter((result) => result.state === 'open');
    const shown = ports.length > 40 ? response.results.filter((result) => result.state !== 'closed') : response.results;
    return {
      fields: [
        { label: 'Host', value: `${host} (${response.address})`, mono: true },
        {
          label: 'Open',
          value: open.length > 0 ? open.map((result) => `${result.port}${SERVICES[result.port] ? ` ${SERVICES[result.port]}` : ''}`).join(', ') : 'None',
          tone: open.length > 0 ? 'ok' : 'warn',
        },
        { label: 'Checked', value: `${ports.length} port${ports.length === 1 ? '' : 's'}` },
      ],
      output: ['port\tservice\tstate\tms', ...response.results.map((result) => [result.port, SERVICES[result.port] ?? '', result.state, Math.round(result.elapsedMs)].join('\t'))].join('\n'),
      filename: `${host}-ports.tsv`,
      preview: {
        kind: 'html',
        html: report(
          note('Tested from this computer. "No answer" usually means a firewall dropped the attempt; a port open here may still be closed to the internet.'),
          ports.length > 40 && shown.length < response.results.length ? note(`${response.results.length - shown.length} closed ports are hidden.`) : '',
          table(
            ['Port', 'Service', 'State', 'Time'],
            shown.map((result) => [
              result.port,
              SERVICES[result.port] ?? '',
              html(pill((STATES[result.state] ?? ['?', 'muted'])[0], (STATES[result.state] ?? ['?', 'muted'])[1])),
              result.state === 'filtered' ? '' : formatMs(result.elapsedMs),
            ]),
            { numeric: [0, 3] },
          ),
          `<p>${esc(`${open.length} open of ${ports.length}`)}</p>`,
        ),
      },
    };
  },
});
