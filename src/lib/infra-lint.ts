/**
 * Checks for infrastructure files: Kubernetes manifests, Docker Compose files
 * and Terraform (HCL).  Each finding names the line, what is risky or fragile,
 * and how to fix it.  The rules follow common guidance (Kubernetes Pod Security
 * Standards, Docker and Terraform documentation) and are a quick review, not
 * a replacement for kube-score, hadolint, tfsec or checkov.
 */
import { type Document, LineCounter, parseAllDocuments } from 'yaml';

export type Severity = 'error' | 'warning' | 'note';
export type FileKind = 'kubernetes' | 'compose' | 'terraform' | 'dockerfile' | 'unknown';

export interface Finding {
  readonly severity: Severity;
  readonly line: number;
  /** The resource, service or object the finding is about. */
  readonly subject: string;
  readonly message: string;
  readonly fix: string;
  readonly rule: string;
}

const SECRET_NAME = /(pass(word|wd)?|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|credential)/i;
const DATABASE_PORTS = new Set([3306, 5432, 27017, 6379, 9200, 5984, 1433, 1521, 11211, 9042]);

export function detectKind(text: string): FileKind {
  if (/^\s*(resource|provider|variable|module|terraform|data|output|locals)\s+("[^"]*"\s*)*\{/m.test(text)) return 'terraform';
  if (/^services\s*:/m.test(text)) return 'compose';
  if (/^\s*apiVersion\s*:/m.test(text) && /^\s*kind\s*:/m.test(text)) return 'kubernetes';
  if (/^\s*FROM\s+\S+/im.test(text) && /^\s*(RUN|COPY|ADD|CMD|ENTRYPOINT|WORKDIR|ENV|EXPOSE|USER|ARG|LABEL)\b/im.test(text)) return 'dockerfile';
  return 'unknown';
}

/* ---------------------------------------------------------------- YAML -- */

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

interface YamlDoc {
  readonly doc: Document.Parsed;
  readonly value: unknown;
  readonly line: (path: readonly (string | number)[]) => number;
}

function yamlDocs(text: string): YamlDoc[] {
  const counter = new LineCounter();
  const docs = parseAllDocuments(text, { lineCounter: counter });
  const list = Array.isArray(docs) ? docs : [];
  return list.map((doc) => {
    const line = (path: readonly (string | number)[]) => {
      for (let n = path.length; n >= 0; n--) {
        const node = n === 0 ? doc.contents : doc.getIn(path.slice(0, n), true);
        const range = (node as { range?: [number, number, number] } | undefined)?.range;
        if (range) return counter.linePos(range[0]).line;
      }
      return 1;
    };
    return { doc, value: doc.toJS({ maxAliasCount: 50 }), line };
  });
}

function imageProblem(image: string): string | null {
  if (!image) return null;
  if (image.includes('@sha256:')) return null;
  const last = image.split('/').pop() ?? image;
  if (!last.includes(':')) return 'has no tag, so it means ":latest"';
  if (last.endsWith(':latest')) return 'uses the ":latest" tag';
  return null;
}

/* ---------------------------------------------------------- Kubernetes -- */

const WORKLOADS = new Set(['Deployment', 'StatefulSet', 'DaemonSet', 'ReplicaSet', 'Job', 'CronJob', 'Pod', 'ReplicationController']);
const LONG_RUNNING = new Set(['Deployment', 'StatefulSet', 'DaemonSet', 'ReplicaSet', 'ReplicationController']);
const REMOVED_APIS: Record<string, string> = {
  'extensions/v1beta1': 'apps/v1 (workloads) or networking.k8s.io/v1 (Ingress)',
  'apps/v1beta1': 'apps/v1',
  'apps/v1beta2': 'apps/v1',
  'networking.k8s.io/v1beta1': 'networking.k8s.io/v1',
  'policy/v1beta1': 'policy/v1 (PodDisruptionBudget); PodSecurityPolicy was removed in 1.25',
  'batch/v1beta1': 'batch/v1',
  'rbac.authorization.k8s.io/v1beta1': 'rbac.authorization.k8s.io/v1',
  'autoscaling/v2beta1': 'autoscaling/v2',
  'autoscaling/v2beta2': 'autoscaling/v2',
};

function checkKubernetes(docs: YamlDoc[]): Finding[] {
  const out: Finding[] = [];
  for (const { value, line } of docs) {
    const o = obj(value);
    if (!o) continue;
    const kind = String(o.kind ?? '');
    const meta = obj(o.metadata);
    const subject = `${kind}/${String(meta?.name ?? '(no name)')}`;
    const add = (severity: Severity, path: (string | number)[], rule: string, message: string, fix: string) => out.push({ severity, line: line(path), subject, message, fix, rule });
    const api = String(o.apiVersion ?? '');
    if (REMOVED_APIS[api]) add('error', ['apiVersion'], 'removed-api', `apiVersion ${api} is no longer served by current Kubernetes versions.`, `Use ${REMOVED_APIS[api]}.`);

    if (WORKLOADS.has(kind)) {
      const basePath: (string | number)[] = kind === 'Pod' ? ['spec'] : kind === 'CronJob' ? ['spec', 'jobTemplate', 'spec', 'template', 'spec'] : ['spec', 'template', 'spec'];
      let pod: Obj | null = o;
      for (const p of basePath) pod = obj(pod?.[p]);
      if (!pod) continue;
      const podSecurity = obj(pod.securityContext);
      for (const flag of ['hostNetwork', 'hostPID', 'hostIPC'] as const)
        if (pod[flag] === true)
          add(
            'error',
            [...basePath, flag],
            `host-${flag.slice(4).toLowerCase()}`,
            `${flag}: true shares the node's ${flag.slice(4)} namespace with the pod.`,
            `Remove ${flag}, unless this is a node agent that truly needs it.`,
          );
      arr(pod.volumes).forEach((v, i) => {
        if (obj(v)?.hostPath)
          add(
            'warning',
            [...basePath, 'volumes', i, 'hostPath'],
            'host-path',
            `Volume "${String(obj(v)?.name)}" mounts a folder of the node (hostPath).`,
            'Use a PersistentVolumeClaim, ConfigMap or emptyDir instead; hostPath lets the pod reach the node.',
          );
      });
      if (kind === 'Deployment' && (o.spec as Obj | undefined)?.replicas === 1)
        add(
          'note',
          ['spec', 'replicas'],
          'single-replica',
          'Only one replica: the app is down while it restarts or its node is drained.',
          'Run 2 or more replicas, with a PodDisruptionBudget, if the app must stay up.',
        );
      for (const group of ['initContainers', 'containers'] as const) {
        arr(pod[group]).forEach((c, i) => {
          const container = obj(c);
          if (!container) return;
          const path = [...basePath, group, i];
          const name = String(container.name ?? i);
          const where = `Container "${name}"`;
          const image = String(container.image ?? '');
          const tag = imageProblem(image);
          if (tag)
            add(
              'warning',
              [...path, 'image'],
              'image-tag',
              `${where}: image ${image} ${tag}, so a restart can silently run different code.`,
              'Pin a version tag (nginx:1.27.2) or, better, a digest (nginx@sha256:…).',
            );
          const resources = obj(container.resources);
          const requests = obj(resources?.requests);
          const limits = obj(resources?.limits);
          if (!requests?.cpu || !requests?.memory)
            add(
              'warning',
              [...path, 'resources'],
              'requests',
              `${where} has no CPU or memory requests, so the scheduler cannot place it sensibly.`,
              'Set resources.requests.cpu and resources.requests.memory.',
            );
          if (!limits?.memory)
            add('warning', [...path, 'resources'], 'memory-limit', `${where} has no memory limit; a leak can starve the whole node.`, 'Set resources.limits.memory (often equal to the request).');
          const security = obj(container.securityContext);
          if (security?.privileged === true)
            add(
              'error',
              [...path, 'securityContext', 'privileged'],
              'privileged',
              `${where} runs privileged: it has full access to the node.`,
              'Remove privileged: true; grant only the capabilities it needs.',
            );
          if (security?.allowPrivilegeEscalation !== false)
            add('warning', [...path, 'securityContext'], 'privilege-escalation', `${where} may gain more privileges than it starts with.`, 'Set securityContext.allowPrivilegeEscalation: false.');
          if (security?.runAsNonRoot !== true && podSecurity?.runAsNonRoot !== true && !(Number(security?.runAsUser) > 0 || Number(podSecurity?.runAsUser) > 0))
            add('warning', [...path, 'securityContext'], 'run-as-root', `${where} may run as root.`, 'Set securityContext.runAsNonRoot: true (and runAsUser to a non-zero id if the image needs it).');
          if (security?.readOnlyRootFilesystem !== true)
            add(
              'note',
              [...path, 'securityContext'],
              'read-only-root',
              `${where} can write to its own file system.`,
              'Set securityContext.readOnlyRootFilesystem: true and mount emptyDir volumes where it must write.',
            );
          const added = arr(obj(security?.capabilities)?.add).map(String);
          for (const cap of added.filter((c) => ['ALL', 'SYS_ADMIN', 'NET_ADMIN', 'SYS_PTRACE', 'SYS_MODULE'].includes(c.toUpperCase())))
            add(
              'error',
              [...path, 'securityContext', 'capabilities', 'add'],
              'dangerous-capability',
              `${where} adds the ${cap} capability, which comes close to root on the node.`,
              `Remove ${cap}; add only narrow capabilities such as NET_BIND_SERVICE.`,
            );
          if (group === 'containers' && LONG_RUNNING.has(kind)) {
            if (!container.readinessProbe)
              add('note', path, 'readiness-probe', `${where} has no readiness probe, so traffic may reach it before it is ready.`, 'Add a readinessProbe (HTTP, TCP or exec).');
            if (!container.livenessProbe)
              add('note', path, 'liveness-probe', `${where} has no liveness probe, so a hung process is never restarted.`, 'Add a livenessProbe, with a longer delay than the readiness probe.');
          }
          arr(container.env).forEach((e, k) => {
            const env = obj(e);
            if (env && SECRET_NAME.test(String(env.name ?? '')) && typeof env.value === 'string' && env.value)
              add(
                'error',
                [...path, 'env', k, 'value'],
                'secret-in-env',
                `${where}: ${String(env.name)} is written into the manifest in plain text.`,
                'Keep it in a Secret and use valueFrom.secretKeyRef.',
              );
          });
        });
      }
    }
    if (kind === 'Service' && ['LoadBalancer', 'NodePort'].includes(String((o.spec as Obj | undefined)?.type)))
      add(
        'note',
        ['spec', 'type'],
        'exposed-service',
        `This ${String((o.spec as Obj).type)} Service is reachable from outside the cluster.`,
        'Make sure that is intended; prefer ClusterIP behind an Ingress, and restrict loadBalancerSourceRanges.',
      );
    if (kind === 'Ingress' && !arr((o.spec as Obj | undefined)?.tls).length)
      add('warning', ['spec'], 'ingress-tls', 'This Ingress serves plain HTTP: it has no tls section.', 'Add spec.tls with a certificate (cert-manager can issue one).');
    if (kind === 'Secret' && obj(o.stringData))
      add(
        'warning',
        ['stringData'],
        'secret-in-git',
        'This Secret holds its values in plain text (stringData). Anyone who can read the file can read them.',
        'Keep secrets out of version control: use Sealed Secrets, SOPS or an external secret store.',
      );
    if ((kind === 'ClusterRole' || kind === 'Role') && arr(o.rules).some((r) => arr(obj(r)?.verbs).includes('*') || arr(obj(r)?.resources).includes('*')))
      add('warning', ['rules'], 'rbac-wildcard', `${kind} grants "*" (every verb or every resource).`, 'List the verbs and resources it needs.');
  }
  return out;
}

/* ------------------------------------------------------------ Compose -- */

function checkCompose(docs: YamlDoc[]): Finding[] {
  const out: Finding[] = [];
  const first = docs[0];
  if (!first) return out;
  const root = obj(first.value);
  if (!root) return out;
  const add = (severity: Severity, subject: string, path: (string | number)[], rule: string, message: string, fix: string) =>
    out.push({ severity, line: first.line(path), subject, message, fix, rule });
  if (root.version !== undefined) add('note', 'compose file', ['version'], 'obsolete-version', 'The top-level "version" key is obsolete; Compose ignores it.', 'Remove the version line.');
  const services = obj(root.services) ?? {};
  for (const [name, raw] of Object.entries(services)) {
    const s = obj(raw);
    if (!s) continue;
    const path = ['services', name];
    const subject = `service ${name}`;
    const image = typeof s.image === 'string' ? s.image : '';
    const tag = imageProblem(image);
    if (image && tag && !s.build) add('warning', subject, [...path, 'image'], 'image-tag', `Image ${image} ${tag}; a pull can change what runs.`, 'Pin a version tag or digest.');
    if (s.privileged === true)
      add(
        'error',
        subject,
        [...path, 'privileged'],
        'privileged',
        'The container runs privileged, with full access to the host.',
        'Remove privileged: true; use cap_add for the few capabilities it needs.',
      );
    if (s.network_mode === 'host')
      add(
        'warning',
        subject,
        [...path, 'network_mode'],
        'host-network',
        'network_mode: host puts the container on the host network, bypassing port publishing.',
        'Use a bridge network and publish only the ports needed.',
      );
    const volumes = arr(s.volumes);
    volumes.forEach((v, i) => {
      const text = typeof v === 'string' ? v : String(obj(v)?.source ?? '');
      if (text.includes('/var/run/docker.sock') || text.includes('/run/docker.sock'))
        add(
          'error',
          subject,
          [...path, 'volumes', i],
          'docker-socket',
          'The Docker socket is mounted: the container can control Docker, which is root on the host.',
          'Remove the mount, or use a socket proxy that allows only what is needed.',
        );
      if (/^\/(:|$)/.test(text) || text.startsWith('/etc:') || text.startsWith('/:'))
        add(
          'error',
          subject,
          [...path, 'volumes', i],
          'host-root',
          'A system folder of the host is mounted into the container.',
          'Mount only the folders the service needs, read-only where possible (:ro).',
        );
    });
    arr(s.ports).forEach((p, i) => {
      const text = typeof p === 'string' || typeof p === 'number' ? String(p) : `${String(obj(p)?.published ?? '')}:${String(obj(p)?.target ?? '')}`;
      const parts = text.split(':');
      const target = Number(parts[parts.length - 1]?.split('/')[0]);
      const boundToAll = parts.length < 3 && !(typeof p === 'object' && obj(p)?.host_ip);
      if (boundToAll && DATABASE_PORTS.has(target))
        add(
          'warning',
          subject,
          [...path, 'ports', i],
          'database-port',
          `Port ${target} (a database) is published on every network interface of the host.`,
          `Publish it on 127.0.0.1 only ("127.0.0.1:${target}:${target}"), or not at all if only other services use it.`,
        );
    });
    const env = s.environment;
    const entries: [string, unknown][] = Array.isArray(env) ? env.map((e) => String(e).split(/=(.*)/s).slice(0, 2) as [string, string]) : Object.entries(obj(env) ?? {});
    for (const [key, value] of entries)
      if (SECRET_NAME.test(key) && typeof value === 'string' && value && !/^\$\{?/.test(value))
        add('warning', subject, [...path, 'environment'], 'secret-in-env', `${key} is written into the file in plain text.`, 'Use an .env file kept out of version control, or Compose secrets.');
    if (!s.restart && !obj(s.deploy)?.restart_policy)
      add('note', subject, path, 'restart-policy', 'No restart policy: the service stays down after a crash or a reboot.', 'Add restart: unless-stopped (or on-failure).');
    if (!s.healthcheck && (image || s.build))
      add('note', subject, path, 'healthcheck', 'No healthcheck, so depends_on cannot wait for the service to be ready.', 'Add a healthcheck, and use depends_on with condition: service_healthy.');
  }
  return out;
}

/* ---------------------------------------------------------- Terraform -- */

export interface HclAttr {
  readonly name: string;
  readonly raw: string;
  readonly line: number;
}

export interface HclBlock {
  readonly type: string;
  readonly labels: readonly string[];
  readonly line: number;
  readonly attrs: readonly HclAttr[];
  readonly blocks: readonly HclBlock[];
}

/** A small HCL reader: blocks, labels and attributes with their raw expressions. */
export function parseHcl(text: string): HclBlock {
  let i = 0;
  let line = 1;
  const peek = () => text[i] ?? '';
  const skipSpace = (newlines = true) => {
    for (;;) {
      const c = peek();
      if (c === '\n') {
        if (!newlines) return;
        line++;
        i++;
      } else if (c === ' ' || c === '\t' || c === '\r') i++;
      else if (c === '#' || (c === '/' && text[i + 1] === '/')) while (i < text.length && peek() !== '\n') i++;
      else if (c === '/' && text[i + 1] === '*') {
        i += 2;
        while (i < text.length && !(peek() === '*' && text[i + 1] === '/')) {
          if (peek() === '\n') line++;
          i++;
        }
        i += 2;
      } else return;
    }
  };
  const ident = () => {
    const m = /^[A-Za-z_][\w-]*/.exec(text.slice(i));
    if (!m) return '';
    i += m[0].length;
    return m[0];
  };
  const string = () => {
    // A quoted string, with escapes and ${…} kept as written.
    let out = '';
    i++;
    while (i < text.length && peek() !== '"') {
      if (peek() === '\\') {
        out += text.slice(i, i + 2);
        i += 2;
      } else {
        if (peek() === '\n') line++;
        out += peek();
        i++;
      }
    }
    i++;
    return out;
  };
  /** The raw text of an expression, up to the end of its line outside brackets. */
  const expression = () => {
    const start = i;
    let depth = 0;
    while (i < text.length) {
      const c = peek();
      if (c === '"') {
        string();
        continue;
      }
      if (c === '<' && text[i + 1] === '<') {
        const m = /^<<-?\s*([A-Za-z_]\w*)[^\n]*\n/.exec(text.slice(i));
        if (m) {
          const end = text.indexOf(`\n${m[1]}`, i + m[0].length - 1);
          const stop = end < 0 ? text.length : end + 1 + (m[1] as string).length;
          for (let k = i; k < stop; k++) if (text[k] === '\n') line++;
          i = stop;
          continue;
        }
      }
      if ('([{'.includes(c)) depth++;
      else if (')]}'.includes(c)) {
        if (depth === 0) break;
        depth--;
      } else if (c === '\n') {
        if (depth === 0) break;
        line++;
      } else if (c === '#' && depth === 0) break;
      i++;
    }
    return text.slice(start, i).trim();
  };
  const body = (type: string, labels: string[], at: number): HclBlock => {
    const attrs: HclAttr[] = [];
    const blocks: HclBlock[] = [];
    for (;;) {
      skipSpace();
      if (i >= text.length || peek() === '}') {
        i++;
        return { type, labels, line: at, attrs, blocks };
      }
      const startLine = line;
      const name = ident();
      if (!name) {
        // Not something this reader understands: skip a line.
        while (i < text.length && peek() !== '\n') i++;
        continue;
      }
      skipSpace(false);
      if (peek() === '=') {
        i++;
        skipSpace(false);
        attrs.push({ name, raw: expression(), line: startLine });
        continue;
      }
      const blockLabels: string[] = [];
      for (;;) {
        skipSpace(false);
        if (peek() === '"') blockLabels.push(string());
        else if (/[A-Za-z_]/.test(peek())) blockLabels.push(ident());
        else break;
      }
      skipSpace();
      if (peek() === '{') {
        i++;
        blocks.push(body(name, blockLabels, startLine));
      }
    }
  };
  return body('', [], 1);
}

const literal = (raw: string | undefined): string | boolean | number | null => {
  if (raw === undefined) return null;
  const t = raw.trim();
  if (t === 'true' || t === 'false') return t === 'true';
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  const m = /^"((?:[^"\\]|\\.)*)"$/.exec(t);
  return m && !(m[1] as string).includes('${') ? (m[1] as string) : null;
};
const stringsIn = (raw: string | undefined) => [...(raw ?? '').matchAll(/"([^"]*)"/g)].map((m) => m[1] as string);

