/**
 * Reads the vendored CyberChef operations (src/recipe/vendor/cyberchef) as text,
 * parses them with acorn without running them, and writes
 * src/recipe/ops/cyberchef-port.meta.ts: each operation's name, description,
 * data types and arguments, so the Recipe tool can list them without loading
 * their code.  Run after scripts/vendor-cyberchef.py:
 *   node scripts/cyberchef-meta.mjs && pnpm biome format --write src/recipe/ops/cyberchef-port.meta.ts
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as acorn from 'acorn';

const root = fileURLToPath(new URL('../src/recipe/vendor/cyberchef/', import.meta.url));
const parse = (file) => acorn.parse(readFileSync(file, 'utf8'), { ecmaVersion: 'latest', sourceType: 'module' });
const modules = new Map();

/** Top-level constants and imports of a module, evaluated lazily. */
function scope(file) {
  if (modules.has(file)) return modules.get(file);
  const ast = parse(file);
  const consts = new Map();
  const imports = new Map();
  for (const node of ast.body) {
    const decl = node.type === 'ExportNamedDeclaration' ? node.declaration : node;
    if (decl?.type === 'VariableDeclaration') for (const d of decl.declarations) if (d.id.type === 'Identifier' && d.init) consts.set(d.id.name, d.init);
    if (node.type === 'ImportDeclaration' && node.source.value.startsWith('.'))
      for (const s of node.specifiers) imports.set(s.local.name, { file: resolve(dirname(file), node.source.value), name: s.imported?.name ?? 'default' });
  }
  const result = { ast, consts, imports, file };
  modules.set(file, result);
  return result;
}

function evaluate(node, sc) {
  switch (node.type) {
    case 'Literal':
      return node.value;
    case 'TemplateLiteral':
      return node.quasis.map((q, i) => q.value.cooked + (node.expressions[i] ? evaluate(node.expressions[i], sc) : '')).join('');
    case 'ArrayExpression':
      return node.elements.flatMap((e) => (e.type === 'SpreadElement' ? evaluate(e.argument, sc) : [evaluate(e, sc)]));
    case 'ObjectExpression':
      return Object.fromEntries(node.properties.flatMap((p) => (p.type === 'SpreadElement' ? Object.entries(evaluate(p.argument, sc)) : [[p.key.name ?? p.key.value, evaluate(p.value, sc)]])));
    case 'BinaryExpression': {
      const l = evaluate(node.left, sc);
      const r = evaluate(node.right, sc);
      return { '+': l + r, '-': l - r, '*': l * r, '/': l / r, '**': l ** r }[node.operator];
    }
    case 'UnaryExpression':
      return node.operator === '-' ? -evaluate(node.argument, sc) : node.operator === '!' ? !evaluate(node.argument, sc) : undefined;
    case 'Identifier': {
      if (node.name === 'undefined') return undefined;
      if (sc.consts.has(node.name)) return evaluate(sc.consts.get(node.name), sc);
      const imported = sc.imports.get(node.name);
      if (imported) {
        const other = scope(imported.file);
        if (other.consts.has(imported.name)) return evaluate(other.consts.get(imported.name), other);
      }
      throw new Error(`cannot resolve ${node.name}`);
    }
    case 'MemberExpression': {
      const object = evaluate(node.object, sc);
      const key = node.computed ? evaluate(node.property, sc) : node.property.name;
      if (typeof object?.[key] === 'function') throw new Error('call');
      return object?.[key];
    }
    case 'CallExpression': {
      // Object.keys(X) and X.map(v => v.name) appear in a few argument lists.
      if (node.callee.type === 'MemberExpression' && node.callee.object.name === 'Object' && node.callee.property.name === 'keys') return Object.keys(evaluate(node.arguments[0], sc));
      if (node.callee.type === 'MemberExpression' && node.callee.property.name === 'map' && node.arguments[0]?.type === 'ArrowFunctionExpression') {
        const list = evaluate(node.callee.object, sc);
        const fn = node.arguments[0];
        const param = fn.params[0].name;
        return list.map((item) => {
          const inner = { ...sc, consts: new Map(sc.consts) };
          inner.consts.set(param, { type: 'Literal', value: item });
          return evaluate(fn.body, { ...inner, consts: new Map([...inner.consts].map(([k, v]) => [k, k === param ? { type: 'Literal', value: item } : v])) });
        });
      }
      // Multiple Bombe lists rotor sets with this helper: values s..n-1 joined by newlines.
      if (node.callee.type === 'Identifier' && node.callee.name === 'rotorsFormat') {
        const [rotors, from, to] = node.arguments.map((a) => evaluate(a, sc));
        return rotors
          .slice(from, to)
          .map((r) => r.value)
          .join('\n');
      }
      // String and array methods on constants: "ABC".split(""), [..].concat(..), .slice(..).
      if (node.callee.type === 'MemberExpression' && !node.callee.computed) {
        const method = node.callee.property.name;
        if (node.callee.object.type === 'Identifier' && node.callee.object.name === 'hljs' && method === 'listLanguages') {
          const languages = readdirSync(fileURLToPath(new URL('../node_modules/highlight.js/lib/languages/', import.meta.url)))
            .filter((f) => f.endsWith('.js') && !f.endsWith('.js.js'))
            .map((f) => f.replace(/\.js$/, ''));
          return languages.sort();
        }
        const target = evaluate(node.callee.object, sc);
        const args = node.arguments.map((a) => evaluate(a, sc));
        if (['split', 'concat', 'slice', 'join', 'toUpperCase', 'toLowerCase'].includes(method) && typeof target?.[method] === 'function') return target[method](...args);
      }
      throw new Error('call');
    }
    default:
      throw new Error(`unsupported ${node.type}`);
  }
}

