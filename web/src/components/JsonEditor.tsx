import { useEffect, useRef, useState, useCallback } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLineGutter, highlightSpecialChars, drawSelection, dropCursor, rectangularSelection, crosshairCursor, highlightActiveLine } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import type { KeyBinding } from '@codemirror/view';
import { json } from '@codemirror/lang-json';
import { syntaxHighlighting, HighlightStyle, bracketMatching, foldGutter, indentOnInput, indentUnit } from '@codemirror/language';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { tags } from '@lezer/highlight';

const editorColors = {
  bg: '#0f172a',
  text: '#e2e8f0',
  textMuted: '#64748b',
  border: '#334155',
  primary: '#3b82f6',
  selection: 'rgba(59, 130, 246, 0.3)',
  activeLine: 'rgba(59, 130, 246, 0.1)',
  gutter: '#1e293b',
  error: '#ef4444',
};

const jsonHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: '#c792ea' },
  { tag: tags.operator, color: '#89ddff' },
  { tag: tags.number, color: '#f78c6c' },
  { tag: tags.string, color: '#c3e88d' },
  { tag: tags.bool, color: '#f78c6c' },
  { tag: tags.null, color: '#f78c6c' },
  { tag: tags.propertyName, color: '#82aaff' },
  { tag: tags.bracket, color: '#89ddff' },
  { tag: tags.punctuation, color: '#89ddff' },
  { tag: tags.separator, color: '#89ddff' },
]);

const darkTheme = EditorView.theme({
  '&': {
    backgroundColor: editorColors.bg,
    color: editorColors.text,
    fontSize: '0.8125rem',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  },
  '.cm-content': {
    caretColor: editorColors.primary,
    padding: '0.5rem 0',
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: editorColors.primary,
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
    backgroundColor: editorColors.selection,
  },
  '.cm-activeLine': {
    backgroundColor: editorColors.activeLine,
  },
  '.cm-gutters': {
    backgroundColor: editorColors.gutter,
    color: editorColors.textMuted,
    border: 'none',
    borderRight: `1px solid ${editorColors.border}`,
  },
  '.cm-activeLineGutter': {
    backgroundColor: editorColors.activeLine,
  },
  '.cm-foldPlaceholder': {
    backgroundColor: editorColors.gutter,
    border: 'none',
    color: editorColors.textMuted,
  },
  '.cm-tooltip': {
    backgroundColor: editorColors.gutter,
    border: `1px solid ${editorColors.border}`,
    color: editorColors.text,
  },
}, { dark: true });

interface JsonEditorProps {
  value: string;
  onChange: (value: string) => void;
  onValidate?: (isValid: boolean, error: string | null) => void;
  readOnly?: boolean;
  minHeight?: string;
}

export function JsonEditor({ value, onChange, onValidate, readOnly = false, minHeight = '300px' }: JsonEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const runValidation = useCallback((content: string) => {
    try {
      if (content.trim()) {
        JSON.parse(content);
      }
      setError(null);
      onValidate?.(true, null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Invalid JSON';
      setError(message);
      onValidate?.(false, message);
    }
  }, [onValidate]);

  useEffect(() => {
    if (!editorRef.current) return;

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        const newValue = update.state.doc.toString();
        onChange(newValue);
        runValidation(newValue);
      }
    });

    const extensions = [
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightSpecialChars(),
      history(),
      foldGutter(),
      drawSelection(),
      dropCursor(),
      EditorState.allowMultipleSelections.of(true),
      indentOnInput(),
      syntaxHighlighting(jsonHighlightStyle),
      bracketMatching(),
      closeBrackets(),
      rectangularSelection(),
      crosshairCursor(),
      highlightActiveLine(),
      indentUnit.of('  '),
      keymap.of([
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...historyKeymap,
        indentWithTab,
      ] satisfies KeyBinding[]),
      json(),
      darkTheme,
      updateListener,
    ];

    if (readOnly) {
      extensions.push(EditorState.readOnly.of(true));
    }

    const state = EditorState.create({
      doc: value,
      extensions,
    });

    const view = new EditorView({
      state,
      parent: editorRef.current,
    });

    viewRef.current = view;
    runValidation(value);

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (viewRef.current) {
      const currentValue = viewRef.current.state.doc.toString();
      if (currentValue !== value) {
        viewRef.current.dispatch({
          changes: { from: 0, to: currentValue.length, insert: value },
        });
      }
    }
  }, [value]);

  return (
    <div className="yaml-editor-wrapper">
      <div
        ref={editorRef}
        className="yaml-editor"
        style={{ minHeight }}
      />
      {error && (
        <div className="yaml-errors">
          <div className="yaml-errors-header">
            <span className="yaml-errors-icon">&#9888;</span>
            <span>JSON Error</span>
          </div>
          <ul className="yaml-errors-list">
            <li>{error}</li>
          </ul>
        </div>
      )}
    </div>
  );
}
