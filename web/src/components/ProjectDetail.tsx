import { useState, useEffect, useRef, useCallback } from 'react';
import { YamlEditor } from './YamlEditor';
import { TerminalPanel } from './TerminalPanel';
import type { TerminalHandle } from './TerminalPanel';
import { ContainerRow } from './ContainerRow';
import { api, type AutoUpdatePolicy } from '../api';
import type { Project, Container, ProxyHost, ProxyHostInput } from '../api';
import { useProxyHosts } from '../hooks/useProxyHosts';
import { useConfirm } from '../hooks/useConfirm.js';
import { ProxyHostForm } from './ProxyHostForm';
import { ProxyHostList } from './ProxyHostList';
import '../styles/proxy.css';

export type TabType = 'overview' | 'logs' | 'compose' | 'env' | 'terminal' | 'proxy';
type ToastType = 'success' | 'error' | 'warning';

// ─── ANSI → HTML ─────────────────────────────────────────────────────────────

const ANSI_FG: Record<number, string> = {
  30: '#4c4c4c', 31: '#cd3131', 32: '#0dbc79', 33: '#e5e510',
  34: '#2472c8', 35: '#bc3fbc', 36: '#11a8cd', 37: '#e5e5e5',
  90: '#767676', 91: '#f14c4c', 92: '#23d18b', 93: '#f5f543',
  94: '#3b8eea', 95: '#d670d6', 96: '#29b8db', 97: '#ffffff',
};
const ANSI_BG: Record<number, string> = {
  40: '#000000', 41: '#cd3131', 42: '#0dbc79', 43: '#e5e510',
  44: '#2472c8', 45: '#bc3fbc', 46: '#11a8cd', 47: '#e5e5e5',
  100: '#767676', 101: '#f14c4c', 102: '#23d18b', 103: '#f5f543',
  104: '#3b8eea', 105: '#d670d6', 106: '#29b8db', 107: '#ffffff',
};

function ansi256ToColor(n: number): string {
  if (n < 16) {
    const p = ['#000000','#800000','#008000','#808000','#000080','#800080','#008080','#c0c0c0',
               '#808080','#ff0000','#00ff00','#ffff00','#0000ff','#ff00ff','#00ffff','#ffffff'];
    return p[n] ?? '#ffffff';
  }
  if (n < 232) {
    const idx = n - 16;
    const b = idx % 6, g = Math.floor(idx / 6) % 6, r = Math.floor(idx / 36);
    const v = (x: number) => x === 0 ? 0 : 55 + x * 40;
    return `rgb(${v(r)},${v(g)},${v(b)})`;
  }
  const lv = (n - 232) * 10 + 8;
  return `rgb(${lv},${lv},${lv})`;
}

interface AnsiStyle { fg: string | null; bg: string | null; bold: boolean; dim: boolean; italic: boolean; underline: boolean; }
interface AnsiSegment { text: string; style: AnsiStyle; }

function parseAnsiSegments(raw: string): AnsiSegment[] {
  const text = raw
    .replace(/\r/g, '')
    .replace(/\x1b\[[0-9;]*[ABCDEFGHIJKLMSTPsuhr]/g, '')
    .replace(/\x1b[()][A-Z0-9]/g, '');

  let style: AnsiStyle = { fg: null, bg: null, bold: false, dim: false, italic: false, underline: false };
  const segments: AnsiSegment[] = [];
  const seqRe = /\x1b\[([0-9;]*)m/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = seqRe.exec(text)) !== null) {
    const before = text.slice(lastIndex, match.index);
    if (before) segments.push({ text: before, style: { ...style } });
    lastIndex = match.index + match[0].length;

    const params = match[1] === '' ? [0] : match[1].split(';').map(Number);
    let i = 0;
    while (i < params.length) {
      const c = params[i];
      if (c === 0) style = { fg: null, bg: null, bold: false, dim: false, italic: false, underline: false };
      else if (c === 1) style.bold = true;
      else if (c === 2) style.dim = true;
      else if (c === 3) style.italic = true;
      else if (c === 4) style.underline = true;
      else if (c === 22) { style.bold = false; style.dim = false; }
      else if (c === 23) style.italic = false;
      else if (c === 24) style.underline = false;
      else if (c === 39) style.fg = null;
      else if (c === 49) style.bg = null;
      else if ((c >= 30 && c <= 37) || (c >= 90 && c <= 97)) style.fg = ANSI_FG[c] ?? null;
      else if ((c >= 40 && c <= 47) || (c >= 100 && c <= 107)) style.bg = ANSI_BG[c] ?? null;
      else if (c === 38 && params[i + 1] === 5 && i + 2 < params.length) { style.fg = ansi256ToColor(params[i + 2]); i += 2; }
      else if (c === 38 && params[i + 1] === 2 && i + 4 < params.length) { style.fg = `rgb(${params[i+2]},${params[i+3]},${params[i+4]})`; i += 4; }
      else if (c === 48 && params[i + 1] === 5 && i + 2 < params.length) { style.bg = ansi256ToColor(params[i + 2]); i += 2; }
      else if (c === 48 && params[i + 1] === 2 && i + 4 < params.length) { style.bg = `rgb(${params[i+2]},${params[i+3]},${params[i+4]})`; i += 4; }
      i++;
    }
  }

  const remaining = text.slice(lastIndex);
  if (remaining) segments.push({ text: remaining, style: { ...style } });
  return segments;
}

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

interface ProjectDetailProps {
  project: Project;
  onRefresh: () => void;
  onDelete: () => void;
  addToast: (type: ToastType, message: string) => void;
  initialTab?: TabType;
  onTabChange?: (tab: TabType) => void;
}



