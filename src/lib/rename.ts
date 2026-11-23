/**
 * Bulk rename rules: a name template with fields, find and replace (plain or
 * regular expression), letter case, spaces and the extension.  Pure functions,
 * so the preview updates as the rules change; the desktop side does the renaming.
 */

export interface RenameFile {
  /** Path inside the chosen folder, with "/" separators. */
  readonly path: string;
  readonly size: number;
  /** Last change, in milliseconds since 1970. */
  readonly modified: number;
}

export type CaseRule = 'keep' | 'lower' | 'upper' | 'title' | 'sentence';
export type SpaceRule = 'keep' | 'dash' | 'underscore' | 'remove';
export type ExtRule = 'keep' | 'lower' | 'upper' | 'set' | 'remove';
export type SortRule = 'name' | 'modified' | 'size' | 'list';

export interface RenameRules {
  /** "{name}" keeps the name; fields: {name} {ext} {n} {n:3} {date} {date:YYYYMMDD} {time} {folder} {size} {original}. */
  readonly template: string;
  readonly find: string;
  readonly replace: string;
  readonly regex: boolean;
  readonly matchCase: boolean;
  readonly caseRule: CaseRule;
  readonly spaces: SpaceRule;
  readonly ext: ExtRule;
  readonly newExt: string;
  readonly start: number;
  readonly step: number;
  readonly sort: SortRule;
  /** Tidy: collapse repeated spaces, dashes and underscores; trim them from the ends. */
  readonly tidy: boolean;
}

export const DEFAULT_RULES: RenameRules = {
  template: '{name}',
  find: '',
  replace: '',
  regex: false,
  matchCase: false,
  caseRule: 'keep',
  spaces: 'keep',
  ext: 'keep',
  newExt: '',
  start: 1,
  step: 1,
  sort: 'list',
  tidy: true,
};

export interface Planned {
  readonly from: string;
  readonly to: string;
  /** Why this name cannot be used, if it cannot. */
  readonly problem?: string;
}

export function splitName(path: string): { dir: string; stem: string; ext: string } {
  const slash = path.lastIndexOf('/');
  const dir = slash >= 0 ? path.slice(0, slash + 1) : '';
  const file = path.slice(slash + 1);
  const dot = file.lastIndexOf('.');
  // ".bashrc" has no extension; "archive.tar.gz" keeps "gz".
  return dot > 0 ? { dir, stem: file.slice(0, dot), ext: file.slice(dot + 1) } : { dir, stem: file, ext: '' };
}

const pad = (n: number, width: number) => (n < 0 ? `-${String(-n).padStart(width, '0')}` : String(n).padStart(width, '0'));

export function formatDate(ms: number, pattern: string): string {
  const d = new Date(ms);
  const parts: Record<string, string> = {
    YYYY: String(d.getFullYear()),
    YY: String(d.getFullYear()).slice(-2),
    MM: pad(d.getMonth() + 1, 2),
    DD: pad(d.getDate(), 2),
    hh: pad(d.getHours(), 2),
    mm: pad(d.getMinutes(), 2),
    ss: pad(d.getSeconds(), 2),
  };
  return pattern.replace(/YYYY|YY|MM|DD|hh|mm|ss/g, (t) => parts[t] as string);
}

