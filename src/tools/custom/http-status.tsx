/** Searchable reference of HTTP status codes. */
import { useMemo, useState } from 'preact/hooks';
import { STATUS_CLASSES, STATUS_CODES } from '../../lib/reference';
import { copyText } from '../../platform';
import { Icon } from '../../ui/icons';
import { attempt, notify } from '../../ui/toast';
import { defineCustomTool } from '../types';
import { Segmented } from './_shared';

type ClassFilter = 'all' | '1' | '2' | '3' | '4' | '5';

const FILTERS: readonly { value: ClassFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: '1', label: '1xx' },
  { value: '2', label: '2xx' },
  { value: '3', label: '3xx' },
  { value: '4', label: '4xx' },
  { value: '5', label: '5xx' },
];

function HttpStatus() {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<ClassFilter>('all');

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const rows = STATUS_CODES.filter((row) => {
      if (filter !== 'all' && String(row.code)[0] !== filter) return false;
      if (needle === '') return true;
      if (/^\d{1,3}$/.test(needle)) return String(row.code).startsWith(needle);
      return [row.phrase, row.meaning, row.spec].some((text) => text.toLowerCase().includes(needle));
    });
    const byClass = new Map<number, typeof rows>();
    for (const row of rows) {
      const key = Math.floor(row.code / 100);
      byClass.set(key, [...(byClass.get(key) ?? []), row]);
    }
    return [...byClass.entries()];
  }, [query, filter]);

  const unknown = /^[1-5]\d\d$/.test(query.trim()) && !STATUS_CODES.some((row) => String(row.code) === query.trim()) ? Number(query.trim()) : null;

  const copy = (text: string) =>
    attempt(async () => {
      await copyText(text);
      notify(`Copied ${text}`);
    });

  return (
    <section class="tool tool-reference" data-testid="tool" data-state="done">
      <div class="tool-options ref-toolbar">
        <label class="control ref-search">
          <span class="control-label">Search</span>
          <input class="input" type="search" placeholder="404, redirect, rate limit…" value={query} onInput={(event) => setQuery(event.currentTarget.value)} data-testid="status-search" />
        </label>
        <div class="control">
          <span class="control-label">Class</span>
          <Segmented label="Status class" value={filter} onChange={setFilter} choices={FILTERS} />
        </div>
      </div>
      <div class="ref-table-wrap">
        <table class="ref-table">
          <thead>
            <tr>
              <th scope="col">Code</th>
              <th scope="col">Reason phrase</th>
              <th scope="col">Meaning</th>
              <th scope="col">Defined in</th>
            </tr>
          </thead>
          {groups.map(([group, rows]) => (
            <tbody key={group}>
              <tr class="ref-group">
                <th colSpan={4} scope="colgroup">
                  {group}xx {STATUS_CLASSES[group]}
                </th>
              </tr>
              {rows.map((row) => (
                <tr key={row.code} data-testid="status-row">
                  <th scope="row">
                    <button type="button" class={`command status-code status-${group}`} onClick={() => copy(`${row.code} ${row.phrase}`)} title="Copy">
                      <code>{row.code}</code>
                      <Icon name="copy" size={12} />
                    </button>
                  </th>
                  <td class="ref-strong">{row.phrase}</td>
                  <td>{row.meaning}</td>
                  <td class="ref-muted">{row.spec}</td>
                </tr>
              ))}
            </tbody>
          ))}
        </table>
        {groups.length === 0 && (
          <p class="control-help ref-empty">
            {unknown === null
              ? `Nothing matches “${query}”.`
              : `${unknown} is not a registered status code. Clients treat unknown codes like ${Math.floor(unknown / 100)}00 (${STATUS_CLASSES[Math.floor(unknown / 100)]}).`}
          </p>
        )}
      </div>
    </section>
  );
}

export default defineCustomTool(HttpStatus);
