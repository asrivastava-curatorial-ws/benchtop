/**
 * Parses a `curl` command line and renders it as JavaScript `fetch()` code.
 *
 * The tokenizer follows POSIX shell quoting (single quotes, double quotes,
 * ANSI-C `$'...'` strings, backslash escapes and line continuations), which
 * is what "Copy as cURL" in browsers and most documentation produce.
 */
import { toBase64, utf8Encode } from './bytes';
import { ToolError } from './errors';

/* ------------------------------------------------------------ tokenizer -- */

const ANSI_ESCAPES: Record<string, string> = { n: '\n', t: '\t', r: '\r', a: '\x07', b: '\b', f: '\f', v: '\v', e: '\x1b', '\\': '\\', "'": "'", '"': '"' };

export function tokenizeShell(command: string): string[] {
  const source = command;
  const tokens: string[] = [];
  /** Length of a line break at `index` (0 when there is none). */
  const newlineAt = (index: number): number => (source[index] === '\n' ? 1 : source[index] === '\r' && source[index + 1] === '\n' ? 2 : 0);
  let current = '';
  let started = false;
  let i = 0;
  const push = () => {
    if (started) tokens.push(current);
    current = '';
    started = false;
  };
  while (i < source.length) {
    const ch = source[i] as string;
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      push();
      i++;
    } else if (ch === "'") {
      const end = source.indexOf("'", i + 1);
      if (end < 0) throw new ToolError('Unterminated single quote in the command.');
      current += source.slice(i + 1, end);
      started = true;
      i = end + 1;
    } else if (ch === '$' && source[i + 1] === "'") {
      started = true;
      i += 2;
      for (;;) {
        if (i >= source.length) throw new ToolError("Unterminated $'...' string in the command.");
        const inner = source[i] as string;
        if (inner === "'") {
          i++;
          break;
        }
        if (inner === '\\') {
          const next = source[i + 1] ?? '';
          const hex = /^x([0-9a-fA-F]{1,2})/.exec(source.slice(i + 1, i + 4));
          const unicode = /^u([0-9a-fA-F]{1,4})/.exec(source.slice(i + 1, i + 6));
          const octal = /^([0-7]{1,3})/.exec(source.slice(i + 1, i + 4));
          if (hex) {
            current += String.fromCharCode(Number.parseInt(hex[1] as string, 16));
            i += 1 + hex[0].length;
          } else if (unicode) {
            current += String.fromCharCode(Number.parseInt(unicode[1] as string, 16));
            i += 1 + unicode[0].length;
          } else if (octal) {
            current += String.fromCharCode(Number.parseInt(octal[1] as string, 8));
            i += 1 + octal[0].length;
          } else {
            current += ANSI_ESCAPES[next] ?? `\\${next}`;
            i += 2;
          }
        } else {
          current += inner;
          i++;
        }
      }
    } else if (ch === '"') {
      started = true;
      i++;
      for (;;) {
        if (i >= source.length) throw new ToolError('Unterminated double quote in the command.');
        const inner = source[i] as string;
        if (inner === '"') {
          i++;
          break;
        }
        if (inner === '\\' && newlineAt(i + 1) > 0) {
          i += 1 + newlineAt(i + 1); // line continuation
        } else if (inner === '\\' && '"\\$`'.includes(source[i + 1] ?? '\0')) {
          current += source[i + 1];
          i += 2;
        } else {
          current += inner;
          i++;
        }
      }
    } else if ((ch === '\\' || ch === '^' || ch === '`') && newlineAt(i + 1) > 0) {
      i += 1 + newlineAt(i + 1); // line continuation (POSIX shells, cmd.exe and PowerShell)
    } else if (ch === '\\') {
      current += source[i + 1] ?? '';
      started = true;
      i += 2;
    } else if (!started && ch === '#') {
      while (i < source.length && source[i] !== '\n') i++;
    } else if (ch === '|' || ch === ';' || ch === '>' || (ch === '&' && source[i + 1] === '&')) {
      // A pipe, the next command or a redirection: not part of this curl call.
      if (ch === '>' && /^[0-9]+$/.test(current)) started = false; // "2>" file-descriptor prefix
      break;
    } else {
      current += ch;
      started = true;
      i++;
    }
  }
  push();
  return tokens;
}

