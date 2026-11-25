/**
 * The Code Runner's desktop side (coderun.rs): which compilers and
 * interpreters are installed, and running a program with them.
 */
import { invoke } from '@tauri-apps/api/core';
import { isDesktop } from './index';

export interface Toolchain {
  readonly id: string;
  readonly program: string | null;
  /** A second program the language needs, when it is missing (java for javac). */
  readonly missingRunner: string | null;
}

export interface NativeRun {
  readonly program: string;
  readonly compileOutput: string;
  readonly compiled: boolean;
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
  readonly timedOut: boolean;
  readonly truncated: boolean;
  readonly compileMs: number;
  readonly runMs: number;
}

export async function toolchains(): Promise<readonly Toolchain[]> {
  if (!isDesktop) return [];
  return invoke<Toolchain[]>('code_toolchains');
}

export async function toolchainVersion(language: string): Promise<string> {
  return invoke<string>('code_version', { language });
}

export async function runNative(language: string, source: string, stdin: string, args: readonly string[], timeoutMs: number): Promise<NativeRun> {
  return invoke<NativeRun>('code_run', { request: { language, source, stdin, args, timeoutMs } });
}
