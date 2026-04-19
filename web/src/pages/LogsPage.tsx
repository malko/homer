import { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, getActivePeer } from '../api';
import { useAuth } from '../hooks/useAuth';
import { parseAnsiSegments } from '../utils/ansi';

function AnsiLine({ line, index }: { line: string; index: number }) {
  const segments = parseAnsiSegments(line);
  return (
    <span key={index}>
      {segments.map((seg, i) => {
        const css: React.CSSProperties = {};
        if (seg.style.fg) css.color = seg.style.fg;
        if (seg.style.bg) css.backgroundColor = seg.style.bg;
        if (seg.style.bold) css.fontWeight = 'bold';
        if (seg.style.dim) css.opacity = 0.5;
        if (seg.style.italic) css.fontStyle = 'italic';
        if (seg.style.underline) css.textDecoration = 'underline';
        const hasStyle = Object.keys(css).length > 0;
        return hasStyle ? <span key={i} style={css}>{seg.text}</span> : seg.text;
      })}
    </span>
  );
}

export function LogsPage() {
  const [searchParams] = useSearchParams();
  const containerId = searchParams.get('containerId') ?? '';
  const containerName = searchParams.get('containerName') ?? containerId;
  const { status } = useAuth();

  const [logs, setLogs] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [following, setFollowing] = useState(true);
  const [wsConnected, setWsConnected] = useState(false);
  const logsScrollRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!containerId || !status?.authenticated) return;

    const fetchInitialLogs = async () => {
      try {
        const response = await api.containers.logs(containerId, 500);
        const lines = response.logs.split('\n').filter(Boolean);
        setLogs(lines);
      } catch {
        setLogs(['Failed to fetch logs']);
      } finally {
        setLoading(false);
      }
    };

    fetchInitialLogs();
  }, [containerId, status?.authenticated]);

  useEffect(() => {
    if (!containerId || !status?.authenticated) return;

    const token = localStorage.getItem('token');
    if (!token) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/api/events?token=${token}`);
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'subscribe_logs', containerId, peer_uuid: getActivePeer() }));
      setWsConnected(true);
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'log_line' && msg.containerId === containerId) {
          setLogs(prev => [...prev.slice(-499), msg.line]);
        }
      } catch {}
    };

    ws.onclose = () => setWsConnected(false);

    return () => {
      try { ws.send(JSON.stringify({ type: 'unsubscribe_logs', containerId })); } catch {}
      ws.close();
    };
  }, [containerId, status?.authenticated]);

  useEffect(() => {
    if (following && logsScrollRef.current) {
      logsScrollRef.current.scrollTop = logsScrollRef.current.scrollHeight;
    }
  }, [logs, following]);

  const handleMoveBack = () => {
    window.close();
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#0a0a0f', fontFamily: 'monospace' }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.75rem',
        padding: '0.35rem 0.75rem',
        background: '#0f172a',
        borderBottom: '1px solid #1e293b',
        flexShrink: 0,
      }}>
        <span style={{ fontSize: '0.8rem', color: '#94a3b8', fontWeight: 500 }}>
          Logs: {containerName}
        </span>
        <span style={{ fontSize: '0.7rem', color: wsConnected ? '#4ade80' : '#f87171' }}>
          {wsConnected ? '● streaming' : '○ disconnected'}
        </span>
        <span style={{ fontSize: '0.7rem', color: '#64748b' }}>
          {logs.length} lines
        </span>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', fontSize: '0.75rem', color: '#94a3b8', cursor: 'pointer', marginLeft: 'auto' }}>
          <input type="checkbox" checked={following} onChange={e => setFollowing(e.target.checked)} />
          Auto-scroll
        </label>
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
          ← Close
        </button>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }} ref={logsScrollRef}>
        {loading ? (
          <div style={{ padding: '1rem', color: '#64748b' }}>Loading logs...</div>
        ) : (
          <div style={{ padding: '0.5rem', fontSize: '0.75rem', lineHeight: '1.4', color: '#d4d4d4' }}>
            {logs.length === 0 ? (
              <span style={{ color: '#64748b' }}>No logs available</span>
            ) : (
              logs.map((line, i) => (
                <div key={i} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                  <AnsiLine line={line} index={i} />
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}