/* --------------------------------------------------------------- parser -- */

export interface CurlFormPart {
  readonly name: string;
  readonly value: string;
  /** The value is a file path (`name=@path`). */
  readonly file: boolean;
  readonly filename?: string;
  readonly type?: string;
}

export interface CurlRequest {
  url: string;
  method: string;
  headers: [string, string][];
  /** Raw request body, when one is sent. */
  body?: string;
  /** Path of a file whose contents are the body (`--data-binary @file`, `-T file`). */
  bodyFile?: string;
  form?: CurlFormPart[];
  timeoutSeconds?: number;
  followRedirects: boolean;
  warnings: string[];
}

type OptionKind = 'flag' | 'value';

/** Options that take a value.  Everything else known is a plain flag. */
const VALUE_OPTIONS = new Set([
  '-X',
  '--request',
  '-H',
  '--header',
  '-d',
  '--data',
  '--data-ascii',
  '--data-raw',
  '--data-binary',
  '--data-urlencode',
  '--json',
  '-F',
  '--form',
  '--form-string',
  '-u',
  '--user',
  '-A',
  '--user-agent',
  '-e',
  '--referer',
  '-b',
  '--cookie',
  '--url',
  '-o',
  '--output',
  '-m',
  '--max-time',
  '--connect-timeout',
  '-x',
  '--proxy',
  '--oauth2-bearer',
  '-T',
  '--upload-file',
  '--cert',
  '-E',
  '--key',
  '--cacert',
  '--capath',
  '--retry',
  '--retry-delay',
  '--retry-max-time',
  '-w',
  '--write-out',
  '-c',
  '--cookie-jar',
  '--max-redirs',
  '-r',
  '--range',
  '--resolve',
  '--interface',
  '-K',
  '--config',
  '--proxy-user',
  '-U',
  '--ciphers',
  '--tls-max',
  '--limit-rate',
  '-Y',
  '--speed-limit',
  '-y',
  '--speed-time',
  '--connect-to',
  '--dns-servers',
  '--unix-socket',
  '--aws-sigv4',
  '-D',
  '--dump-header',
  '--stderr',
  '--trace',
  '--trace-ascii',
  '-z',
  '--time-cond',
  '--max-filesize',
  '--noproxy',
  '--pinnedpubkey',
  '--cert-type',
  '--key-type',
  '--pass',
  '--proto',
  '--proto-default',
  '-C',
  '--continue-at',
  '--keepalive-time',
  '--expect100-timeout',
  '--happy-eyeballs-timeout-ms',
  '--request-target',
]);

const FLAG_OPTIONS = new Set([
  '-G',
  '--get',
  '-I',
  '--head',
  '-L',
  '--location',
  '--location-trusted',
  '-k',
  '--insecure',
  '--compressed',
  '-s',
  '--silent',
  '-S',
  '--show-error',
  '-v',
  '--verbose',
  '-i',
  '--include',
  '-f',
  '--fail',
  '--fail-with-body',
  '-N',
  '--no-buffer',
  '-#',
  '--progress-bar',
  '-g',
  '--globoff',
  '-4',
  '--ipv4',
  '-6',
  '--ipv6',
  '-O',
  '--remote-name',
  '-J',
  '--remote-header-name',
  '--http1.0',
  '--http1.1',
  '--http2',
  '--http2-prior-knowledge',
  '--http3',
  '-0',
  '-1',
  '-2',
  '-3',
  '--tlsv1',
  '--tlsv1.2',
  '--tlsv1.3',
  '--no-keepalive',
  '--tcp-nodelay',
  '--tcp-fastopen',
  '-n',
  '--netrc',
  '--basic',
  '--digest',
  '--ntlm',
  '--negotiate',
  '--anyauth',
  '-q',
  '--disable',
  '--path-as-is',
  '--raw',
  '-j',
  '--junk-session-cookies',
  '--no-progress-meter',
  '--ssl',
  '--ssl-reqd',
  '--no-alpn',
  '--no-sessionid',
  '--create-dirs',
  '--post301',
  '--post302',
  '--post303',
  '--tr-encoding',
  '--styled-output',
  '--no-styled-output',
  '-Z',
  '--parallel',
  '--retry-connrefused',
  '--retry-all-errors',
  '-a',
  '--append',
  '-:',
  '--next',
  '--globoff',
]);

