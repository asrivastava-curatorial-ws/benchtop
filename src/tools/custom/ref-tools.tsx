/**
 * Palette Library (free-to-use colour palettes with their sources),
 * Scratchpad (quick notes kept on this computer) and Tailwind Cheat Sheet
 * (every common utility and the CSS it makes).
 */
import { useMemo, useState } from 'preact/hooks';
import { readableOn } from '../../lib/color';
import { PALETTES, paletteExports } from '../../lib/palettes';
import { UTILITIES, UTILITY_GROUPS } from '../../lib/tailwind-classes';
import { copyText, saveFile } from '../../platform';
import { CodeOutput } from '../../ui/CodeOutput';
import { Icon } from '../../ui/icons';
import { attempt, notify } from '../../ui/toast';
import { defineCustomTool, type Values } from '../types';
import { usePersistentState } from './_shared';

const copy = (text: string, message = `Copied ${text}`) =>
  attempt(async () => {
    await copyText(text);
    notify(message);
  });

/* ------------------------------------------------------------- palettes -- */

function PaletteLibrary() {
  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState(PALETTES[0]?.id ?? '');
  const q = query.trim().toLowerCase();
  const shown = PALETTES.filter((p) => !q || `${p.name} ${p.group} ${p.source} ${p.colors.map((c) => c.join(' ')).join(' ')}`.toLowerCase().includes(q));
  const palette = PALETTES.find((p) => p.id === chosen) ?? PALETTES[0];
  const files = palette ? paletteExports(palette) : null;
  const groups = [...new Set(shown.map((p) => p.group))];

  return (
    <section class="tool pl-tool" data-testid="tool" data-state="done">
      <label class="control pl-search">
        <span class="control-label">Find a palette or colour</span>
        <input class="input" type="search" value={query} onInput={(e) => setQuery(e.currentTarget.value)} placeholder="viridis, nord, #0072b2, colour-blind…" data-testid="pl-search" />
      </label>
      {groups.map((g) => (
        <div key={g} class="pl-group">
          <h3>{g}</h3>
          <div class="pl-list">
            {shown
              .filter((p) => p.group === g)
              .map((p) => (
                <button key={p.id} type="button" class={`pl-card${p.id === chosen ? ' is-on' : ''}`} onClick={() => setChosen(p.id)} aria-pressed={p.id === chosen} data-testid={`pl-${p.id}`}>
                  <span class="pl-strip" aria-hidden="true">
                    {p.colors.map(([n, h]) => (
                      <span key={n} style={{ background: h }} />
                    ))}
                  </span>
                  <span class="pl-name">{p.name}</span>
                  <span class="pl-meta">
                    {p.colors.length} colours · {p.licence}
                  </span>
                </button>
              ))}
          </div>
        </div>
      ))}
      {!shown.length && <p class="np-empty">No palettes match “{query}”.</p>}
      {palette && files && (
        <div class="pl-detail" data-testid="pl-detail">
          <h3>{palette.name}</h3>
          <p class="control-help">
            {palette.source}. Licence: {palette.licence}.
          </p>
          <div class="pl-swatches">
            {palette.colors.map(([n, h]) => (
              <button key={n} type="button" class="pl-swatch" style={{ background: h, color: readableOn(h) }} onClick={() => copy(h.toLowerCase())} aria-label={`Copy ${n} ${h}`}>
                <span>{n}</span>
                <code>{h.toLowerCase()}</code>
              </button>
            ))}
          </div>
          <CodeOutput
            outputs={[
              { label: 'CSS', language: 'css', code: files.css, filename: `${palette.id}.css` },
              { label: 'Sass', language: 'css', code: files.scss, filename: `_${palette.id}.scss` },
              { label: 'JSON', language: 'json', code: files.json, filename: `${palette.id}.json` },
              { label: 'GIMP / Inkscape', language: 'text', code: files.gpl, filename: `${palette.id}.gpl` },
            ]}
            baseName={palette.id}
          />
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------ scratchpad -- */

interface Note {
  readonly id: string;
  readonly text: string;
  readonly updated: number;
}

const newNote = (): Note => ({ id: `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, text: '', updated: Date.now() });
const titleOf = (n: Note) => n.text.trim().split('\n')[0]?.slice(0, 48) || 'Empty note';

function Scratchpad({ toolId }: { toolId: string }) {
  const [state, setState] = usePersistentState(
    toolId,
    (s: Values | undefined) => {
      const notes = Array.isArray(s?.notes) ? (s.notes as Note[]).filter((n) => n && typeof n.text === 'string').slice(0, 100) : [];
      const list = notes.length ? notes : [{ ...newNote(), text: 'Quick notes stay here on this computer.\n\nUse them for phone numbers, commands, ideas or anything to paste later.' }];
      return { notes: list, open: typeof s?.open === 'string' && list.some((n) => n.id === s.open) ? (s.open as string) : (list[0] as Note).id };
    },
    (p: { notes: Note[]; open: string }): Values => ({ ...p }),
  );
  const [query, setQuery] = useState('');
  const note = state.notes.find((n) => n.id === state.open) ?? state.notes[0];
  const words = note?.text.trim() ? note.text.trim().split(/\s+/).length : 0;
  const q = query.trim().toLowerCase();
  const listed = state.notes.filter((n) => !q || n.text.toLowerCase().includes(q)).sort((a, b) => b.updated - a.updated);

  const update = (text: string) => setState((s) => ({ ...s, notes: s.notes.map((n) => (n.id === s.open ? { ...n, text, updated: Date.now() } : n)) }));
  const add = () => {
    const n = newNote();
    setState((s) => ({ notes: [n, ...s.notes].slice(0, 100), open: n.id }));
  };
  const remove = () =>
    setState((s) => {
      const rest = s.notes.filter((n) => n.id !== s.open);
      const list = rest.length ? rest : [newNote()];
      return { notes: list, open: (list[0] as Note).id };
    });

  return (
    <section class="tool pad-tool" data-testid="tool" data-state="done">
      <aside class="pad-list">
        <div class="button-row">
          <button type="button" class="button button-primary button-small" onClick={add} data-testid="sp-new">
            <Icon name="plus" size={14} /> New note
          </button>
        </div>
        <input class="input" type="search" placeholder="Search notes" value={query} onInput={(e) => setQuery(e.currentTarget.value)} aria-label="Search notes" />
        <ul>
          {listed.map((n) => (
            <li key={n.id}>
              <button type="button" class={n.id === state.open ? 'is-on' : ''} onClick={() => setState((s) => ({ ...s, open: n.id }))} aria-current={n.id === state.open}>
                <span>{titleOf(n)}</span>
                <small>{new Date(n.updated).toLocaleString()}</small>
              </button>
            </li>
          ))}
        </ul>
      </aside>
      {note && (
        <div class="pad-editor">
          <textarea class="input pad-text" value={note.text} onInput={(e) => update(e.currentTarget.value)} aria-label="Note" placeholder="Write anything…" data-testid="sp-text" />
          <div class="pad-bar">
            <span class="control-help" data-testid="sp-count">
              {words} word{words === 1 ? '' : 's'}, {[...note.text].length} characters
            </span>
            <button type="button" class="button button-small" onClick={() => update(`${note.text}${note.text && !note.text.endsWith('\n') ? '\n' : ''}${new Date().toLocaleString()}\n`)}>
              Insert date and time
            </button>
            <button type="button" class="button button-small" onClick={() => copy(note.text, 'Copied the note')}>
              <Icon name="copy" size={14} /> Copy
            </button>
            <button
              type="button"
              class="button button-small"
              onClick={() =>
                attempt(async () => {
                  const name = `${
                    titleOf(note)
                      .replace(/[^\p{L}\p{N} -]+/gu, '')
                      .trim()
                      .slice(0, 40) || 'note'
                  }.md`;
                  const saved = await saveFile(name, note.text, 'text/markdown');
                  if (saved.saved) notify(`Saved to ${saved.location}`);
                })
              }
            >
              <Icon name="save" size={14} /> Save
            </button>
            <button type="button" class="button button-small button-quiet" onClick={remove}>
              <Icon name="trash" size={14} /> Delete
            </button>
          </div>
          <p class="control-help">Notes are kept on this computer while “Remember options” is on in Settings.</p>
        </div>
      )}
    </section>
  );
}

/* -------------------------------------------------------------- tailwind -- */

function TailwindSheet() {
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState('all');
  const q = query.trim().toLowerCase();
  const rows = useMemo(() => UTILITIES.filter((u) => (group === 'all' || u.group === group) && (!q || u.cls.toLowerCase().includes(q) || u.css.toLowerCase().includes(q))).slice(0, 400), [q, group]);
  const count = useMemo(() => UTILITIES.filter((u) => (group === 'all' || u.group === group) && (!q || u.cls.toLowerCase().includes(q) || u.css.toLowerCase().includes(q))).length, [q, group]);

  return (
    <section class="tool tw-tool" data-testid="tool" data-state="done">
      <div class="icon-row">
        <label class="control tw-search">
          <span class="control-label">Search classes or CSS</span>
          <input class="input input-mono" type="search" value={query} onInput={(e) => setQuery(e.currentTarget.value)} placeholder="justify, padding, rounded-lg, 1.5rem…" data-testid="tw-search" />
        </label>
        <label class="control">
          <span class="control-label">Group</span>
          <select class="input" value={group} onChange={(e) => setGroup(e.currentTarget.value)}>
            <option value="all">All groups</option>
            {UTILITY_GROUPS.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p class="control-help">
        {count} utilit{count === 1 ? 'y' : 'ies'}
        {count > rows.length ? `, showing the first ${rows.length}` : ''}. Tailwind CSS v4 defaults; click a class to copy it. Colours are in Tailwind Colours.
      </p>
      <table class="ref-table tw-table" data-testid="tw-table">
        <thead>
          <tr>
            <th scope="col">Class</th>
            <th scope="col">CSS</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((u) => (
            <tr key={`${u.group}-${u.cls}`}>
              <th scope="row">
                <button type="button" class="tw-class" onClick={() => copy(u.cls)}>
                  {u.cls}
                </button>
              </th>
              <td>
                <code>{u.css}</code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function RefTools({ toolId }: { toolId: string }) {
  if (toolId === 'scratchpad') return <Scratchpad toolId={toolId} />;
  if (toolId === 'tailwind-cheatsheet') return <TailwindSheet />;
  return <PaletteLibrary />;
}

export default defineCustomTool(RefTools);