const titleCase = (s: string) => s.toLowerCase().replace(/(^|[\s\-_(.[])(\p{L})/gu, (_, a: string, b: string) => a + b.toUpperCase());
const sentenceCase = (s: string) => {
  const lower = s.toLowerCase();
  const i = lower.search(/\p{L}/u);
  return i < 0 ? lower : lower.slice(0, i) + lower.charAt(i).toUpperCase() + lower.slice(i + 1);
};

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  const units = ['KB', 'MB', 'GB'];
  let v = bytes / 1024;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)}${units[u]}`;
}

/** Checks that a regular expression can be used; returns the error message or null. */
export function regexProblem(rules: Pick<RenameRules, 'find' | 'regex' | 'matchCase'>): string | null {
  if (!rules.regex || !rules.find) return null;
  try {
    new RegExp(rules.find, rules.matchCase ? 'gu' : 'giu');
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const invalid = (s: string) => [...s].some((ch) => ch.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(ch));

/** The new name of each file, in the order given; numbering follows `rules.sort`. */
export function planRenames(files: readonly RenameFile[], rules: RenameRules): Planned[] {
  const order = [...files.keys()];
  if (rules.sort === 'name') order.sort((a, b) => (files[a] as RenameFile).path.localeCompare((files[b] as RenameFile).path, undefined, { numeric: true }));
  else if (rules.sort === 'modified') order.sort((a, b) => (files[a] as RenameFile).modified - (files[b] as RenameFile).modified);
  else if (rules.sort === 'size') order.sort((a, b) => (files[a] as RenameFile).size - (files[b] as RenameFile).size);
  const number = new Map<number, number>();
  for (const [position, index] of order.entries()) number.set(index, rules.start + position * rules.step);
  const finder = rules.find ? (regexProblem(rules) ? null : new RegExp(rules.regex ? rules.find : escapeRegExp(rules.find), rules.matchCase ? 'gu' : 'giu')) : null;

  const planned = files.map((file, index): Planned => {
    const { dir, stem, ext } = splitName(file.path);
    const folder = dir.split('/').filter(Boolean).pop() ?? '';
    const n = number.get(index) ?? index + 1;
    let name = (rules.template || '{name}').replace(/\{(\w+)(?::([^}]*))?\}/g, (whole, field: string, arg: string | undefined) => {
      switch (field) {
        case 'name':
          return stem;
        case 'ext':
          return ext;
        case 'original':
          return ext ? `${stem}.${ext}` : stem;
        case 'n':
          return pad(n, Number(arg) || 1);
        case 'date':
          return formatDate(file.modified, arg || 'YYYY-MM-DD');
        case 'time':
          return formatDate(file.modified, arg || 'hh-mm-ss');
        case 'folder':
          return folder;
        case 'size':
          return humanSize(file.size);
        default:
          return whole;
      }
    });
    if (finder) name = name.replace(finder, rules.replace);
    if (rules.caseRule === 'lower') name = name.toLowerCase();
    else if (rules.caseRule === 'upper') name = name.toUpperCase();
    else if (rules.caseRule === 'title') name = titleCase(name);
    else if (rules.caseRule === 'sentence') name = sentenceCase(name);
    if (rules.spaces === 'dash') name = name.replace(/\s+/g, '-');
    else if (rules.spaces === 'underscore') name = name.replace(/\s+/g, '_');
    else if (rules.spaces === 'remove') name = name.replace(/\s+/g, '');
    if (rules.tidy)
      name = name
        .replace(/ {2,}/g, ' ')
        .replace(/-{2,}/g, '-')
        .replace(/_{2,}/g, '_')
        .replace(/^[\s\-_]+|[\s\-_.]+$/g, '');
    let newExt = ext;
    if (rules.ext === 'lower') newExt = ext.toLowerCase();
    else if (rules.ext === 'upper') newExt = ext.toUpperCase();
    else if (rules.ext === 'set') newExt = rules.newExt.replace(/^\.+/, '');
    else if (rules.ext === 'remove') newExt = '';
    const to = `${dir}${name}${newExt ? `.${newExt}` : ''}`;
    let problem: string | undefined;
    if (!name.trim()) problem = 'The new name is empty.';
    else if (invalid(name) || invalid(newExt)) problem = 'Names cannot contain \\ / : * ? " < > |';
    else if (name.length + newExt.length > 240) problem = 'The name is too long.';
    return problem ? { from: file.path, to, problem } : { from: file.path, to };
  });

  // Two files may not end up with one name (letters' case aside, for Windows and macOS).
  const counts = new Map<string, number>();
  for (const p of planned) counts.set(p.to.toLowerCase(), (counts.get(p.to.toLowerCase()) ?? 0) + 1);
  return planned.map((p) => (!p.problem && (counts.get(p.to.toLowerCase()) ?? 0) > 1 ? { ...p, problem: 'Another file would get the same name.' } : p));
}

/** Names that would clash with files that stay as they are. */
export function clashes(planned: readonly Planned[], allPaths: readonly string[]): Planned[] {
  const moving = new Set(planned.filter((p) => p.from !== p.to).map((p) => p.from.toLowerCase()));
  const staying = new Set(allPaths.map((p) => p.toLowerCase()).filter((p) => !moving.has(p)));
  return planned.map((p) => (!p.problem && p.from !== p.to && staying.has(p.to.toLowerCase()) ? { ...p, problem: 'A file with this name is already there.' } : p));
}
