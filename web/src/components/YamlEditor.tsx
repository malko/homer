import { useEffect, useRef, useState, useCallback } from 'react';
import { EditorState, Extension, Transaction } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLineGutter, highlightSpecialChars, drawSelection, dropCursor, rectangularSelection, crosshairCursor, highlightActiveLine } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab, indentLess, insertTab, insertNewlineAndIndent } from '@codemirror/commands';
import type { KeyBinding } from '@codemirror/view';
import { yaml } from '@codemirror/lang-yaml';
import { syntaxHighlighting, HighlightStyle, bracketMatching, foldGutter, indentOnInput, indentUnit } from '@codemirror/language';
import { closeBrackets, closeBracketsKeymap, autocompletion, completionKeymap } from '@codemirror/autocomplete';
import { tags } from '@lezer/highlight';
import type { CompletionContext, CompletionSource } from '@codemirror/autocomplete';

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
  warning: '#f59e0b',
};

const yamlHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: '#c792ea' },
  { tag: tags.operator, color: '#89ddff' },
  { tag: tags.special(tags.variableName), color: '#eeffff' },
  { tag: tags.typeName, color: '#ffcb6b' },
  { tag: tags.atom, color: '#f78c6c' },
  { tag: tags.number, color: '#f78c6c' },
  { tag: tags.definition(tags.variableName), color: '#82aaff' },
  { tag: tags.string, color: '#c3e88d' },
  { tag: tags.special(tags.string), color: '#c3e88d' },
  { tag: tags.comment, color: '#546e7a', fontStyle: 'italic' },
  { tag: tags.variableName, color: '#eeffff' },
  { tag: tags.tagName, color: '#f07178' },
  { tag: tags.bracket, color: '#89ddff' },
  { tag: tags.meta, color: '#ffcb6b' },
  { tag: tags.link, color: '#82aaff', textDecoration: 'underline' },
  { tag: tags.heading, color: '#c792ea', fontWeight: 'bold' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strong, fontWeight: 'bold' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: tags.className, color: '#ffcb6b' },
  { tag: tags.propertyName, color: '#82aaff' },
  { tag: tags.function(tags.variableName), color: '#82aaff' },
  { tag: tags.bool, color: '#f78c6c' },
  { tag: tags.null, color: '#f78c6c' },
  { tag: tags.punctuation, color: '#89ddff' },
  { tag: tags.separator, color: '#89ddff' },
]);

const composeCompletions = [
  { label: 'services', type: 'keyword', detail: 'Define services' },
  { label: 'image', type: 'property', detail: 'Container image' },
  { label: 'build', type: 'property', detail: 'Build configuration' },
  { label: 'ports', type: 'property', detail: 'Port mappings' },
  { label: 'volumes', type: 'property', detail: 'Volume mounts' },
  { label: 'environment', type: 'property', detail: 'Environment variables' },
  { label: 'env_file', type: 'property', detail: 'Environment file' },
  { label: 'command', type: 'property', detail: 'Container command' },
  { label: 'entrypoint', type: 'property', detail: 'Container entrypoint' },
  { label: 'restart', type: 'property', detail: 'Restart policy' },
  { label: 'networks', type: 'property', detail: 'Network names' },
  { label: 'network_mode', type: 'property', detail: 'Network mode (host/bridge)' },
  { label: 'depends_on', type: 'property', detail: 'Service dependencies' },
  { label: 'privileged', type: 'property', detail: 'Privileged mode' },
  { label: 'cap_add', type: 'property', detail: 'Add capabilities' },
  { label: 'cap_drop', type: 'property', detail: 'Drop capabilities' },
  { label: 'extra_hosts', type: 'property', detail: 'Extra host entries' },
  { label: 'deploy', type: 'property', detail: 'Deployment configuration' },
  { label: 'resources', type: 'property', detail: 'Resource limits' },
  { label: 'reservations', type: 'property', detail: 'Resource reservations' },
  { label: 'devices', type: 'property', detail: 'Device mappings' },
  { label: 'driver', type: 'property', detail: 'Driver name' },
  { label: 'count', type: 'property', detail: 'Device count' },
  { label: 'capabilities', type: 'property', detail: 'Device capabilities' },
  { label: 'gpu', type: 'keyword', detail: 'GPU capability' },
  { label: 'labels', type: 'property', detail: 'Container labels' },
  { label: 'healthcheck', type: 'property', detail: 'Health check config' },
  { label: 'test', type: 'property', detail: 'Health check command' },
  { label: 'interval', type: 'property', detail: 'Check interval' },
  { label: 'timeout', type: 'property', detail: 'Check timeout' },
  { label: 'retries', type: 'property', detail: 'Retry count' },
  { label: 'user', type: 'property', detail: 'Run as user' },
  { label: 'working_dir', type: 'property', detail: 'Working directory' },
  { label: 'hostname', type: 'property', detail: 'Container hostname' },
  { label: 'dns', type: 'property', detail: 'DNS servers' },
  { label: 'expose', type: 'property', detail: 'Expose ports' },
  { label: 'external_links', type: 'property', detail: 'External links' },
  { label: 'pull_policy', type: 'property', detail: 'Image pull policy' },
  { label: 'profiles', type: 'property', detail: 'Compose profiles' },
  { label: 'secrets', type: 'property', detail: 'Secrets configuration' },
  { label: 'configs', type: 'property', detail: 'Configs configuration' },
  { label: 'logging', type: 'property', detail: 'Logging configuration' },
  { label: 'options', type: 'property', detail: 'Log options' },
  { label: 'networks', type: 'keyword', detail: 'Define networks' },
  { label: 'name', type: 'property', detail: 'Network name' },
  { label: 'driver', type: 'property', detail: 'Network driver' },
  { label: 'driver_opts', type: 'property', detail: 'Driver options' },
  { label: 'ipam', type: 'property', detail: 'IPAM config' },
  { label: 'volumes', type: 'keyword', detail: 'Define volumes' },
  { label: 'driver_opts', type: 'property', detail: 'Volume options' },
  { label: 'always', type: 'keyword', detail: 'Restart always' },
  { label: 'on-failure', type: 'keyword', detail: 'Restart on failure' },
  { label: 'unless-stopped', type: 'keyword', detail: 'Restart unless stopped' },
  { label: 'no', type: 'keyword', detail: 'No restart' },
  { label: 'host', type: 'keyword', detail: 'Host network mode' },
  { label: 'bridge', type: 'keyword', detail: 'Bridge network mode' },
  { label: 'nvidia', type: 'keyword', detail: 'NVIDIA driver' },
  { label: 'limits', type: 'property', detail: 'Resource limits' },
];

