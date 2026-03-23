import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

export interface TerminalHandle {
  /** Write raw bytes (base64-encoded) coming from the backend PTY */
  writeB64: (b64: string) => void;
  focus: () => void;
  resize: () => void;
  getDimensions: () => { cols: number; rows: number };
}

interface TerminalPanelProps {
  /** Called when the user types anything (raw terminal data as binary string) */
  onData: (data: string) => void;
  /** Called after a resize with the new cols/rows */
  onResize: (cols: number, rows: number) => void;
  /** Terminal history to replay on mount (binary string from previous session) */
  initialContent?: string;
  /** Ref exposed to the parent so it can write / focus / resize */
  handle: React.RefObject<TerminalHandle | null>;
}

export function TerminalPanel({ onData, onResize, initialContent, handle }: TerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const onDataRef = useRef(onData);
  const onResizeRef = useRef(onResize);
  onDataRef.current = onData;
  onResizeRef.current = onResize;

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      lineHeight: 1.4,
      fontFamily: "'Fira Code', 'Cascadia Code', 'Consolas', 'Liberation Mono', monospace",
      theme: {
        background:    '#0a0a0f',
        foreground:    '#d4d4d4',
        cursor:        '#4ade80',
        cursorAccent:  '#0a0a0f',
        selectionBackground: '#264f7880',
        black:         '#1e1e2e',
        red:           '#f38ba8',
        green:         '#a6e3a1',
        yellow:        '#f9e2af',
        blue:          '#89b4fa',
        magenta:       '#cba6f7',
        cyan:          '#89dceb',
        white:         '#cdd6f4',
        brightBlack:   '#585b70',
        brightRed:     '#f38ba8',
        brightGreen:   '#a6e3a1',
        brightYellow:  '#f9e2af',
        brightBlue:    '#89b4fa',
        brightMagenta: '#cba6f7',
        brightCyan:    '#89dceb',
        brightWhite:   '#ffffff',
      },
      scrollback: 5000,
      convertEol: false,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef.current);

    // Replay session history (binary string → Uint8Array)
    if (initialContent) {
      term.write(Uint8Array.from([...initialContent].map(c => c.charCodeAt(0))));
    }

    fitAddon.fit();
    term.focus();

    // Expose handle to parent
    (handle as React.MutableRefObject<TerminalHandle>).current = {
      writeB64: (b64: string) => {
        const binary = atob(b64);
        term.write(Uint8Array.from([...binary].map(c => c.charCodeAt(0))));
      },
      focus: () => term.focus(),
      resize: () => {
        try { fitAddon.fit(); } catch {}
        onResizeRef.current(term.cols, term.rows);
      },
      getDimensions: () => ({ cols: term.cols, rows: term.rows }),
    };

    term.onData(data => onDataRef.current(data));

    const ro = new ResizeObserver(() => {
      try { fitAddon.fit(); } catch {}
      onResizeRef.current(term.cols, term.rows);
    });
    ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      term.dispose();
      (handle as React.MutableRefObject<TerminalHandle | null>).current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%', background: '#0a0a0f' }}
    />
  );
}
