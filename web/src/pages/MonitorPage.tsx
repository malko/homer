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
}

interface HistoryPoint {
  cpu: number;
  memory: number;
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

function SimpleChart({ data, maxValue }: { data: number[]; maxValue: number }) {
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
  
  const strokeColor = maxValue > 50 ? 'var(--color-success)' : 'var(--color-info)';
  
  return (
    <div className="simple-chart">
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={strokeColor} stopOpacity="0.3" />
            <stop offset="100%" stopColor={strokeColor} stopOpacity="0.05" />
          </linearGradient>
        </defs>
        <path d={areaPathD} fill="url(#chartGradient)" />
        <path d={linePathD} fill="none" stroke={strokeColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
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

  const cpuMax = Math.max(100, (stats?.cpuPercent ?? 0) * 1.5, 10);
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
            <div className="monitor-card-label">Utilisée</div>
          </div>
          <div className="monitor-card">
            <div className="monitor-card-value">{stats && stats.memoryLimit > 0 ? formatBytes(stats.memoryLimit) : 'N/A'}</div>
            <div className="monitor-card-label">Limite système</div>
          </div>
        </div>
        {history.length > 1 && (
          <div className="monitor-chart-wrapper">
            <SimpleChart data={history.map(h => h.memory)} maxValue={memMax} />
          </div>
        )}
        <div className="monitor-progress">
          <div className="monitor-progress-label">
            <span>Utilisation mémoire</span>
            <span>{stats?.memoryPercent?.toFixed(1) ?? 0}%</span>
          </div>
          <div className="monitor-progress-bar">
            <div
              className="monitor-progress-fill monitor-progress-fill--memory"
              style={{ width: `${Math.min(stats?.memoryPercent ?? 0, 100)}%` }}
            />
          </div>
        </div>
      </div>

      <div className="monitor-section">
        <h3 className="monitor-section-title">CPU</h3>
        <div className="monitor-cards">
          <div className="monitor-card">
            <div className="monitor-card-value">{stats?.cpuPercent?.toFixed(1) ?? 0}%</div>
            <div className="monitor-card-label">Total</div>
          </div>
        </div>
        {history.length > 1 && (
          <div className="monitor-chart-wrapper">
            <SimpleChart data={history.map(h => h.cpu)} maxValue={cpuMax} />
          </div>
        )}
        <div className="monitor-progress">
          <div className="monitor-progress-label">
            <span>Utilisation CPU</span>
            <span>{stats?.cpuPercent?.toFixed(1) ?? 0}%</span>
          </div>
          <div className="monitor-progress-bar">
            <div
              className="monitor-progress-fill monitor-progress-fill--cpu"
              style={{ width: `${Math.min(stats?.cpuPercent ?? 0, 100)}%` }}
            />
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}