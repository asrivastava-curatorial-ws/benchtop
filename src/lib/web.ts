/** URLs, HTTP security headers and web server configuration. */
import { ToolError } from './errors';

/* ------------------------------------------------------------------- URLs -- */

export interface UrlParts {
  readonly href: string;
  readonly protocol: string;
  readonly username: string;
  readonly password: string;
  readonly hostname: string;
  readonly port: string;
  readonly pathname: string;
  readonly search: string;
  readonly hash: string;
  readonly origin: string;
  readonly query: readonly [string, string][];
  readonly pathSegments: readonly string[];
}

export function parseUrl(text: string): UrlParts {
  const trimmed = text.trim();
  if (trimmed === '') throw new ToolError('Enter a URL such as https://example.org/path?q=1#top.');
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    try {
      // Accept addresses typed without a scheme.
      url = new URL(`https://${trimmed}`);
      if (!url.hostname.includes('.') && url.hostname !== 'localhost') throw new Error('no host');
    } catch {
      throw new ToolError('This is not a URL. Include the scheme, as in https://example.org/.');
    }
  }
  return {
    href: url.href,
    protocol: url.protocol.replace(/:$/, ''),
    username: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    hostname: url.hostname,
    port: url.port,
    pathname: url.pathname,
    search: url.search,
    hash: url.hash,
    origin: url.origin,
    query: [...url.searchParams.entries()],
    pathSegments: url.pathname
      .split('/')
      .filter(Boolean)
      .map((segment) => {
        try {
          return decodeURIComponent(segment);
        } catch {
          return segment;
        }
      }),
  };
}

export interface UrlSpec {
  readonly protocol?: string;
  readonly username?: string;
  readonly password?: string;
  readonly hostname: string;
  readonly port?: string | number;
  readonly path?: string | readonly string[];
  readonly query?: Record<string, unknown> | readonly [string, unknown][];
  readonly hash?: string;
}

/** Builds a URL from parts; query values that are arrays become repeated parameters. */
export function buildUrl(spec: UrlSpec): string {
  if (typeof spec.hostname !== 'string' || spec.hostname === '') throw new ToolError('"hostname" is required.');
  const url = new URL(`${(spec.protocol ?? 'https').replace(/:?$/, ':')}//${spec.hostname}`);
  if (spec.port !== undefined && spec.port !== '') url.port = String(spec.port);
  if (spec.username) url.username = encodeURIComponent(spec.username);
  if (spec.password) url.password = encodeURIComponent(spec.password);
  if (Array.isArray(spec.path)) url.pathname = `/${spec.path.map((segment) => encodeURIComponent(String(segment))).join('/')}`;
  else if (typeof spec.path === 'string') url.pathname = spec.path;
  const entries = Array.isArray(spec.query) ? spec.query : Object.entries(spec.query ?? {});
  for (const [key, value] of entries as [string, unknown][]) {
    for (const item of Array.isArray(value) ? value : [value]) url.searchParams.append(key, item === null || item === undefined ? '' : typeof item === 'object' ? JSON.stringify(item) : String(item));
  }
  if (spec.hash) url.hash = spec.hash;
  return url.href;
}

/* ------------------------------------------------------- security headers -- */

export interface SecurityOptions {
  readonly csp: boolean;
  readonly cspDefault: string;
  readonly cspScripts: string;
  readonly cspStyles: string;
  readonly cspImages: string;
  readonly cspConnect: string;
  readonly cspFonts: string;
  readonly cspFrames: string;
  readonly upgradeInsecure: boolean;
  readonly reportOnly: boolean;
  readonly hsts: boolean;
  readonly hstsPreload: boolean;
  readonly frame: 'DENY' | 'SAMEORIGIN' | 'none';
  readonly referrer: string;
  readonly nosniff: boolean;
  readonly permissions: boolean;
  readonly isolation: boolean;
}

const sources = (text: string) =>
  text
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((source) => (['self', 'none', 'unsafe-inline', 'unsafe-eval', 'strict-dynamic', 'wasm-unsafe-eval', 'unsafe-hashes', 'report-sample'].includes(source) ? `'${source}'` : source))
    .join(' ');

