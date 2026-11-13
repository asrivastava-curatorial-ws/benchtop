/** Converts `docker run` commands into Docker Compose services. */
import { tokenizeShell } from './curl';
import { ToolError } from './errors';

export interface ComposeService {
  [key: string]: unknown;
}

export interface Conversion {
  readonly name: string;
  readonly service: ComposeService;
  readonly warnings: readonly string[];
  readonly volumes: readonly string[];
  readonly networks: readonly string[];
}

/** Options that take a value, mapped to the Compose key they fill (lists append). */
const VALUE_OPTIONS: Record<string, { key: string; list?: boolean }> = {
  '-p': { key: 'ports', list: true },
  '--publish': { key: 'ports', list: true },
  '-v': { key: 'volumes', list: true },
  '--volume': { key: 'volumes', list: true },
  '-e': { key: 'environment', list: true },
  '--env': { key: 'environment', list: true },
  '--env-file': { key: 'env_file', list: true },
  '-l': { key: 'labels', list: true },
  '--label': { key: 'labels', list: true },
  '--name': { key: 'container_name' },
  '-h': { key: 'hostname' },
  '--hostname': { key: 'hostname' },
  '-u': { key: 'user' },
  '--user': { key: 'user' },
  '-w': { key: 'working_dir' },
  '--workdir': { key: 'working_dir' },
  '--restart': { key: 'restart' },
  '--network': { key: 'networks', list: true },
  '--net': { key: 'networks', list: true },
  '--entrypoint': { key: 'entrypoint' },
  '--add-host': { key: 'extra_hosts', list: true },
  '--dns': { key: 'dns', list: true },
  '--cap-add': { key: 'cap_add', list: true },
  '--cap-drop': { key: 'cap_drop', list: true },
  '--device': { key: 'devices', list: true },
  '--security-opt': { key: 'security_opt', list: true },
  '--tmpfs': { key: 'tmpfs', list: true },
  '--expose': { key: 'expose', list: true },
  '--shm-size': { key: 'shm_size' },
  '--memory': { key: 'mem_limit' },
  '-m': { key: 'mem_limit' },
  '--cpus': { key: 'cpus' },
  '--platform': { key: 'platform' },
  '--pull': { key: 'pull_policy' },
  '--stop-signal': { key: 'stop_signal' },
  '--log-driver': { key: 'logging.driver' },
  '--log-opt': { key: 'logging.options', list: true },
  '--health-cmd': { key: 'healthcheck.test' },
  '--health-interval': { key: 'healthcheck.interval' },
  '--health-timeout': { key: 'healthcheck.timeout' },
  '--health-retries': { key: 'healthcheck.retries' },
  '--health-start-period': { key: 'healthcheck.start_period' },
  '--mount': { key: 'volumes', list: true },
  '--ulimit': { key: 'ulimits', list: true },
  '--pid': { key: 'pid' },
  '--ipc': { key: 'ipc' },
  '--gpus': { key: 'gpus' },
  '--sysctl': { key: 'sysctls', list: true },
};

const FLAG_OPTIONS: Record<string, { key: string; value: unknown } | null> = {
  '--no-healthcheck': { key: 'healthcheck.disable', value: true },
  '-d': null,
  '--detach': null,
  '--rm': null,
  '-i': { key: 'stdin_open', value: true },
  '--interactive': { key: 'stdin_open', value: true },
  '-t': { key: 'tty', value: true },
  '--tty': { key: 'tty', value: true },
  '-it': { key: 'tty', value: true },
  '-ti': { key: 'tty', value: true },
  '--privileged': { key: 'privileged', value: true },
  '--read-only': { key: 'read_only', value: true },
  '--init': { key: 'init', value: true },
  '-P': null,
  '--publish-all': null,
};

/** Flags without a value that have no direct Compose equivalent. */
const BOOLEAN_UNSUPPORTED = new Set(['--oom-kill-disable', '--sig-proxy', '--disable-content-trust', '-q', '--quiet', '--use-api-socket']);

/** Stores a value at `key` in `target`; with `list`, appends it to an array there instead. */
function put(target: Record<string, unknown>, key: string, value: unknown, list: boolean): void {
  if (!list) {
    target[key] = value;
    return;
  }
  const existing = target[key];
  if (Array.isArray(existing)) existing.push(value);
  else target[key] = [value];
}

const set = (target: ComposeService, path: string, value: unknown, list: boolean) => {
  const [head, tail] = path.split('.', 2) as [string, string | undefined];
  if (tail) {
    if (typeof target[head] !== 'object' || target[head] === null) target[head] = {};
    put(target[head] as Record<string, unknown>, tail, value, list);
    return;
  }
  put(target, head, value, list);
};

/** Turns `--mount type=bind,source=/a,target=/b,readonly` into a short volume string where possible. */
function mountToVolume(spec: string): string {
  const parts = Object.fromEntries(
    spec.split(',').map((part) => {
      const [k, v] = part.split('=', 2) as [string, string | undefined];
      return [k.trim(), v ?? 'true'];
    }),
  );
  const source = parts.source ?? parts.src;
  const target = parts.target ?? parts.destination ?? parts.dst;
  if (!target) throw new ToolError(`The mount "${spec}" has no target.`);
  const readonly = parts.readonly === 'true' || parts.ro === 'true' || parts.readonly === '1';
  return source ? `${source}:${target}${readonly ? ':ro' : ''}` : target;
}

