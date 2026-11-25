/**
 * Git Workbench in the desktop shell (git.rs): reads a repository with the git
 * installed on this computer.  A repository is named by the token of the folder
 * picked in the system dialog.
 */
import { invoke } from '@tauri-apps/api/core';

export interface GitCommit {
  readonly hash: string;
  readonly parents: readonly string[];
  readonly author: string;
  readonly email: string;
  readonly time: number;
  readonly refs: readonly string[];
  readonly subject: string;
}

export interface RepoInfo {
  readonly path: string;
  readonly branch: string;
  readonly head: string;
  readonly version: string;
  readonly merging: boolean;
  readonly conflicts: number;
}

export interface GitReference {
  readonly kind: 'branch' | 'tag' | 'remote';
  readonly name: string;
  readonly hash: string;
  readonly current: boolean;
  readonly upstream: string;
  readonly time: number;
  readonly subject: string;
}

export interface ChangedFile {
  readonly status: string;
  readonly path: string;
  readonly from: string;
  readonly added: number;
  readonly removed: number;
}

export interface CommitDetail {
  readonly commit: GitCommit;
  readonly committer: string;
  readonly commitTime: number;
  readonly message: string;
  readonly files: readonly ChangedFile[];
}

export interface Comparison {
  readonly onlyFirst: number;
  readonly onlySecond: number;
  readonly mergeBase: string;
  readonly files: readonly ChangedFile[];
}

export interface ConflictedFile {
  readonly path: string;
  readonly base: boolean;
  readonly ours: boolean;
  readonly theirs: boolean;
}

export interface ConflictSides {
  readonly base: string | null;
  readonly ours: string | null;
  readonly theirs: string | null;
  readonly current: string | null;
}

export interface LogOptions {
  readonly rev?: string;
  readonly limit?: number;
  readonly skip?: number;
  readonly path?: string;
  readonly search?: string;
}

export const gitOpen = (token: string): Promise<RepoInfo> => invoke<RepoInfo>('git_open', { token });
export const gitRefs = (token: string): Promise<GitReference[]> => invoke<GitReference[]>('git_refs', { token });
export const gitLog = (token: string, options: LogOptions): Promise<GitCommit[]> => invoke<GitCommit[]>('git_log', { token, options });
export const gitCommit = (token: string, hash: string): Promise<CommitDetail> => invoke<CommitDetail>('git_commit', { token, hash });
/** With `from` empty: the changes of commit `to` against its first parent. */
export const gitDiff = (token: string, from: string, to: string, path: string, context = 3): Promise<string> => invoke<string>('git_diff', { token, from, to, path, context });
export const gitCompare = (token: string, first: string, second: string): Promise<Comparison> => invoke<Comparison>('git_compare', { token, first, second });
export const gitConflicts = (token: string): Promise<ConflictedFile[]> => invoke<ConflictedFile[]>('git_conflicts', { token });
export const gitConflictSides = (token: string, path: string): Promise<ConflictSides> => invoke<ConflictSides>('git_conflict_sides', { token, path });
export const gitResolve = (token: string, path: string, content: string): Promise<void> => invoke<void>('git_resolve', { token, path, content });