const UNSUPPORTED_NOTES: Record<string, string> = {
  '-k': 'fetch() cannot skip TLS certificate checks (-k / --insecure); the certificate must be trusted.',
  '--insecure': 'fetch() cannot skip TLS certificate checks (-k / --insecure); the certificate must be trusted.',
  '-x': 'fetch() has no proxy option (-x / --proxy); configure the proxy in the runtime instead.',
  '--proxy': 'fetch() has no proxy option (-x / --proxy); configure the proxy in the runtime instead.',
  '--cert': 'Client certificates (--cert / --key) cannot be set from fetch().',
  '-E': 'Client certificates (--cert / --key) cannot be set from fetch().',
  '--cacert': 'A custom CA bundle (--cacert) cannot be set from fetch().',
  '--retry': 'fetch() does not retry (--retry); add your own retry loop if needed.',
  '-o': 'curl wrote the response to a file (-o / -O); the generated code only reads it.',
  '--output': 'curl wrote the response to a file (-o / -O); the generated code only reads it.',
  '-O': 'curl wrote the response to a file (-o / -O); the generated code only reads it.',
  '-c': 'curl saved cookies to a file (-c); with fetch() use credentials: "include" in a browser.',
  '--cookie-jar': 'curl saved cookies to a file (-c); with fetch() use credentials: "include" in a browser.',
  '--unix-socket': 'fetch() cannot connect to a Unix socket.',
  '--resolve': 'fetch() cannot override DNS (--resolve).',
  '--aws-sigv4': 'AWS SigV4 signing (--aws-sigv4) is not reproduced; sign the request yourself.',
  '--digest': 'Digest authentication is not supported by fetch(); only Basic credentials are sent.',
  '--ntlm': 'NTLM authentication is not supported by fetch().',
};

function splitHeader(header: string): [string, string] | null {
  const colon = header.indexOf(':');
  if (colon > 0) return [header.slice(0, colon).trim(), header.slice(colon + 1).trim()];
  if (header.endsWith(';')) return [header.slice(0, -1).trim(), ''];
  return null;
}

function parseFormPart(spec: string, literal: boolean): CurlFormPart {
  const equals = spec.indexOf('=');
  if (equals < 0) throw new ToolError(`Form field "${spec}" must look like name=value.`);
  const name = spec.slice(0, equals);
  let value = spec.slice(equals + 1);
  if (literal) return { name, value, file: false };
  let filename: string | undefined;
  let type: string | undefined;
  const isFile = value.startsWith('@');
  const isFileContent = value.startsWith('<');
  if (isFile || isFileContent) {
    const segments = value.slice(1).split(';');
    value = segments[0] ?? '';
    for (const segment of segments.slice(1)) {
      const [key, raw = ''] = segment.split('=');
      if (key === 'type') type = raw;
      if (key === 'filename') filename = raw.replace(/^"|"$/g, '');
    }
  } else {
    const typed = /;type=([^;]+)$/.exec(value);
    if (typed) {
      type = typed[1];
      value = value.slice(0, typed.index);
    }
  }
  return { name, value, file: isFile || isFileContent, filename, type };
}

