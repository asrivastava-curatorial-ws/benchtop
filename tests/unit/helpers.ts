import { defaultsOf } from '../../src/tools/options';
import type { BinaryFile, TextResult, TextToolSpec } from '../../src/tools/types';

interface RunExtras {
  input2?: string;
  file?: BinaryFile | null;
  nonce?: number;
}

/** Runs a text tool exactly as the app does: defaults merged with overrides. */
export async function run(
  // biome-ignore lint/suspicious/noExplicitAny: accepts every tool spec
  spec: TextToolSpec<any>,
  input: string,
  values: Record<string, unknown> = {},
  extras: RunExtras = {},
): Promise<TextResult> {
  const merged = { ...defaultsOf(spec.options), ...values };
  const result = await spec.run(input, merged, { input2: extras.input2 ?? '', file: extras.file ?? null, nonce: extras.nonce ?? 0 });
  return typeof result === 'string' ? { output: result } : result;
}

/** Convenience wrapper returning only the main output text. */
export async function out(
  // biome-ignore lint/suspicious/noExplicitAny: accepts every tool spec
  spec: TextToolSpec<any>,
  input: string,
  values: Record<string, unknown> = {},
  extras: RunExtras = {},
): Promise<string> {
  return (await run(spec, input, values, extras)).output ?? '';
}

export function field(result: TextResult, label: string): string {
  const found = result.fields?.find((item) => item.label === label || item.label.startsWith(label));
  if (!found) throw new Error(`No field labelled "${label}" in: ${result.fields?.map((item) => item.label).join(', ')}`);
  return found.value;
}

export const bytesOf = (text: string): Uint8Array => new TextEncoder().encode(text);

export function fileOf(name: string, bytes: Uint8Array, mime = ''): BinaryFile {
  return { name, mime, bytes };
}
