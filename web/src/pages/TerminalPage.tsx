import { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { TerminalPanel } from '../components/TerminalPanel';
import type { TerminalHandle } from '../components/TerminalPanel';

export function TerminalPage() {
  const [searchParams] = useSearchParams();
  const containerId = searchParams.get('containerId') ?? '';
  const containerName = searchParams.get('containerName') ?? containerId;
  const initCols = Number(searchParams.get('cols')) || 80;
  const initRows = Number(searchParams.get('rows')) || 24;

  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const terminalHandle = useRef<TerminalHandle | null>(null);
  const historyRef = useRef('');
  const historySnap = useRef('');

  // Handshake: signal ready → receive history from parent tab
  useEffect(() => {
    const handle = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      if (e.data?.type === 'terminal_init' && typeof e.data.history === 'string') {
        historyRef.current = e.data.history;
        historySnap.current = e.data.history;
        // Write history into the xterm.js terminal
        if (e.data.history && terminalHandle.current) {
          const binary = e.data.history as string;
          const b64 = btoa([...binary].map(c => c.charCodeAt(0) < 256 ? c : '?').join(''));
          terminalHandle.current.writeB64(b64);
        }
      }
    };
    window.addEventListener('message', handle);
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage({ type: 'terminal_ready' }, window.location.origin);
    }
    return () => window.removeEventListener('message', handle);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // WebSocket session
  useEffect(() => {
    if (!containerId) return;
    const token = localStorage.getItem('token');
    if (!token) return;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/api/events?token=${token}`);
    wsRef.current = ws;

    ws.onopen = () => {
      const cols = terminalHandle.current?.getDimensions().cols ?? initCols;
      const rows = terminalHandle.current?.getDimensions().rows ?? initRows;
      ws.send(JSON.stringify({ type: 'subscribe_terminal', containerId, cols, rows }));
      setConnected(true);
      terminalHandle.current?.focus();
    };
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'terminal_output' && msg.containerId === containerId) {
          const binary = atob(msg.data as string);
          historyRef.current += binary;
          historySnap.current = historyRef.current;
          if (historyRef.current.length > 200000) {
            historyRef.current = historyRef.current.slice(-200000);
            historySnap.current = historyRef.current;
          }
          terminalHandle.current?.writeB64(msg.data as string);
        } else if (msg.type === 'terminal_exit' && msg.containerId === containerId) {
          setConnected(false);
        }
      } catch {}
    };
    ws.onclose = () => setConnected(false);
    ws.onerror = () => ws.close();

    return () => {
      wsRef.current = null;
      try { ws.send(JSON.stringify({ type: 'unsubscribe_terminal', containerId })); } catch {}
      ws.close();
    };
  }, [containerId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleData = useCallback((data: string) => {
    if (!wsRef.current || !connected) return;
    wsRef.current.send(JSON.stringify({ type: 'terminal_input', containerId, data }));
  }, [connected, containerId]);

  const handleResize = useCallback((cols: number, rows: number) => {
    if (!wsRef.current) return;
    wsRef.current.send(JSON.stringify({ type: 'terminal_resize', containerId, cols, rows }));
  }, [containerId]);

  const handleMoveBack = () => {
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage(
        { type: 'terminal_back', history: historySnap.current },
        window.location.origin
      );
    }
    window.close();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#0a0a0f' }}>
      {/* Compact titlebar — no macOS dots */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.75rem',
        padding: '0.35rem 0.75rem',
        background: '#0f172a',
        borderBottom: '1px solid #1e293b',
        flexShrink: 0,
        fontFamily: 'system-ui, sans-serif',
      }}>
        <span style={{ fontSize: '0.8rem', color: '#94a3b8', fontWeight: 500 }}>
          {containerName}
        </span>
        <span style={{ fontSize: '0.7rem', color: connected ? '#4ade80' : '#f87171' }}>
          {connected ? '● connected' : '○ disconnected'}
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem' }}>
          <button
            onClick={handleMoveBack}
            style={{
              background: 'transparent',
              border: '1px solid #334155',
              color: '#94a3b8',
              borderRadius: '0.25rem',
              padding: '0.2rem 0.6rem',
              fontSize: '0.75rem',
              cursor: 'pointer',
            }}
          >
            ← Move back to tab
          </button>
          <button
            onClick={() => window.close()}
            style={{
              background: 'transparent',
              border: '1px solid #334155',
              color: '#94a3b8',
              borderRadius: '0.25rem',
              padding: '0.2rem 0.5rem',
              fontSize: '0.75rem',
              cursor: 'pointer',
            }}
            title="Close window"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Full-height xterm.js terminal */}
      <div style={{ flex: 1, minHeight: 0 }}>
        <TerminalPanel
          handle={terminalHandle}
          onData={handleData}
          onResize={handleResize}
        />
      </div>
    </div>
  );
}
