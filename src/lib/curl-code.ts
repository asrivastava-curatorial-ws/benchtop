/**
 * Code generators that turn a parsed curl command into an equivalent request
 * in other languages.  JavaScript fetch() lives in curl.ts.
 */
import { type CurlRequest, parseCurl } from './curl';

export type CurlLanguage = 'python' | 'php' | 'go' | 'java' | 'csharp' | 'rust' | 'powershell';

export const CURL_LANGUAGES: readonly { value: CurlLanguage; label: string; filename: string }[] = [
  { value: 'python', label: 'Python (requests)', filename: 'request.py' },
  { value: 'php', label: 'PHP (cURL)', filename: 'request.php' },
  { value: 'go', label: 'Go (net/http)', filename: 'main.go' },
  { value: 'java', label: 'Java (HttpClient)', filename: 'Main.java' },
  { value: 'csharp', label: 'C# (HttpClient)', filename: 'Program.cs' },
  { value: 'rust', label: 'Rust (reqwest)', filename: 'main.rs' },
  { value: 'powershell', label: 'PowerShell (Invoke-WebRequest)', filename: 'request.ps1' },
];

const header = (request: CurlRequest, name: string): string | undefined => request.headers.find(([key]) => key.toLowerCase() === name)?.[1];

function jsonBody(request: CurlRequest): unknown {
  if (request.body === undefined || !/json/i.test(header(request, 'content-type') ?? '')) return undefined;
  try {
    const parsed: unknown = JSON.parse(request.body);
    return parsed !== null && typeof parsed === 'object' ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/* --------------------------------------------------------------- Python -- */

const py = (text: string): string => JSON.stringify(text);

function pyLiteral(value: unknown, level: number): string {
  if (value === null) return 'None';
  if (value === true) return 'True';
  if (value === false) return 'False';
  if (typeof value === 'string') return py(value);
  if (typeof value !== 'object') return String(value);
  const inner = '    '.repeat(level + 1);
  const outer = '    '.repeat(level);
  if (Array.isArray(value)) return value.length === 0 ? '[]' : `[\n${value.map((item) => `${inner}${pyLiteral(item, level + 1)},`).join('\n')}\n${outer}]`;
  const entries = Object.entries(value);
  return entries.length === 0 ? '{}' : `{\n${entries.map(([key, item]) => `${inner}${py(key)}: ${pyLiteral(item, level + 1)},`).join('\n')}\n${outer}}`;
}

function python(request: CurlRequest, warnings: string[]): string {
  const lines = ['import requests', '', `url = ${py(request.url)}`];
  const args = ['url'];
  if (request.headers.length > 0) {
    lines.push('headers = {', ...request.headers.map(([name, value]) => `    ${py(name)}: ${py(value)},`), '}');
    args.push('headers=headers');
  }
  const json = jsonBody(request);
  if (request.form) {
    const fields = request.form.filter((part) => !part.file);
    const files = request.form.filter((part) => part.file);
    if (fields.length > 0) {
      lines.push('data = {', ...fields.map((part) => `    ${py(part.name)}: ${py(part.value)},`), '}');
      args.push('data=data');
    }
    if (files.length > 0) {
      lines.push('files = {', ...files.map((part) => `    ${py(part.name)}: open(${py(part.value)}, "rb"),`), '}');
      args.push('files=files');
    }
  } else if (request.bodyFile !== undefined) {
    args.push(`data=open(${py(request.bodyFile)}, "rb")`);
  } else if (json !== undefined) {
    lines.push(`payload = ${pyLiteral(json, 0)}`);
    args.push('json=payload');
  } else if (request.body !== undefined) {
    lines.push(`payload = ${py(request.body)}`);
    args.push('data=payload');
  }
  if (request.timeoutSeconds !== undefined) args.push(`timeout=${request.timeoutSeconds}`);
  else warnings.push('requests waits forever by default; add timeout= in production code.');
  if (!request.followRedirects && request.method !== 'HEAD') args.push('allow_redirects=False');
  if (request.followRedirects && request.method === 'HEAD') args.push('allow_redirects=True');
  const method = request.method.toLowerCase();
  const call = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'].includes(method) ? `requests.${method}(${args.join(', ')})` : `requests.request(${py(request.method)}, ${args.join(', ')})`;
  lines.push('', `response = ${call}`, 'response.raise_for_status()', request.method === 'HEAD' ? 'print(response.status_code, response.headers)' : 'print(response.text)');
  return lines.join('\n');
}

/* ------------------------------------------------------------------ PHP -- */

const php = (text: string): string => `'${text.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

function phpCode(request: CurlRequest): string {
  const options: string[] = ['CURLOPT_RETURNTRANSFER => true,'];
  if (request.method === 'HEAD') options.push('CURLOPT_NOBODY => true,');
  else if (request.method !== 'GET') options.push(`CURLOPT_CUSTOMREQUEST => ${php(request.method)},`);
  if (request.headers.length > 0) options.push('CURLOPT_HTTPHEADER => [', ...request.headers.map(([name, value]) => `    ${php(`${name}: ${value}`)},`), '],');
  if (request.form) {
    options.push(
      'CURLOPT_POSTFIELDS => [',
      ...request.form.map((part) =>
        part.file ? `    ${php(part.name)} => new CURLFile(${php(part.value)}${part.type ? `, ${php(part.type)}` : ''}),` : `    ${php(part.name)} => ${php(part.value)},`,
      ),
      '],',
    );
  } else if (request.bodyFile !== undefined) options.push(`CURLOPT_POSTFIELDS => file_get_contents(${php(request.bodyFile)}),`);
  else if (request.body !== undefined) options.push(`CURLOPT_POSTFIELDS => ${php(request.body)},`);
  if (request.timeoutSeconds !== undefined) options.push(`CURLOPT_TIMEOUT => ${Math.ceil(request.timeoutSeconds)},`);
  if (request.followRedirects) options.push('CURLOPT_FOLLOWLOCATION => true,');
  return [
    '<?php',
    '',
    `$ch = curl_init(${php(request.url)});`,
    'curl_setopt_array($ch, [',
    ...options.map((line) => `    ${line}`),
    ']);',
    '$response = curl_exec($ch);',
    'if ($response === false) {',
    '    throw new RuntimeException(curl_error($ch));',
    '}',
    '$status = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);',
    'curl_close($ch);',
    '',
    'echo $status, PHP_EOL, $response, PHP_EOL;',
  ].join('\n');
}

/* ------------------------------------------------------------------- Go -- */

const goString = (text: string): string => JSON.stringify(text);

function goCode(request: CurlRequest): string {
  const imports = new Set(['fmt', 'io', 'net/http']);
  const setup: string[] = [];
  let body = 'nil';
  if (request.form) {
    imports.add('bytes');
    imports.add('mime/multipart');
    setup.push('var buf bytes.Buffer', 'writer := multipart.NewWriter(&buf)');
    let fileCount = 0;
    for (const part of request.form) {
      if (part.file) {
        imports.add('os');
        fileCount++;
        const file = `file${fileCount}`;
        const field = `part${fileCount}`;
        setup.push(
          `${file}, err := os.Open(${goString(part.value)})`,
          'if err != nil {',
          '\tpanic(err)',
          '}',
          `defer ${file}.Close()`,
          `${field}, err := writer.CreateFormFile(${goString(part.name)}, ${goString(part.filename ?? part.value.split(/[\\/]/).pop() ?? part.value)})`,
          'if err != nil {',
          '\tpanic(err)',
          '}',
          `if _, err := io.Copy(${field}, ${file}); err != nil {`,
          '\tpanic(err)',
          '}',
        );
      } else setup.push(`writer.WriteField(${goString(part.name)}, ${goString(part.value)})`);
    }
    setup.push('writer.Close()');
    body = '&buf';
  } else if (request.bodyFile !== undefined) {
    imports.add('os');
    setup.push(`body, err := os.Open(${goString(request.bodyFile)})`, 'if err != nil {', '\tpanic(err)', '}', 'defer body.Close()');
    body = 'body';
  } else if (request.body !== undefined) {
    imports.add('strings');
    body = `strings.NewReader(${request.body.includes('`') ? goString(request.body) : `\`${request.body}\``})`;
  }
  const lines = [...setup, `req, err := http.NewRequest(${goString(request.method)}, ${goString(request.url)}, ${body})`, 'if err != nil {', '\tpanic(err)', '}'];
  for (const [name, value] of request.headers) lines.push(`req.Header.Set(${goString(name)}, ${goString(value)})`);
  if (request.form) lines.push('req.Header.Set("Content-Type", writer.FormDataContentType())');
  const client: string[] = [];
  if (request.timeoutSeconds !== undefined) {
    imports.add('time');
    client.push(`Timeout: ${Math.round(request.timeoutSeconds * 1000)} * time.Millisecond,`);
  }
  if (!request.followRedirects) client.push('CheckRedirect: func(req *http.Request, via []*http.Request) error { return http.ErrUseLastResponse },');
  lines.push(client.length > 0 ? `client := &http.Client{\n${client.map((line) => `\t${line}`).join('\n')}\n}` : 'client := &http.Client{}');
  lines.push(
    'resp, err := client.Do(req)',
    'if err != nil {',
    '\tpanic(err)',
    '}',
    'defer resp.Body.Close()',
    'data, err := io.ReadAll(resp.Body)',
    'if err != nil {',
    '\tpanic(err)',
    '}',
    'fmt.Println(resp.Status)',
    'fmt.Println(string(data))',
  );
  return [
    'package main',
    '',
    'import (',
    ...[...imports].sort().map((name) => `\t"${name}"`),
    ')',
    '',
    'func main() {',
    ...lines.flatMap((line) => line.split('\n')).map((line) => `\t${line}`),
    '}',
  ].join('\n');
}

/* ----------------------------------------------------------------- Java -- */

/** Headers Java's HttpClient refuses to set. */
const JAVA_RESTRICTED = new Set(['connection', 'content-length', 'expect', 'host', 'upgrade']);

function javaCode(request: CurlRequest, warnings: string[]): string {
  const imports = new Set(['java.net.URI', 'java.net.http.HttpClient', 'java.net.http.HttpRequest', 'java.net.http.HttpResponse']);
  const clientLines = [`.followRedirects(HttpClient.Redirect.${request.followRedirects ? 'NORMAL' : 'NEVER'})`];
  const builder = [`.uri(URI.create(${JSON.stringify(request.url)}))`];
  if (request.timeoutSeconds !== undefined) {
    imports.add('java.time.Duration');
    builder.push(`.timeout(Duration.ofMillis(${Math.round(request.timeoutSeconds * 1000)}))`);
  }
  for (const [name, value] of request.headers) {
    if (JAVA_RESTRICTED.has(name.toLowerCase())) warnings.push(`Java's HttpClient sets the ${name} header itself; it was left out.`);
    else builder.push(`.header(${JSON.stringify(name)}, ${JSON.stringify(value)})`);
  }
  let publisher = 'HttpRequest.BodyPublishers.noBody()';
  if (request.form) {
    warnings.push('Java has no built-in multipart encoder: build the form body yourself or use a library such as Apache HttpClient 5.');
  } else if (request.bodyFile !== undefined) {
    imports.add('java.nio.file.Path');
    publisher = `HttpRequest.BodyPublishers.ofFile(Path.of(${JSON.stringify(request.bodyFile)}))`;
  } else if (request.body !== undefined) publisher = `HttpRequest.BodyPublishers.ofString(${JSON.stringify(request.body)})`;
  builder.push(`.method(${JSON.stringify(request.method)}, ${publisher})`, '.build();');
  return [
    ...[...imports].sort().map((name) => `import ${name};`),
    '',
    'public class Main {',
    '    public static void main(String[] args) throws Exception {',
    '        HttpClient client = HttpClient.newBuilder()',
    ...clientLines.map((line) => `            ${line}`),
    '            .build();',
    '        HttpRequest request = HttpRequest.newBuilder()',
    ...builder.map((line) => `            ${line}`),
    '        HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());',
    '        System.out.println(response.statusCode());',
    '        System.out.println(response.body());',
    '    }',
    '}',
  ].join('\n');
}

/* ------------------------------------------------------------------- C# -- */

const CONTENT_HEADERS = new Set(['content-type', 'content-encoding', 'content-language', 'content-disposition', 'content-md5', 'content-range', 'expires', 'last-modified', 'allow']);
const CS_METHODS: Record<string, string> = { GET: 'Get', POST: 'Post', PUT: 'Put', DELETE: 'Delete', HEAD: 'Head', PATCH: 'Patch', OPTIONS: 'Options' };

function csharpCode(request: CurlRequest): string {
  const s = (text: string) => JSON.stringify(text);
  const method = CS_METHODS[request.method] ? `HttpMethod.${CS_METHODS[request.method]}` : `new HttpMethod(${s(request.method)})`;
  const files = request.bodyFile !== undefined || request.form?.some((part) => part.file);
  const lines = ['using System;', ...(files ? ['using System.IO;'] : []), 'using System.Net.Http;', 'using System.Text;', ''];
  const handler = !request.followRedirects;
  if (handler) lines.push('using var handler = new HttpClientHandler { AllowAutoRedirect = false };');
  const init = request.timeoutSeconds !== undefined ? ` { Timeout = TimeSpan.FromMilliseconds(${Math.round(request.timeoutSeconds * 1000)}) }` : '';
  lines.push(`using var client = new HttpClient(${handler ? 'handler' : ''})${init};`, `using var request = new HttpRequestMessage(${method}, ${s(request.url)});`);
  for (const [name, value] of request.headers) if (!CONTENT_HEADERS.has(name.toLowerCase())) lines.push(`request.Headers.TryAddWithoutValidation(${s(name)}, ${s(value)});`);
  const contentType = header(request, 'content-type');
  if (request.form) {
    lines.push('var form = new MultipartFormDataContent();');
    for (const part of request.form) {
      if (part.file) lines.push(`form.Add(new StreamContent(File.OpenRead(${s(part.value)})), ${s(part.name)}, ${s(part.filename ?? part.value.split(/[\\/]/).pop() ?? part.value)});`);
      else lines.push(`form.Add(new StringContent(${s(part.value)}), ${s(part.name)});`);
    }
    lines.push('request.Content = form;');
  } else if (request.bodyFile !== undefined) {
    lines.push(`request.Content = new StreamContent(File.OpenRead(${s(request.bodyFile)}));`);
    if (contentType) lines.push(`request.Content.Headers.TryAddWithoutValidation("Content-Type", ${s(contentType)});`);
  } else if (request.body !== undefined) {
    const mediaType = contentType?.split(';')[0]?.trim() ?? 'application/x-www-form-urlencoded';
    lines.push(`request.Content = new StringContent(${s(request.body)}, Encoding.UTF8, ${s(mediaType)});`);
  }
  if (request.body !== undefined || request.bodyFile !== undefined) {
    for (const [name, value] of request.headers)
      if (CONTENT_HEADERS.has(name.toLowerCase()) && name.toLowerCase() !== 'content-type') lines.push(`request.Content.Headers.TryAddWithoutValidation(${s(name)}, ${s(value)});`);
  }
  lines.push('', 'using var response = await client.SendAsync(request);', 'Console.WriteLine((int)response.StatusCode);', 'Console.WriteLine(await response.Content.ReadAsStringAsync());');
  return lines.join('\n');
}

/* ----------------------------------------------------------------- Rust -- */

const hasControl = (text: string): boolean =>
  [...text].some((ch) => {
    const code = ch.charCodeAt(0);
    return (code < 0x20 && code !== 9 && code !== 10) || code === 0x7f;
  });

function rustString(text: string): string {
  if (!text.includes('"#') && /["\\\n]/.test(text) && !hasControl(text)) return `r#"${text}"#`;
  let out = '"';
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (ch === '"') out += '\\"';
    else if (ch === '\\') out += '\\\\';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else if (code < 0x20 || code === 0x7f) out += `\\u{${code.toString(16)}}`;
    else out += ch;
  }
  return `${out}"`;
}

function rustCode(request: CurlRequest): string {
  const features = ['blocking'];
  const client = ['reqwest::blocking::Client::builder()'];
  if (request.timeoutSeconds !== undefined) client.push(`    .timeout(Duration::from_millis(${Math.round(request.timeoutSeconds * 1000)}))`);
  if (!request.followRedirects) client.push('    .redirect(reqwest::redirect::Policy::none())');
  client.push('    .build()?;');
  const method = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'].includes(request.method)
    ? `reqwest::Method::${request.method}`
    : `reqwest::Method::from_bytes(${rustString(request.method)}.as_bytes())?`;
  const chain = [`.request(${method}, ${rustString(request.url)})`];
  for (const [name, value] of request.headers) chain.push(`.header(${rustString(name)}, ${rustString(value)})`);
  if (request.form) {
    features.push('multipart');
    const form = ['reqwest::blocking::multipart::Form::new()'];
    for (const part of request.form)
      form.push(part.file ? `        .file(${rustString(part.name)}, ${rustString(part.value)})?` : `        .text(${rustString(part.name)}, ${rustString(part.value)})`);
    chain.push(`.multipart(\n${form.join('\n')},\n    )`);
  } else if (request.bodyFile !== undefined) chain.push(`.body(std::fs::read(${rustString(request.bodyFile)})?)`);
  else if (request.body !== undefined) chain.push(`.body(${rustString(request.body)})`);
  chain.push('.send()?;');
  return [
    `// Cargo.toml: reqwest = { version = "0.12", features = [${features.map((feature) => `"${feature}"`).join(', ')}] }`,
    ...(request.timeoutSeconds !== undefined ? ['use std::time::Duration;', ''] : ['']),
    'fn main() -> Result<(), Box<dyn std::error::Error>> {',
    `    let client = ${client.join('\n    ')}`,
    '    let response = client',
    ...chain.map((line) => `        ${line}`),
    '    println!("{}", response.status());',
    '    println!("{}", response.text()?);',
    '    Ok(())',
    '}',
  ].join('\n');
}

/* ----------------------------------------------------------- PowerShell -- */

const ps = (text: string): string => `'${text.replace(/'/g, "''")}'`;

function powershellCode(request: CurlRequest): string {
  const lines: string[] = [];
  const args = [`-Uri ${ps(request.url)}`];
  const method = request.method.charAt(0) + request.method.slice(1).toLowerCase();
  if (request.method !== 'GET')
    args.push(['Get', 'Post', 'Put', 'Patch', 'Delete', 'Head', 'Options', 'Trace', 'Merge'].includes(method) ? `-Method ${method}` : `-CustomMethod ${ps(request.method)}`);
  const contentType = header(request, 'content-type');
  const headers = request.headers.filter(([name]) => name.toLowerCase() !== 'content-type');
  if (headers.length > 0) {
    lines.push('$headers = @{', ...headers.map(([name, value]) => `    ${ps(name)} = ${ps(value)}`), '}');
    args.push('-Headers $headers');
  }
  if (contentType && !request.form) args.push(`-ContentType ${ps(contentType)}`);
  if (request.form) {
    lines.push('# -Form needs PowerShell 7 or later', '$form = @{', ...request.form.map((part) => `    ${ps(part.name)} = ${part.file ? `Get-Item ${ps(part.value)}` : ps(part.value)}`), '}');
    args.push('-Form $form');
  } else if (request.bodyFile !== undefined) args.push(`-InFile ${ps(request.bodyFile)}`);
  else if (request.body !== undefined) {
    if (request.body.includes('\n')) lines.push("$body = @'", request.body, "'@");
    else lines.push(`$body = ${ps(request.body)}`);
    args.push('-Body $body');
  }
  if (request.timeoutSeconds !== undefined) args.push(`-TimeoutSec ${Math.max(1, Math.ceil(request.timeoutSeconds))}`);
  if (!request.followRedirects) args.push('-MaximumRedirection 0');
  lines.push(`$response = Invoke-WebRequest ${args.join(' `\n    ')}`, '$response.StatusCode', '$response.Content');
  return lines.join('\n');
}

export function curlToCode(command: string, language: CurlLanguage): { code: string; warnings: string[] } {
  const request = parseCurl(command);
  const warnings = [...request.warnings];
  let code: string;
  switch (language) {
    case 'python':
      code = python(request, warnings);
      break;
    case 'php':
      code = phpCode(request);
      break;
    case 'go':
      code = goCode(request);
      break;
    case 'java':
      code = javaCode(request, warnings);
      break;
    case 'csharp':
      code = csharpCode(request);
      break;
    case 'rust':
      code = rustCode(request);
      break;
    default:
      code = powershellCode(request);
  }
  return { code: `${code}\n`, warnings };
}