const strip = (html) =>
  String(html ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(p|li|ul|ol)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const rows = [];
const opsDir = join(root, 'operations');
for (const file of readdirSync(opsDir)
  .filter((f) => f.endsWith('.mjs'))
  .sort()) {
  const sc = scope(join(opsDir, file));
  const cls = sc.ast.body.find((n) => n.type === 'ClassDeclaration');
  const ctor = cls.body.body.find((m) => m.kind === 'constructor');
  const fields = {};
  for (const st of ctor.value.body.body) {
    if (st.type !== 'ExpressionStatement' || st.expression.type !== 'AssignmentExpression' || st.expression.left.object?.type !== 'ThisExpression') continue;
    const key = st.expression.left.property.name;
    try {
      fields[key] = evaluate(st.expression.right, sc);
    } catch (error) {
      if (['name', 'description', 'inputType', 'outputType', 'args'].includes(key)) console.error(`${file}: ${key}: ${error.message}`);
    }
  }
  const present = cls.body.body.some((m) => m.key?.name === 'present');
  rows.push({
    file: file.replace(/\.mjs$/, ''),
    name: fields.name,
    description: strip(fields.description),
    infoURL: fields.infoURL || undefined,
    inputType: fields.inputType,
    outputType: fields.outputType,
    presentType: fields.presentType || undefined,
    present,
    args: (fields.args ?? []).map((a) => ({ name: a.name, type: a.type, value: a.value, toggleValues: a.toggleValues, min: a.min, max: a.max, step: a.step })),
  });
}
const header = `/** Generated by scripts/cyberchef-meta.mjs from the vendored CyberChef operations. Do not edit. */

export interface PortArg {
  readonly name?: string;
  readonly type: string;
  readonly value?: unknown;
  readonly toggleValues?: readonly string[];
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
}

export interface PortMeta {
  readonly file: string;
  readonly name: string;
  readonly description: string;
  readonly infoURL?: string;
  readonly inputType: string;
  readonly outputType: string;
  readonly presentType?: string;
  readonly present: boolean;
  readonly args: readonly PortArg[];
}
`;
const source = `${header}\nexport const CYBERCHEF_PORT: readonly PortMeta[] = ${JSON.stringify(rows, null, 1)};\n`;
writeFileSync(new URL('../src/recipe/ops/cyberchef-port.meta.ts', import.meta.url), source);
console.log(`${rows.length} operations`);