function SettingToggle({ label, description, value, onChange }: {
  label: string;
  description: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.75rem', backgroundColor: 'var(--color-bg-secondary)', borderRadius: '0.5rem', border: '1px solid var(--color-border)' }}>
      <div>
        <div style={{ fontSize: '0.875rem', fontWeight: 500 }}>{label}</div>
        <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '0.125rem' }}>{description}</div>
      </div>
      <div className={`toggle ${value ? 'toggle-active' : ''}`} onClick={() => onChange(!value)}>
        <div className="toggle-handle" />
      </div>
    </div>
  );
}

const AUTO_UPDATE_POLICY_LABELS: Record<AutoUpdatePolicy, string> = {
  disabled: 'Désactivée',
  all: 'Toutes les mises à jour',
  semver_minor: 'Mises à jour mineures (1.x.x)',
  semver_patch: 'Patches uniquement (1.2.x)',
};

function SettingSelect({ label, description, value, options, onChange }: {
  label: string;
  description: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <div style={{ padding: '0.75rem', backgroundColor: 'var(--color-bg-secondary)', borderRadius: '0.5rem', border: '1px solid var(--color-border)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
        <div>
          <div style={{ fontSize: '0.875rem', fontWeight: 500 }}>{label}</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '0.125rem' }}>{description}</div>
        </div>
        <select
          className="input"
          style={{ width: 'auto', flexShrink: 0, fontSize: '0.8125rem' }}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          {options.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

export function ProjectDetail({ project, onRefresh, onDelete, addToast, initialTab, onTabChange }: ProjectDetailProps) {
  const { ConfirmDialog, confirm } = useConfirm();
  const [activeTab, setActiveTab] = useState<TabType>(initialTab ?? 'overview');

  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab);
    onTabChange?.(tab);
  };
  const { hosts: proxyHosts, loading: proxyLoading, createHost, updateHost, deleteHost, toggleHost, refetch: refetchProxy } = useProxyHosts(project.id);

  // Action states
  const [updating, setUpdating] = useState(false);
  const [checkingUpdates, setCheckingUpdates] = useState(false);

  // Deploy panel state
  const [composePanelOpen, setComposePanelOpen] = useState(false);
  const [composePanelType, setComposePanelType] = useState<'deploy' | 'down'>('deploy');
  const [deployLines, setDeployLines] = useState<string[]>([]);
  const [deployRunning, setDeployRunning] = useState(false);
  const deployWsRef = useRef<WebSocket | null>(null);
  const deployScrollRef = useRef<HTMLDivElement | null>(null);

  // Down panel state (merged into compose panel)
  const [downLines, setDownLines] = useState<string[]>([]);
  const [downRunning, setDownRunning] = useState(false);
  const downWsRef = useRef<WebSocket | null>(null);
  const downScrollRef = useRef<HTMLDivElement | null>(null);

  // Delete modal state
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteOpts, setDeleteOpts] = useState({ composeDown: false, removeVolumes: false, deleteFiles: false });
  const [deleting, setDeleting] = useState(false);

  // File editor state (lazy: loaded on first compose/env tab visit)
  const [composeContent, setComposeContent] = useState('');
  const [envContent, setEnvContent] = useState('');
  const [hasEnvFile, setHasEnvFile] = useState(false);
  const [filesLoaded, setFilesLoaded] = useState(false);
  const [fileLoading, setFileLoading] = useState(false);
  const [fileSaving, setFileSaving] = useState(false);
  const [fileValidating, setFileValidating] = useState(false);
  const [composeErrors, setComposeErrors] = useState<string[]>([]);

  // Logs state (lazy: loaded on first logs tab visit)
  const [logs, setLogs] = useState<Record<string, string[]>>({});
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsInitialized, setLogsInitialized] = useState(false);
  const [following, setFollowing] = useState(true);
  const [selectedContainerId, setSelectedContainerId] = useState<string | null>(null);
  const logsScrollRef = useRef<HTMLDivElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<number | undefined>(undefined);

  // Terminal state
  const [terminalContainerId, setTerminalContainerId] = useState<string | null>(
    () => project.containers.find(c => c.state === 'running')?.id ?? project.containers[0]?.id ?? null
  );
  const [terminalConnected, setTerminalConnected] = useState(false);
  const terminalWsRef = useRef<WebSocket | null>(null);
  const terminalWindowRef = useRef<Window | null>(null);
  const terminalHandle = useRef<TerminalHandle | null>(null);
  // Accumulated raw PTY history (binary string) for replay and postMessage
  const terminalHistoryRef = useRef('');
  // Snapshot ref so event handlers always see the latest history without re-registering
  const terminalHistorySnap = useRef('');

  const fileLoadAttempted = useRef(false);

  // Load files when first visiting compose or env tab
  useEffect(() => {
    if ((activeTab === 'compose' || activeTab === 'env') && !fileLoadAttempted.current) {
      fileLoadAttempted.current = true;
      setFileLoading(true);
      (async () => {
        try {
          const files = await api.projects.readFiles(project.id);
          setComposeContent(files.composeContent);
          setEnvContent(files.envContent || '');
          setHasEnvFile(!!files.envPath && !!files.envContent);
          setFilesLoaded(true);
        } catch (err) {
          addToast('error', err instanceof Error ? err.message : 'Failed to load files');
        } finally {
          setFileLoading(false);
        }
      })();
    }
  }, [activeTab, project.id]);

  // WebSocket logs: connect when on logs tab, cleanup when leaving
  useEffect(() => {
    if (activeTab !== 'logs') {
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      if (wsRef.current) {
        const ws = wsRef.current;
        wsRef.current = null; // prevent reconnect in onclose
        for (const c of project.containers) {
          try { ws.send(JSON.stringify({ type: 'unsubscribe_logs', containerId: c.id })); } catch {}
        }
        ws.close();
      }
      return;
    }

    // Fetch initial logs on first visit
    if (!logsInitialized) {
      setLogsInitialized(true);
      setLogsLoading(true);
      (async () => {
        const initialLogs: Record<string, string[]> = {};
        for (const container of project.containers) {
          try {
            const response = await api.containers.logs(container.id, 200);
            initialLogs[container.id] = response.logs.split('\n').filter(Boolean);
          } catch {
            initialLogs[container.id] = ['Failed to fetch logs'];
          }
        }
        setLogs(initialLogs);
        setLogsLoading(false);
      })();
    }

    // Connect WebSocket for live log streaming
    const token = localStorage.getItem('token');
    if (!token || project.containers.length === 0) return;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/api/events?token=${token}`;

    const connect = () => {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;
      ws.onopen = () => {
        for (const c of project.containers) {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'subscribe_logs', containerId: c.id }));
          }
        }
      };
      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          if (message.type === 'log_line' && message.containerId && message.line) {
            setLogs(prev => {
              const lines = [...(prev[message.containerId] || []), message.line];
              if (lines.length > 1000) lines.splice(0, lines.length - 1000);
              return { ...prev, [message.containerId]: lines };
            });
          }
        } catch {}
      };
      ws.onclose = () => {
        if (wsRef.current) { // still on logs tab
          reconnectRef.current = window.setTimeout(connect, 3000);
        }
      };
      ws.onerror = () => ws.close();
    };
    connect();
  }, [activeTab, logsInitialized, project.containers]);

  // Auto-scroll logs
  useEffect(() => {
    if (following && logsScrollRef.current) {
      logsScrollRef.current.scrollTop = logsScrollRef.current.scrollHeight;
    }
  }, [logs, following]);

  // Reset history when the selected container changes
  useEffect(() => {
    terminalHistoryRef.current = '';
    terminalHistorySnap.current = '';
  }, [terminalContainerId]);

  // Terminal WebSocket: connect when on terminal tab with a selected container
  useEffect(() => {
    if (activeTab !== 'terminal' || !terminalContainerId) {
      if (terminalWsRef.current) {
        const ws = terminalWsRef.current;
        terminalWsRef.current = null;
        try { ws.send(JSON.stringify({ type: 'unsubscribe_terminal', containerId: terminalContainerId })); } catch {}
        ws.close();
        setTerminalConnected(false);
      }
      return;
    }

    const token = localStorage.getItem('token');
    if (!token) return;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/api/events?token=${token}`);
    terminalWsRef.current = ws;

    ws.onopen = () => {
      const cols = terminalHandle.current?.getDimensions().cols ?? 80;
      const rows = terminalHandle.current?.getDimensions().rows ?? 24;
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'subscribe_terminal', containerId: terminalContainerId, cols, rows }));
      }
      setTerminalConnected(true);
      terminalHandle.current?.focus();
    };
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'terminal_output' && msg.containerId === terminalContainerId) {
          // Accumulate raw binary history for replay/postMessage
          const binary = atob(msg.data as string);
          terminalHistoryRef.current += binary;
          terminalHistorySnap.current = terminalHistoryRef.current;
          // Trim to last 200 KB to avoid unbounded growth
          if (terminalHistoryRef.current.length > 200000) {
            terminalHistoryRef.current = terminalHistoryRef.current.slice(-200000);
            terminalHistorySnap.current = terminalHistoryRef.current;
          }
          terminalHandle.current?.writeB64(msg.data as string);
        } else if (msg.type === 'terminal_exit' && msg.containerId === terminalContainerId) {
          setTerminalConnected(false);
        }
      } catch {}
    };
    ws.onclose = () => { if (terminalWsRef.current) setTerminalConnected(false); };
    ws.onerror = () => ws.close();

    return () => {
      terminalWsRef.current = null;
      try { ws.send(JSON.stringify({ type: 'unsubscribe_terminal', containerId: terminalContainerId })); } catch {}
      ws.close();
      setTerminalConnected(false);
    };
  }, [activeTab, terminalContainerId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Communicate with popup terminal window via postMessage (no localStorage)
  useEffect(() => {
    const handle = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      if (e.data?.type === 'terminal_ready') {
        terminalWindowRef.current?.postMessage(
          { type: 'terminal_init', history: terminalHistorySnap.current },
          window.location.origin
        );
      }
      if (e.data?.type === 'terminal_back') {
        terminalWindowRef.current = null;
        if (typeof e.data.history === 'string') {
          terminalHistoryRef.current = e.data.history;
          terminalHistorySnap.current = e.data.history;
        }
        setActiveTab('terminal');
        window.focus();
      }
    };
    window.addEventListener('message', handle);
    return () => window.removeEventListener('message', handle);
  }, []);

  const handleTerminalData = useCallback((data: string) => {
    if (!terminalWsRef.current || !terminalConnected || !terminalContainerId) return;
    if (terminalWsRef.current.readyState !== WebSocket.OPEN) return;
    terminalWsRef.current.send(JSON.stringify({
      type: 'terminal_input',
      containerId: terminalContainerId,
      data,
    }));
  }, [terminalConnected, terminalContainerId]);

  const handleTerminalResize = useCallback((cols: number, rows: number) => {
    if (!terminalWsRef.current || !terminalContainerId) return;
    if (terminalWsRef.current.readyState !== WebSocket.OPEN) return;
    terminalWsRef.current.send(JSON.stringify({
      type: 'terminal_resize',
      containerId: terminalContainerId,
      cols,
      rows,
    }));
  }, [terminalContainerId]);

  const handleOpenTerminalWindow = () => {
    const container = project.containers.find(c => c.id === terminalContainerId);
    if (!container) return;
    const { cols, rows } = terminalHandle.current?.getDimensions() ?? { cols: 80, rows: 24 };
    const url = `/terminal?containerId=${encodeURIComponent(container.id)}&containerName=${encodeURIComponent(container.name)}&cols=${cols}&rows=${rows}`;
    const win = window.open(url, '_blank', 'width=960,height=640');
    if (win) terminalWindowRef.current = win;
  };

  const handleCloseTerminal = () => {
    if (terminalWsRef.current) {
      const ws = terminalWsRef.current;
      terminalWsRef.current = null;
      try { ws.send(JSON.stringify({ type: 'unsubscribe_terminal', containerId: terminalContainerId })); } catch {}
      ws.close();
    }
    terminalHistoryRef.current = '';
    terminalHistorySnap.current = '';
    setTerminalConnected(false);
    setActiveTab('overview');
  };

  // Ctrl+S to save files
  useEffect(() => {
    if (activeTab !== 'compose' && activeTab !== 'env') return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleSaveFiles();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeTab, composeContent, envContent, hasEnvFile, composeErrors]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-scroll deploy panel
  useEffect(() => {
    if (deployScrollRef.current) {
      deployScrollRef.current.scrollTop = deployScrollRef.current.scrollHeight;
    }
  }, [deployLines]);

  const handleDeploy = () => {
    setComposePanelType('deploy');
    setComposePanelOpen(true);
    setDeployRunning(true);

    const token = localStorage.getItem('token');
    if (!token) return;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/api/events?token=${token}`);
    deployWsRef.current = ws;

    ws.onopen = () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'subscribe_deploy', projectId: project.id }));
      }
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'deploy_output' && msg.projectId === project.id) {
          setDeployLines(prev => [...prev, msg.line as string]);
        } else if (msg.type === 'deploy_done' && msg.projectId === project.id) {
          setDeployRunning(false);
          ws.close();
          deployWsRef.current = null;
          if (msg.success) {
            addToast('success', `${project.name} deployed successfully`);
            onRefresh();
          } else {
            addToast('error', 'Deploy failed — see output for details');
          }
        }
      } catch {}
    };

    ws.onclose = () => {
      setDeployRunning(false);
      deployWsRef.current = null;
    };
  };

  const handleAbortDeploy = () => {
    if (deployWsRef.current) {
      try {
        deployWsRef.current.send(JSON.stringify({ type: 'abort_deploy', projectId: project.id }));
      } catch {}
      deployWsRef.current.close();
      deployWsRef.current = null;
    }
    setDeployRunning(false);
  };

  const handleCloseDeployPanel = () => {
    if (deployRunning) handleAbortDeploy();
    if (downRunning) handleAbortDown();
    setComposePanelOpen(false);
  };

  const handleCloseDownPanel = () => {
    handleAbortDown();
    setComposePanelOpen(false);
  };

  const handleDown = () => {
    setComposePanelType('down');
    setComposePanelOpen(true);
    setDownRunning(true);

    const token = localStorage.getItem('token');
    if (!token) return;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/api/events?token=${token}`);
    downWsRef.current = ws;

    ws.onopen = () => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'subscribe_down', projectId: project.id }));
      }
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'down_output' && msg.projectId === project.id) {
          setDownLines(prev => [...prev, msg.line as string]);
        } else if (msg.type === 'down_done' && msg.projectId === project.id) {
          setDownRunning(false);
          ws.close();
          downWsRef.current = null;
          if (msg.success) {
            addToast('success', `${project.name} stopped`);
            onRefresh();
          } else {
            addToast('error', 'Stop failed — see output for details');
          }
        }
      } catch {}
    };

    ws.onclose = () => {
      setDownRunning(false);
      downWsRef.current = null;
    };
  };

  const handleAbortDown = () => {
    if (downWsRef.current) {
      try {
        downWsRef.current.send(JSON.stringify({ type: 'abort_down', projectId: project.id }));
      } catch {}
      downWsRef.current.close();
      downWsRef.current = null;
    }
    setDownRunning(false);
  };

  const handleToggle = async () => {
    if (runningCount > 0) {
      await handleDown();
    } else {
      await handleDeploy();
    }
  };

  const handleUpdate = async () => {
    setUpdating(true);
    try {
      await api.projects.updateImages(project.id);
      addToast('success', `Images updated for ${project.name}`);
      onRefresh();
    } catch (err) {
      addToast('error', err instanceof Error ? err.message : 'Update images failed');
    } finally {
      setUpdating(false);
    }
  };

  const handleCheckUpdates = async () => {
    setCheckingUpdates(true);
    try {
      const result = await api.projects.checkUpdates(project.id, true);
      if (result.hasUpdates) {
        addToast('warning', `Mises à jour disponibles : ${result.services.join(', ')}`);
      } else {
        addToast('success', 'Toutes les images sont à jour');
      }
      onRefresh();
    } catch (err) {
      addToast('error', err instanceof Error ? err.message : 'Vérification échouée');
    } finally {
      setCheckingUpdates(false);
    }
  };

  const handleStartAll = async () => {
    const stopped = project.containers.filter(c => c.state !== 'running');
    if (stopped.length === 0) { addToast('warning', 'All containers are already running'); return; }
    try {
      await Promise.all(stopped.map(c => api.containers.start(c.id)));
      addToast('success', `Started ${stopped.length} container${stopped.length !== 1 ? 's' : ''}`);
      onRefresh();
    } catch (err) {
      addToast('error', err instanceof Error ? err.message : 'Failed to start containers');
    }
  };

  const handleStopAll = async () => {
    const running = project.containers.filter(c => c.state === 'running');
    if (running.length === 0) { addToast('warning', 'No containers are running'); return; }
    try {
      await Promise.all(running.map(c => api.containers.stop(c.id)));
      addToast('success', `Stopped ${running.length} container${running.length !== 1 ? 's' : ''}`);
      onRefresh();
    } catch (err) {
      addToast('error', err instanceof Error ? err.message : 'Failed to stop containers');
    }
  };

  const handleDeleteClick = () => setShowDeleteModal(true);

  const handleDeleteConfirm = async () => {
    setDeleting(true);
    try {
      const result = await api.projects.delete(project.id, deleteOpts);
      if (result.output) addToast('warning', result.output);
      onDelete();
    } catch (err) {
      addToast('error', err instanceof Error ? err.message : 'Failed to remove project');
    } finally {
      setDeleting(false);
      setShowDeleteModal(false);
    }
  };

  const handleSaveFiles = async () => {
    if (composeErrors.length > 0) {
      addToast('error', 'Please fix YAML errors before saving');
      return;
    }
    setFileSaving(true);
    try {
      await api.projects.saveFiles(project.id, {
        composeContent,
        envContent: hasEnvFile ? envContent : undefined,
      });
      addToast('success', 'Files saved');
      onRefresh();
    } catch (err) {
      addToast('error', err instanceof Error ? err.message : 'Failed to save files');
    } finally {
      setFileSaving(false);
    }
  };

  const handleValidate = async () => {
    setFileValidating(true);
    try {
      const result = await api.projects.validate(project.id);
      if (result.valid) {
        addToast('success', 'Compose file is valid');
      } else {
        addToast('error', result.error || 'Validation failed');
      }
    } catch (err) {
      addToast('error', err instanceof Error ? err.message : 'Validation failed');
    } finally {
      setFileValidating(false);
    }
  };

  const [containerActionInProgress, setContainerActionInProgress] = useState<string | null>(null);

  const handleContainerAction = async (action: 'start' | 'stop' | 'restart' | 'remove' | 'checkUpdate', containerId: string) => {
    setContainerActionInProgress(`${action}-${containerId}`);
    try {
      if (action === 'checkUpdate') {
        const result = await api.containers.checkUpdate(containerId);
        addToast(result.hasUpdate ? 'warning' : 'success', result.hasUpdate ? 'Mise à jour disponible !' : 'Image à jour');
      } else if (action === 'remove') {
        const confirmed = await confirm({
          title: 'Supprimer le container',
          message: 'Voulez-vous vraiment supprimer ce container ? Cette action est irréversible.',
          confirmText: 'Supprimer',
          type: 'danger',
        });
        if (!confirmed) {
          setContainerActionInProgress(null);
          return;
        }
        const result = await api.containers.remove(containerId);
        addToast(result.success ? 'success' : 'error', result.output);
      } else {
        await api.containers[action](containerId);
        addToast('success', `Container ${action === 'restart' ? 'redémarré' : action === 'stop' ? 'arrêté' : 'démarré'} avec succès`);
      }
      onRefresh();
    } catch (err) {
      addToast('error', err instanceof Error ? err.message : 'Erreur');
    } finally {
      setContainerActionInProgress(null);
    }
  };

  const runningCount = project.containers.filter(c => c.state === 'running').length;
  const totalCount = project.containers.length;
  const allPorts = project.containers
    .filter(c => c.state === 'running' && c.ports && c.ports.length > 0)
    .flatMap(c => c.ports!.map(port => ({ container: c, port: String(port) })));

  const tabs: { id: TabType; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'compose', label: 'Compose' },
    { id: 'env', label: 'Env' },
    { id: 'terminal', label: 'Terminal' },
    { id: 'logs', label: 'Logs' },
    { id: 'proxy', label: 'Proxy' },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', position: 'relative' }}>
      <ConfirmDialog />
      {/* Header */}
      <div className="detail-header">
        <div style={{ minWidth: 0 }}>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {project.name}
          </h2>
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginTop: '0.25rem', flexWrap: 'wrap' }}>
            <span className="project-path" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '300px' }}>
              {project.path}
            </span>
            <span className={`status-badge ${project.allRunning ? 'status-running' : project.anyRunning ? 'status-other' : 'status-stopped'}`}>
              <span className="status-dot" />
              {runningCount}/{totalCount} running
            </span>
            {project.update_available && (
              <span className="update-pill" title="Des images plus récentes sont disponibles">
                Mise à jour dispo
              </span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center', flexShrink: 0 }}>
          <button className={`btn btn-sm ${runningCount > 0 ? 'btn-danger' : 'btn-primary'}`} onClick={handleToggle} disabled={deployRunning || downRunning} title={runningCount > 0 ? 'docker compose down' : 'docker compose up -d'}>
            {deployRunning || downRunning ? (runningCount > 0 ? 'Stopping...' : 'Starting...') : (runningCount > 0 ? 'Stop' : 'Start')}
          </button>
          <button className="btn btn-sm btn-success" onClick={handleUpdate} disabled={updating} title="docker compose pull && docker compose up -d">
            {updating ? 'Updating...' : 'Update Images'}
          </button>
          <button className="btn btn-sm btn-secondary" onClick={handleCheckUpdates} disabled={checkingUpdates} title="Vérifier les mises à jour d'images">
            {checkingUpdates ? '...' : 'Check Updates'}
          </button>
          <button className="btn btn-sm btn-danger" onClick={handleDeleteClick} title="Supprime le projet d'HOMER (avec option docker compose down)">Remove</button>
          {!composePanelOpen && deployLines.length > 0 && (
            <button className="btn btn-sm btn-secondary" onClick={() => { setComposePanelType('deploy'); setComposePanelOpen(true); }} title="Voir les logs de déploiement">
              Logs
            </button>
          )}
          {!composePanelOpen && downLines.length > 0 && (
            <button className="btn btn-sm btn-secondary" onClick={() => { setComposePanelType('down'); setComposePanelOpen(true); }} title="Voir les logs d'arrêt">
              Logs
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="detail-tabs">
        {tabs.map(tab => (
          <button
            key={tab.id}
            className={`detail-tab ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => handleTabChange(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="detail-content">

        {/* Overview */}
        {activeTab === 'overview' && (
          <div>
            <h3 className="section-title">Containers</h3>
            {totalCount === 0 ? (
              <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>
                No containers yet. Deploy to start.
              </p>
            ) : (
              <div className="resource-list">
                {project.containers.map(c => (
                  <ContainerRow
                    key={c.id}
                    container={c}
                    onAction={handleContainerAction}
                    actionInProgress={containerActionInProgress}
                    showPorts
                    showMenu
                    showUpdateInfo
                  />
                ))}
              </div>
            )}

            {(allPorts.length > 0 || proxyHosts.filter(h => h.show_on_overview && h.enabled).length > 0) && (
              <div style={{ marginTop: '1.5rem' }}>
                <h3 className="section-title">Exposed Services</h3>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                  {proxyHosts.filter(h => h.show_on_overview && h.enabled).map(host => (
                    <a
                      key={`proxy-${host.id}`}
                      href={`https://${host.domain}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn btn-sm btn-link"
                      title={`https://${host.domain} → ${host.upstream}`}
                    >
                      <span className="proxy-badge-sm">proxy</span> {host.domain} ↗
                    </a>
                  ))}
                  {allPorts.map(({ container, port }) => {
                    const host = window.location.hostname;
                    const url = `http://${host}:${port}`;
                    return (
                      <a
                        key={`${container.id}-${port}`}
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn btn-sm btn-link"
                        title={`Open ${container.name} — ${url}`}
                      >
                        {container.name}:{port} ↗
                      </a>
                    );
                  })}
                </div>
              </div>
            )}

            <div style={{ marginTop: '1.5rem' }}>
              <h3 className="section-title">Settings</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <SettingSelect
                  label="Mise à jour automatique"
                  description="Appliquer automatiquement les mises à jour lors de la vérification périodique"
                  value={project.auto_update_policy ?? 'disabled'}
                  options={(Object.keys(AUTO_UPDATE_POLICY_LABELS) as AutoUpdatePolicy[]).map(p => ({ value: p, label: AUTO_UPDATE_POLICY_LABELS[p] }))}
                  onChange={async (v) => {
                    const policy = v as AutoUpdatePolicy;
                    try {
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      await api.projects.update(project.id, { autoUpdate: policy !== 'disabled', autoUpdatePolicy: policy });
                      onRefresh();
                    } catch { addToast('error', 'Failed to update setting'); }
                  }}
                />
                <SettingToggle
                  label="Watch for file changes"
                  description="Auto-deploy when the compose file changes on disk"
                  value={!!project.watch_enabled}
                  onChange={async (v) => {
                    try {
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      await api.projects.update(project.id, { watchEnabled: v });
                      onRefresh();
                    } catch { addToast('error', 'Failed to update setting'); }
                  }}
                />
              </div>
            </div>
          </div>
        )}

        {/* Logs */}
        {activeTab === 'logs' && (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', gap: '0.75rem', flexWrap: 'wrap' }}>
              {project.containers.length > 1 && (
                <div style={{ display: 'flex', gap: '0.375rem', flexWrap: 'wrap' }}>
                  <button
                    className={`chip ${selectedContainerId === null ? 'active' : ''}`}
                    onClick={() => setSelectedContainerId(null)}
                  >
                    All
                  </button>
                  {project.containers.map(c => (
                    <button
                      key={c.id}
                      className={`chip ${selectedContainerId === c.id ? 'active' : ''}`}
                      onClick={() => setSelectedContainerId(c.id)}
                    >
                      {c.name}
                    </button>
                  ))}
                </div>
              )}
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem', cursor: 'pointer', marginLeft: 'auto' }}>
                <input type="checkbox" checked={following} onChange={e => setFollowing(e.target.checked)} />
                Follow logs
              </label>
            </div>
            {logsLoading ? (
              <div className="loading"><div className="spinner" />Loading logs...</div>
            ) : (
              <div ref={logsScrollRef} style={{ flex: 1, overflow: 'auto', minHeight: 0, backgroundColor: 'var(--color-bg)', padding: '0.75rem', borderRadius: '4px', border: '1px solid var(--color-border)' }}>
                {project.containers.length === 0 ? (
                  <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>No containers to show logs for.</p>
                ) : project.containers
                    .filter(c => selectedContainerId === null || c.id === selectedContainerId)
                    .map((container, idx, arr) => (
                  <div key={container.id} style={{ marginBottom: idx < arr.length - 1 ? '1.5rem' : 0 }}>
                    {(selectedContainerId === null && project.containers.length > 1) && (
                      <h4 style={{ marginBottom: '0.5rem', color: 'var(--color-text-muted)', fontSize: '0.875rem', display: 'flex', justifyContent: 'space-between' }}>
                        <span>{container.name}</span>
                        {container.ports && container.ports.length > 0 && (
                          <span style={{ fontSize: '0.75rem' }}>Ports: {container.ports.join(', ')}</span>
                        )}
                      </h4>
                    )}
                    <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontSize: '0.75rem', lineHeight: '1.4', margin: 0 }}>
                      {logs[container.id]?.length
                        ? logs[container.id].map((line, i) => <><AnsiLine key={i} line={line} index={i} />{i < logs[container.id].length - 1 ? '\n' : ''}</>)
                        : 'No logs available'}
                    </pre>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Compose editor */}
        {activeTab === 'compose' && (
          fileLoading ? (
            <div className="loading"><div className="spinner" />Loading files...</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
              <div style={{ flex: 1 }}>
                <YamlEditor
                  value={composeContent}
                  onChange={setComposeContent}
                  onValidate={(_, errors) => setComposeErrors(errors)}
                  minHeight="500px"
                />
              </div>
              <div className="edit-project-footer" style={{ marginTop: '0.75rem' }}>
                <span className="project-path">{project.path}</span>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  {composeErrors.length > 0 && (
                    <span style={{ fontSize: '0.75rem', color: 'var(--color-danger)' }}>
                      {composeErrors.length} error{composeErrors.length !== 1 ? 's' : ''}
                    </span>
                  )}
                  <button className="btn btn-sm btn-info" onClick={handleValidate} disabled={fileValidating || composeErrors.length > 0}>
                    {fileValidating ? 'Validating...' : 'Validate'}
                  </button>
                  <button className="btn btn-sm btn-primary" onClick={handleSaveFiles} disabled={fileSaving || composeErrors.length > 0}>
                    {fileSaving ? 'Saving...' : 'Save (Ctrl+S)'}
                  </button>
                </div>
              </div>
            </div>
          )
        )}

        {/* Env editor */}
        {activeTab === 'env' && (
          fileLoading ? (
            <div className="loading"><div className="spinner" />Loading files...</div>
          ) : !hasEnvFile ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '0.75rem' }}>
              <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>No .env file for this project.</p>
              <button
                className="btn btn-sm btn-secondary"
                onClick={() => { setHasEnvFile(true); setEnvContent('# Environment variables\n'); }}
              >
                Create .env file
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
              <div style={{ flex: 1 }}>
                <YamlEditor value={envContent} onChange={setEnvContent} minHeight="300px" />
              </div>
              <div className="edit-project-footer" style={{ marginTop: '0.75rem' }}>
                <button
                  className="btn btn-sm btn-danger"
                  onClick={() => { setHasEnvFile(false); setEnvContent(''); }}
                >
                  Remove .env file
                </button>
                <button className="btn btn-sm btn-primary" onClick={handleSaveFiles} disabled={fileSaving}>
                  {fileSaving ? 'Saving...' : 'Save (Ctrl+S)'}
                </button>
              </div>
            </div>
          )
        )}

        {/* Proxy */}
        {activeTab === 'proxy' && (
          <ProjectProxyTab
            projectId={project.id}
            containers={project.containers}
            hosts={proxyHosts}
            loading={proxyLoading}
            createHost={createHost}
            updateHost={updateHost}
            deleteHost={deleteHost}
            toggleHost={toggleHost}
          />
        )}

        {/* Terminal */}
        {activeTab === 'terminal' && (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
              {project.containers.length > 1 && (
                <select
                  className="input"
                  value={terminalContainerId ?? ''}
                  onChange={e => setTerminalContainerId(e.target.value || null)}
                  style={{ fontSize: '0.8rem', padding: '0.3rem 0.5rem', width: 'auto' }}
                >
                  {project.containers.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.name}{c.state !== 'running' ? ' (stopped)' : ''}
                    </option>
                  ))}
                </select>
              )}
              <span style={{ fontSize: '0.75rem', color: terminalConnected ? 'var(--color-success)' : 'var(--color-text-muted)' }}>
                {terminalConnected ? '● Connected' : '○ Disconnected'}
              </span>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem' }}>
                <button className="btn btn-sm btn-secondary" onClick={handleOpenTerminalWindow} title="Open in a new window">
                  ↗ Open in window
                </button>
                <button className="btn btn-sm btn-danger" onClick={handleCloseTerminal} title="Close terminal">
                  ✕ Close
                </button>
              </div>
            </div>
            {project.containers.length === 0 ? (
              <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>No containers to connect to.</p>
            ) : (
              <div className="terminal-container">
                <TerminalPanel
                  handle={terminalHandle}
                  initialContent={terminalHistoryRef.current}
                  onData={handleTerminalData}
                  onResize={handleTerminalResize}
                />
              </div>
            )}
          </div>
        )}
      </div>

      {composePanelOpen && (
        <div className="deploy-panel">
          <div className="deploy-panel-header">
            <span className="deploy-panel-title">
              {(deployRunning || downRunning) ? (
                <><span className="deploy-panel-spinner" /> {deployRunning ? 'Deploying' : 'Stopping'} {project.name}…</>
              ) : (
                `${composePanelType === 'deploy' ? 'Deploy' : 'Stop'} output — ${project.name}`
              )}
            </span>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              {(deployRunning || downRunning) && (
                <button className="btn btn-sm btn-danger" onClick={deployRunning ? handleAbortDeploy : handleAbortDown}>
                  Abort
                </button>
              )}
              <button className="btn btn-sm btn-secondary" onClick={handleCloseDeployPanel}>
                Close
              </button>
            </div>
          </div>
          <div className="deploy-panel-body" ref={composePanelType === 'deploy' ? deployScrollRef : downScrollRef}>
            {composePanelType === 'deploy' ? (
              <>
                {deployLines.length === 0 && deployRunning && (
                  <span style={{ color: 'var(--color-text-muted)' }}>Waiting for output…</span>
                )}
                {deployLines.map((line, i) => (
                  <div key={i} className="deploy-panel-line">{line}</div>
                ))}
              </>
            ) : (
              <>
                {downLines.length === 0 && downRunning && (
                  <span style={{ color: 'var(--color-text-muted)' }}>Waiting for output…</span>
                )}
                {downLines.map((line, i) => (
                  <div key={i} className="deploy-panel-line">{line}</div>
                ))}
              </>
            )}
          </div>
        </div>
      )}

      {showDeleteModal && (
        <div className="modal-overlay" onClick={() => setShowDeleteModal(false)}>
          <div className="modal delete-project-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Remove "{project.name}"</h2>
              <button className="modal-close" onClick={() => setShowDeleteModal(false)}>&times;</button>
            </div>
            <p className="delete-modal__always">
              Always: removes the project from HOMER.
            </p>
            <div className="delete-modal__options">
              <label className="delete-modal__option">
                <input
                  type="checkbox"
                  checked={deleteOpts.composeDown}
                  onChange={(e) => setDeleteOpts(o => ({
                    ...o,
                    composeDown: e.target.checked,
                    removeVolumes: e.target.checked ? o.removeVolumes : false,
                  }))}
                />
                <span>Stop containers &amp; remove networks</span>
                <span className="delete-modal__hint">runs <code>docker compose down</code></span>
              </label>
              <label className={`delete-modal__option delete-modal__option--nested${!deleteOpts.composeDown ? ' delete-modal__option--disabled' : ''}`}>
                <input
                  type="checkbox"
                  checked={deleteOpts.removeVolumes}
                  disabled={!deleteOpts.composeDown}
                  onChange={(e) => setDeleteOpts(o => ({ ...o, removeVolumes: e.target.checked }))}
                />
                <span>Also delete volumes</span>
                <span className="delete-modal__hint">adds <code>--volumes</code></span>
              </label>
              <label className="delete-modal__option">
                <input
                  type="checkbox"
                  checked={deleteOpts.deleteFiles}
                  onChange={(e) => setDeleteOpts(o => ({ ...o, deleteFiles: e.target.checked }))}
                />
                <span>Also delete project files</span>
                <span className="delete-modal__hint">
                  deletes <code>{project.path.replace(/\/docker-compose\.yml$/, '/')}</code>
                </span>
              </label>
            </div>
            <div className="form-actions">
              <button className="btn btn-secondary" onClick={() => setShowDeleteModal(false)} disabled={deleting}>
                Cancel
              </button>
              <button className="btn btn-danger" onClick={handleDeleteConfirm} disabled={deleting}>
                {deleting ? 'Removing...' : 'Remove'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Project Proxy Tab ───────────────────────────────────────────────────────

interface ProjectProxyTabProps {
  projectId: number;
  containers: Container[];
  hosts: ProxyHost[];
  loading: boolean;
  createHost: (data: ProxyHostInput) => Promise<unknown>;
  updateHost: (id: number, data: Partial<ProxyHostInput>) => Promise<unknown>;
  deleteHost: (id: number) => Promise<unknown>;
  toggleHost: (id: number) => Promise<unknown>;
}

function ProjectProxyTab({ projectId, containers, hosts, loading, createHost, updateHost, deleteHost, toggleHost }: ProjectProxyTabProps) {
  const [editingHost, setEditingHost] = useState<ProxyHost | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [domainSuffix, setDomainSuffix] = useState('');

  const { ConfirmDialog, confirm } = useConfirm();

  useEffect(() => {
    api.system.getSettings().then(s => setDomainSuffix(s.domainSuffix || ''));
  }, []);

  const handleSave = async (data: ProxyHostInput) => {
    if (editingHost) {
      await updateHost(editingHost.id, data);
    } else {
      await createHost({ ...data, project_id: projectId });
    }
    setShowForm(false);
    setEditingHost(null);
  };

  const handleEdit = (host: ProxyHost) => {
    setEditingHost(host);
    setShowForm(true);
  };

  const handleDelete = async (host: ProxyHost) => {
    const confirmed = await confirm({
      title: 'Supprimer le proxy',
      message: `Supprimer le proxy pour ${host.domain} ?`,
      confirmText: 'Supprimer',
      type: 'danger',
    });
    if (confirmed) {
      await deleteHost(host.id);
    }
  };

  const handleToggle = async (host: ProxyHost) => {
    await toggleHost(host.id);
  };

  return (
    <div style={{ padding: '0.5rem 0' }}>
      <ConfirmDialog />
      <div className="proxy-tab-header">
        <span style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)' }}>
          Proxy reverse configurés pour ce projet
        </span>
        {!showForm && (
          <button className="btn btn-sm btn-primary" onClick={() => { setEditingHost(null); setShowForm(true); }}>
            + Ajouter
          </button>
        )}
      </div>

      {showForm && (
        <div style={{ marginBottom: '1rem', padding: '1rem', background: 'var(--color-bg)', borderRadius: '0.5rem', border: '1px solid var(--color-border)' }}>
          <ProxyHostForm
            proxyHost={editingHost || undefined}
            projectId={projectId}
            domainSuffix={domainSuffix}
            containers={containers}
            onSave={handleSave}
            onCancel={() => { setShowForm(false); setEditingHost(null); }}
          />
        </div>
      )}

      <ProxyHostList
        hosts={hosts}
        loading={loading}
        onEdit={handleEdit}
        onDelete={handleDelete}
        onToggle={handleToggle}
      />
    </div>
  );
}
