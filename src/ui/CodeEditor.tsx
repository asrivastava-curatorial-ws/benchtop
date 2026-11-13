/** A CodeMirror 6 editor wrapped as a controlled component. */

import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { xml } from '@codemirror/lang-xml';
import { yaml } from '@codemirror/lang-yaml';
import { bracketMatching, HighlightStyle, indentOnInput, syntaxHighlighting } from '@codemirror/language';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import { Compartment, EditorState, type Extension } from '@codemirror/state';
import {
  Decoration,
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  placeholder as placeholderExtension,
} from '@codemirror/view';
import { tags as t } from '@lezer/highlight';
import { useEffect, useRef } from 'preact/hooks';
import type { Lang } from '../tools/types';

function languageExtension(language: Lang): Extension {
  switch (language) {
    case 'json':
      return json();
    case 'javascript':
      return javascript();
    case 'jsx':
      return javascript({ jsx: true });
    case 'typescript':
      return javascript({ typescript: true, jsx: true });
    case 'html':
      return html();
    case 'css':
      return css();
    case 'xml':
      return xml();
    case 'markdown':
      return markdown();
    case 'yaml':
      return yaml();
    default:
      return [];
  }
}

/** Colours come from CSS custom properties, so one theme follows light and dark mode. */
const theme = EditorView.theme({
  '&': { color: 'var(--text)', backgroundColor: 'transparent', height: '100%', fontSize: 'var(--editor-font-size, 13px)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.55', overflow: 'auto' },
  '.cm-content': { caretColor: 'var(--accent)', padding: '8px 0' },
  '.cm-line': { padding: '0 12px 0 6px' },
  '.cm-gutters': { backgroundColor: 'transparent', color: 'var(--faint)', border: 'none', userSelect: 'none' },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 6px 0 12px', minWidth: '32px' },
  '.cm-activeLine': { backgroundColor: 'var(--editor-line)' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--text)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent)', borderLeftWidth: '2px' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: 'var(--editor-selection)',
  },
  '.cm-selectionMatch': { backgroundColor: 'var(--editor-match)' },
  '.cm-matchingBracket, .cm-nonmatchingBracket': { backgroundColor: 'var(--editor-match)', outline: '1px solid var(--line-strong)' },
  '.cm-placeholder': { color: 'var(--faint)', fontFamily: 'var(--font-ui)' },
  '.cm-error-line': { backgroundColor: 'var(--bad-soft)' },
  '.cm-panels': { backgroundColor: 'var(--panel-2)', color: 'var(--text)', borderColor: 'var(--line)' },
  '.cm-panels.cm-panels-bottom': { borderTop: '1px solid var(--line)' },
  '.cm-search': { fontFamily: 'var(--font-ui)', fontSize: '12px', padding: '6px 8px' },
  '.cm-textfield': { backgroundColor: 'var(--panel)', color: 'var(--text)', border: '1px solid var(--line-strong)', borderRadius: '4px', fontSize: '12px' },
  '.cm-button': { backgroundImage: 'none', backgroundColor: 'var(--panel)', color: 'var(--text)', border: '1px solid var(--line-strong)', borderRadius: '4px', fontSize: '12px' },
  '.cm-searchMatch': { backgroundColor: 'var(--warn-soft)', outline: '1px solid var(--warn)' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'var(--accent-soft)' },
});

