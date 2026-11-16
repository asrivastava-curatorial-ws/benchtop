/** Searchable emoji list: click to copy the character, its code points or an HTML entity. */
import { useEffect, useMemo, useState } from 'preact/hooks';
import { copyText } from '../../platform';
import { attempt, notify } from '../../ui/toast';
import { defineCustomTool } from '../types';
import { Segmented } from './_shared';

interface Emoji {
  readonly emoji: string;
  readonly name: string;
  readonly group: string;
  readonly version: string;
}

type CopyAs = 'char' | 'codepoints' | 'html' | 'escape';

export const codePoints = (text: string): number[] => [...text].map((char) => char.codePointAt(0) as number);

export function copyForm(emoji: string, form: CopyAs): string {
  const points = codePoints(emoji);
  switch (form) {
    case 'codepoints':
      return points.map((point) => `U+${point.toString(16).toUpperCase().padStart(4, '0')}`).join(' ');
    case 'html':
      return points.map((point) => `&#x${point.toString(16).toUpperCase()};`).join('');
    case 'escape':
      return points.map((point) => `\\u{${point.toString(16)}}`).join('');
    default:
      return emoji;
  }
}

let data: Promise<readonly Emoji[]> | null = null;

const load = () => {
  data ??= import('unicode-emoji-json/data-by-group.json').then((module) =>
    (module.default as { name: string; emojis: { emoji: string; name: string; emoji_version: string }[] }[]).flatMap((group) =>
      group.emojis.map((item) => ({ emoji: item.emoji, name: item.name, group: group.name, version: item.emoji_version })),
    ),
  );
  return data;
};

function EmojiPicker() {
  const [all, setAll] = useState<readonly Emoji[]>([]);
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState('All');
  const [form, setForm] = useState<CopyAs>('char');
  const [picked, setPicked] = useState<Emoji | null>(null);

  useEffect(() => {
    void load().then(setAll);
  }, []);

  const groups = useMemo(() => ['All', ...new Set(all.map((item) => item.group))], [all]);
  const shown = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return all.filter((item) => (group === 'All' || item.group === group) && words.every((word) => item.name.includes(word) || item.emoji === word));
  }, [all, query, group]);

  const copy = (item: Emoji) =>
    attempt(async () => {
      setPicked(item);
      await copyText(copyForm(item.emoji, form));
      notify(`Copied ${copyForm(item.emoji, form)}`);
    });

  return (
    <section class="tool tool-emoji" data-testid="tool" data-state={all.length > 0 ? 'done' : 'busy'}>
      <div class="emoji-bar">
        <input
          class="input"
          type="search"
          placeholder="Search, e.g. rocket or heart"
          value={query}
          onInput={(event) => setQuery(event.currentTarget.value)}
          aria-label="Search emoji"
          data-testid="emoji-search"
        />
        <select class="input" value={group} onChange={(event) => setGroup(event.currentTarget.value)} aria-label="Group">
          {groups.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <Segmented<CopyAs>
          label="Copy as"
          value={form}
          onChange={setForm}
          choices={[
            { value: 'char', label: 'Emoji' },
            { value: 'codepoints', label: 'U+' },
            { value: 'html', label: 'HTML' },
            { value: 'escape', label: '\\u{}' },
          ]}
        />
      </div>
      {picked && (
        <p class="emoji-picked">
          <span class="emoji-big">{picked.emoji}</span> {picked.name} · <span class="mono">{copyForm(picked.emoji, 'codepoints')}</span> · Emoji {picked.version}
        </p>
      )}
      <div class="emoji-grid pane" data-testid="emoji-grid">
        {shown.slice(0, 2000).map((item) => (
          <button key={item.emoji} type="button" class="emoji-cell" title={item.name} aria-label={item.name} onClick={() => copy(item)}>
            {item.emoji}
          </button>
        ))}
        {all.length > 0 && shown.length === 0 && <p class="muted">No emoji match “{query}”.</p>}
      </div>
      <p class="muted">{all.length === 0 ? 'Loading…' : `${shown.length} of ${all.length} emoji. Click one to copy it.`}</p>
    </section>
  );
}

export default defineCustomTool(EmojiPicker);
