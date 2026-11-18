/**
 * Runs a recipe: a list of operations applied in order, with CyberChef's flow
 * control (Fork, Subsection, Merge, Register, Label, Jump, Conditional Jump,
 * Return, Comment) and Magic.
 */
import { type Args, bArg, type Dish, nArg, type OpContext, type Operation, type Preview, sArg, toBytes, toText, unescapeShort, userRegex } from './core';
import { type Catalog, type MagicSuggestion, magic, renderSuggestions } from './magic';

export interface Step {
  readonly op: string;
  readonly args: Args;
  readonly disabled?: boolean;
  readonly breakpoint?: boolean;
}

export interface BakeOutcome {
  readonly value: Dish;
  readonly preview?: Preview;
  /** Index of the step that failed and why. */
  readonly error?: { readonly step: number; readonly message: string };
  /** Index of the breakpoint the recipe stopped at. */
  readonly paused?: number;
  readonly suggestions?: readonly MagicSuggestion[];
  readonly ms: number;
}

export type { Catalog } from './magic';

class StepError extends Error {
  constructor(
    readonly step: number,
    message: string,
  ) {
    super(message);
  }
}

interface State {
  readonly catalog: Catalog;
  readonly steps: readonly Step[];
  registers: string[];
  readonly jumps: Map<number, number>;
  suggestions?: MagicSuggestion[];
  /** Breakpoints only apply to the top level, not inside Fork or Subsection. */
  readonly top: boolean;
  budget: { ops: number };
}

interface Partial_ {
  dish: Dish;
  preview?: Preview;
  paused?: number;
  returned?: boolean;
}

const MAX_OPS = 200_000;

/** Replaces $R0, $R1… with captured registers; \$R0 stays literal. */
export function substitute(args: Args, registers: readonly string[]): Args {
  if (registers.length === 0) return args;
  const out: Args = {};
  for (const [key, value] of Object.entries(args)) {
    out[key] =
      typeof value === 'string' ? value.replace(/(\\)?\$R(\d{1,2})/g, (match, slash: string | undefined, index: string) => (slash ? match.slice(1) : (registers[Number(index)] ?? match))) : value;
  }
  return out;
}

/** Index of the Merge closing the block that starts at `from`, or the end of the recipe. */
function blockEnd(state: State, from: number, to: number): number {
  let depth = 1;
  for (let i = from; i < to; i++) {
    const step = state.steps[i] as Step;
    if (step.disabled) continue;
    const flow = state.catalog.get(step.op)?.flow;
    if (flow === 'fork' || flow === 'subsection') depth++;
    else if (flow === 'merge') {
      depth--;
      if (depth === 0 || bArg(step.args, 'all')) return i;
    }
  }
  return to;
}

function findLabel(state: State, name: string): number {
  return state.steps.findIndex((step) => !step.disabled && state.catalog.get(step.op)?.flow === 'label' && sArg(step.args, 'name') === name);
}

async function runOp(op: Operation, dish: Dish, args: Args, ctx: OpContext): Promise<{ dish: Dish; preview?: Preview }> {
  const input = op.input === 'text' ? toText(dish) : toBytes(dish);
  const result = await op.run(input as never, args, ctx);
  if (typeof result === 'string' || result instanceof Uint8Array) return { dish: result };
  return { dish: result.value, preview: result.preview };
}