function checkTerraform(text: string): Finding[] {
  const out: Finding[] = [];
  const root = parseHcl(text);
  const add = (severity: Severity, line: number, subject: string, rule: string, message: string, fix: string) => out.push({ severity, line, subject, message, fix, rule });
  const walk = (block: HclBlock, subject: string, fn: (b: HclBlock, subject: string) => void) => {
    fn(block, subject);
    for (const b of block.blocks) walk(b, subject, fn);
  };
  const attr = (b: HclBlock, name: string) => b.attrs.find((a) => a.name === name);

  const terraform = root.blocks.find((b) => b.type === 'terraform');
  if (root.blocks.some((b) => b.type === 'resource') && !terraform?.attrs.some((a) => a.name === 'required_version'))
    add(
      'note',
      terraform?.line ?? 1,
      'terraform',
      'required-version',
      'No required_version: any Terraform version may apply this, including ones that behave differently.',
      'Add required_version = "~> 1.9" (or the range you test with) to the terraform block.',
    );
  const required = terraform?.blocks.find((b) => b.type === 'required_providers');
  for (const p of required?.attrs ?? [])
    if (!/version\s*=/.test(p.raw))
      add(
        'warning',
        p.line,
        `provider ${p.name}`,
        'provider-version',
        `Provider ${p.name} has no version constraint, so a new major version can arrive unannounced.`,
        `Add version = "~> X.Y" to the ${p.name} entry.`,
      );
  for (const m of root.blocks.filter((b) => b.type === 'module')) {
    const source = literal(attr(m, 'source')?.raw);
    if (typeof source === 'string' && /^(git::|github\.com\/|git@)/.test(source) && !/[?&]ref=/.test(source))
      add(
        'warning',
        attr(m, 'source')?.line ?? m.line,
        `module ${m.labels[0] ?? ''}`,
        'module-ref',
        'The module comes from Git without a ref, so it follows whatever the default branch holds.',
        'Add ?ref=v1.2.3 (a tag or commit) to the source.',
      );
    if (typeof source === 'string' && /^[\w-]+\/[\w-]+\/[\w-]+$/.test(source) && !attr(m, 'version'))
      add('warning', m.line, `module ${m.labels[0] ?? ''}`, 'module-version', 'The registry module has no version constraint.', 'Add version = "~> X.Y".');
  }

  for (const r of root.blocks.filter((b) => b.type === 'resource' || b.type === 'provider' || b.type === 'data')) {
    const type = r.labels[0] ?? '';
    const subject = r.type === 'provider' ? `provider ${type}` : `${type}.${r.labels[1] ?? ''}`;
    walk(r, subject, (b, s) => {
      for (const a of b.attrs) {
        const value = literal(a.raw);
        if (SECRET_NAME.test(a.name) && typeof value === 'string' && value && !/^(arn:|data\.|var\.)/.test(value))
          add(
            'error',
            a.line,
            s,
            'hardcoded-secret',
            `${a.name} is written into the configuration in plain text (and ends up in the state file).`,
            'Use a variable marked sensitive = true, or read it from a secret store (aws_secretsmanager_secret_version, vault_generic_secret…).',
          );
      }
    });
    if (r.type !== 'resource') continue;
    // Security groups open to the whole internet.
    const ingressBlocks =
      type === 'aws_security_group'
        ? r.blocks.filter((b) => b.type === 'ingress')
        : type === 'aws_security_group_rule' && literal(attr(r, 'type')?.raw) === 'ingress'
          ? [r]
          : type === 'aws_vpc_security_group_ingress_rule'
            ? [r]
            : [];
    for (const ing of ingressBlocks) {
      const cidrs = [...stringsIn(attr(ing, 'cidr_blocks')?.raw), ...stringsIn(attr(ing, 'ipv6_cidr_blocks')?.raw), ...stringsIn(attr(ing, 'cidr_ipv4')?.raw)];
      if (cidrs.some((c) => c === '0.0.0.0/0' || c === '::/0')) {
        const from = Number(literal(attr(ing, 'from_port')?.raw) ?? 0);
        const to = Number(literal(attr(ing, 'to_port')?.raw) ?? from);
        const sensitive = [22, 3389, ...DATABASE_PORTS].filter((p) => p >= from && p <= to);
        add(
          sensitive.length || from === 0 ? 'error' : 'warning',
          ing.line,
          subject,
          'open-ingress',
          `Inbound traffic is allowed from anywhere on the internet${sensitive.length ? ` on port ${sensitive.join(', ')}` : from === 0 && to === 0 ? ' on every port' : ''}.`,
          'Limit cidr_blocks to the addresses that need access (an office range, a VPN or a load balancer).',
        );
      }
    }
    if (type === 'aws_s3_bucket' || type === 'aws_s3_bucket_acl') {
      const acl = literal(attr(r, 'acl')?.raw);
      if (acl === 'public-read' || acl === 'public-read-write')
        add(
          'error',
          attr(r, 'acl')?.line ?? r.line,
          subject,
          's3-public',
          `The bucket is ${acl}: anyone can ${acl === 'public-read' ? 'read' : 'read and write'} its files.`,
          'Use private ACLs with an aws_s3_bucket_public_access_block; share files with pre-signed URLs or CloudFront.',
        );
    }
    if (type === 'aws_db_instance' || type === 'aws_rds_cluster') {
      if (literal(attr(r, 'publicly_accessible')?.raw) === true)
        add(
          'error',
          attr(r, 'publicly_accessible')?.line ?? r.line,
          subject,
          'db-public',
          'The database is reachable from the internet.',
          'Set publicly_accessible = false and reach it through the VPC.',
        );
      if (literal(attr(r, 'storage_encrypted')?.raw) !== true) add('warning', r.line, subject, 'db-encryption', 'Storage encryption is not turned on.', 'Set storage_encrypted = true.');
      if (literal(attr(r, 'deletion_protection')?.raw) !== true)
        add('note', r.line, subject, 'db-deletion', 'Deletion protection is off; one wrong apply can drop the database.', 'Set deletion_protection = true for production databases.');
    }
    if (type === 'aws_ebs_volume' && literal(attr(r, 'encrypted')?.raw) !== true) add('warning', r.line, subject, 'ebs-encryption', 'The volume is not encrypted.', 'Set encrypted = true.');
    if (type === 'aws_instance') {
      const metadata = r.blocks.find((b) => b.type === 'metadata_options');
      if (literal(metadata ? attr(metadata, 'http_tokens')?.raw : undefined) !== 'required')
        add(
          'warning',
          metadata?.line ?? r.line,
          subject,
          'imdsv2',
          'The instance allows the old metadata service (IMDSv1), a common way credentials leak.',
          'Add metadata_options { http_tokens = "required" }.',
        );
      if (literal(attr(r, 'associate_public_ip_address')?.raw) === true)
        add('note', r.line, subject, 'public-ip', 'The instance gets a public IP address.', 'Make sure it must be reachable directly; otherwise put it behind a load balancer.');
    }
    if (type === 'azurerm_storage_account') {
      if (literal(attr(r, 'allow_nested_items_to_be_public')?.raw) === true || literal(attr(r, 'allow_blob_public_access')?.raw) === true)
        add('error', r.line, subject, 'azure-public-blobs', 'Blobs in this storage account can be made public.', 'Set allow_nested_items_to_be_public = false.');
      const tls = literal(attr(r, 'min_tls_version')?.raw);
      if (tls === 'TLS1_0' || tls === 'TLS1_1') add('warning', attr(r, 'min_tls_version')?.line ?? r.line, subject, 'azure-tls', `min_tls_version is ${tls}.`, 'Set min_tls_version = "TLS1_2".');
    }
    if (type === 'google_storage_bucket' && literal(attr(r, 'uniform_bucket_level_access')?.raw) !== true)
      add('note', r.line, subject, 'gcs-uniform', 'Uniform bucket-level access is off, so object ACLs can make single files public.', 'Set uniform_bucket_level_access = true.');
    if (type === 'google_compute_firewall' && stringsIn(attr(r, 'source_ranges')?.raw).includes('0.0.0.0/0'))
      add('warning', attr(r, 'source_ranges')?.line ?? r.line, subject, 'open-ingress', 'The firewall rule allows traffic from anywhere.', 'Narrow source_ranges.');
  }
  return out;
}

