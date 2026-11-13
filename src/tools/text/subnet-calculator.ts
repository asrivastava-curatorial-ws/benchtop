import { ToolError } from '../../lib/errors';
import { classify, formatAddress, fullIPv6, hostRange, parseCidr, subdivide } from '../../lib/subnet';
import { defineTextTool, type Field } from '../types';

export default defineTextTool({
  input: { label: 'Address and prefix', sample: '192.168.10.37/26', placeholder: '10.0.0.1/24, 172.16.5.4 255.255.240.0 or 2001:db8::/48' },
  output: { label: 'Subnets' },
  options: [{ key: 'split', label: 'Split into /', type: 'number', min: 0, max: 128, step: 1, default: 0, help: '0 leaves the network whole. Up to 256 subnets are listed.' }],
  run(input, o) {
    const lines = input
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length === 0) throw new ToolError('Enter an address such as 192.168.1.10/24.');
    const net = parseCidr(lines[0] as string);
    const f = (value: bigint) => formatAddress(net.family, value);
    const hosts = hostRange(net);
    const fields: Field[] = [
      { label: 'Address', value: f(net.address), mono: true },
      { label: 'Network', value: `${f(net.network)}/${net.prefix}`, mono: true },
    ];
    if (net.family === 4) {
      fields.push(
        { label: 'Netmask', value: f(net.mask), mono: true },
        { label: 'Wildcard', value: f(net.mask ^ 0xffffffffn), mono: true },
        { label: 'Broadcast', value: net.prefix < 31 ? f(net.last) : '(none)', mono: true },
      );
    } else {
      fields.push({ label: 'Expanded', value: fullIPv6(net.network), mono: true });
    }
    fields.push(
      { label: 'Usable hosts', value: `${f(hosts.first)} – ${f(hosts.last)}`, mono: true },
      { label: 'Host count', value: hosts.count.toLocaleString('en-US') },
      { label: 'Addresses', value: net.size.toLocaleString('en-US') },
      { label: 'Type', value: classify(net.family, net.address) },
    );
    if (net.family === 4)
      fields.push({
        label: 'Binary mask',
        value: net.mask
          .toString(2)
          .padStart(32, '0')
          .replace(/(.{8})(?!$)/g, '$1.'),
        mono: true,
      });
    let output = '';
    if (o.split > 0) {
      const { subnets, total } = subdivide(net, o.split);
      output = subnets.map((start) => `${f(start)}/${o.split}`).join('\n');
      if (total > BigInt(subnets.length)) output += `\n... ${(total - BigInt(subnets.length)).toLocaleString('en-US')} more`;
      fields.push({ label: 'Subnets', value: `${total.toLocaleString('en-US')} × /${o.split}` });
    }
    // Further lines: say whether each address is inside the network.
    const checks = lines.slice(1).map((line) => {
      try {
        const other = parseCidr(line);
        const inside = other.family === net.family && (other.address & net.mask) === net.network;
        return `${line}: ${inside ? 'inside' : 'outside'} ${f(net.network)}/${net.prefix}`;
      } catch (error) {
        return `${line}: ${(error as Error).message}`;
      }
    });
    if (checks.length > 0) output = `${checks.join('\n')}${output ? `\n\n${output}` : ''}`;
    return { output: output ? `${output}\n` : '', fields, info: lines.length === 1 ? 'Add more addresses on new lines to check whether they are in this network.' : undefined };
  },
});