export function dockerRunToCompose(command: string): Conversion {
  const tokens = tokenizeShell(command.trim()).filter((token) => token !== '');
  let i = 0;
  if (tokens[i] === 'sudo') i++;
  if (tokens[i] === 'docker' || tokens[i] === 'podman') i++;
  if (tokens[i] === 'container') i++;
  if (tokens[i] === 'run' || tokens[i] === 'create') i++;
  else throw new ToolError('Paste a "docker run ..." command.');
  const service: ComposeService = {};
  const warnings: string[] = [];
  let image: string | undefined;
  let commandArgs: string[] = [];
  for (; i < tokens.length; i++) {
    const token = tokens[i] as string;
    if (image !== undefined) {
      commandArgs = tokens.slice(i);
      break;
    }
    if (!token.startsWith('-')) {
      image = token;
      continue;
    }
    let name = token;
    let value: string | undefined;
    const eq = token.indexOf('=');
    if (token.startsWith('--') && eq > 0) {
      name = token.slice(0, eq);
      value = token.slice(eq + 1);
    }
    if (name in FLAG_OPTIONS) {
      const flag = FLAG_OPTIONS[name];
      if (flag) set(service, flag.key, flag.value, false);
      if (name === '-it' || name === '-ti') service.stdin_open = true;
      if (name === '-P' || name === '--publish-all') warnings.push('--publish-all has no Compose equivalent; list the ports explicitly.');
      continue;
    }
    // Short options can carry their value directly: -p8080:80, -eKEY=value.
    if (!(name in VALUE_OPTIONS) && /^-[a-zA-Z]./.test(name) && !name.startsWith('--') && `${name.slice(0, 2)}` in VALUE_OPTIONS) {
      value = name.slice(2);
      name = name.slice(0, 2);
    }
    const option = VALUE_OPTIONS[name];
    if (!option) {
      if (BOOLEAN_UNSUPPORTED.has(name)) {
        warnings.push(`${name} was not converted; check the Compose reference for an equivalent.`);
        continue;
      }
      // Other docker run options take a value: skip it so it is not mistaken for the image.
      if (value === undefined && i + 2 < tokens.length) i++;
      warnings.push(`${name} was not converted; check the Compose reference for an equivalent.`);
      continue;
    }
    if (value === undefined) {
      value = tokens[++i];
      if (value === undefined) throw new ToolError(`${name} needs a value.`);
    }
    let stored: unknown = value;
    if (name === '--mount') stored = mountToVolume(value);
    if (option.key === 'healthcheck.test') stored = ['CMD-SHELL', value];
    if (option.key === 'healthcheck.retries' || option.key === 'cpus') stored = Number(value);
    if (option.key === 'entrypoint') stored = tokenizeShell(value);
    if (option.key === 'networks' && (value === 'host' || value === 'none')) {
      service.network_mode = value;
      continue;
    }
    set(service, option.key, stored, option.list === true);
  }
  if (!image) throw new ToolError('No image was found in the command.');
  // Compose puts the image first; rebuild the object in a readable order.
  const ordered: ComposeService = { image };
  for (const key of ['container_name', 'hostname', 'restart', 'user', 'working_dir', 'entrypoint']) if (key in service) ordered[key] = service[key];
  if (commandArgs.length > 0) ordered.command = commandArgs;
  for (const [key, value] of Object.entries(service)) if (!(key in ordered)) ordered[key] = value;
  const base = image.split('/').pop()?.split(/[:@]/)[0] ?? 'app';
  const name =
    String(service.container_name ?? base)
      .replace(/[^a-zA-Z0-9_.-]/g, '-')
      .toLowerCase() || 'app';
  // Named volumes ("data:/var/lib/x", not paths) must also be declared at the top level.
  const volumes = ((ordered.volumes as string[] | undefined) ?? [])
    .filter((spec) => spec.includes(':'))
    .map((spec) => spec.split(':')[0] as string)
    .filter((source, index, all) => /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(source) && all.indexOf(source) === index);
  const networks = ((ordered.networks as string[] | undefined) ?? []).filter((network, index, all) => all.indexOf(network) === index);
  return { name, service: ordered, warnings, volumes, networks };
}

export function composeDocument(conversions: readonly Conversion[]): Record<string, unknown> {
  const services: Record<string, unknown> = {};
  const volumes: Record<string, Record<string, never>> = {};
  const networks: Record<string, null> = {};
  for (const conversion of conversions) {
    let name = conversion.name;
    for (let n = 2; name in services; n++) name = `${conversion.name}-${n}`;
    services[name] = conversion.service;
    for (const volume of conversion.volumes) volumes[volume] = {};
    for (const network of conversion.networks) networks[network] = null;
  }
  const document: Record<string, unknown> = { services };
  if (Object.keys(volumes).length > 0) document.volumes = volumes;
  if (Object.keys(networks).length > 0) document.networks = Object.fromEntries(Object.keys(networks).map((network) => [network, { external: true }]));
  return document;
}
