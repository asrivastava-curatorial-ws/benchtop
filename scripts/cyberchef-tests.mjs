/**
 * Turns CyberChef's operation tests (tests/operations/tests/*.mjs in its
 * repository, Apache-2.0) into JSON test cases for Benchtop, reading them as
 * text with acorn: nothing in them is run.  Constants they import from
 * CyberChef's tests/samples are looked up in the samples directory given.
 *
 *   node scripts/cyberchef-tests.mjs <samples-dir> <out.json> <test.mjs>...
 *
 * Each case is { file, name, input, recipe, expected? | match? | unexpected? },
 * where match and unexpected are regular expressions as { source, flags }.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import * as acorn from 'acorn';

const [samplesDir, outFile, ...testFiles] = process.argv.slice(2);
if (!outFile || testFiles.length === 0) {
  console.error('usage: node scripts/cyberchef-tests.mjs <samples-dir> <out.json> <test.mjs>...');
  process.exit(2);
}

const modules = new Map();

function scope(file) {
  if (modules.has(file)) return modules.get(file);
  const ast = acorn.parse(readFileSync(file, 'utf8'), { ecmaVersion: 'latest', sourceType: 'module' });
  const consts = new Map();
  const imports = new Map();
  for (const node of ast.body) {
    const decl = node.type === 'ExportNamedDeclaration' ? node.declaration : node;
    if (decl?.type === 'VariableDeclaration') for (const d of decl.declarations) if (d.id.type === 'Identifier' && d.init) consts.set(d.id.name, d.init);
    if (node.type === 'ImportDeclaration' && node.source.value.includes('/samples/'))
      for (const s of node.specifiers) imports.set(s.local.name, { file: join(samplesDir, basename(node.source.value)), name: s.imported?.name ?? 'default' });
  }
  const result = { ast, consts, imports };
  modules.set(file, result);
  return result;
}

const STRING_METHODS = new Set(['split', 'concat', 'slice', 'join', 'repeat', 'toUpperCase', 'toLowerCase', 'trim', 'replace', 'padStart', 'padEnd']);

function evaluate(node, sc) {
  switch (node.type) {
    case 'Literal':
      return node.regex ? { source: node.regex.pattern, flags: node.regex.flags, regex: true } : node.value;
    case 'TemplateLiteral':
      return node.quasis.map((q, i) => q.value.cooked + (node.expressions[i] ? String(evaluate(node.expressions[i], sc)) : '')).join('');
    case 'ArrayExpression':
      return node.elements.flatMap((e) => (e.type === 'SpreadElement' ? evaluate(e.argument, sc) : [evaluate(e, sc)]));
    case 'ObjectExpression':
      return Object.fromEntries(
        node.properties.flatMap((p) =>
          p.type === 'SpreadElement' ? Object.entries(evaluate(p.argument, sc)) : [[p.computed ? evaluate(p.key, sc) : (p.key.name ?? p.key.value), evaluate(p.value, sc)]],
        ),
      );
    case 'BinaryExpression': {
      const l = evaluate(node.left, sc);
      const r = evaluate(node.right, sc);
      const ops = { '+': () => l + r, '-': () => l - r, '*': () => l * r, '/': () => l / r };
      if (!ops[node.operator]) throw new Error(`operator ${node.operator}`);
      return ops[node.operator]();
    }
    case 'UnaryExpression':
      if (node.operator === '-') return -evaluate(node.argument, sc);
      if (node.operator === '!') return !evaluate(node.argument, sc);
      throw new Error(`operator ${node.operator}`);
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
      if (key === 'length') return object.length;
      if (typeof object?.[key] === 'function') throw new Error('method');
      return object?.[key];
    }
    case 'CallExpression': {
      const callee = node.callee;
      const args = () => node.arguments.map((a) => evaluate(a, sc));
      if (callee.type === 'MemberExpression' && !callee.computed) {
        const method = callee.property.name;
        if (callee.object.type === 'Identifier' && callee.object.name === 'JSON' && method === 'stringify') {
          const [value, , indent] = args();
          return JSON.stringify(value, null, indent);
        }
        if (callee.object.type === 'Identifier' && callee.object.name === 'String' && method === 'fromCharCode') return String.fromCharCode(...args());
        if (STRING_METHODS.has(method)) {
          const target = evaluate(callee.object, sc);
          if (typeof target?.[method] === 'function') return target[method](...args());
        }
      }
      throw new Error('call');
    }
    default:
      throw new Error(`unsupported ${node.type}`);
  }
}

const cases = [];
for (const file of testFiles) {
  const sc = scope(file);
  for (const statement of sc.ast.body) {
    const call = statement.type === 'ExpressionStatement' ? statement.expression : null;
    if (call?.type !== 'CallExpression' || call.callee.type !== 'MemberExpression' || call.callee.property.name !== 'addTests') continue;
    for (const element of call.arguments[0].elements) {
      let test;
      try {
        test = evaluate(element, sc);
      } catch (error) {
        console.error(`${basename(file)}: skipped a test (${error.message})`);
        continue;
      }
      const item = { file: basename(file, '.mjs'), name: test.name, input: test.input ?? '', recipe: test.recipeConfig };
      if (typeof test.expectedOutput === 'string') item.expected = test.expectedOutput;
      if (test.expectedMatch?.regex) item.match = { source: test.expectedMatch.source, flags: test.expectedMatch.flags };
      if (test.unexpectedMatch?.regex) item.unexpected = { source: test.unexpectedMatch.source, flags: test.unexpectedMatch.flags };
      cases.push(item);
    }
  }
}
// Invisible characters are written as escapes, as Benchtop's source check requires.
const json = JSON.stringify(cases, null, 1).replace(
  /[\u007f-\u00a0\u00ad\u061c\u180e\u2000-\u200f\u2028-\u202f\u205f-\u206f\u3000\ufeff\ufff9-\ufffd]/g,
  (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`,
);
writeFileSync(outFile, `${json}\n`);
console.log(`${cases.length} cases`);
