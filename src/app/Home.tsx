import { CATEGORIES, findTool, TOOLS } from '../tools/registry';
import type { ToolEntry } from '../tools/types';
import { Icon } from '../ui/icons';
import { toolHref } from './router';
import { useSettings } from './store';

function Shortcuts({ title, tools }: { title: string; tools: ToolEntry[] }) {
  if (tools.length === 0) return null;
  return (
    <section class="home-shortcuts">
      <h2>{title}</h2>
      <ul>
        {tools.map((tool) => (
          <li key={tool.id}>
            <a href={toolHref(tool.id)}>
              <strong>{tool.name}</strong>
              <span>{tool.description}</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function Home({ onOpenPalette }: { onOpenPalette: () => void }) {
  const settings = useSettings();
  const resolve = (ids: readonly string[]) => ids.map(findTool).filter((tool): tool is ToolEntry => tool !== undefined);
  const favorites = resolve(settings.favorites);
  const recents = resolve(settings.recents).filter((tool) => !settings.favorites.includes(tool.id));

  return (
    <div class="home">
      <header class="home-header">
        <h1>{TOOLS.length} developer tools that work without a network</h1>
        <p>Everything runs on this computer. Nothing you paste, open or generate is sent anywhere, and the app never connects to the internet.</p>
        <button type="button" class="home-search" onClick={onOpenPalette}>
          <Icon name="search" size={17} />
          <span>Find a tool</span>
          <kbd>Ctrl K</kbd>
        </button>
      </header>

      <Shortcuts title="Favourites" tools={favorites} />
      <Shortcuts title="Recently used" tools={recents.slice(0, 6)} />

      <section class="home-index" aria-label="All tools">
        {CATEGORIES.map((category) => (
          <div key={category.id} class="home-category">
            <h2>{category.name}</h2>
            <p>{category.blurb}</p>
            <ul>
              {TOOLS.filter((tool) => tool.category === category.id).map((tool) => (
                <li key={tool.id}>
                  <a href={toolHref(tool.id)} title={tool.description}>
                    {tool.name}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>
    </div>
  );
}
