import { describe, expect, it } from 'vitest';
import { parseAllDocuments } from 'yaml';
import { FIELD_BY_KEY, FIELDS, fileOf, TEMPLATE_BY_ID, TEMPLATES } from '../../src/lib/config-templates';
import tool from '../../src/tools/text/config-generator';

const defaults = Object.fromEntries(FIELDS.map((f) => [f.key, f.default]));
const render = (id: string, values: Record<string, unknown> = {}) => {
  const template = TEMPLATE_BY_ID.get(id);
  if (!template) throw new Error(`no template ${id}`);
  return template.render({ ...defaults, ...values });
};

describe('config generator templates', () => {
  it('has unique ids and only known fields, and every field is used', () => {
    expect(new Set(TEMPLATES.map((t) => t.id)).size).toBe(TEMPLATES.length);
    const used = new Set<string>();
    for (const t of TEMPLATES) {
      for (const key of t.fields) {
        expect(FIELD_BY_KEY.has(key), `${t.id} uses unknown field ${key}`).toBe(true);
        used.add(key);
      }
    }
    for (const field of FIELDS) expect(used.has(field.key), `field ${field.key} is used by no template`).toBe(true);
    expect(TEMPLATES.length).toBeGreaterThanOrEqual(90);
  });

  it.each(TEMPLATES.map((t) => [t.id]))('%s renders a well-formed file', (id) => {
    const template = TEMPLATE_BY_ID.get(id);
    if (!template) throw new Error(id);
    const out = render(id);
    expect(out.length).toBeGreaterThan(20);
    expect(out.endsWith('\n')).toBe(true);
    expect(out).not.toMatch(/undefined|NaN|\[object Object\]/);
    if (template.lang === 'json') expect(() => JSON.parse(out)).not.toThrow();
    if (template.lang === 'yaml') {
      for (const doc of parseAllDocuments(out)) {
        expect(doc.errors.map((e) => e.message)).toEqual([]);
        expect(doc.warnings.map((e) => e.message)).toEqual([]);
      }
    }
    expect(fileOf(template, defaults).length).toBeGreaterThan(0);
  });

  it('keeps secrets out of ConfigMaps and .env.example', () => {
    const k8s = render('k8s-configmap');
    const [configMap, secret] = k8s.split('\n---\n');
    expect(configMap).toContain('NODE_ENV: "production"');
    expect(configMap).not.toContain('DATABASE_URL');
    expect(secret).toContain('DATABASE_URL: "postgres://user:password@localhost:5432/app"');
    expect(render('env-example')).toBe('NODE_ENV=production\nPORT=3000\nDATABASE_URL=\n');
  });

  it('quotes values YAML would misread and dedupes the Python matrix', () => {
    const values = parseAllDocuments(render('helm-values', { image: 'ghcr.io/x/app:1.0' }))[0]?.toJS() as { image: { tag: unknown } };
    expect(values.image.tag).toBe('1.0');
    expect(render('gha-python', { python: '3.10' })).toContain('python-version: ["3.10"]');
    expect(render('gha-python', { python: '3.13' })).toContain('python-version: ["3.10", "3.13"]');
  });

  it('writes commands as exec arrays and names files after the project', () => {
    expect(render('dockerfile-node', { command: 'node dist/server.js --port 8080' })).toContain('CMD ["node", "dist/server.js", "--port", "8080"]');
    const systemd = TEMPLATE_BY_ID.get('systemd');
    expect(systemd && fileOf(systemd, { ...defaults, name: 'Museum Guide' })).toBe('/etc/systemd/system/museum-guide.service');
  });

  it('encodes connection details and uses the usual ports', () => {
    const pg = render('conn-postgres', { dbpassword: 'p@ss word/1', dbuser: 'curator' });
    expect(pg).toContain('postgresql://curator:p%40ss%20word%2F1@localhost:5432/museum?sslmode=prefer');
    expect(pg).toContain("password='p@ss word/1'");
    expect(render('conn-mysql', { dbport: '3307' })).toContain('jdbc:mysql://localhost:3307/museum');
    expect(render('conn-redis', { dbssl: true })).toContain('rediss://:change-me@localhost:6379/0');
    expect(render('conn-mongodb', { dbhost: '::1' })).toContain('mongodb://app:change-me@[::1]:27017/museum');
  });

  it('builds structured data from lines', () => {
    const faq = JSON.parse(render('schema-faq')) as { mainEntity: { name: string; acceptedAnswer: { text: string } }[] };
    expect(faq.mainEntity).toHaveLength(2);
    expect(faq.mainEntity[1]?.acceptedAnswer.text).toBe('Yes, without flash.');
    const crumbs = JSON.parse(render('schema-breadcrumb')) as { itemListElement: { position: number; item: string }[] };
    expect(crumbs.itemListElement.map((c) => c.position)).toEqual([1, 2, 3]);
    expect(render('sitemap')).toContain('<loc>https://example.org/visit/</loc>');
  });
});

describe('config generator tool', () => {
  it('shows only the fields the chosen file uses and suggests its name', async () => {
    const options = tool.options;
    const visible = (template: string) => options.filter((o) => o.type !== 'heading' && o.key !== 'template' && (!o.showIf || o.showIf({ template }))).map((o) => o.key);
    expect(visible('k8s-hpa')).toEqual(['name', 'replicas', 'namespace']);
    expect(visible('dockerignore')).toEqual([]);
    const result = await tool.run('', { ...defaults, template: 'gha-pages' } as never, { input2: '', file: null, nonce: 0 });
    expect(typeof result === 'object' && result.filename).toBe('pages.yml');
    expect(typeof result === 'object' && result.info).toContain('.github/workflows/pages.yml');
  });
});
