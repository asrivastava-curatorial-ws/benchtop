/** Generated code in one or more flavours (CSS, Tailwind, SVG...) with copy and save. */
import { useState } from 'preact/hooks';
import { useSettings } from '../app/store';
import { copyText, saveFile } from '../platform';
import type { Download, CodeOutput as Output } from '../tools/types';
import { CodeEditor } from './CodeEditor';
import { Icon } from './icons';
import { attempt, notify } from './toast';

const EXTENSIONS: Record<string, string> = {
  css: 'css',
  html: 'html',
  xml: 'xml',
  javascript: 'js',
  typescript: 'ts',
  jsx: 'jsx',
  json: 'json',
  markdown: 'md',
  yaml: 'yaml',
  text: 'txt',
};

export function CodeOutput({ outputs, downloads = [], baseName }: { outputs: readonly Output[]; downloads?: readonly Download[]; baseName: string }) {
  const wrap = useSettings((settings) => settings.wrapLines);
  const [selected, setSelected] = useState(0);
  const current = outputs[Math.min(selected, outputs.length - 1)];
  if (!current) return null;
  return (
    <div class="pane pane-output" data-testid="code-output">
      <div class="pane-header">
        {outputs.length > 1 ? (
          <div class="tabs" role="tablist">
            {outputs.map((output, index) => (
              <button key={output.label} type="button" role="tab" aria-selected={output === current} class={output === current ? 'is-active' : ''} onClick={() => setSelected(index)}>
                {output.label}
              </button>
            ))}
          </div>
        ) : (
          <span class="pane-title">{current.label}</span>
        )}
        <div class="pane-actions">
          {downloads.map((download) => (
            <button
              key={download.label}
              type="button"
              class="button button-small"
              onClick={() =>
                attempt(async () => {
                  const saved = await saveFile(download.filename, await download.make());
                  if (saved.saved) notify(`Saved to ${saved.location}`);
                })
              }
            >
              <Icon name="save" size={14} />
              {download.label}
            </button>
          ))}
          <button
            type="button"
            class="button button-small"
            onClick={() =>
              attempt(async () => {
                await copyText(current.code);
                notify('Copied');
              })
            }
          >
            <Icon name="copy" size={14} />
            Copy
          </button>
          <button
            type="button"
            class="button button-small"
            onClick={() =>
              attempt(async () => {
                const saved = await saveFile(current.filename ?? `${baseName}.${EXTENSIONS[current.language] ?? 'txt'}`, current.code, 'text/plain;charset=utf-8');
                if (saved.saved) notify(`Saved to ${saved.location}`);
              })
            }
          >
            <Icon name="save" size={14} />
            Save
          </button>
        </div>
      </div>
      <div class="pane-body">
        <CodeEditor value={current.code} language={current.language} readOnly wrap={wrap} label={current.label} testId="output-editor" />
      </div>
    </div>
  );
}
