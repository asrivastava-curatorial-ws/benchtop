import { ToolError } from '../../lib/errors';
import { type FileKind, lintInfra, type Severity } from '../../lib/infra-lint';
import { escapeHtml } from '../../lib/text';
import { defineTextTool } from '../types';

const SAMPLE = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: ticketing
spec:
  replicas: 1
  selector:
    matchLabels: { app: ticketing }
  template:
    metadata:
      labels: { app: ticketing }
    spec:
      containers:
        - name: web
          image: registry.example.org/vitm/ticketing:latest
          ports:
            - containerPort: 8080
          env:
            - name: DB_PASSWORD
              value: hunter2
          securityContext:
            privileged: true
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: ticketing
spec:
  rules:
    - host: tickets.example.org
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service: { name: ticketing, port: { number: 80 } }
`;

const LABEL: Record<Severity, string> = { error: 'Error', warning: 'Warning', note: 'Note' };
const KIND_NAME: Record<FileKind, string> = { kubernetes: 'Kubernetes manifests', compose: 'Docker Compose file', terraform: 'Terraform configuration', dockerfile: 'Dockerfile', unknown: 'file' };

export default defineTextTool({
  // No file filter: Dockerfiles usually have no extension.
  input: { label: 'Kubernetes YAML, compose.yaml, Terraform or Dockerfile', language: 'yaml', sample: SAMPLE },
  output: { label: 'Findings' },
  options: [
    {
      key: 'kind',
      label: 'File type',
      type: 'select',
      choices: [
        { value: 'auto', label: 'Detect' },
        { value: 'kubernetes', label: 'Kubernetes' },
        { value: 'compose', label: 'Docker Compose' },
        { value: 'terraform', label: 'Terraform (HCL)' },
        { value: 'dockerfile', label: 'Dockerfile' },
      ],
      default: 'auto',
    },
    { key: 'notes', label: 'Show notes (good practice, not risks)', type: 'toggle', default: true },
  ] as const,
  run(input, o) {
    if (!input.trim()) return '';
    const kind = o.kind === 'auto' ? undefined : (o.kind as FileKind);
    let result: ReturnType<typeof lintInfra>;
    try {
      result = lintInfra(input, kind);
    } catch (e) {
      throw new ToolError(e instanceof Error ? e.message : String(e));
    }
    if (result.kind === 'unknown')
      throw new ToolError('This does not look like Kubernetes YAML (apiVersion and kind), a Compose file (services:), Terraform (resource blocks) or a Dockerfile (FROM). Choose the file type.');
    const findings = result.findings.filter((f) => o.notes || f.severity !== 'note');
    const count = (s: Severity) => result.findings.filter((f) => f.severity === s).length;
    const info = `${KIND_NAME[result.kind]}: ${count('error')} errors, ${count('warning')} warnings, ${count('note')} notes`;
    if (!findings.length) return { output: 'No problems found.', info, preview: { kind: 'html', html: '<p>No problems found.</p>' } };
    const output = findings.map((f) => `${LABEL[f.severity].toUpperCase()} line ${f.line} [${f.subject}] ${f.message}\n  Fix: ${f.fix}`).join('\n\n');
    const rows = findings
      .map(
        (f) =>
          `<tr class="lint-${f.severity}"><td><span class="lint-badge lint-${f.severity}">${LABEL[f.severity]}</span></td><td>${f.line}</td><td><code>${escapeHtml(f.subject)}</code></td><td>${escapeHtml(f.message)}<br><span class="lint-fix">${escapeHtml(f.fix)}</span></td></tr>`,
      )
      .join('');
    return {
      output,
      info,
      preview: { kind: 'html', html: `<table class="lint-table"><thead><tr><th>Level</th><th>Line</th><th>Where</th><th>Finding</th></tr></thead><tbody>${rows}</tbody></table>` },
    };
  },
});