const composeCompletion: CompletionSource = (context: CompletionContext) => {
  const word = context.matchBefore(/\w*/);
  if (!word || (word.from === word.to && !context.explicit)) return null;
  return {
    from: word.from,
    options: composeCompletions.map(c => ({
      label: c.label,
      type: c.type,
      detail: c.detail,
      apply: c.label,
    })),
  };
};

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
  '.cm-tooltip-autocomplete': {
    '& > ul > li[aria-selected]': {
      backgroundColor: editorColors.selection,
    },
  },
  '.cm-completionIcon': {
    opacity: '0.7',
  },
  '.cm-lineError': {
    textDecoration: 'underline wavy',
    textDecorationColor: editorColors.error,
  },
}, { dark: true });

interface YamlEditorProps {
  value: string;
  onChange: (value: string) => void;
  onValidate?: (isValid: boolean, errors: string[]) => void;
  placeholder?: string;
  minHeight?: string;
}

function basicYamlValidation(content: string): string[] {
  const errors: string[] = [];
  const lines = content.split('\n');
  
  let indentStack: number[] = [0];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;
    
    if (line.trim() === '' || line.trim().startsWith('#')) continue;
    
    const indent = line.search(/\S/);
    if (indent === -1) continue;
    
    const trimmedLine = line.trim();
    
    if (trimmedLine.includes(':')) {
      const keyPart = trimmedLine.split(':')[0];
      if (keyPart && !keyPart.includes('#')) {
        if (keyPart.match(/^[\w-]+$/)) {
          const afterColon = trimmedLine.split(':')[1]?.trim();
          if (!afterColon && i + 1 < lines.length) {
            const nextLine = lines[i + 1];
            const nextIndent = nextLine.search(/\S/);
            if (nextIndent <= indent) {
              errors.push(`Line ${lineNum}: Empty value for key "${keyPart}"`);
            }
          }
        }
      }
    }
    
    if (trimmedLine.match(/^\[.*\]$/) || trimmedLine.match(/^\{.*\}$/)) {
      errors.push(`Line ${lineNum}: Flow sequences/flows not recommended in YAML`);
    }
    
    if (trimmedLine.includes('\t')) {
      errors.push(`Line ${lineNum}: Tabs are not allowed in YAML, use spaces`);
    }
    
    const yamlSensitiveChars = trimmedLine.match(/'/g);
    if (yamlSensitiveChars && yamlSensitiveChars.length % 2 !== 0) {
      errors.push(`Line ${lineNum}: Unmatched single quote`);
    }
    
    const yamlDoubleQuotes = trimmedLine.match(/"/g);
    if (yamlDoubleQuotes && yamlDoubleQuotes.length % 2 !== 0) {
      errors.push(`Line ${lineNum}: Unmatched double quote`);
    }
  }
  
  return errors;
}

export function YamlEditor({ value, onChange, onValidate, minHeight = '150px' }: YamlEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  const runValidation = useCallback((content: string) => {
    const validationErrors = basicYamlValidation(content);
    setErrors(validationErrors);
    onValidate?.(validationErrors.length === 0, validationErrors);
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

    const state = EditorState.create({
      doc: value,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightSpecialChars(),
        history(),
        foldGutter(),
        drawSelection(),
        dropCursor(),
        EditorState.allowMultipleSelections.of(true),
        indentOnInput(),
        syntaxHighlighting(yamlHighlightStyle),
        bracketMatching(),
        closeBrackets(),
        autocompletion({
          override: [composeCompletion],
        }),
        rectangularSelection(),
        crosshairCursor(),
        highlightActiveLine(),
        indentUnit.of('  '),
        keymap.of([
          ...closeBracketsKeymap,
          ...defaultKeymap,
          ...historyKeymap,
          ...completionKeymap,
          indentWithTab,
        ] satisfies KeyBinding[]),
        keymap.of([{ key: 'Enter', run: insertNewlineAndIndent }]),
        yaml(),
        darkTheme,
        updateListener,
      ],
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
          changes: {
            from: 0,
            to: currentValue.length,
            insert: value,
          },
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
      {errors.length > 0 && (
        <div className="yaml-errors">
          <div className="yaml-errors-header">
            <span className="yaml-errors-icon">&#9888;</span>
            <span>Validation Errors ({errors.length})</span>
          </div>
          <ul className="yaml-errors-list">
            {errors.map((error, i) => (
              <li key={i}>{error}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