export function securityHeaders(o: SecurityOptions): { headers: [string, string][]; warnings: string[] } {
  const headers: [string, string][] = [];
  const warnings: string[] = [];
  if (o.csp) {
    const directives: string[] = [];
    const add = (name: string, value: string) => {
      const list = sources(value);
      if (list) directives.push(`${name} ${list}`);
    };
    add('default-src', o.cspDefault);
    add('script-src', o.cspScripts);
    add('style-src', o.cspStyles);
    add('img-src', o.cspImages);
    add('font-src', o.cspFonts);
    add('connect-src', o.cspConnect);
    add('frame-src', o.cspFrames);
    directives.push("object-src 'none'", "base-uri 'self'", "form-action 'self'");
    if (o.frame !== 'none') directives.push(`frame-ancestors ${o.frame === 'DENY' ? "'none'" : "'self'"}`);
    if (o.upgradeInsecure) directives.push('upgrade-insecure-requests');
    headers.push([o.reportOnly ? 'Content-Security-Policy-Report-Only' : 'Content-Security-Policy', directives.join('; ')]);
    const scripts = sources(o.cspScripts || o.cspDefault);
    if (/'unsafe-inline'/.test(scripts) && !/'strict-dynamic'|'nonce-|'sha(256|384|512)-/.test(scripts))
      warnings.push("script-src allows 'unsafe-inline', which removes most of the protection against cross-site scripting.");
    if (/'unsafe-eval'/.test(scripts)) warnings.push("script-src allows 'unsafe-eval'; avoid it unless a library truly needs it.");
    if (/(^|\s)(\*|https:|http:)(\s|$)/.test(scripts)) warnings.push('script-src allows scripts from any host; list the hosts you need instead.');
  }
  if (o.hsts) {
    headers.push(['Strict-Transport-Security', `max-age=63072000; includeSubDomains${o.hstsPreload ? '; preload' : ''}`]);
    if (o.hstsPreload) warnings.push('Only use preload after every subdomain serves HTTPS: browsers will refuse plain HTTP for the whole domain.');
  }
  if (o.frame !== 'none') headers.push(['X-Frame-Options', o.frame]);
  if (o.nosniff) headers.push(['X-Content-Type-Options', 'nosniff']);
  if (o.referrer) headers.push(['Referrer-Policy', o.referrer]);
  if (o.permissions) headers.push(['Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()']);
  if (o.isolation) {
    headers.push(['Cross-Origin-Opener-Policy', 'same-origin'], ['Cross-Origin-Resource-Policy', 'same-origin'], ['Cross-Origin-Embedder-Policy', 'require-corp']);
    warnings.push('Cross-Origin-Embedder-Policy blocks cross-origin images and scripts that do not send CORS or CORP headers. Test before enabling it.');
  }
  return { headers, warnings };
}

export function headersFor(server: 'nginx' | 'apache' | 'caddy' | 'express' | 'netlify' | 'raw', headers: readonly [string, string][]): string {
  switch (server) {
    case 'nginx':
      return `${headers.map(([name, value]) => `add_header ${name} "${value.replace(/"/g, '\\"')}" always;`).join('\n')}\n`;
    case 'apache':
      return `<IfModule mod_headers.c>\n${headers.map(([name, value]) => `  Header always set ${name} "${value.replace(/"/g, '\\"')}"`).join('\n')}\n</IfModule>\n`;
    case 'caddy':
      return `header {\n${headers.map(([name, value]) => `\t${name} "${value.replace(/"/g, '\\"')}"`).join('\n')}\n}\n`;
    case 'express':
      return `app.use((req, res, next) => {\n${headers.map(([name, value]) => `  res.setHeader('${name}', ${JSON.stringify(value)});`).join('\n')}\n  next();\n});\n`;
    case 'netlify':
      return `/*\n${headers.map(([name, value]) => `  ${name}: ${value}`).join('\n')}\n`;
    default:
      return `${headers.map(([name, value]) => `${name}: ${value}`).join('\n')}\n`;
  }
}

/* -------------------------------------------------------- server configs -- */