export function parseCurl(command: string): CurlRequest {
  const tokens = tokenizeShell(command.trim().replace(/^\$\s+/, ''));
  if (tokens.length === 0) throw new ToolError('Paste a curl command to convert.');
  const program = (tokens[0] as string).replace(/\.exe$/i, '');
  if (!/(^|[\\/])curl$/.test(program)) throw new ToolError(`The command must start with "curl" (found "${tokens[0]}").`);

  const request: CurlRequest = { url: '', method: '', headers: [], followRedirects: false, warnings: [] };
  const dataParts: string[] = [];
  const urls: string[] = [];
  let explicitMethod = '';
  let head = false;
  let asQuery = false;
  let json = false;
  let hasData = false;
  let uploadFile = '';
  const note = (message: string) => {
    if (!request.warnings.includes(message)) request.warnings.push(message);
  };
  const setHeader = (name: string, value: string) => {
    request.headers = request.headers.filter(([existing]) => existing.toLowerCase() !== name.toLowerCase());
    request.headers.push([name, value]);
  };
  const hasHeader = (name: string) => request.headers.some(([existing]) => existing.toLowerCase() === name.toLowerCase());

  const apply = (option: string, value: string) => {
    const unsupported = UNSUPPORTED_NOTES[option];
    if (unsupported) note(unsupported);
    switch (option) {
      case '-X':
      case '--request':
        explicitMethod = value.toUpperCase();
        break;
      case '-H':
      case '--header': {
        const header = splitHeader(value);
        if (!header) {
          note(`Ignored a header without a colon: "${value}".`);
        } else if (header[1] === '' && !value.endsWith(';')) {
          request.headers = request.headers.filter(([existing]) => existing.toLowerCase() !== header[0].toLowerCase());
        } else {
          setHeader(header[0], header[1]);
        }
        break;
      }
      case '-d':
      case '--data':
      case '--data-ascii':
      case '--data-binary':
        hasData = true;
        if (value.startsWith('@')) {
          request.bodyFile = value.slice(1);
        } else {
          dataParts.push(value);
        }
        break;
      case '--data-raw':
        hasData = true;
        dataParts.push(value);
        break;
      case '--data-urlencode': {
        hasData = true;
        const equals = value.indexOf('=');
        const at = value.indexOf('@');
        if (at >= 0 && (equals < 0 || at < equals)) {
          note(`--data-urlencode read "${value.slice(at + 1)}" from a file; put its URL-encoded contents in the body.`);
          dataParts.push(value.slice(0, at) === '' ? '' : `${value.slice(0, at)}=`);
        } else if (equals < 0) {
          dataParts.push(encodeURIComponent(value));
        } else {
          const name = value.slice(0, equals);
          dataParts.push(`${name === '' ? '' : `${name}=`}${encodeURIComponent(value.slice(equals + 1))}`);
        }
        break;
      }
      case '--json':
        hasData = true;
        json = true;
        if (value.startsWith('@')) request.bodyFile = value.slice(1);
        else dataParts.push(value);
        break;
      case '-F':
      case '--form':
      case '--form-string':
        request.form = [...(request.form ?? []), parseFormPart(value, option === '--form-string')];
        break;
      case '-u':
      case '--user':
        setHeader('Authorization', `Basic ${toBase64(utf8Encode(value))}`);
        break;
      case '--oauth2-bearer':
        setHeader('Authorization', `Bearer ${value}`);
        break;
      case '-A':
      case '--user-agent':
        setHeader('User-Agent', value);
        break;
      case '-e':
      case '--referer':
        setHeader('Referer', value.replace(/;auto$/, ''));
        break;
      case '-b':
      case '--cookie':
        if (value.includes('=')) setHeader('Cookie', value);
        else note(`curl read cookies from the file "${value}" (-b); add them to a Cookie header yourself.`);
        break;
      case '-r':
      case '--range':
        setHeader('Range', `bytes=${value}`);
        break;
      case '--url':
        urls.push(value);
        break;
      case '-m':
      case '--max-time': {
        const seconds = Number(value);
        if (Number.isFinite(seconds) && seconds > 0) request.timeoutSeconds = seconds;
        break;
      }
      case '-T':
      case '--upload-file':
        uploadFile = value;
        break;
      case '-G':
      case '--get':
        asQuery = true;
        break;
      case '-I':
      case '--head':
        head = true;
        break;
      case '-L':
      case '--location':
      case '--location-trusted':
        request.followRedirects = true;
        break;
      case '--next':
        note('Only the first request of a multi-request command (--next) is converted.');
        break;
      default:
        break;
    }
  };

  const kindOf = (option: string): OptionKind | undefined => (VALUE_OPTIONS.has(option) ? 'value' : FLAG_OPTIONS.has(option) ? 'flag' : undefined);

  let stop = false;
  for (let i = 1; i < tokens.length && !stop; i++) {
    const token = tokens[i] as string;
    if (token === '--next') {
      apply(token, '');
      stop = true;
    } else if (token.startsWith('--') && token.length > 2) {
      const kind = kindOf(token);
      if (kind === 'value') {
        const value = tokens[++i];
        if (value === undefined) throw new ToolError(`Option ${token} needs a value.`);
        apply(token, value);
      } else if (kind === 'flag' || token.startsWith('--no-')) {
        apply(token, '');
      } else {
        note(`Unknown option ${token} was ignored.`);
      }
    } else if (token.startsWith('-') && token.length > 1 && token !== '-') {
      // A cluster of short options, possibly with the value attached: -sSL, -XPOST, -H'a: b'
      for (let j = 1; j < token.length; j++) {
        const option = `-${token[j]}`;
        const kind = kindOf(option);
        if (kind === 'value') {
          const attached = token.slice(j + 1);
          const value = attached !== '' ? attached : tokens[++i];
          if (value === undefined) throw new ToolError(`Option ${option} needs a value.`);
          apply(option, value);
          break;
        }
        if (kind === 'flag') apply(option, '');
        else note(`Unknown option ${option} was ignored.`);
      }
    } else {
      urls.push(token);
    }
  }

  if (urls.length === 0) throw new ToolError('The curl command has no URL.');
  if (urls.length > 1) note(`The command has ${urls.length} URLs; only the first is converted.`);
  let url = urls[0] as string;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) url = `http://${url}`;

  if (json) {
    if (!hasHeader('Content-Type')) setHeader('Content-Type', 'application/json');
    if (!hasHeader('Accept')) setHeader('Accept', 'application/json');
  }

  const body = dataParts.join(json ? '' : '&');
  if (asQuery && hasData) {
    if (body !== '') url += (url.includes('?') ? '&' : '?') + body;
  } else if (hasData && request.bodyFile === undefined) {
    request.body = body;
  } else if (hasData && dataParts.length > 0) {
    note('The command mixes inline data with a data file; only the file is used.');
  }
  if (uploadFile !== '') request.bodyFile = uploadFile;

  if (request.form && (request.body !== undefined || request.bodyFile !== undefined)) {
    throw new ToolError('A request cannot use both -d/--data and -F/--form.');
  }
  if (request.form && hasHeader('Content-Type')) {
    request.headers = request.headers.filter(([name]) => name.toLowerCase() !== 'content-type');
    note('The Content-Type header was dropped: fetch() must set the multipart boundary itself.');
  }
  if (request.body !== undefined && !hasHeader('Content-Type')) {
    setHeader('Content-Type', 'application/x-www-form-urlencoded');
  }

  request.url = url;
  request.method = explicitMethod || (head ? 'HEAD' : asQuery ? 'GET' : uploadFile !== '' ? 'PUT' : request.body !== undefined || request.bodyFile !== undefined || request.form ? 'POST' : 'GET');
  return request;
}

