import { apacheConfig, caddyConfig, nginxConfig, type ServerOptions } from '../../lib/web';
import { defineTextTool, type Values } from '../types';

export default defineTextTool({
  input: false,
  output: { label: 'Configuration' },
  options: [
    {
      key: 'server',
      label: 'Server',
      type: 'segmented',
      choices: [
        { value: 'nginx', label: 'Nginx' },
        { value: 'apache', label: 'Apache' },
        { value: 'caddy', label: 'Caddy' },
      ],
      default: 'nginx',
    },
    {
      key: 'kind',
      label: 'Site',
      type: 'select',
      choices: [
        { value: 'static', label: 'Static files' },
        { value: 'spa', label: 'Single-page app (fallback to index.html)' },
        { value: 'proxy', label: 'Reverse proxy to an app server' },
      ],
      default: 'spa',
    },
    { key: 'domain', label: 'Domain', type: 'text', default: 'example.org', mono: true },
    { key: 'root', label: 'Files folder', type: 'text', default: '/var/www/example', mono: true, showIf: (v: Values) => v.kind !== 'proxy' },
    { key: 'upstream', label: 'App server', type: 'text', default: 'http://127.0.0.1:3000', mono: true, showIf: (v: Values) => v.kind === 'proxy' },
    { key: 'websockets', label: 'WebSockets', type: 'toggle', default: false, showIf: (v: Values) => v.kind === 'proxy' },
    { key: 'https', label: 'HTTPS with Let’s Encrypt certificates', type: 'toggle', default: true },
    { key: 'redirectWww', label: 'Redirect www to the bare domain', type: 'toggle', default: true },
    { key: 'compression', label: 'Compression', type: 'toggle', default: true },
    { key: 'caching', label: 'Long caching for assets', type: 'toggle', default: true, showIf: (v: Values) => v.kind !== 'proxy' },
    { key: 'maxBody', label: 'Largest upload', type: 'number', min: 1, max: 10240, step: 1, unit: 'MB', default: 20 },
  ],
  runOnEmpty: true,
  run(_input, o) {
    const options: ServerOptions = { ...o, kind: o.kind as ServerOptions['kind'] };
    const output = o.server === 'apache' ? apacheConfig(options) : o.server === 'caddy' ? caddyConfig(options) : nginxConfig(options);
    const check = o.server === 'apache' ? 'sudo apachectl configtest' : o.server === 'caddy' ? 'caddy validate --config /etc/caddy/Caddyfile' : 'sudo nginx -t';
    const certificate =
      o.https && o.server !== 'caddy'
        ? ` Get the certificate first, for example with: sudo certbot certonly --webroot -w ${o.root || '/var/www/html'} -d ${o.domain}${o.redirectWww ? ` -d www.${o.domain}` : ''}.`
        : '';
    return { output, info: `Check the configuration before reloading: ${check}.${certificate}` };
  },
});