export interface ServerOptions {
  readonly kind: 'static' | 'spa' | 'proxy';
  readonly domain: string;
  readonly root: string;
  readonly upstream: string;
  readonly https: boolean;
  readonly redirectWww: boolean;
  readonly compression: boolean;
  readonly caching: boolean;
  readonly websockets: boolean;
  readonly maxBody: number;
}

const certPath = (domain: string) => `/etc/letsencrypt/live/${domain}`;

export function nginxConfig(o: ServerOptions): string {
  const domain = o.domain.trim() || 'example.org';
  const names = o.redirectWww ? `${domain} www.${domain}` : domain;
  const blocks: string[] = [];
  if (o.https) {
    blocks.push(`server {\n    listen 80;\n    listen [::]:80;\n    server_name ${names};\n    return 301 https://${domain}$request_uri;\n}`);
  }
  const lines: string[] = [];
  if (o.https) {
    lines.push(
      '    # On nginx 1.25.1 and later you can write "listen 443 ssl;" plus "http2 on;" instead.',
      '    listen 443 ssl http2;',
      '    listen [::]:443 ssl http2;',
      `    server_name ${o.redirectWww ? domain : names};`,
      '',
      `    ssl_certificate     ${certPath(domain)}/fullchain.pem;`,
      `    ssl_certificate_key ${certPath(domain)}/privkey.pem;`,
      '    ssl_protocols TLSv1.2 TLSv1.3;',
    );
  } else {
    lines.push('    listen 80;', '    listen [::]:80;', `    server_name ${names};`);
  }
  lines.push('', `    client_max_body_size ${o.maxBody}m;`);
  if (o.compression)
    lines.push('', '    gzip on;', '    gzip_vary on;', '    gzip_min_length 1024;', '    gzip_types text/plain text/css application/javascript application/json image/svg+xml application/xml;');
  if (o.kind === 'proxy') {
    lines.push(
      '',
      '    location / {',
      `        proxy_pass ${o.upstream.trim() || 'http://127.0.0.1:3000'};`,
      '        proxy_http_version 1.1;',
      '        proxy_set_header Host $host;',
      '        proxy_set_header X-Real-IP $remote_addr;',
      '        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;',
      '        proxy_set_header X-Forwarded-Proto $scheme;',
    );
    if (o.websockets) lines.push('        proxy_set_header Upgrade $http_upgrade;', '        proxy_set_header Connection "upgrade";', '        proxy_read_timeout 1h;');
    lines.push('    }');
  } else {
    lines.push(
      '',
      `    root ${o.root.trim() || '/var/www/site'};`,
      '    index index.html;',
      '',
      '    location / {',
      `        try_files $uri $uri/ ${o.kind === 'spa' ? '/index.html' : '=404'};`,
      '    }',
    );
    if (o.caching)
      lines.push(
        '',
        '    location ~* \\.(?:css|js|mjs|woff2?|png|jpe?g|gif|svg|webp|avif|ico)$ {',
        '        expires 30d;',
        '        add_header Cache-Control "public, max-age=2592000, immutable";',
        '        access_log off;',
        '    }',
      );
  }
  blocks.push(`server {\n${lines.join('\n')}\n}`);
  if (o.https && o.redirectWww) {
    blocks.push(
      `server {\n    listen 443 ssl;\n    listen [::]:443 ssl;\n    server_name www.${domain};\n    ssl_certificate     ${certPath(domain)}/fullchain.pem;\n    ssl_certificate_key ${certPath(domain)}/privkey.pem;\n    return 301 https://${domain}$request_uri;\n}`,
    );
  }
  return `${blocks.join('\n\n')}\n`;
}

