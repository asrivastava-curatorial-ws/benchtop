/**
 * The rarer CyberChef operations (GOST, SM2/SM4, Ascon, Twofish, PRESENT, RC2/RC6,
 * LS47, Typex, Bombe, Lorenz, Colossus, SIGABA, SSDEEP/CTPH, LZMA, XPRESS, BSON,
 * AMF, JA4, X.509 CRLs, YARA, disassemblers and more) run from CyberChef's own
 * source, vendored in src/recipe/vendor/cyberchef (Apache-2.0, see
 * licenses/cyberchef-NOTICE.txt).  Their names, descriptions and arguments come
 * from cyberchef-port.meta.ts, generated without running the code; each
 * operation's module loads only when a recipe uses it.
 */
import { type ArgDef, type Args, type Category, type DataKind, type Dish, defineOp, OpError, type Operation, type OpResult, slug, toBytes, toText } from '../core';
import { CYBERCHEF_PORT, type PortMeta as Meta, type PortArg as MetaArg } from './cyberchef-port.meta';

interface CyberChefOperation {
  run(input: unknown, args: unknown[]): unknown;
  present(data: unknown, args: unknown[]): unknown;
}

type Loader = (file: string) => Promise<{ default: new () => CyberChefOperation }> | undefined;

/** Set by the recipe worker (cyberchef-loaders.ts), so the page itself never bundles this code. */
let load: Loader = () => undefined;

export function setPortLoader(next: Loader): void {
  load = next;
}

/** CyberChef's category for each operation, from its Categories.json. */
const CATEGORY_OF: Record<string, Category> = {
  'Convert co-ordinate format': 'Utils',
  'Ascon Decrypt': 'Encryption / Encoding',
  'Ascon Encrypt': 'Encryption / Encoding',
  'Ascon Hash': 'Hashing',
  'Ascon MAC': 'Hashing',
  'BSON deserialise': 'Data format',
  'BSON serialise': 'Data format',
  'AMF Decode': 'Data format',
  'AMF Encode': 'Data format',
  Bombe: 'Encryption / Encoding',
  'Multiple Bombe': 'Encryption / Encoding',
  Typex: 'Encryption / Encoding',
  Lorenz: 'Encryption / Encoding',
  Colossus: 'Encryption / Encoding',
  SIGABA: 'Encryption / Encoding',
  'LS47 Encrypt': 'Encryption / Encoding',
  'LS47 Decrypt': 'Encryption / Encoding',
  'PRESENT Encrypt': 'Encryption / Encoding',
  'PRESENT Decrypt': 'Encryption / Encoding',
  'RC2 Encrypt': 'Encryption / Encoding',
  'RC2 Decrypt': 'Encryption / Encoding',
  'RC6 Encrypt': 'Encryption / Encoding',
  'RC6 Decrypt': 'Encryption / Encoding',
  'SM4 Encrypt': 'Encryption / Encoding',
  'SM4 Decrypt': 'Encryption / Encoding',
  'Twofish Encrypt': 'Encryption / Encoding',
  'Twofish Decrypt': 'Encryption / Encoding',
  'GOST Encrypt': 'Encryption / Encoding',
  'GOST Decrypt': 'Encryption / Encoding',
  'GOST Key Wrap': 'Encryption / Encoding',
  'GOST Key Unwrap': 'Encryption / Encoding',
  'GOST Sign': 'Public Key',
  'GOST Verify': 'Public Key',
  'SM2 Encrypt': 'Public Key',
  'SM2 Decrypt': 'Public Key',
  'Parse X.509 CRL': 'Public Key',
  'JA4 Fingerprint': 'Networking',
  'JA4Server Fingerprint': 'Networking',
  'Bzip2 Compress': 'Compression',
  'LZMA Compress': 'Compression',
  'LZMA Decompress': 'Compression',
  'XPRESS Decompress': 'Compression',
  'XPRESS LZ77+Huffman Decompress': 'Compression',
  'Disassemble x86': 'Code tidy',
  'Disassemble ARM': 'Code tidy',
  'JavaScript Parser': 'Code tidy',
  'Syntax highlighter': 'Code tidy',
  'Jsonata Query': 'Code tidy',
  'Microsoft Script Decoder': 'Code tidy',
  'Extract Audio Metadata': 'Forensics',
  'P-list Viewer': 'Forensics',
  'YARA Rules': 'Forensics',
  Numberwang: 'Other',
  'XKCD Random Number': 'Other',
};

const kindOf = (type: string): DataKind => (type === 'ArrayBuffer' || type === 'byteArray' ? 'bytes' : 'text');

/** Argument keys: the argument's name as a slug, numbered when two share one. */
function keysFor(args: readonly MetaArg[]): string[] {
  const used = new Map<string, number>();
  return args.map((arg, i) => {
    const base = slug(String(arg.name ?? `arg${i}`)) || `arg${i}`;
    const n = used.get(base) ?? 0;
    used.set(base, n + 1);
    return n ? `${base}${n + 1}` : base;
  });
}

const optionName = (value: unknown): string => (typeof value === 'object' && value !== null && 'name' in value ? String((value as { name: unknown }).name) : String(value));

