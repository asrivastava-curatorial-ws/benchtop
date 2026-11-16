/** A rich-text editor that writes clean HTML and Markdown: type formatted text, copy the code. */
import { useEffect, useRef, useState } from 'preact/hooks';
import { CodeOutput } from '../../ui/CodeOutput';
import { sanitizeHtml } from '../../ui/sanitize';
import { defineCustomTool } from '../types';

const START = '<h2>Welcome to the galleries</h2><p>Type here and use the toolbar: <strong>bold</strong>, <em>italic</em>, lists and links all work.</p><ul><li>Engines</li><li>Electricity</li></ul>';

const ACTIONS: readonly { command: string; value?: string; label: string; title: string }[] = [
  { command: 'formatBlock', value: 'p', label: 'P', title: 'Paragraph' },
  { command: 'formatBlock', value: 'h1', label: 'H1', title: 'Heading 1' },
  { command: 'formatBlock', value: 'h2', label: 'H2', title: 'Heading 2' },
  { command: 'formatBlock', value: 'h3', label: 'H3', title: 'Heading 3' },
  { command: 'bold', label: 'B', title: 'Bold (Ctrl+B)' },
  { command: 'italic', label: 'I', title: 'Italic (Ctrl+I)' },
  { command: 'underline', label: 'U', title: 'Underline (Ctrl+U)' },
  { command: 'strikeThrough', label: 'S', title: 'Strikethrough' },
  { command: 'insertUnorderedList', label: '• List', title: 'Bulleted list' },
  { command: 'insertOrderedList', label: '1. List', title: 'Numbered list' },
  { command: 'formatBlock', value: 'blockquote', label: '❝', title: 'Quote' },
  { command: 'formatBlock', value: 'pre', label: '</>', title: 'Code block' },
  { command: 'createLink', label: 'Link', title: 'Make the selection a link' },
  { command: 'unlink', label: 'Unlink', title: 'Remove the link' },
  { command: 'insertHorizontalRule', label: '―', title: 'Horizontal line' },
  { command: 'removeFormat', label: 'Clear', title: 'Remove formatting' },
  { command: 'undo', label: '↶', title: 'Undo' },
  { command: 'redo', label: '↷', title: 'Redo' },
];

/** Drops the editor's inline styles and empty spans, keeping semantic markup. */
export function tidyHtml(html: string): string {
  return sanitizeHtml(html)
    .replace(/\s(style|class|data-[\w-]+)="[^"]*"/g, '')
    .replace(/<span>([\s\S]*?)<\/span>/g, '$1')
    .replace(/<(b)>/g, '<strong>')
    .replace(/<\/b>/g, '</strong>')
    .replace(/<(i)>/g, '<em>')
    .replace(/<\/i>/g, '</em>')
    .replace(/<div><br><\/div>/g, '')
    .replace(/<div>/g, '<p>')
    .replace(/<\/div>/g, '</p>')
    .replace(/<\/(p|h[1-6]|ul|ol|li|blockquote|pre|hr)>/g, '</$1>\n')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

function Wysiwyg() {
  const editor = useRef<HTMLDivElement>(null);
  const [html, setHtml] = useState(START);
  const [markdown, setMarkdown] = useState('');

  useEffect(() => {
    if (editor.current && editor.current.innerHTML === '') editor.current.innerHTML = START;
  }, []);

  useEffect(() => {
    let cancelled = false;
    void import('turndown').then(({ default: TurndownService }) => {
      if (cancelled) return;
      const service = new TurndownService({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-' });
      setMarkdown(`${service.turndown(html)}\n`);
    });
    return () => {
      cancelled = true;
    };
  }, [html]);

  const sync = () => setHtml(tidyHtml(editor.current?.innerHTML ?? ''));

  const run = (action: (typeof ACTIONS)[number]) => {
    editor.current?.focus();
    if (action.command === 'createLink') {
      const url = window.prompt('Link address', 'https://');
      if (!url) return;
      document.execCommand('createLink', false, url);
    } else document.execCommand(action.command, false, action.value);
    sync();
  };

  return (
    <section class="tool tool-wysiwyg" data-testid="tool" data-state="done">
      <div class="pane">
        <div class="pane-header wysiwyg-toolbar" role="toolbar" aria-label="Formatting">
          {ACTIONS.map((action) => (
            <button
              key={action.title}
              type="button"
              class="button button-small"
              title={action.title}
              aria-label={action.title}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => run(action)}
            >
              {action.label}
            </button>
          ))}
        </div>
        <div
          ref={editor}
          class="wysiwyg-editor prose"
          tabIndex={0}
          contentEditable
          spellcheck
          onInput={sync}
          onBlur={sync}
          data-testid="wysiwyg-editor"
          role="textbox"
          aria-multiline="true"
          aria-label="Rich text"
        />
      </div>
      <CodeOutput
        baseName="content"
        outputs={[
          { label: 'HTML', language: 'html', code: `${html}\n` },
          { label: 'Markdown', language: 'markdown', code: markdown },
        ]}
      />
    </section>
  );
}

export default defineCustomTool(Wysiwyg);