export function apacheConfig(o: ServerOptions): string {
  const domain = o.domain.trim() || 'example.org';
  const parts: string[] = [];
  const body: string[] = [`    ServerName ${domain}`];
  if (o.redirectWww) body.push(`    ServerAlias www.${domain}`);
  if (o.kind === 'proxy') {
    const upstream = o.upstream.trim() || 'http://127.0.0.1:3000';
    body.push(
      '',
      '    ProxyPreserveHost On',
      `    ProxyPass / ${upstream.replace(/\/?$/, '/')}`,
      `    ProxyPassReverse / ${upstream.replace(/\/?$/, '/')}`,
      '    RequestHeader set X-Forwarded-Proto "https"',
    );
    if (o.websockets) body.push('    RewriteEngine On', '    RewriteCond %{HTTP:Upgrade} =websocket [NC]', `    RewriteRule /(.*) ${upstream.replace(/^http/, 'ws').replace(/\/?$/, '/')}$1 [P,L]`);
  } else {
    const root = o.root.trim() || '/var/www/site';
    body.push(`    DocumentRoot ${root}`, '', `    <Directory ${root}>`, '        Options -Indexes +FollowSymLinks', '        AllowOverride All', '        Require all granted');
    if (o.kind === 'spa')
      body.push('', '        RewriteEngine On', '        RewriteCond %{REQUEST_FILENAME} !-f', '        RewriteCond %{REQUEST_FILENAME} !-d', '        RewriteRule ^ index.html [L]');
    body.push('    </Directory>');
    if (o.caching)
      body.push(
        '',
        '    <IfModule mod_expires.c>',
        '        ExpiresActive On',
        '        ExpiresByType text/css "access plus 30 days"',
        '        ExpiresByType application/javascript "access plus 30 days"',
        '        ExpiresByType image/webp "access plus 30 days"',
        '        ExpiresByType font/woff2 "access plus 1 year"',
        '    </IfModule>',
      );
  }
  body.push(`    LimitRequestBody ${o.maxBody * 1024 * 1024}`);
  if (o.compression)
    body.push('', '    <IfModule mod_deflate.c>', '        AddOutputFilterByType DEFLATE text/html text/plain text/css application/javascript application/json image/svg+xml', '    </IfModule>');
  if (o.https) {
    parts.push(`<VirtualHost *:80>\n    ServerName ${domain}${o.redirectWww ? `\n    ServerAlias www.${domain}` : ''}\n    Redirect permanent / https://${domain}/\n</VirtualHost>`);
    parts.push(
      `<VirtualHost *:443>\n${body.join('\n')}\n\n    SSLEngine on\n    SSLCertificateFile ${certPath(domain)}/fullchain.pem\n    SSLCertificateKeyFile ${certPath(domain)}/privkey.pem\n</VirtualHost>`,
    );
  } else {
    parts.push(`<VirtualHost *:80>\n${body.join('\n')}\n</VirtualHost>`);
  }
  const modules = [
    'headers',
    ...(o.https ? ['ssl'] : []),
    ...(o.kind === 'proxy' ? ['proxy', 'proxy_http', ...(o.websockets ? ['proxy_wstunnel', 'rewrite'] : [])] : o.kind === 'spa' ? ['rewrite'] : []),
    ...(o.caching && o.kind !== 'proxy' ? ['expires'] : []),
    ...(o.compression ? ['deflate'] : []),
  ];
  return `# Enable the modules this needs: sudo a2enmod ${[...new Set(modules)].join(' ')}\n${parts.join('\n\n')}\n`;
}

export function caddyConfig(o: ServerOptions): string {
  const domain = o.domain.trim() || 'example.org';
  const site = o.https ? domain : `http://${domain}`;
  const lines: string[] = [];
  if (o.compression) lines.push('\tencode zstd gzip');
  lines.push(`\trequest_body {\n\t\tmax_size ${o.maxBody}MB\n\t}`);
  if (o.kind === 'proxy') lines.push(`\treverse_proxy ${(o.upstream.trim() || 'http://127.0.0.1:3000').replace(/^https?:\/\//, '')}`);
  else {
    lines.push(`\troot * ${o.root.trim() || '/var/www/site'}`);
    if (o.kind === 'spa') lines.push('\ttry_files {path} /index.html');
    if (o.caching) lines.push('\t@assets path *.css *.js *.woff2 *.png *.jpg *.svg *.webp *.avif', '\theader @assets Cache-Control "public, max-age=2592000, immutable"');
    lines.push('\tfile_server');
  }
  const www = o.redirectWww ? `\n\n${o.https ? '' : 'http://'}www.${domain} {\n\tredir ${o.https ? 'https' : 'http'}://${domain}{uri} permanent\n}` : '';
  return `# Caddy obtains and renews HTTPS certificates automatically.\n${site} {\n${lines.join('\n')}\n}${www}\n`;
}