/** Benchtop argument definitions for CyberChef's argument list. */
function convertArgs(meta: Meta): ArgDef[] {
  const keys = keysFor(meta.args);
  // Argument selectors show or hide other arguments by index.
  const rules: { selector: string; options: readonly { name: string; on?: readonly number[]; off?: readonly number[] }[] }[] = [];
  meta.args.forEach((arg, i) => {
    if (arg.type === 'argSelector') rules.push({ selector: keys[i] as string, options: (arg.value as unknown as { name: string; on?: number[]; off?: number[] }[]) ?? [] });
  });
  const showIf = (index: number) => {
    const relevant = rules.filter((r) => r.options.some((o) => o.on?.includes(index) || o.off?.includes(index)));
    if (!relevant.length) return undefined;
    return (args: Args) =>
      relevant.every((r) => {
        const chosen = r.options.find((o) => o.name === args[r.selector]) ?? r.options[0];
        return !chosen?.off?.includes(index);
      });
  };
  return meta.args.flatMap((arg, i): ArgDef[] => {
    const key = keys[i] as string;
    const label = String(arg.name ?? key);
    const extra = { showIf: showIf(i) };
    const value = arg.value as unknown;
    switch (arg.type) {
      case 'label':
        // Kept (hidden) so CyberChef recipes' positional argument lists still line up.
        return [{ key, label, type: 'string', default: '', showIf: () => false }];
      case 'boolean':
        return [{ key, label, type: 'boolean', default: value === true, ...extra }];
      case 'number':
        return [{ key, label, type: 'number', default: Number(value ?? 0), min: arg.min as number | undefined, max: arg.max as number | undefined, step: arg.step as number | undefined, ...extra }];
      case 'option':
      case 'argSelector':
      case 'populateMultiOption': {
        const choices = Array.isArray(value) ? value.map(optionName) : [String(value ?? '')];
        return [{ key, label, type: 'select', choices, default: choices[0] ?? '', ...extra }];
      }
      case 'editableOption':
      case 'editableOptionShort': {
        const list = Array.isArray(value) ? (value as { name: string; value: string }[]) : [];
        return [{ key, label, type: 'editable', choices: list.map((o) => ({ label: String(o.name), value: String(o.value) })), default: String(list[0]?.value ?? ''), ...extra }];
      }
      case 'toggleString': {
        const formats = (arg.toggleValues as readonly string[] | undefined) ?? ['UTF8', 'Hex'];
        return [{ key, label, type: 'keyed', default: String(value ?? ''), formats, format: formats[0] ?? 'UTF8', ...extra }];
      }
      case 'text':
        return [{ key, label, type: 'text', default: String(value ?? ''), ...extra }];
      default:
        return [{ key, label, type: 'string', default: String(value ?? ''), ...extra }];
    }
  });
}

/** CyberChef's positional argument values from Benchtop's named ones. */
function positional(meta: Meta, args: Args): unknown[] {
  const keys = keysFor(meta.args);
  return meta.args.map((arg, i) => {
    const key = keys[i] as string;
    const value = args[key];
    switch (arg.type) {
      case 'label':
        return undefined;
      case 'toggleString':
        return { string: String(value ?? ''), option: String(args[`${key}.format`] ?? (arg.toggleValues as readonly string[] | undefined)?.[0] ?? 'UTF8') };
      case 'number':
        return Number(value);
      case 'boolean':
        return value === true || value === 'true';
      default:
        return value === undefined ? '' : String(value);
    }
  });
}

function inputFor(meta: Meta, input: Dish): unknown {
  switch (meta.inputType) {
    case 'ArrayBuffer': {
      const bytes = toBytes(input);
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    }
    case 'byteArray':
      return Array.from(toBytes(input));
    case 'JSON': {
      const text = toText(input).trim();
      try {
        return text ? JSON.parse(text) : {};
      } catch (error) {
        throw new OpError(`${meta.name} expects JSON: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    case 'number':
    case 'Number':
      return Number(toText(input));
    default:
      return toText(input);
  }
}

function outputFrom(meta: Meta, out: unknown): Dish {
  if (out instanceof ArrayBuffer) return new Uint8Array(out);
  if (ArrayBuffer.isView(out)) return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
  if (meta.outputType === 'byteArray' && Array.isArray(out)) return Uint8Array.from(out as number[]);
  if (meta.outputType === 'JSON') return JSON.stringify(out, null, 4);
  return typeof out === 'string' ? out : String(out ?? '');
}

function port(meta: Meta): Operation {
  return defineOp({
    name: meta.name,
    category: CATEGORY_OF[meta.name] ?? 'Other',
    description: `${meta.description}${meta.infoURL ? `\n\nMore: ${meta.infoURL}` : ''}\n\nRuns CyberChef’s own code for this operation.`,
    input: kindOf(meta.inputType),
    output: kindOf(meta.outputType === 'html' ? 'string' : meta.outputType),
    args: convertArgs(meta),
    run: async (input: Dish, args: Args): Promise<Dish | OpResult> => {
      const loading = load(meta.file);
      if (!loading) throw new OpError(`${meta.name} runs in the recipe worker only.`);
      const { default: Op } = await loading;
      const op = new Op();
      const list = positional(meta, args);
      let out: unknown;
      try {
        out = await op.run(inputFor(meta, input), list);
      } catch (error) {
        throw new OpError(error instanceof Error ? error.message : String(error));
      }
      const value = outputFrom(meta, out);
      if (meta.outputType === 'html' || meta.presentType === 'html') {
        const html = meta.present ? String(await op.present(out, list)) : String(out ?? '');
        return { value: meta.outputType === 'html' ? html.replace(/<[^>]+>/g, '') : value, preview: { kind: 'html', html } };
      }
      return value;
    },
  } as never);
}

export const cyberchefPortOps: Operation[] = CYBERCHEF_PORT.filter((meta) => meta.name).map(port);
