/**
 * Reading unified diffs: `git diff`, `git format-patch` mails (one or several
 * commits), `diff -u` output and pull-request .diff files.
 */
import type { DiffRow } from '../tools/types';

export type FileStatus = 'modified' | 'added' | 'deleted' | 'renamed' | 'copied' | 'binary' | 'mode';

export interface HunkLine {
  readonly type: 'same' | 'add' | 'del';
  readonly text: string;
  readonly old?: number;
  readonly new?: number;
}

export interface Hunk {
  readonly header: string;
  readonly oldStart: number;
  readonly newStart: number;
  readonly lines: HunkLine[];
}

export interface PatchFile {
  readonly oldPath: string;
  readonly newPath: string;
  status: FileStatus;
  readonly hunks: Hunk[];
  additions: number;
  deletions: number;
  /** "old mode 100644" style notes, similarity and binary markers. */
  readonly notes: string[];
}

export interface Commit {
  readonly hash: string;
  readonly author: string;
  readonly date: string;
  readonly subject: string;
  readonly message: string;
  readonly files: PatchFile[];
}

const stripPrefix = (path: string) =>
  path === '/dev/null'
    ? path
    : path
        .replace(/^"?[ab]\//, '')
        .replace(/"$/, '')
        .replace(/\t.*$/, '');

/** Splits a patch into commits (format-patch mails) and the files each changes. */
export function parsePatch(text: string): Commit[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const commits: Commit[] = [];
  let commit: Commit | null = null;
  let file: PatchFile | null = null;
  let hunk: Hunk | null = null;
  let oldLine = 0;
  let newLine = 0;
  // Lines still to come in the current hunk, from its header (blank context
  // lines often lose their leading space when patches are copied around).
  let oldLeft = 0;
  let newLeft = 0;
  let inMessage = false;
  const startCommit = (hash = '') => {
    commit = { hash, author: '', date: '', subject: '', message: '', files: [] };
    commits.push(commit);
    file = null;
    hunk = null;
    inMessage = false;
  };
  const current = (): Commit => {
    if (!commit) startCommit();
    return commit as unknown as Commit;
  };
  const startFile = (oldPath: string, newPath: string) => {
    const owner = current();
    file = { oldPath, newPath, status: 'modified', hunks: [], additions: 0, deletions: 0, notes: [] };
    owner.files.push(file);
    hunk = null;
    inMessage = false;
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    const from = /^From ([0-9a-f]{7,40}) /.exec(line);
    if (from && (!hunk || line.startsWith('From '))) {
      startCommit(from[1]);
      continue;
    }
    const c = commit as Commit | null;
    if (c && !file && !hunk) {
      const header = /^(From|Date|Subject):\s*(.*)$/.exec(line);
      if (header && !inMessage) {
        const value = header[2] as string;
        let full = value;
        while ((lines[i + 1] ?? '').startsWith(' ')) full += ` ${(lines[++i] as string).trim()}`;
        if (header[1] === 'From') (c as { author: string }).author = full;
        else if (header[1] === 'Date') (c as { date: string }).date = full;
        else (c as { subject: string }).subject = full.replace(/^\[PATCH[^\]]*\]\s*/, '');
        continue;
      }
      if (line === '' && c.subject && !inMessage) {
        inMessage = true;
        continue;
      }
      if (inMessage && line !== '---' && !line.startsWith('diff --git')) {
        (c as { message: string }).message += `${line}\n`;
        continue;
      }
      if (line === '---') {
        inMessage = false;
        continue;
      }
    }
    const git = /^diff --git (.+?) (.+)$/.exec(line);
    if (git) {
      startFile(stripPrefix(git[1] as string), stripPrefix(git[2] as string));
      continue;
    }
    const f = file as PatchFile | null;
    if (line.startsWith('--- ') && (lines[i + 1] ?? '').startsWith('+++ ')) {
      const oldPath = stripPrefix(line.slice(4));
      const newPath = stripPrefix((lines[i + 1] as string).slice(4));
      if (!f || f.hunks.length) startFile(oldPath === '/dev/null' ? newPath : oldPath, newPath === '/dev/null' ? oldPath : newPath);
      const target = file as unknown as PatchFile;
      if (oldPath === '/dev/null') target.status = 'added';
      if (newPath === '/dev/null') target.status = 'deleted';
      i++;
      continue;
    }
    if (f && !hunk) {
      if (line.startsWith('new file mode')) f.status = 'added';
      else if (line.startsWith('deleted file mode')) f.status = 'deleted';
      else if (line.startsWith('rename from') || line.startsWith('rename to')) f.status = 'renamed';
      else if (line.startsWith('copy from')) f.status = 'copied';
      else if (line.startsWith('Binary files') || line === 'GIT binary patch') {
        f.status = 'binary';
        f.notes.push(line);
      } else if (/^(old|new) mode /.test(line)) {
        if (f.status === 'modified') f.status = 'mode';
        f.notes.push(line);
      } else if (line.startsWith('similarity index')) f.notes.push(line);
    }
    const h = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/.exec(line);
    if (h && file) {
      oldLine = Number(h[1]);
      newLine = Number(h[3]);
      oldLeft = h[2] === undefined ? 1 : Number(h[2]);
      newLeft = h[4] === undefined ? 1 : Number(h[4]);
      hunk = { header: line, oldStart: oldLine, newStart: newLine, lines: [] };
      (file as PatchFile).hunks.push(hunk);
      if ((file as PatchFile).status === 'mode') (file as PatchFile).status = 'modified';
      continue;
    }
    const hk = hunk as Hunk | null;
    if (hk && file) {
      const pf = file as PatchFile;
      const first = line.charAt(0);
      if (first === '\\') {
        // "\ No newline at end of file"
      } else if (first === '+' && newLeft > 0) {
        hk.lines.push({ type: 'add', text: line.slice(1), new: newLine++ });
        pf.additions++;
        newLeft--;
      } else if (first === '-' && oldLeft > 0) {
        hk.lines.push({ type: 'del', text: line.slice(1), old: oldLine++ });
        pf.deletions++;
        oldLeft--;
      } else if ((first === ' ' || line === '') && oldLeft > 0 && newLeft > 0) {
        hk.lines.push({ type: 'same', text: line.slice(1), old: oldLine++, new: newLine++ });
        oldLeft--;
        newLeft--;
      } else {
        hunk = null;
        if (line.startsWith('-- ') || line === '--') file = null;
      }
      if (hunk && oldLeft <= 0 && newLeft <= 0) hunk = null;
    }
  }
  return commits.filter((c) => c.files.length || c.subject);
}

/** Rows for the side-by-side view; a hunk header becomes an unnumbered line. */
export function fileRows(file: PatchFile): DiffRow[] {
  const rows: DiffRow[] = [];
  for (const h of file.hunks) {
    rows.push({ type: 'same', text: `⋯ ${h.header}` });
    for (const l of h.lines)
      rows.push(
        l.type === 'add' ? { type: 'add', right: l.new, text: l.text } : l.type === 'del' ? { type: 'del', left: l.old, text: l.text } : { type: 'same', left: l.old, right: l.new, text: l.text },
      );
  }
  return rows;
}

export function patchStats(commits: readonly Commit[]): { files: number; additions: number; deletions: number } {
  const files = commits.flatMap((c) => c.files);
  return { files: files.length, additions: files.reduce((s, f) => s + f.additions, 0), deletions: files.reduce((s, f) => s + f.deletions, 0) };
}
