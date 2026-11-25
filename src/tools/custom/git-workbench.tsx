/**
 * Git Workbench: browse a repository's commits with their graph and diffs,
 * compare two branches, merge three versions of a text, and resolve merge
 * conflicts.  The three-way merge works anywhere; the repository views use the
 * git installed on this computer (desktop app).
 */
import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { type Choice, type Chunk, conflictsIn, type DiffLine, type GraphRow, graphRows, linesOf, merge3, mergedText, parseUnifiedDiff, resolved } from '../../lib/merge3';
import { copyText, isDesktop, pickFile, readTextFile, saveFile } from '../../platform';
import { pickFolder } from '../../platform/convert';
import {
  type ChangedFile,
  type CommitDetail,
  type Comparison,
  type ConflictedFile,
  type GitCommit,
  type GitReference,
  gitCommit,
  gitCompare,
  gitConflictSides,
  gitConflicts,
  gitDiff,
  gitLog,
  gitOpen,
  gitRefs,
  gitResolve,
  type RepoInfo,
} from '../../platform/git';
import { scrollRegion } from '../../ui/a11y';
import { Icon } from '../../ui/icons';
import { attempt, notify } from '../../ui/toast';
import { defineCustomTool } from '../types';
import { Segmented } from './_shared';

type Tab = 'merge' | 'history' | 'compare' | 'conflicts';

const TABS: readonly { value: Tab; label: string }[] = [
  { value: 'history', label: 'History' },
  { value: 'compare', label: 'Compare' },
  { value: 'conflicts', label: 'Conflicts' },
  { value: 'merge', label: 'Three-way merge' },
];

const SAMPLE_BASE = [
  'Engine Hall',
  'Open daily, 10 to 5.',
  'Entry is free.',
  '',
  'The beam engine runs at noon.',
  'Please do not touch the flywheel.',
  '',
  'Photography is welcome.',
  'The shop is by the exit.',
];
const withLines = (changes: Record<number, string>, extra: string[] = []) => `${[...SAMPLE_BASE.map((line, index) => changes[index] ?? line), ...extra].join('\n')}\n`;
const SAMPLE = {
  base: withLines({}),
  ours: withLines({ 1: 'Open every day, 10 to 6.', 5: 'Please keep clear of the flywheel.' }, ['Guided tours start at the entrance.']),
  theirs: withLines({ 1: 'Open on weekdays, 10 to 5.', 5: 'Do not touch the flywheel.', 7: 'Photography without flash is welcome.' }),
};

