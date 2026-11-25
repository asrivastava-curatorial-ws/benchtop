/**
 * Projects: keep the files of one job together with the settings of the
 * tools used on them.  While a project is open, files opened in tools are
 * copied into it as inputs, files saved from tools as outputs, and every
 * tool remembers its options in the project.  A project is saved as one
 * bundle file to move it to another computer or keep it with the job.
 */
import { useEffect, useMemo, useState } from 'preact/hooks';
import { sendToTool } from '../../app/handoff';
import { addFiles, createProject, deleteProject, exportBundle, getFileBytes, importBundle, listProjects, openProject, removeFiles, updateProject, useActiveProject } from '../../app/projects';
import { toolHref } from '../../app/router';
import { type Suggestion, suggestTools } from '../../app/suggest';
import { formatBytes } from '../../lib/bytes';
import { type FileRole, type Project, type ProjectFile, projectSize, ROLE_LABELS, ROLES } from '../../lib/project-bundle';
import { pickFile, pickFiles, saveFile } from '../../platform';
import { Icon } from '../../ui/icons';
import { attempt, notify } from '../../ui/toast';
import { findTool } from '../registry';
import { defineCustomTool } from '../types';

const when = (time: number) => new Date(time).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

function FileRow({ project, file, onChanged }: { project: Project; file: ProjectFile; onChanged: (next: Project) => void }) {
  const [tools, setTools] = useState<Suggestion[] | null>(null);
  const asFile = async () => {
    const bytes = await getFileBytes(project.id, file.id);
    if (!bytes) throw new Error('This file’s contents are missing from the project.');
    return new File([bytes as BlobPart], file.name.split('/').pop() ?? file.name, { type: file.mime ?? '' });
  };
  const from = file.tool ? findTool(file.tool) : undefined;
  return (
    <tr>
      <td class="pj-name">{file.name}</td>
      <td>{formatBytes(file.size)}</td>
      <td>{from ? <a href={toolHref(from.id)}>{from.name}</a> : ''}</td>
      <td>{when(file.added)}</td>
      <td class="pj-actions">
        <label>
          <span class="visually-hidden">Open {file.name} in a tool</span>
          <select
            class="input"
            value=""
            onFocus={() => {
              if (!tools) void attempt(async () => setTools(await suggestTools([await asFile()])));
            }}
            onChange={(e) => {
              const id = e.currentTarget.value;
              e.currentTarget.value = '';
              if (id) void attempt(async () => sendToTool(id, { files: [await asFile()] }));
            }}
          >
            <option value="">Open in…</option>
            {(tools ?? []).map((s) => (
              <option key={s.tool.id} value={s.tool.id}>
                {s.tool.name}: {s.does}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          class="icon-button"
          title="Save a copy"
          aria-label={`Save a copy of ${file.name}`}
          onClick={() => attempt(async () => void (await saveFile(file.name.split('/').pop() ?? file.name, (await asFile()) as Blob, file.mime || 'application/octet-stream', { record: false })))}
        >
          <Icon name="save" size={15} />
        </button>
        <button
          type="button"
          class="icon-button"
          title="Remove from the project"
          aria-label={`Remove ${file.name} from the project`}
          onClick={() => attempt(async () => onChanged(await removeFiles(project.id, [file.id])))}
        >
          <Icon name="trash" size={15} />
        </button>
      </td>
    </tr>
  );
}

function Projects() {
  const active = useActiveProject();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = async (select?: string) => {
    const list = await listProjects();
    setProjects(list);
    setChosen((was) => select ?? (was && list.some((p) => p.id === was) ? was : (active?.id ?? list[0]?.id ?? null)));
  };
  useEffect(() => {
    void attempt(() => refresh());
  }, []);

  // The open project changes as tools add files; show it as it is now.
  const shown = useMemo(() => {
    const found = projects?.find((p) => p.id === chosen) ?? null;
    return found && active?.id === found.id ? active : found;
  }, [projects, chosen, active]);
  const replace = (next: Project) => setProjects((list) => (list ?? []).map((p) => (p.id === next.id ? next : p)));

  const create = () =>
    attempt(async () => {
      const made = await createProject(name || 'New project');
      setName('');
      await openProject(made.id);
      await refresh(made.id);
      notify(`Project “${made.name}” is open: files you open and save in any tool are now kept in it`);
    });

  const bring = () =>
    attempt(async () => {
      const file = await pickFile('.bproject,.zip,application/zip', { record: false });
      if (!file) return;
      setBusy(true);
      try {
        const made = await importBundle(new Uint8Array(await file.arrayBuffer()));
        await refresh(made.id);
        notify(`Opened the bundle as “${made.name}” (${made.files.length} files)`);
      } finally {
        setBusy(false);
      }
    });

  const bundle = (project: Project) =>
    attempt(async () => {
      setBusy(true);
      try {
        const { name: fileName, bytes } = await exportBundle(project.id);
        const outcome = await saveFile(fileName, bytes, 'application/zip', { record: false });
        if (outcome.saved) notify(`Saved to ${outcome.location}`);
      } finally {
        setBusy(false);
      }
    });

  const addTo = (project: Project, role: FileRole, files: File[]) =>
    attempt(async () => {
      if (!files.length) return;
      const result = await addFiles(
        project.id,
        files.map((f) => ({ name: f.name, data: f, role, ...(f.type ? { mime: f.type } : {}) })),
      );
      replace(result.project);
    });

  const tools = shown
    ? Object.keys(shown.toolOptions)
        .map(findTool)
        .filter((t) => t !== undefined)
    : [];

  return (
    <section class="tool pj-tool" data-testid="tool" data-state={projects ? 'done' : 'idle'}>
      <div class="pj-layout">
        <aside class="pj-list" aria-label="Projects">
          <form
            class="pj-new"
            onSubmit={(e) => {
              e.preventDefault();
              void create();
            }}
          >
            <label class="visually-hidden" for="pj-new-name">
              Name of the new project
            </label>
            <input id="pj-new-name" class="input" value={name} placeholder="Name of a new project" onInput={(e) => setName(e.currentTarget.value)} data-testid="pj-name" />
            <button type="submit" class="button button-primary" data-testid="pj-create">
              <Icon name="plus" size={14} /> Create
            </button>
          </form>
          <button type="button" class="button" onClick={bring} disabled={busy} data-testid="pj-import">
            <Icon name="open" size={14} /> Open a bundle file
          </button>
          <ul>
            {(projects ?? []).map((p) => {
              const now = active?.id === p.id ? active : p;
              return (
                <li key={p.id} class={p.id === chosen ? 'is-chosen' : ''}>
                  <button type="button" class="link-button" aria-pressed={p.id === chosen} onClick={() => setChosen(p.id)}>
                    {now.name}
                  </button>
                  <span class="tone-muted">
                    {now.files.length} {now.files.length === 1 ? 'file' : 'files'}, {formatBytes(projectSize(now))}
                    {active?.id === p.id && <b class="pj-open"> open</b>}
                  </span>
                </li>
              );
            })}
          </ul>
          {projects?.length === 0 && <p class="tone-muted">No projects yet. Create one for a job you return to: an exhibition, a report, a set of files to convert.</p>}
        </aside>

        {shown ? (
          <div class="pj-detail" data-testid="pj-detail">
            <div class="button-row pj-head">
              <label class="pj-title">
                <span class="visually-hidden">Project name</span>
                <input class="input" value={shown.name} onChange={(e) => attempt(async () => replace(await updateProject(shown.id, { name: e.currentTarget.value })))} />
              </label>
              {active?.id === shown.id ? (
                <button type="button" class="button" onClick={() => attempt(async () => openProject(null).then(() => refresh()))} data-testid="pj-close">
                  Close project
                </button>
              ) : (
                <button type="button" class="button button-primary" onClick={() => attempt(async () => openProject(shown.id).then(() => refresh()))} data-testid="pj-open">
                  Open project
                </button>
              )}
              <button type="button" class="button" disabled={busy} onClick={() => bundle(shown)} data-testid="pj-export">
                <Icon name="save" size={14} /> Save as a bundle
              </button>
              <button
                type="button"
                class="button button-quiet"
                onClick={() =>
                  attempt(async () => {
                    if (!window.confirm(`Delete the project “${shown.name}” and the ${shown.files.length} files kept in it? Bundles you saved stay where they are.`)) return;
                    await deleteProject(shown.id);
                    await refresh();
                  })
                }
              >
                <Icon name="trash" size={14} /> Delete
              </button>
            </div>
            <p class="tone-muted pj-state" data-testid="pj-state">
              {active?.id === shown.id
                ? 'This project is open. Tools keep their settings in it, and copies of the files you open and save are added below.'
                : 'This project is closed. Open it to carry on where you left off: every tool comes back with the settings it had.'}{' '}
              Created {when(shown.created)}, changed {when(shown.modified)}.
            </p>
            <div class="pj-switches">
              <label class="check">
                <input type="checkbox" checked={shown.collectInputs} onChange={(e) => attempt(async () => replace(await updateProject(shown.id, { collectInputs: e.currentTarget.checked })))} /> Keep
                copies of files opened in tools
              </label>
              <label class="check">
                <input type="checkbox" checked={shown.collectOutputs} onChange={(e) => attempt(async () => replace(await updateProject(shown.id, { collectOutputs: e.currentTarget.checked })))} /> Keep
                copies of files saved from tools
              </label>
            </div>
            <label class="pj-notes">
              <span class="control-label">Notes</span>
              <textarea
                class="input"
                rows={2}
                value={shown.notes}
                placeholder="What this job is, what is left to do…"
                onChange={(e) => attempt(async () => replace(await updateProject(shown.id, { notes: e.currentTarget.value })))}
              />
            </label>

            {ROLES.map((role) => {
              const files = shown.files.filter((f) => f.role === role);
              if (role === 'intermediate' && files.length === 0) return null;
              return (
                <section key={role} class="pj-files" data-testid={`pj-${role}`}>
                  <div class="pj-files-head">
                    <h2>
                      {ROLE_LABELS[role]} <span class="count">{files.length}</span>
                    </h2>
                    {role !== 'intermediate' && (
                      <button type="button" class="button button-small" onClick={() => attempt(async () => addTo(shown, role, await pickFiles('', { record: false })))} data-testid={`pj-add-${role}`}>
                        <Icon name="plus" size={13} /> Add files
                      </button>
                    )}
                    {files.length > 0 && (
                      <button
                        type="button"
                        class="button button-small button-quiet"
                        onClick={() =>
                          attempt(async () =>
                            replace(
                              await removeFiles(
                                shown.id,
                                files.map((f) => f.id),
                              ),
                            ),
                          )
                        }
                      >
                        Remove all
                      </button>
                    )}
                  </div>
                  {files.length === 0 ? (
                    <p class="tone-muted">
                      {role === 'input'
                        ? 'The files this job starts from. Add them here, or just open them in any tool while the project is open.'
                        : 'Results appear here when you save from a tool while the project is open.'}
                    </p>
                  ) : (
                    <div class="pj-table-wrap">
                      <table class="fp-results">
                        <thead>
                          <tr>
                            <th scope="col">File</th>
                            <th scope="col">Size</th>
                            <th scope="col">Tool</th>
                            <th scope="col">Added</th>
                            <th scope="col">
                              <span class="visually-hidden">Actions</span>
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {files.slice(0, 300).map((f) => (
                            <FileRow key={f.id} project={shown} file={f} onChanged={replace} />
                          ))}
                        </tbody>
                      </table>
                      {files.length > 300 && <p class="tone-muted">Showing the first 300 of {files.length.toLocaleString()} files; the bundle holds them all.</p>}
                    </div>
                  )}
                </section>
              );
            })}

            <section class="pj-files" data-testid="pj-tools">
              <div class="pj-files-head">
                <h2>
                  Tool settings <span class="count">{tools.length}</span>
                </h2>
              </div>
              {tools.length === 0 ? (
                <p class="tone-muted">Tools you use while the project is open keep their settings here, the workflow in the Workflow Builder included.</p>
              ) : (
                <ul class="pj-tools">
                  {tools.map((t) => (
                    <li key={t.id}>
                      <a href={toolHref(t.id)}>{t.name}</a>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        ) : (
          <div class="pj-detail pj-empty">
            <h2>Keep a job together</h2>
            <p>
              A project holds the files you start from, what each tool made of them, and how every tool was set, so you can stop today and carry on next month, or hand the whole job to someone else as
              one file.
            </p>
            <p class="tone-muted">Projects stay on this computer. A bundle is an ordinary ZIP file with a manifest, so its files can be reached without Benchtop too.</p>
          </div>
        )}
      </div>
    </section>
  );
}

export default defineCustomTool(Projects);