/* ------------------------------------------------------------ generator -- */

const js = (value: string): string =>
  `'${value
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')}'`;

const objectKey = (key: string): string => (/^[A-Za-z_$][\w$]*$/.test(key) ? key : js(key));

function literal(value: unknown, indent: string, level: number): string {
  if (value === null || typeof value !== 'object') return typeof value === 'string' ? js(value) : String(value);
  const inner = indent.repeat(level + 1);
  const outer = indent.repeat(level);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    return `[\n${value.map((item) => `${inner}${literal(item, indent, level + 1)},`).join('\n')}\n${outer}]`;
  }
  const entries = Object.entries(value);
  if (entries.length === 0) return '{}';
  return `{\n${entries.map(([key, item]) => `${inner}${objectKey(key)}: ${literal(item, indent, level + 1)},`).join('\n')}\n${outer}}`;
}

export interface FetchCodeOptions {
  readonly style: 'await' | 'then';
  readonly indent: string;
}

export function curlToFetch(command: string, options: FetchCodeOptions): { code: string; warnings: string[] } {
  const request = parseCurl(command);
  const { indent } = options;
  const warnings = [...request.warnings];
  const lines: string[] = [];
  const init: string[] = [];
  const contentType = request.headers.find(([name]) => name.toLowerCase() === 'content-type')?.[1] ?? '';
  const accept = request.headers.find(([name]) => name.toLowerCase() === 'accept')?.[1] ?? '';

  if (request.method !== 'GET') init.push(`method: ${js(request.method)},`);
  if (request.headers.length > 0) {
    init.push('headers: {', ...request.headers.map(([name, value]) => `${indent}${objectKey(name)}: ${js(value)},`), '},');
  }

  if (request.form) {
    lines.push('const form = new FormData();');
    for (const part of request.form) {
      if (part.file) {
        lines.push(
          `// curl attached the file ${js(part.value)}; supply it as a File or Blob (for example from <input type="file">).`,
          `form.append(${js(part.name)}, file${part.filename ? `, ${js(part.filename)}` : ''});`,
        );
      } else {
        lines.push(`form.append(${js(part.name)}, ${js(part.value)});`);
      }
    }
    lines.push('');
    init.push('body: form,');
  } else if (request.bodyFile !== undefined) {
    lines.push(`// curl sent the contents of the file ${js(request.bodyFile)}; supply them as a string, Blob or ArrayBuffer.`, '');
    init.push('body: fileContents,');
  } else if (request.body !== undefined) {
    let rendered = js(request.body);
    if (/json/i.test(contentType)) {
      try {
        const parsed: unknown = JSON.parse(request.body);
        if (parsed !== null && typeof parsed === 'object') {
          rendered = `JSON.stringify(${literal(parsed, indent, 1)})`;
        }
      } catch {
        // Not valid JSON: send the body exactly as written.
      }
    }
    init.push(`body: ${rendered},`);
    if (request.method === 'GET' || request.method === 'HEAD') {
      warnings.push(`fetch() does not allow a body with ${request.method}; change the method or drop the body.`);
    }
  }
  if (request.timeoutSeconds !== undefined) init.push(`signal: AbortSignal.timeout(${Math.round(request.timeoutSeconds * 1000)}),`);
  if (!request.followRedirects) {
    warnings.push('curl does not follow redirects without -L, but fetch() does by default; add redirect: "manual" if that matters.');
  }

  const args = init.length > 0 ? `${js(request.url)}, {\n${init.map((line) => `${indent}${line}`).join('\n')}\n}` : js(request.url);
  const reader = request.method === 'HEAD' ? '' : /json/i.test(accept) || /json/i.test(contentType) ? 'json' : 'text';
  if (options.style === 'await') {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: this is generated JavaScript source, not a template
    lines.push(`const response = await fetch(${args});`, 'if (!response.ok) throw new Error(`HTTP ${response.status}`);');
    lines.push(reader === '' ? 'console.log(response.status, Object.fromEntries(response.headers));' : `const data = await response.${reader}();\nconsole.log(data);`);
  } else {
    lines.push(
      `fetch(${args})`,
      `${indent}.then((response) => {`,
      `${indent}${indent}if (!response.ok) throw new Error(\`HTTP \${response.status}\`);`,
      `${indent}${indent}return ${reader === '' ? 'response.status' : `response.${reader}()`};`,
      `${indent}})`,
      `${indent}.then((data) => console.log(data))`,
      `${indent}.catch((error) => console.error(error));`,
    );
  }
  return { code: `${lines.join('\n')}\n`, warnings };
}
