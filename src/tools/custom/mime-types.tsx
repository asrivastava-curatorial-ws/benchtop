/** Look up media (MIME) types by file extension, file name or type. */
import { useMemo, useState } from 'preact/hooks';
import { FORM_TYPES, MEDIA_TYPES, type MediaType } from '../../lib/reference';
import { copyText } from '../../platform';
import { Icon } from '../../ui/icons';
import { attempt, notify } from '../../ui/toast';
import { defineCustomTool } from '../types';

function matches(row: MediaType, needle: string): boolean {
  if (needle === '') return true;
  // "photo.JPG", ".jpg" and "jpg" all look up the extension.
  const extension = needle.includes('/') ? null : needle.replace(/^.*\./, '');
  if (extension && row.extensions.includes(extension)) return true;
  return row.type.includes(needle) || row.description.toLowerCase().includes(needle) || row.extensions.some((ext) => ext.startsWith(needle.replace(/^\./, '')));
}

function MimeTypes() {
  const [query, setQuery] = useState('');
  const needle = query.trim().toLowerCase();

  const groups = useMemo(
    () =>
      (
        [
          ['File types', MEDIA_TYPES],
          ['Other common types (no file extension)', FORM_TYPES],
        ] as const
      )
        .map(([name, rows]) => {
          const found = rows.filter((row) => matches(row, needle));
          // Exact extension hits first.
          const extension = needle.replace(/^.*\./, '');
          return [name, [...found].sort((a, b) => Number(b.extensions.includes(extension)) - Number(a.extensions.includes(extension)))] as const;
        })
        .filter(([, rows]) => rows.length > 0),
    [needle],
  );

  const copy = (text: string) =>
    attempt(async () => {
      await copyText(text);
      notify(`Copied ${text}`);
    });

  return (
    <section class="tool tool-reference" data-testid="tool" data-state="done">
      <div class="tool-options ref-toolbar">
        <label class="control ref-search">
          <span class="control-label">Extension, file name or type</span>
          <input
            class="input"
            type="search"
            placeholder="report.pdf, .webp, font, application/json…"
            value={query}
            onInput={(event) => setQuery(event.currentTarget.value)}
            data-testid="mime-search"
          />
        </label>
        <p class="control-help ref-note">
          Send text types with a charset, for example <code>text/html; charset=utf-8</code>. Unknown binary files are served as <code>application/octet-stream</code>.
        </p>
      </div>
      <div class="ref-table-wrap">
        <table class="ref-table">
          <thead>
            <tr>
              <th scope="col">Extensions</th>
              <th scope="col">Media type</th>
              <th scope="col">What it is</th>
            </tr>
          </thead>
          {groups.map(([name, rows]) => (
            <tbody key={name}>
              <tr class="ref-group">
                <th colSpan={3} scope="colgroup">
                  {name}
                </th>
              </tr>
              {rows.map((row) => (
                <tr key={`${row.type}-${row.extensions.join()}`} data-testid="mime-row">
                  <th scope="row" class="mono">
                    {row.extensions.length > 0 ? row.extensions.map((ext) => `.${ext}`).join('  ') : '—'}
                  </th>
                  <td>
                    <button type="button" class="command" onClick={() => copy(row.type)} title="Copy">
                      <code>{row.type}</code>
                      <Icon name="copy" size={12} />
                    </button>
                  </td>
                  <td>{row.description}</td>
                </tr>
              ))}
            </tbody>
          ))}
        </table>
        {groups.length === 0 && <p class="control-help ref-empty">Nothing matches “{query}”. Unknown binary files are usually served as application/octet-stream.</p>}
      </div>
    </section>
  );
}

export default defineCustomTool(MimeTypes);