/* ---------------------------------------------------------- Dockerfile -- */

const INSTRUCTIONS = new Set([
  'FROM',
  'RUN',
  'CMD',
  'LABEL',
  'MAINTAINER',
  'EXPOSE',
  'ENV',
  'ADD',
  'COPY',
  'ENTRYPOINT',
  'VOLUME',
  'USER',
  'WORKDIR',
  'ARG',
  'ONBUILD',
  'STOPSIGNAL',
  'HEALTHCHECK',
  'SHELL',
]);

interface Instruction {
  readonly line: number;
  readonly name: string;
  readonly args: string;
}

/** Instructions with their continuation lines joined, comments and parser directives skipped. */
function instructions(text: string): Instruction[] {
  const out: Instruction[] = [];
  const lines = text.split(/\r?\n/);
  const directive = /^#\s*escape\s*=\s*(\S)/i.exec(lines[0] ?? '');
  const continuation = directive ? (directive[1] as string) : '\\';
  for (let i = 0; i < lines.length; i++) {
    const first = lines[i] as string;
    if (/^\s*(#|$)/.test(first)) continue;
    const start = i;
    let joined = first;
    while (joined.trimEnd().endsWith(continuation) && i + 1 < lines.length) {
      joined = joined.trimEnd().slice(0, -1);
      i++;
      const next = lines[i] as string;
      if (/^\s*#/.test(next)) continue;
      joined += ` ${next.trim()}`;
    }
    const match = /^\s*(\S+)\s*(.*)$/s.exec(joined);
    if (match) out.push({ line: start + 1, name: (match[1] as string).toUpperCase(), args: (match[2] as string).trim() });
  }
  return out;
}

function checkDockerfile(text: string): Finding[] {
  const out: Finding[] = [];
  const all = instructions(text);
  const stages: { name: string; image: string; line: number; items: Instruction[] }[] = [];
  const stageNames = new Set<string>();
  const add = (severity: Severity, line: number, subject: string, rule: string, message: string, fix: string) => out.push({ severity, line, subject, message, fix, rule });

  const firstReal = all.find((item) => item.name !== 'ARG');
  if (firstReal && firstReal.name !== 'FROM')
    add('error', firstReal.line, firstReal.name, 'from-first', 'The Dockerfile must start with FROM (only ARG may come before it).', 'Move the FROM line to the top.');

  for (const item of all) {
    if (!INSTRUCTIONS.has(item.name)) {
      add(
        'error',
        item.line,
        item.name,
        'unknown-instruction',
        `${item.name} is not a Dockerfile instruction.`,
        'Check the spelling: FROM, RUN, COPY, ADD, ENV, ARG, WORKDIR, USER, EXPOSE, CMD, ENTRYPOINT…',
      );
      continue;
    }
    if (item.name === 'FROM') {
      const words = item.args.split(/\s+/).filter((w) => !w.startsWith('--'));
      const image = words[0] ?? '';
      const as = words.length >= 3 && words[1]?.toUpperCase() === 'AS' ? (words[2] as string) : '';
      stages.push({ name: as || `stage ${stages.length + 1}`, image, line: item.line, items: [] });
      const lower = image.toLowerCase();
      if (lower !== 'scratch' && !stageNames.has(lower) && !image.includes('$') && !image.includes('@')) {
        const tag = /:([^/:]+)$/.exec(image)?.[1];
        if (!tag)
          add('warning', item.line, image, 'untagged-image', `${image} has no tag, so every build may get a different image.`, `Pin a version, for example ${image}:1.2.3, or a digest (@sha256:…).`);
        else if (tag === 'latest') add('warning', item.line, image, 'latest-image', `${image} uses the latest tag, which changes under you.`, 'Pin a version or a digest.');
      }
      if (as) stageNames.add(as.toLowerCase());
      continue;
    }
    stages[stages.length - 1]?.items.push(item);
  }

  for (const [index, stage] of stages.entries()) {
    const final = index === stages.length - 1;
    const subject = stage.name;
    let users: Instruction[] = [];
    const counts: Record<string, Instruction[]> = {};
    for (const item of stage.items) {
      const same = counts[item.name] ?? [];
      same.push(item);
      counts[item.name] = same;
      const a = item.args;
      switch (item.name) {
        case 'MAINTAINER':
          add('note', item.line, subject, 'maintainer', 'MAINTAINER is deprecated.', 'Use LABEL org.opencontainers.image.authors="…" instead.');
          break;
        case 'ADD': {
          const sources = a
            .split(/\s+/)
            .filter((w) => !w.startsWith('--'))
            .slice(0, -1);
          if (sources.some((src) => /^https?:\/\//i.test(src)))
            add(
              'warning',
              item.line,
              subject,
              'add-url',
              'ADD downloads a file without checking it.',
              'Download with curl or wget in a RUN step and verify a checksum, or use ADD --checksum=sha256:….',
            );
          else if (!sources.some((src) => /\.(tar|tgz|tar\.(gz|bz2|xz|zst))$/i.test(src)))
            add('note', item.line, subject, 'add-copy', 'ADD is used to copy local files.', 'Use COPY; ADD also unpacks archives and fetches URLs, which surprises readers.');
          break;
        }
        case 'WORKDIR':
          if (!/^(\/|\$|[A-Za-z]:[\\/])/.test(a.replace(/^["']/, '')))
            add('warning', item.line, subject, 'relative-workdir', `WORKDIR ${a} is relative, so it depends on the WORKDIR before it.`, 'Use an absolute path such as /app.');
          break;
        case 'USER':
          users.push(item);
          break;
        case 'EXPOSE':
          for (const port of a.split(/\s+/)) {
            const n = Number(port.replace(/\/(tcp|udp)$/i, '').split('-')[0]);
            if (!port.includes('$') && !(Number.isInteger(n) && n >= 1 && n <= 65535))
              add('error', item.line, subject, 'expose-port', `${port} is not a valid port.`, 'Use a number from 1 to 65535, optionally with /tcp or /udp.');
          }
          break;
        case 'ENV':
        case 'ARG': {
          const names = [...a.matchAll(/(?:^|\s)([A-Za-z_][A-Za-z0-9_]*)(?:=|\s|$)/g)].map((m) => m[1] as string);
          const secret = names.find((name) => SECRET_NAME.test(name));
          if (secret && item.name === 'ENV')
            add(
              'error',
              item.line,
              subject,
              'secret-env',
              `${secret} is set with ENV, so it stays in the image for anyone who pulls it.`,
              'Pass secrets at run time, or use RUN --mount=type=secret while building.',
            );
          else if (secret)
            add(
              'warning',
              item.line,
              subject,
              'secret-arg',
              `${secret} is a build argument; its value is visible in the image history.`,
              'Use RUN --mount=type=secret,id=… instead of ARG for secrets.',
            );
          break;
        }
        case 'CMD':
        case 'ENTRYPOINT':
          if (!a.startsWith('['))
            add(
              'note',
              item.line,
              subject,
              'shell-form',
              `${item.name} uses the shell form, so the program does not receive stop signals and shuts down slowly.`,
              `Use the exec form: ${item.name} ["program", "argument"].`,
            );
          break;
        case 'RUN': {
          const run = a;
          if (/\bapt-get\s+(?:-\S+\s+)*install\b/.test(run)) {
            const tokens = run.split(/\s+/);
            if (!tokens.some((t) => /^-[a-zA-Z]*y[a-zA-Z]*$/.test(t) || t === '--yes' || t === '--assume-yes'))
              add('warning', item.line, subject, 'apt-yes', 'apt-get install without -y waits for an answer and fails the build.', 'Add -y.');
            if (!/--no-install-recommends/.test(run))
              add('note', item.line, subject, 'apt-recommends', 'apt-get install also installs recommended packages.', 'Add --no-install-recommends to keep the image small.');
            if (!/rm\s+-[a-z]*r[a-z]*f?[a-z]*\s+\/var\/lib\/apt\/lists/.test(run))
              add('note', item.line, subject, 'apt-lists', 'The apt package lists stay in the layer.', 'End the same RUN with && rm -rf /var/lib/apt/lists/*.');
          } else if (/\bapt-get\s+update\b/.test(run)) {
            add(
              'warning',
              item.line,
              subject,
              'apt-update-alone',
              'apt-get update in a RUN step of its own is cached, so later installs use stale lists.',
              'Run apt-get update && apt-get install -y … in the same RUN step.',
            );
          }
          if (/\bapk\s+add\b/.test(run) && !/--no-cache/.test(run)) add('note', item.line, subject, 'apk-cache', 'apk add keeps its package index in the image.', 'Use apk add --no-cache.');
          if (/\bpip3?\s+install\b/.test(run) && !/--no-cache-dir/.test(run)) add('note', item.line, subject, 'pip-cache', 'pip keeps its download cache in the image.', 'Add --no-cache-dir.');
          if (/\bnpm\s+install\b(?![^&;|]*-g\b)/.test(run) && !/\bnpm\s+install\s+(?:-\S+\s+)*[A-Za-z@]/.test(run))
            add('note', item.line, subject, 'npm-ci', 'npm install may change package-lock.json and install different versions.', 'Use npm ci for repeatable installs.');
          if (/\b(curl|wget)\b[^|;&]*\|\s*(sudo\s+)?(ba|z|da)?sh\b/.test(run))
            add('warning', item.line, subject, 'pipe-to-shell', 'A script from the internet is piped straight into a shell.', 'Download it, check its checksum or signature, then run it.');
          if (/(^|[;&|]\s*)sudo\s/.test(run))
            add(
              'warning',
              item.line,
              subject,
              'sudo',
              'sudo in a Dockerfile has unpredictable behaviour (TTY, signals).',
              'Run the step as root (USER root before it), then switch back to an unprivileged user.',
            );
          if (/(^|&&|;)\s*cd\s+\S/.test(run)) add('note', item.line, subject, 'cd', 'cd in RUN only lasts for that step.', 'Use WORKDIR to change directory.');
          if (/\bchmod\s+(-R\s+)?0?777\b/.test(run))
            add(
              'warning',
              item.line,
              subject,
              'chmod-777',
              'chmod 777 lets every user in the container change these files.',
              'Give the needed permission to the owning user only, for example chmod 750 with chown.',
            );
          break;
        }
      }
    }
    for (const name of ['CMD', 'ENTRYPOINT', 'HEALTHCHECK']) {
      const list = counts[name] ?? [];
      if (list.length > 1)
        add('warning', (list[0] as Instruction).line, subject, `multiple-${name.toLowerCase()}`, `${list.length} ${name} instructions: only the last one counts.`, `Keep one ${name}.`);
    }
    if (!final) continue;
    const lastUser = users[users.length - 1];
    const rootless = /nonroot|distroless.*:nonroot|rootless/i.test(stage.image);
    if (!lastUser && !rootless) add('warning', stage.line, subject, 'root-user', 'The container runs as root.', 'Create a user and add USER before CMD, for example RUN useradd -r app and USER app.');
    else if (lastUser && /^(root|0)(:|$)/.test(lastUser.args.trim()))
      add('warning', lastUser.line, subject, 'root-user', 'The last USER is root, so the container runs as root.', 'Switch to an unprivileged user before CMD.');
    if (!counts.HEALTHCHECK && stage.image.toLowerCase() !== 'scratch' && !/distroless/i.test(stage.image))
      add(
        'note',
        stage.line,
        subject,
        'healthcheck',
        'There is no HEALTHCHECK, so Docker cannot tell when the app hangs.',
        'Add HEALTHCHECK CMD with a quick request to the app (Kubernetes uses its own probes instead).',
      );
    users = [];
  }
  return out;
}

/* ---------------------------------------------------------------- all -- */

export function lintInfra(text: string, kind: FileKind = detectKind(text)): { kind: FileKind; findings: Finding[] } {
  let findings: Finding[] = [];
  if (kind === 'terraform') findings = checkTerraform(text);
  else if (kind === 'dockerfile') findings = checkDockerfile(text);
  else if (kind === 'kubernetes' || kind === 'compose') {
    const docs = yamlDocs(text);
    const errors = docs.flatMap((d) => d.doc.errors);
    if (errors.length) throw new Error(`The YAML could not be read: ${errors[0]?.message ?? 'unknown error'}`);
    findings = kind === 'kubernetes' ? checkKubernetes(docs) : checkCompose(docs);
  }
  const order: Record<Severity, number> = { error: 0, warning: 1, note: 2 };
  findings.sort((a, b) => order[a.severity] - order[b.severity] || a.line - b.line);
  return { kind, findings };
}
