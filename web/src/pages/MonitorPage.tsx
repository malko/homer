import { useState, useEffect, useRef } from 'react';
import { api } from '../api/index.js';
import { AppHeader } from '../components/AppHeader';
import '../styles/monitor.css';

interface SystemStats {
  totalContainers: number;
  runningContainers: number;
  cpuPercent: number;
  memoryUsage: number;
  memoryLimit: number;
  memoryPercent: number;
  systemCpuPercent: number;
  systemMemoryUsage: number;
  systemMemoryTotal: number;
  systemMemoryPercent: number;
}

interface HistoryPoint {
  cpu: number;
  memory: number;
  systemCpu: number;
  systemMemory: number;
  timestamp: number;
}

const MAX_HISTORY = 60;

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let unitIndex = 0;
  let value = bytes;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

function SimpleChart({ 
  data, 
  maxValue, 
  label,
  currentValue,
  color,
  chartId
}: { 
  data: number[]; 
  maxValue: number;
  label: string;
  currentValue: string;
  color: string;
  chartId: string;
}) {
  if (data.length < 2 || maxValue <= 0) return null;
  
  const width = 200;
  const height = 50;
  const pathPoints: number[] = [];
  
  for (let i = 0; i < data.length; i++) {
    const x = (i / (data.length - 1)) * width;
    const y = height - Math.min((data[i] / maxValue) * height, height);
    pathPoints.push(x, y);
  }
  
  let pathD = `M ${pathPoints[0]} ${pathPoints[1]}`;
  for (let i = 2; i < pathPoints.length; i += 2) {
    pathD += ` L ${pathPoints[i]} ${pathPoints[i + 1]}`;
  }
  
  const linePathD = pathD;
  const areaPathD = `${pathD} L ${width} ${height} L 0 ${height} Z`;
  
  return (
    <div className="simple-chart" title={`${label}: ${currentValue}`}>
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id={`chartGradient-${chartId}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.3" />
            <stop offset="100%" stopColor={color} stopOpacity="0.05" />
          </linearGradient>
        </defs>
        <path d={areaPathD} fill={`url(#chartGradient-${chartId})`} />
        <path d={linePathD} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

function StackedBar({ label, systemValue, systemPercent, homerValue, homerPercent, homerColor = 'var(--color-primary)', systemColor = 'var(--color-info)' }: {
  label: string;
  systemValue: string;
  systemPercent: number;
  homerValue: string;
  homerPercent: number;
  homerColor?: string;
  systemColor?: string;
}) {
  const homerWidth = Math.min(homerPercent, 100);
  const systemWidth = Math.min(systemPercent, 100);
  
  return (
    <div className="stacked-bar-container">
      <div className="stacked-bar-label">{label}</div>
      <div className="stacked-bar-track">
        <div 
          className="stacked-bar-fill homer" 
          style={{ width: `${homerWidth}%`, backgroundColor: homerColor }}
          title={`HOMER: ${homerValue} (${homerPercent.toFixed(1)}%)`}
        />
        <div 
          className="stacked-bar-fill system" 
          style={{ width: `${systemWidth}%`, backgroundColor: systemColor }}
          title={`Système: ${systemValue} (${systemPercent.toFixed(1)}%)`}
        />
      </div>
      <div className="stacked-bar-values">
        <span style={{ color: homerColor }}>● HOMER: {homerValue}</span>
        <span style={{ color: systemColor }}>● Système: {systemValue}</span>
      </div>
    </div>
  );
}

export function MonitorPage() {
  const [stats, setStats] = useState<SystemStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const data = await api.system.getStats();
        setStats(prev => {
          setHistory(h => {
            const newPoint: HistoryPoint = {
              cpu: data.cpuPercent,
              memory: data.memoryPercent,
              systemCpu: data.systemCpuPercent,
              systemMemory: data.systemMemoryPercent,
              timestamp: Date.now(),
            };
            const newHistory = [...h, newPoint];
            if (newHistory.length > MAX_HISTORY) {
              return newHistory.slice(-MAX_HISTORY);
            }
            return newHistory;
          });
          return data;
        });
      } catch (err) {
        console.error('Failed to fetch stats:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
    const interval = setInterval(fetchStats, 2000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="loading">
        <div className="spinner" />
        Chargement...
      </div>
    );
  }

  const containerPercent = stats && stats.totalContainers > 0
    ? (stats.runningContainers / stats.totalContainers) * 100
    : 0;

  const cpuMax = Math.max(100, (stats?.systemCpuPercent ?? 0) * 1.5, 10);
  const memMax = 100;

  return (
    <div className="monitor-page">
      <AppHeader title="Moniteur système" stats={stats ? `${stats.runningContainers}/${stats.totalContainers} containers` : undefined} />
      <div className="monitor-content" ref={containerRef}>
        <div className="monitor-section">
          <h3 className="monitor-section-title">Containers</h3>
          <div className="monitor-cards">
            <div className="monitor-card">
              <div className="monitor-card-value">{stats?.totalContainers ?? 0}</div>
              <div className="monitor-card-label">Total</div>
            </div>
            <div className="monitor-card">
              <div className="monitor-card-value">{stats?.runningContainers ?? 0}</div>
              <div className="monitor-card-label">En cours</div>
            </div>
            <div className="monitor-card">
              <div className="monitor-card-value">{stats ? (stats.totalContainers - stats.runningContainers) : 0}</div>
              <div className="monitor-card-label">Arrêtés</div>
            </div>
          </div>
          <div className="monitor-progress">
            <div className="monitor-progress-label">
              <span>Utilisation des containers</span>
              <span>{containerPercent.toFixed(0)}%</span>
            </div>
            <div className="monitor-progress-bar">
              <div
                className="monitor-progress-fill"
                style={{ width: `${containerPercent}%` }}
              />
            </div>
          </div>
        </div>

        <div className="monitor-section">
          <h3 className="monitor-section-title">Mémoire</h3>
          <div className="monitor-cards">
            <div className="monitor-card">
              <div className="monitor-card-value">{stats ? formatBytes(stats.memoryUsage) : '0 B'}</div>
              <div className="monitor-card-label">HOMER</div>
            </div>
            <div className="monitor-card">
              <div className="monitor-card-value">{stats && stats.systemMemoryTotal > 0 ? formatBytes(stats.systemMemoryTotal) : 'N/A'}</div>
              <div className="monitor-card-label">Système</div>
            </div>
          </div>
          {history.length > 1 && (
            <div className="monitor-chart-wrapper">
              <SimpleChart 
                data={history.map(h => h.systemMemory)} 
                maxValue={memMax} 
                label="Mémoire système"
                currentValue={`${stats?.systemMemoryPercent?.toFixed(1) ?? 0}%`}
                color="var(--color-info)"
                chartId="memory"
              />
            </div>
          )}
          <div className="stacked-bars">
            <StackedBar 
              label="Mémoire" 
              homerValue={stats ? formatBytes(stats.memoryUsage) : '0 B'}
              homerPercent={stats?.memoryPercent ?? 0}
              systemValue={stats ? formatBytes(stats.systemMemoryUsage) : '0 B'}
              systemPercent={stats?.systemMemoryPercent ?? 0}
              homerColor="var(--color-primary)"
              systemColor="var(--color-info)"
            />
          </div>
        </div>

        <div className="monitor-section">
          <h3 className="monitor-section-title">CPU</h3>
          <div className="monitor-cards">
            <div className="monitor-card">
              <div className="monitor-card-value">{stats?.cpuPercent?.toFixed(1) ?? 0}%</div>
              <div className="monitor-card-label">HOMER</div>
            </div>
            <div className="monitor-card">
              <div className="monitor-card-value">{stats?.systemCpuPercent?.toFixed(1) ?? 0}%</div>
              <div className="monitor-card-label">Système</div>
            </div>
          </div>
          {history.length > 1 && (
            <div className="monitor-chart-wrapper">
              <SimpleChart 
                data={history.map(h => h.systemCpu)} 
                maxValue={cpuMax}
                label="CPU système"
                currentValue={`${stats?.systemCpuPercent?.toFixed(1) ?? 0}%`}
                color="var(--color-success)"
                chartId="cpu"
              />
            </div>
          )}
          <div className="stacked-bars">
            <StackedBar 
              label="CPU" 
              homerValue={`${stats?.cpuPercent?.toFixed(1) ?? 0}%`}
              homerPercent={stats?.cpuPercent ?? 0}
              systemValue={`${stats?.systemCpuPercent?.toFixed(1) ?? 0}%`}
              systemPercent={stats?.systemCpuPercent ?? 0}
              homerColor="var(--color-primary)"
              systemColor="var(--color-success)"
            />
          </div>
        </div>
      </div>
    </div>
  );
}