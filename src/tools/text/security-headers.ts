import { headersFor, securityHeaders } from '../../lib/web';
import { defineTextTool, type Values } from '../types';

const csp = (v: Values) => v.csp === true;

export default defineTextTool({
  input: false,
  output: { label: 'Configuration' },
  options: [
    {
      key: 'server',
      label: 'Write for',
      type: 'select',
      choices: [
        { value: 'nginx', label: 'Nginx' },
        { value: 'apache', label: 'Apache (.htaccess or vhost)' },
        { value: 'caddy', label: 'Caddy' },
        { value: 'express', label: 'Node.js / Express' },
        { value: 'netlify', label: 'Netlify / Cloudflare Pages _headers' },
        { value: 'raw', label: 'Plain headers' },
      ],
      default: 'nginx',
    },
    { key: 'heading-csp', label: 'Content security policy', type: 'heading' },
    { key: 'csp', label: 'Send a content security policy', type: 'toggle', default: true },
    { key: 'reportOnly', label: 'Report only (test without blocking)', type: 'toggle', default: false, showIf: csp },
    {
      key: 'cspDefault',
      label: 'default-src',
      type: 'text',
      default: 'self',
      mono: true,
      showIf: csp,
      help: 'Keywords such as self, none, unsafe-inline get their quotes added; hosts are written as they are.',
    },
    { key: 'cspScripts', label: 'script-src', type: 'text', default: 'self', mono: true, showIf: csp },
    { key: 'cspStyles', label: 'style-src', type: 'text', default: 'self', mono: true, showIf: csp },
    { key: 'cspImages', label: 'img-src', type: 'text', default: 'self data:', mono: true, showIf: csp },
    { key: 'cspFonts', label: 'font-src', type: 'text', default: 'self', mono: true, showIf: csp },
    { key: 'cspConnect', label: 'connect-src', type: 'text', default: 'self', mono: true, showIf: csp },
    { key: 'cspFrames', label: 'frame-src', type: 'text', default: '', mono: true, showIf: csp, placeholder: 'https://www.youtube-nocookie.com' },
    { key: 'upgradeInsecure', label: 'Upgrade insecure requests', type: 'toggle', default: true, showIf: csp },
    { key: 'heading-other', label: 'Other headers', type: 'heading' },
    { key: 'hsts', label: 'HSTS (HTTPS only, two years)', type: 'toggle', default: true },
    { key: 'hstsPreload', label: 'HSTS preload', type: 'toggle', default: false, showIf: (v: Values) => v.hsts === true },
    {
      key: 'frame',
      label: 'Allow framing',
      type: 'select',
      choices: [
        { value: 'DENY', label: 'Never' },
        { value: 'SAMEORIGIN', label: 'Same site only' },
        { value: 'none', label: "Don't set" },
      ],
      default: 'DENY',
    },
    { key: 'nosniff', label: 'X-Content-Type-Options: nosniff', type: 'toggle', default: true },
    {
      key: 'referrer',
      label: 'Referrer-Policy',
      type: 'select',
      choices: ['strict-origin-when-cross-origin', 'no-referrer', 'same-origin', 'strict-origin', 'origin', { value: '', label: "Don't set" }],
      default: 'strict-origin-when-cross-origin',
    },
    { key: 'permissions', label: 'Turn off camera, microphone, location and payment APIs', type: 'toggle', default: true },
    { key: 'isolation', label: 'Cross-origin isolation (COOP, COEP, CORP)', type: 'toggle', default: false },
  ],
  runOnEmpty: true,
  run(_input, o) {
    const { headers, warnings } = securityHeaders({ ...o, frame: o.frame as 'DENY' | 'SAMEORIGIN' | 'none' });
    return {
      output: headersFor(o.server as 'nginx', headers),
      warnings,
      info: `${headers.length} headers. Test your site after adding them: a strict policy can block scripts and styles it relies on.`,
    };
  },
});