const when = (seconds: number) => new Date(seconds * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

const STATUS: Readonly<Record<string, string>> = { A: 'added', M: 'changed', D: 'deleted', R: 'renamed', C: 'copied', T: 'type changed' };

/* ----------------------------------------------------------------- pieces -- */

function DiffView({ text }: { text: string }) {
  const lines = useMemo(() => parseUnifiedDiff(text), [text]);
  const shown = lines.slice(0, 6000);
  if (!lines.length) return <p class="tone-muted">No differences in text (the file may be binary, or only its mode changed).</p>;
  return (
    <div class="gw-diff" {...scrollRegion('Differences')} data-testid="gw-diff">
      <table>
        <tbody>
          {shown.map((line: DiffLine, index) => (
            <tr key={index} class={`is-${line.kind}`}>
              <td class="gw-ln">{line.old ?? ''}</td>
              <td class="gw-ln">{line.new ?? ''}</td>
              <td class="gw-sign">{line.kind === 'add' ? '+' : line.kind === 'remove' ? '−' : ''}</td>
              <td class="gw-code">{line.text}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {lines.length > shown.length && <p class="tone-muted">Only the first {shown.length.toLocaleString()} lines are shown.</p>}
    </div>
  );
}

const LANE = 14;
const ROW = 28;
const COLOURS = ['#1f8a66', '#1f6fd0', '#b7861b', '#b3261e', '#7a4fc9', '#0e8a9a', '#c4572d'];

function GraphCell({ row, width }: { row: GraphRow; width: number }) {
  const x = (lane: number) => lane * LANE + LANE / 2;
  const colour = (lane: number) => COLOURS[lane % COLOURS.length] as string;
  const mid = ROW / 2;
  return (
    <svg width={width * LANE} height={ROW} class="gw-graph" aria-hidden="true">
      {row.passing.map((lane) => (
        <line key={`p${lane}`} x1={x(lane)} y1={0} x2={x(lane)} y2={ROW} stroke={colour(lane)} stroke-width={2} />
      ))}
      {row.joins.map((lane) => (
        <path key={`j${lane}`} d={`M${x(lane)} 0 C${x(lane)} ${mid} ${x(row.lane)} 0 ${x(row.lane)} ${mid}`} fill="none" stroke={colour(lane)} stroke-width={2} />
      ))}
      {row.out.map((lane) => (
        <path key={`o${lane}`} d={`M${x(row.lane)} ${mid} C${x(row.lane)} ${ROW} ${x(lane)} ${mid} ${x(lane)} ${ROW}`} fill="none" stroke={colour(lane)} stroke-width={2} />
      ))}
      <circle cx={x(row.lane)} cy={mid} r={4} fill={colour(row.lane)} stroke="var(--panel)" stroke-width={1.5} />
    </svg>
  );
}

function Files({ files, chosen, onChoose }: { files: readonly ChangedFile[]; chosen: string; onChoose: (path: string) => void }) {
  return (
    <ul class="gw-files" data-testid="gw-files">
      {files.map((file) => (
        <li key={file.path}>
          <button type="button" class={`gw-file${chosen === file.path ? ' is-chosen' : ''}`} onClick={() => onChoose(file.path)}>
            <span class={`gw-status is-${file.status}`}>{STATUS[file.status] ?? file.status}</span>
            <span class="gw-path">
              {file.from ? `${file.from} → ` : ''}
              {file.path}
            </span>
            <span class="gw-count">{file.added < 0 ? 'binary' : `+${file.added} −${file.removed}`}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** The merge of three texts, with a decision for every conflict. */
function MergeEditor({
  base,
  ours,
  theirs,
  labels,
  actions,
}: {
  base: string;
  ours: string;
  theirs: string;
  labels: { ours: string; theirs: string; base: string };
  actions: (result: string, open: number) => ComponentChildren;
}) {
  const chunks = useMemo(() => merge3(linesOf(base), linesOf(ours), linesOf(theirs)), [base, ours, theirs]);
  const [decisions, setDecisions] = useState<ReadonlyMap<number, string[]>>(new Map());
  useEffect(() => setDecisions(new Map()), [chunks]);
  const total = conflictsIn(chunks);
  const open = total - decisions.size;
  const result = mergedText(chunks, decisions, labels);
  const decide = (index: number, lines: string[] | null) => {
    const next = new Map(decisions);
    if (lines) next.set(index, lines);
    else next.delete(index);
    setDecisions(next);
  };
  const fromOurs = chunks.filter((c) => c.kind === 'plain' && c.from === 'ours').length;
  const fromTheirs = chunks.filter((c) => c.kind === 'plain' && c.from === 'theirs').length;
  const CHOICES: readonly { id: Choice; label: string }[] = [
    { id: 'ours', label: `Take ${labels.ours}` },
    { id: 'theirs', label: `Take ${labels.theirs}` },
    { id: 'ours-theirs', label: `${labels.ours}, then ${labels.theirs}` },
    { id: 'theirs-ours', label: `${labels.theirs}, then ${labels.ours}` },
    { id: 'base', label: 'Keep the original' },
    { id: 'none', label: 'Take neither' },
  ];
  let number = 0;
  return (
    <div class="gw-merge">
      <p class="gw-summary" data-testid="gw-summary" role="status">
        {total === 0 ? 'The two sides merge cleanly. ' : `${total} ${total === 1 ? 'conflict' : 'conflicts'}, ${open} still to decide. `}
        <span class="tone-muted">
          Taken without asking: {fromOurs} {fromOurs === 1 ? 'change' : 'changes'} from {labels.ours}, {fromTheirs} from {labels.theirs}.
        </span>
      </p>
      <div class="gw-chunks">
        {chunks.map((chunk: Chunk, index) => {
          if (chunk.kind === 'plain') {
            const long = chunk.from === 'base' && chunk.lines.length > 8;
            const lines = long ? [...chunk.lines.slice(0, 3), `… ${chunk.lines.length - 6} lines nobody changed …\n`, ...chunk.lines.slice(-3)] : chunk.lines;
            return (
              <pre
                key={index}
                class={`gw-plain is-${chunk.from}`}
                title={chunk.from === 'base' ? undefined : chunk.from === 'both' ? 'Changed the same way on both sides' : `From ${labels[chunk.from]}`}
              >
                {lines.join('')}
              </pre>
            );
          }
          number += 1;
          const decided = decisions.get(index);
          return (
            <div key={index} class={`gw-conflict${decided ? ' is-decided' : ''}`} data-testid="gw-conflict">
              <strong>
                Conflict {number} of {total}
              </strong>
              <div class="gw-sides">
                <div>
                  <span class="control-label">{labels.ours}</span>
                  <pre class="is-ours">{chunk.ours.join('') || '(nothing here)'}</pre>
                </div>
                <div>
                  <span class="control-label">{labels.base}</span>
                  <pre>{chunk.base.join('') || '(nothing here)'}</pre>
                </div>
                <div>
                  <span class="control-label">{labels.theirs}</span>
                  <pre class="is-theirs">{chunk.theirs.join('') || '(nothing here)'}</pre>
                </div>
              </div>
              <div class="gw-choices">
                {CHOICES.map((choice) => (
                  <button type="button" class="button button-small" key={choice.id} onClick={() => decide(index, resolved(chunk, choice.id))} data-testid={`gw-take-${choice.id}`}>
                    {choice.label}
                  </button>
                ))}
                {decided && (
                  <button type="button" class="button button-small button-quiet" onClick={() => decide(index, null)}>
                    Undecide
                  </button>
                )}
              </div>
              {decided && (
                <label class="gw-field">
                  <span class="control-label">What goes into the result (edit it if neither side is right)</span>
                  <textarea
                    class="input"
                    rows={Math.min(12, Math.max(2, decided.length + 1))}
                    value={decided.join('')}
                    onInput={(e) => decide(index, linesOf(e.currentTarget.value))}
                    spellcheck={false}
                    data-testid="gw-edit"
                  />
                </label>
              )}
            </div>
          );
        })}
      </div>
      <div class="gw-row">{actions(result, open)}</div>
      <details class="gw-result-box">
        <summary>The merged text</summary>
        <pre class="gw-result" {...scrollRegion('The merged text')} data-testid="gw-result">
          {result}
        </pre>
      </details>
    </div>
  );
}

/* ------------------------------------------------------------------- tabs -- */

function MergeTab() {
  const [texts, setTexts] = useState({ base: '', ours: '', theirs: '' });
  const side = (key: 'base' | 'ours' | 'theirs', label: string) => (
    <label class="gw-field">
      <span class="control-label">
        {label}{' '}
        <button
          type="button"
          class="link-button"
          onClick={() =>
            attempt(async () => {
              const file = await pickFile('');
              if (file) setTexts({ ...texts, [key]: await readTextFile(file) });
            })
          }
        >
          Open a file
        </button>
      </span>
      <textarea class="input" rows={8} value={texts[key]} onInput={(e) => setTexts({ ...texts, [key]: e.currentTarget.value })} spellcheck={false} data-testid={`gw-${key}`} />
    </label>
  );
  const any = texts.base || texts.ours || texts.theirs;
  return (
    <div class="gw-pane">
      <div class="gw-three">
        {side('ours', 'Yours')}
        {side('base', 'The version both started from')}
        {side('theirs', 'Theirs')}
      </div>
      <div class="gw-row">
        <button type="button" class="button button-small" onClick={() => setTexts(SAMPLE)} data-testid="gw-sample">
          <Icon name="sample" size={13} /> Example
        </button>
        {any && (
          <button type="button" class="button button-small button-quiet" onClick={() => setTexts({ base: '', ours: '', theirs: '' })}>
            Clear
          </button>
        )}
      </div>
      {any && (
        <MergeEditor
          {...texts}
          labels={{ ours: 'yours', theirs: 'theirs', base: 'original' }}
          actions={(result, open) => (
            <>
              <button
                type="button"
                class="button button-primary"
                onClick={() =>
                  attempt(async () => {
                    const saved = await saveFile('merged.txt', result, 'text/plain');
                    if (saved.saved) notify(`Saved to ${saved.location}`);
                  })
                }
                data-testid="gw-save"
              >
                <Icon name="save" size={14} /> Save the merged text
              </button>
              <button
                type="button"
                class="button"
                onClick={() =>
                  attempt(async () => {
                    await copyText(result);
                    notify('Copied');
                  })
                }
              >
                <Icon name="copy" size={14} /> Copy
              </button>
              {open > 0 && <span class="tone-muted">Undecided conflicts are written with the &lt;&lt;&lt;&lt;&lt;&lt;&lt; markers git uses.</span>}
            </>
          )}
        />
      )}
    </div>
  );
}

function HistoryTab({ token, refs }: { token: string; refs: readonly GitReference[] }) {
  const [rev, setRev] = useState('');
  const [search, setSearch] = useState('');
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [more, setMore] = useState(false);
  const [chosen, setChosen] = useState('');
  const [detail, setDetail] = useState<CommitDetail | null>(null);
  const [file, setFile] = useState('');
  const [diff, setDiff] = useState<string | null>(null);
  const PAGE = 200;

  const load = (skip: number) =>
    attempt(async () => {
      const next = await gitLog(token, { rev, search, limit: PAGE, skip });
      setCommits(skip ? [...commits, ...next] : next);
      setMore(next.length === PAGE);
      if (!skip) {
        setChosen('');
        setDetail(null);
      }
    });
  useEffect(() => {
    const timer = setTimeout(() => void load(0), search ? 250 : 0);
    return () => clearTimeout(timer);
  }, [token, rev, search]);

  useEffect(() => {
    setDetail(null);
    setFile('');
    setDiff(null);
    if (chosen) void attempt(async () => setDetail(await gitCommit(token, chosen)));
  }, [chosen]);
  useEffect(() => {
    setDiff(null);
    if (chosen && file) void attempt(async () => setDiff(await gitDiff(token, '', chosen, file)));
  }, [file]);

  // The graph needs every commit's children in the list, so it is drawn only for the whole history.
  const rows = useMemo(() => (search ? null : graphRows(commits)), [commits, search]);
  const width = Math.min(12, Math.max(1, ...(rows ?? []).map((row) => row.width)));
  return (
    <div class="gw-split">
      <div class="gw-pane">
        <div class="gw-row">
          <label class="gw-field">
            <span class="control-label">Show</span>
            <select class="input" value={rev} onChange={(e) => setRev(e.currentTarget.value)} data-testid="gw-rev">
              <option value="">Every branch</option>
              {refs.map((r) => (
                <option key={`${r.kind}/${r.name}`} value={r.name}>
                  {r.kind === 'tag' ? 'tag ' : ''}
                  {r.name}
                  {r.current ? ' (checked out)' : ''}
                </option>
              ))}
            </select>
          </label>
          <label class="gw-field gw-grow">
            <span class="control-label">Words in the message</span>
            <input class="input" type="search" value={search} onInput={(e) => setSearch(e.currentTarget.value)} data-testid="gw-search" />
          </label>
        </div>
        <ol class="gw-commits" data-testid="gw-commits">
          {commits.map((commit, index) => (
            <li key={commit.hash}>
              <button type="button" class={`gw-commit${chosen === commit.hash ? ' is-chosen' : ''}`} onClick={() => setChosen(commit.hash)} data-testid="gw-commit">
                {rows?.[index] && <GraphCell row={rows[index] as GraphRow} width={width} />}
                <span class="gw-subject">
                  {commit.refs.map((r) => (
                    <span key={r} class={`gw-ref${r.startsWith('tag:') ? ' is-tag' : r.startsWith('HEAD') ? ' is-head' : ''}`}>
                      {r.replace('HEAD -> ', '')}
                    </span>
                  ))}
                  {commit.subject}
                </span>
                <span class="gw-meta">
                  {commit.author}, {when(commit.time)}
                </span>
              </button>
            </li>
          ))}
        </ol>
        {commits.length === 0 && <p class="tone-muted">No commits to show.</p>}
        {more && (
          <button type="button" class="button button-small" onClick={() => void load(commits.length)}>
            Show older commits
          </button>
        )}
      </div>
      <div class="gw-pane" data-testid="gw-detail">
        {detail ? (
          <>
            <pre class="gw-message">{detail.message}</pre>
            <p class="gw-meta">
              {detail.commit.author} &lt;{detail.commit.email}&gt;, {when(detail.commit.time)}
              {detail.committer !== detail.commit.author ? `; committed by ${detail.committer}` : ''}
              <br />
              <code>{detail.commit.hash}</code>{' '}
              <button
                type="button"
                class="link-button"
                onClick={() =>
                  attempt(async () => {
                    await copyText(detail.commit.hash);
                    notify('Copied');
                  })
                }
              >
                Copy
              </button>
              {detail.commit.parents.length > 1 ? ` (a merge of ${detail.commit.parents.length} commits, shown against the first)` : ''}
            </p>
            <Files files={detail.files} chosen={file} onChoose={setFile} />
            {diff !== null && <DiffView text={diff} />}
            {diff === null && detail.files.length > 0 && <p class="tone-muted">Choose a file to see what changed in it.</p>}
          </>
        ) : (
          <p class="tone-muted">Choose a commit to read it.</p>
        )}
      </div>
    </div>
  );
}

function CompareTab({ token, refs }: { token: string; refs: readonly GitReference[] }) {
  const current = refs.find((r) => r.current)?.name ?? refs[0]?.name ?? '';
  const [first, setFirst] = useState(current);
  const [second, setSecond] = useState(refs.find((r) => r.name !== current)?.name ?? '');
  const [result, setResult] = useState<(Comparison & { first: string; second: string }) | null>(null);
  const [file, setFile] = useState('');
  const [diff, setDiff] = useState<string | null>(null);
  useEffect(() => {
    setDiff(null);
    if (result && file) void attempt(async () => setDiff(await gitDiff(token, result.first, result.second, file)));
  }, [file, result]);
  const field = (label: string, value: string, set: (next: string) => void, testId: string) => (
    <label class="gw-field gw-grow">
      <span class="control-label">{label}</span>
      <input class="input" type="text" list="gw-refs" value={value} onInput={(e) => set(e.currentTarget.value)} spellcheck={false} placeholder="a branch, tag or commit" data-testid={testId} />
    </label>
  );
  return (
    <div class="gw-pane">
      <datalist id="gw-refs">
        {refs.map((r) => (
          <option key={`${r.kind}/${r.name}`} value={r.name} />
        ))}
      </datalist>
      <div class="gw-row">
        {field('From', first, setFirst, 'gw-first')}
        {field('To', second, setSecond, 'gw-second')}
        <button
          type="button"
          class="button button-primary"
          disabled={!first.trim() || !second.trim()}
          onClick={() =>
            attempt(async () => {
              setFile('');
              setResult({ ...(await gitCompare(token, first.trim(), second.trim())), first: first.trim(), second: second.trim() });
            })
          }
          data-testid="gw-compare"
        >
          Compare
        </button>
      </div>
      {result && (
        <div class="gw-split">
          <div class="gw-pane" data-testid="gw-compare-result">
            <p>
              <strong>{result.first}</strong> has {result.onlyFirst.toLocaleString()} {result.onlyFirst === 1 ? 'commit' : 'commits'} that <strong>{result.second}</strong> lacks;{' '}
              <strong>{result.second}</strong> has {result.onlySecond.toLocaleString()} that <strong>{result.first}</strong> lacks.{' '}
              {result.mergeBase ? (
                <span class="tone-muted">
                  They parted at <code>{result.mergeBase.slice(0, 10)}</code>.
                </span>
              ) : (
                <span class="tone-muted">Their histories share no commit.</span>
              )}
            </p>
            <p class="tone-muted">
              {result.files.length.toLocaleString()} {result.files.length === 1 ? 'file differs' : 'files differ'} between the two as they are now:
            </p>
            <Files files={result.files} chosen={file} onChoose={setFile} />
          </div>
          <div class="gw-pane">{diff !== null ? <DiffView text={diff} /> : <p class="tone-muted">Choose a file to see how it differs.</p>}</div>
        </div>
      )}
    </div>
  );
}

function ConflictsTab({ token, onChanged }: { token: string; onChanged: () => void }) {
  const [files, setFiles] = useState<ConflictedFile[] | null>(null);
  const [path, setPath] = useState('');
  const [sides, setSides] = useState<{ base: string; ours: string; theirs: string } | null>(null);
  const [note, setNote] = useState('');
  const [sure, setSure] = useState(false);
  const refresh = () => attempt(async () => setFiles(await gitConflicts(token)));
  useEffect(() => void refresh(), [token]);
  useEffect(() => {
    setSides(null);
    setNote('');
    setSure(false);
    if (!path) return;
    void attempt(async () => {
      const read = await gitConflictSides(token, path);
      if (read.ours === null || read.theirs === null) setNote(`One side deleted ${path}. Decide in git: “git rm” to delete it, or “git add” to keep the file as it is now.`);
      else setSides({ base: read.base ?? '', ours: read.ours, theirs: read.theirs });
    });
  }, [path]);
  if (!files) return <p class="tone-muted">Looking for conflicts…</p>;
  if (!files.length)
    return (
      <p data-testid="gw-conflicts">
        <Icon name="check" size={14} /> No file has an unresolved conflict. Conflicts appear here after a merge, rebase or cherry-pick stops.
      </p>
    );
  return (
    <div class="gw-pane">
      <ul class="gw-files" data-testid="gw-conflicts">
        {files.map((file) => (
          <li key={file.path}>
            <button type="button" class={`gw-file${path === file.path ? ' is-chosen' : ''}`} onClick={() => setPath(file.path)}>
              <span class="gw-status is-D">conflict</span>
              <span class="gw-path">{file.path}</span>
              <span class="gw-count">{file.ours && file.theirs ? (file.base ? 'both changed it' : 'both added it') : 'one side deleted it'}</span>
            </button>
          </li>
        ))}
      </ul>
      {note && <p>{note}</p>}
      {sides && (
        <MergeEditor
          {...sides}
          labels={{ ours: 'ours', theirs: 'theirs', base: 'original' }}
          actions={(result, open) => (
            <>
              <button
                type="button"
                class="button button-primary"
                disabled={open > 0}
                onClick={() => {
                  if (!sure) {
                    setSure(true);
                    return;
                  }
                  void attempt(async () => {
                    await gitResolve(token, path, result);
                    notify(`${path} saved and marked as resolved (git add)`);
                    setPath('');
                    await refresh();
                    onChanged();
                  });
                }}
                data-testid="gw-resolve"
              >
                <Icon name="check" size={14} /> {sure ? `Write ${path} and stage it` : 'Save and mark as resolved'}
              </button>
              <span class="tone-muted">{open > 0 ? 'Decide every conflict first.' : 'This writes the file in the repository and runs “git add” on it. Committing the merge stays with you.'}</span>
            </>
          )}
        />
      )}
    </div>
  );
}

function Component() {
  const [tab, setTab] = useState<Tab>(isDesktop ? 'history' : 'merge');
  const [repo, setRepo] = useState<{ token: string; info: RepoInfo; refs: GitReference[] } | null>(null);
  const open = () =>
    attempt(async () => {
      const folder = await pickFolder();
      if (!folder) return;
      setRepo({ token: folder.token, info: await gitOpen(folder.token), refs: await gitRefs(folder.token) });
      if (tab === 'merge') setTab('history');
    });
  const reload = () =>
    attempt(async () => {
      if (repo) setRepo({ token: repo.token, info: await gitOpen(repo.token), refs: await gitRefs(repo.token) });
    });
  const needsRepo = tab !== 'merge';
  return (
    <section class="tool gw" data-testid="tool" data-state={repo ? 'done' : 'idle'}>
      <div class="gw-bar">
        <Segmented value={tab} choices={TABS} onChange={setTab} label="View" small={false} />
        {isDesktop && (
          <button type="button" class="button" onClick={() => void open()} data-testid="gw-open">
            <Icon name="open" size={14} /> {repo ? 'Open another repository' : 'Open a repository'}
          </button>
        )}
        {repo && (
          <span class="gw-repo" data-testid="gw-repo">
            <strong>{repo.info.path}</strong> {repo.info.branch ? `on ${repo.info.branch}` : repo.info.head ? `at ${repo.info.head}` : 'no commits yet'}
            {repo.info.conflicts > 0 ? `, ${repo.info.conflicts} ${repo.info.conflicts === 1 ? 'file' : 'files'} in conflict` : repo.info.merging ? ', a merge is in progress' : ''}
            <span class="tone-muted"> (git {repo.info.version})</span>
            <button type="button" class="icon-button" onClick={() => void reload()} aria-label="Read the repository again" title="Read the repository again">
              <Icon name="refresh" size={14} />
            </button>
          </span>
        )}
      </div>
      {needsRepo && !isDesktop && (
        <p class="gw-gate" data-testid="gw-gate">
          <Icon name="info" size={15} /> Reading a repository needs the Benchtop desktop app and git installed on this computer. The three-way merge works here too.
        </p>
      )}
      {needsRepo && isDesktop && !repo && (
        <p class="tone-muted">Open the top folder of a repository (the one that holds .git). Benchtop runs your installed git to read it; as with git itself, open only repositories you trust.</p>
      )}
      {tab === 'merge' && <MergeTab />}
      {tab === 'history' && repo && <HistoryTab key={repo.token} token={repo.token} refs={repo.refs} />}
      {tab === 'compare' && repo && <CompareTab key={repo.token} token={repo.token} refs={repo.refs} />}
      {tab === 'conflicts' && repo && <ConflictsTab key={repo.token} token={repo.token} onChanged={() => void reload()} />}
    </section>
  );
}

export default defineCustomTool(Component);
