import { ToolError } from '../../lib/errors';
import { esc, formatMs, html, note, pill, report, type Tone, table } from '../../lib/net/report';
import { net } from '../../platform/net';
import { defineTextTool } from '../types';
import { hostAndPort } from './_online';

export { parsePorts, SERVICES } from '../../lib/ports';

import { parsePorts, SERVICES } from '../../lib/ports';

const PRESETS: Record<string, number[]> = {
  common: [21, 22, 23, 25, 53, 80, 110, 143, 443, 445, 587, 993, 995, 3306, 3389, 5432, 5900, 8080, 8443],
  web: [80, 443, 3000, 5000, 5173, 8000, 8008, 8080, 8443, 9000],
  mail: [25, 110, 143, 465, 587, 993, 995],
  databases: [1433, 1521, 3306, 5432, 6379, 9200, 11211, 27017],
  remote: [22, 23, 3389, 5900, 5938, 2375, 2376, 6443],
  industrial: [102, 502, 1883, 4840, 8883, 20000, 44818, 47808],
};

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