async function execute(state: State, start: Dish, from: number, to: number): Promise<Partial_> {
  let dish = start;
  let preview: Preview | undefined;
  let i = from;
  while (i < to) {
    const step = state.steps[i] as Step;
    if (step.breakpoint && state.top && !step.disabled) return { dish, preview, paused: i };
    if (step.disabled) {
      i++;
      continue;
    }
    if (++state.budget.ops > MAX_OPS) throw new StepError(i, 'The recipe ran too many operations (check Jump loops).');
    const op = state.catalog.get(step.op);
    if (!op) throw new StepError(i, `Unknown operation "${step.op}".`);
    const args = substitute(step.args, state.registers);
    try {
      switch (op.flow) {
        case 'comment':
        case 'label':
        case 'merge':
          i++;
          continue;
        case 'return':
          return { dish, preview, returned: true };
        case 'jump':
        case 'cjump': {
          let take = true;
          if (op.flow === 'cjump') {
            const pattern = sArg(args, 'match');
            const matched = pattern === '' ? false : userRegex(pattern, '').test(toText(dish));
            take = bArg(args, 'invert') ? !matched : matched;
          }
          const target = findLabel(state, sArg(args, 'label'));
          if (target === -1) throw new Error(`There is no Label named "${sArg(args, 'label')}".`);
          const count = state.jumps.get(i) ?? 0;
          if (take && count < Math.max(0, nArg(args, 'max'))) {
            state.jumps.set(i, count + 1);
            i = target + 1;
          } else {
            i++;
          }
          continue;
        }
        case 'register': {
          const flags = `${bArg(args, 'caseInsensitive') ? 'i' : ''}${bArg(args, 'multiline') ? 'm' : ''}${bArg(args, 'dotAll') ? 's' : ''}`;
          const match = userRegex(sArg(args, 'extractor'), flags).exec(toText(dish));
          if (match) state.registers = [...state.registers, ...match.slice(1).map((group) => group ?? '')];
          i++;
          continue;
        }
        case 'fork': {
          const end = blockEnd(state, i + 1, to);
          const parts = toText(dish).split(unescapeShort(sArg(args, 'split')));
          const results: string[] = [];
          for (const part of parts) {
            try {
              const branch = await execute({ ...state, top: false, registers: [...state.registers] }, part, i + 1, end);
              results.push(toText(branch.dish));
            } catch (error) {
              if (!bArg(args, 'ignoreErrors')) throw error;
            }
          }
          dish = results.join(unescapeShort(sArg(args, 'merge')));
          preview = undefined;
          i = end + 1;
          continue;
        }
        case 'subsection': {
          const end = blockEnd(state, i + 1, to);
          const text = toText(dish);
          const flags = `${bArg(args, 'caseSensitive') ? '' : 'i'}${bArg(args, 'global') ? 'g' : ''}`;
          const pattern = sArg(args, 'section');
          if (pattern === '') {
            i++;
            continue;
          }
          const regex = userRegex(pattern, flags);
          let output = '';
          let offset = 0;
          let matched = false;
          for (let match = regex.exec(text); match; match = regex.global ? regex.exec(text) : null) {
            matched = true;
            let piece = match[0];
            if (match.length >= 2 && match[1] !== undefined) {
              piece = match[1];
              const at = match.index + match[0].indexOf(piece);
              output += text.slice(offset, at);
              offset = at + piece.length;
            } else {
              output += text.slice(offset, match.index);
              offset = match.index + match[0].length;
            }
            try {
              const branch = await execute({ ...state, top: false, registers: [...state.registers] }, piece, i + 1, end);
              output += toText(branch.dish);
            } catch (error) {
              if (!bArg(args, 'ignoreErrors')) throw error;
              output += piece;
            }
            if (match[0] === '') regex.lastIndex++;
          }
          if (matched) dish = output + text.slice(offset);
          preview = undefined;
          i = end + 1;
          continue;
        }
        case 'magic': {
          const suggestions = await magic(toBytes(dish), args, state.catalog);
          state.suggestions = suggestions;
          dish = renderSuggestions(suggestions, state.catalog);
          preview = undefined;
          i++;
          continue;
        }
        default: {
          const result = await runOp(op, dish, args, { registers: state.registers });
          dish = result.dish;
          preview = result.preview;
          i++;
        }
      }
    } catch (error) {
      if (error instanceof StepError) throw error;
      throw new StepError(i, error instanceof Error ? error.message : String(error));
    }
  }
  return { dish, preview };
}

export async function bake(input: Dish, steps: readonly Step[], catalog: Catalog): Promise<BakeOutcome> {
  const started = performance.now();
  const state: State = { catalog, steps, registers: [], jumps: new Map(), top: true, budget: { ops: 0 } };
  try {
    const result = await execute(state, input, 0, steps.length);
    return { value: result.dish, preview: result.preview, paused: result.paused, suggestions: state.suggestions, ms: performance.now() - started };
  } catch (error) {
    const step = error instanceof StepError ? error.step : -1;
    return { value: '', error: { step, message: error instanceof Error ? error.message : String(error) }, suggestions: state.suggestions, ms: performance.now() - started };
  }
}

/** Runs a single operation outside a recipe (used by Magic and the tests). */
export async function apply(op: Operation, input: Dish, args: Args): Promise<Dish> {
  return (await runOp(op, input, args, { registers: [] })).dish;
}