const highlighting = syntaxHighlighting(
  HighlightStyle.define([
    { tag: [t.keyword, t.modifier, t.controlKeyword, t.operatorKeyword, t.definitionKeyword, t.moduleKeyword], color: 'var(--syn-keyword)' },
    { tag: [t.string, t.special(t.string), t.regexp, t.attributeValue], color: 'var(--syn-string)' },
    { tag: [t.number, t.bool, t.null, t.atom, t.unit], color: 'var(--syn-number)' },
    { tag: [t.comment, t.meta, t.documentMeta, t.processingInstruction], color: 'var(--syn-comment)', fontStyle: 'italic' },
    { tag: [t.propertyName, t.attributeName, t.definition(t.propertyName)], color: 'var(--syn-property)' },
    { tag: [t.tagName, t.typeName, t.className, t.namespace], color: 'var(--syn-tag)' },
    { tag: [t.function(t.variableName), t.function(t.propertyName), t.labelName], color: 'var(--syn-function)' },
    { tag: [t.heading, t.strong], fontWeight: '600' },
    { tag: t.emphasis, fontStyle: 'italic' },
    { tag: [t.link, t.url], color: 'var(--syn-property)', textDecoration: 'underline' },
    { tag: t.strikethrough, textDecoration: 'line-through' },
    { tag: t.invalid, color: 'var(--bad)' },
  ]),
);

export interface CodeEditorProps {
  readonly value: string;
  readonly onChange?: (value: string) => void;
  readonly language?: Lang;
  readonly readOnly?: boolean;
  readonly placeholder?: string;
  readonly wrap?: boolean;
  readonly label: string;
  /** 1-based line to mark as the location of an error. */
  readonly errorLine?: number;
  readonly testId?: string;
}

export function CodeEditor({ value, onChange, language = 'text', readOnly = false, placeholder = '', wrap = false, label, errorLine, testId }: CodeEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const handler = useRef(onChange);
  handler.current = onChange;
  /** The document text as last seen by the parent, to tell our own edits from outside changes. */
  const known = useRef(value);
  const compartments = useRef({ language: new Compartment(), wrap: new Compartment(), error: new Compartment(), placeholder: new Compartment() });

  useEffect(() => {
    if (!host.current) return;
    const parts = compartments.current;
    const created = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          highlightSpecialChars(),
          history(),
          drawSelection(),
          indentOnInput(),
          bracketMatching(),
          highlightSelectionMatches(),
          highlighting,
          theme,
          EditorState.readOnly.of(readOnly),
          EditorState.tabSize.of(2),
          EditorView.contentAttributes.of({ 'aria-label': label, spellcheck: 'false', autocorrect: 'off', autocapitalize: 'off' }),
          keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, ...(readOnly ? [] : [indentWithTab])]),
          ...(readOnly ? [] : [highlightActiveLine(), highlightActiveLineGutter()]),
          parts.language.of(languageExtension(language)),
          parts.wrap.of(wrap ? EditorView.lineWrapping : []),
          parts.error.of([]),
          parts.placeholder.of(placeholder ? placeholderExtension(placeholder) : []),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;
            const text = update.state.doc.toString();
            known.current = text;
            handler.current?.(text);
          }),
        ],
      }),
    });
    view.current = created;
    return () => {
      created.destroy();
      view.current = null;
    };
  }, []);

  useEffect(() => {
    const editor = view.current;
    if (!editor || value === known.current) return;
    known.current = value;
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value }, selection: { anchor: 0 }, scrollIntoView: false });
  }, [value]);

  useEffect(() => {
    view.current?.dispatch({ effects: compartments.current.language.reconfigure(languageExtension(language)) });
  }, [language]);

  useEffect(() => {
    view.current?.dispatch({ effects: compartments.current.wrap.reconfigure(wrap ? EditorView.lineWrapping : []) });
  }, [wrap]);

  useEffect(() => {
    view.current?.dispatch({ effects: compartments.current.placeholder.reconfigure(placeholder ? placeholderExtension(placeholder) : []) });
  }, [placeholder]);

  useEffect(() => {
    const editor = view.current;
    if (!editor) return;
    const valid = errorLine !== undefined && errorLine >= 1 && errorLine <= editor.state.doc.lines;
    const decorations = valid ? EditorView.decorations.of(Decoration.set([Decoration.line({ class: 'cm-error-line' }).range(editor.state.doc.line(errorLine).from)])) : [];
    editor.dispatch({ effects: compartments.current.error.reconfigure(decorations) });
  }, [errorLine, value]);

  return <div ref={host} class="editor" data-testid={testId} data-readonly={readOnly ? 'true' : undefined} />;
}
