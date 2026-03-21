import { useState, useEffect, useRef } from 'react';
import { useProjects } from '../hooks/useProjects';
import { useAuth } from '../hooks/useAuth';
import { useWebSocket } from '../hooks/useWebSocket';
import { YamlEditor } from '../components/YamlEditor';
import { EditProjectModal } from '../components/EditProjectModal';
import { ErrorOverlay } from '../components/ErrorOverlay';
import type { Project, Container, StandaloneContainer, ContainerDecision, ParseWarnings } from '../api';
import bigiconImage from '@assets/bigicon.png';

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'project';
}

function ContainerItem({ container, onRefresh }: { container: Container; onRefresh?: () => void }) {
  const [loading, setLoading] = useState<string | null>(null);

  const handleAction = async (action: 'start' | 'stop' | 'restart') => {
    setLoading(action);
    try {
      const { api } = await import('../api');
      await api.containers[action](container.id);
      onRefresh?.();
    } catch {} finally {
      setLoading(null);
    }
  };

  const isRunning = container.state === 'running';

  return (
    <div className="container-item">
      <div className="container-info">
        <span className={`status-badge ${isRunning ? 'status-running' : 'status-stopped'}`}>
          <span className="status-dot" />
          {container.state}
        </span>
        <div style={{ flex: 1 }}>
          <div className="container-name" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>{container.name}</span>
            {container.ports && container.ports.length > 0 && (
              <span style={{ fontSize: '0.7rem', color: 'var(--color-text-muted)' }}>
                {container.ports.map(port => (
                  <span key={port} style={{ 
                    backgroundColor: 'var(--color-bg-secondary)',
                    padding: '0.1rem 0.4rem',
                    borderRadius: '3px',
                    marginLeft: '0.25rem'
                  }}>
                    {port}
                  </span>
                ))}
              </span>
            )}
          </div>
          <div className="container-image">{container.image}</div>
        </div>
      </div>
      <div className="container-actions">
        {isRunning ? (
          <>
            <button
              className="btn btn-sm btn-secondary"
              onClick={() => handleAction('restart')}
              disabled={loading === 'restart'}
            >
              {loading === 'restart' ? '...' : 'Restart'}
            </button>
            <button
              className="btn btn-sm btn-danger"
              onClick={() => handleAction('stop')}
              disabled={loading === 'stop'}
            >
              {loading === 'stop' ? '...' : 'Stop'}
            </button>
          </>
        ) : (
          <button
            className="btn btn-sm btn-success"
            onClick={() => handleAction('start')}
            disabled={loading === 'start'}
          >
            {loading === 'start' ? '...' : 'Start'}
          </button>
        )}
      </div>
    </div>
  );
}

function AddProjectModal({ onClose, onAdd }: { onClose: () => void; onAdd: () => void }) {
  const [name, setName] = useState('');
  const [autoUpdate, setAutoUpdate] = useState(false);
  const [watchEnabled, setWatchEnabled] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { addProject } = useProjects();

  const slugifiedName = slugify(name);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await addProject(name, { autoUpdate, watchEnabled });
      onAdd();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add project');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">Add Project</h2>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="input-group">
            <label className="input-label">Project Name</label>
            <input
              type="text"
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My App"
              required
            />
            {name && (
              <p className="project-path">
                Files will be created at: <code>{`projects/${slugifiedName}/docker-compose.yml`}</code>
              </p>
            )}
          </div>

          <div className="toggle-group">
            <div
              className={`toggle ${autoUpdate ? 'active' : ''}`}
              onClick={() => setAutoUpdate(!autoUpdate)}
            >
              <div className="toggle-handle" />
            </div>
            <span className="toggle-label">Auto-update images</span>
          </div>

          <div className="toggle-group">
            <div
              className={`toggle ${watchEnabled ? 'active' : ''}`}
              onClick={() => setWatchEnabled(!watchEnabled)}
            >
              <div className="toggle-handle" />
            </div>
            <span className="toggle-label">Watch for file changes</span>
          </div>

          {error && <p className="error-text">{error}</p>}

          <div className="form-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? 'Adding...' : 'Add Project'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ImportModal({ onClose, onImport }: { onClose: () => void; onImport: () => void }) {
  const [step, setStep] = useState<'input' | 'decisions' | 'preview'>('input');
  const [tab, setTab] = useState<'run' | 'migrate'>('run');
  const [dockerRunCmd, setDockerRunCmd] = useState('');
  const [standaloneContainers, setStandaloneContainers] = useState<StandaloneContainer[]>([]);
  const [selectedContainers, setSelectedContainers] = useState<Set<string>>(new Set());
  const [decisions, setDecisions] = useState<ContainerDecision[]>([]);
  const [acceptedDecisions, setAcceptedDecisions] = useState<Record<string, boolean>>({});
  const [warnings, setWarnings] = useState<ParseWarnings>({ unsupported: [], skipped: [] });
  const [editedCompose, setEditedCompose] = useState('');
  const [editedEnv, setEditedEnv] = useState('');
  const [projectName, setProjectName] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const resetState = () => {
    setStep('input');
    setDockerRunCmd('');
    setStandaloneContainers([]);
    setSelectedContainers(new Set());
    setDecisions([]);
    setAcceptedDecisions({});
    setWarnings({ unsupported: [], skipped: [] });
    setEditedCompose('');
    setEditedEnv('');
    setProjectName('');
    setError('');
  };

  const handleParseCommand = async () => {
    if (!dockerRunCmd.trim()) {
      setError('Please enter a docker run command');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const { api } = await import('../api');
      const result = await api.import.parseRunCommand(dockerRunCmd);
      setEditedCompose(result.compose);
      setEditedEnv(result.envContent);
      setWarnings(result.warnings);
      setProjectName(result.service.name);
      setStep('preview');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to parse command');
    } finally {
      setLoading(false);
    }
  };

  const handleLoadStandalone = async () => {
    setLoading(true);
    try {
      const { api } = await import('../api');
      const result = await api.import.getStandaloneContainers();
      setStandaloneContainers(result.containers);
      setSelectedContainers(new Set());
    } catch (err) {
      console.error('Failed to load standalone containers:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleContainer = (id: string) => {
    const newSelected = new Set(selectedContainers);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedContainers(newSelected);
  };

  const handleScanContainers = async () => {
    if (selectedContainers.size === 0) {
      setError('Please select at least one container');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const { api } = await import('../api');
      const result = await api.import.getDecisions(Array.from(selectedContainers));
      setDecisions(result.decisions);

      const initialDecisions: Record<string, boolean> = {};
      for (const decision of result.decisions) {
        initialDecisions[`${decision.containerId}:${decision.type}`] = decision.enabled;
      }
      setAcceptedDecisions(initialDecisions);

      if (result.decisions.length > 0) {
        setStep('decisions');
      } else {
        await generateMigrateCompose({});
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to get decisions');
    } finally {
      setLoading(false);
    }
  };

  const handleDecisionToggle = (key: string, value: boolean) => {
    setAcceptedDecisions(prev => ({ ...prev, [key]: value }));
  };

  const handleConfirmDecisions = async () => {
    setLoading(true);
    try {
      await generateMigrateCompose(acceptedDecisions);
      setStep('preview');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate compose');
    } finally {
      setLoading(false);
    }
  };

  const generateMigrateCompose = async (decisions: Record<string, boolean>) => {
    const { api } = await import('../api');
    const result = await api.import.containersToCompose(Array.from(selectedContainers), decisions);
    setEditedCompose(result.compose);
    setEditedEnv(result.envContent);
    setWarnings(result.warnings);
    if (!projectName) {
      setProjectName('migrated-project');
    }
  };

  const handleSave = async () => {
    if (!projectName) {
      setError('Please enter a project name');
      return;
    }

    setSaving(true);
    setError('');

    try {
      const { api } = await import('../api');
      await api.import.saveCompose({
        compose: editedCompose,
        envContent: editedEnv,
        projectName,
      });
      onImport();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleBack = () => {
    if (step === 'decisions') {
      setStep('input');
    } else if (step === 'preview') {
      if (tab === 'migrate' && decisions.length > 0) {
        setStep('decisions');
      } else {
        setStep('input');
      }
    }
  };

  const renderWarnings = () => {
    const allWarnings = [...warnings.unsupported, ...warnings.skipped];
    if (allWarnings.length === 0) return null;

    return (
      <div className="warning-banner">
        <div className="warning-header">
          <span className="warning-icon">&#9888;</span>
          <span>Some options require manual attention:</span>
        </div>
        <ul className="warning-list">
          {allWarnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      </div>
    );
  };

  const renderStepIndicator = () => {
    const steps = tab === 'run' 
      ? ['Input', 'Preview']
      : ['Select', 'Decisions', 'Preview'];
    
    const currentIndex = step === 'input' ? 0 : step === 'decisions' ? 1 : 2;
    
    return (
      <div className="wizard-steps">
        {steps.map((s, i) => (
          <div key={s} className={`wizard-step ${i === currentIndex ? 'active' : ''} ${i < currentIndex ? 'completed' : ''}`}>
            <span className="step-number">{i + 1}</span>
            <span className="step-label">{s}</span>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal import-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '800px' }}>
        <div className="modal-header">
          <h2 className="modal-title">Import / Migrate</h2>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>

        {renderStepIndicator()}

        <div className="import-tabs">
          <button
            className={`import-tab ${tab === 'run' ? 'active' : ''}`}
            onClick={() => { setTab('run'); resetState(); }}
          >
            From docker run
          </button>
          <button
            className={`import-tab ${tab === 'migrate' ? 'active' : ''}`}
            onClick={() => { setTab('migrate'); resetState(); }}
          >
            Migrate containers
          </button>
        </div>

        {step === 'input' && (
          <div className="import-content">
            {tab === 'run' && (
              <>
                <div className="input-group">
                  <label className="input-label">Paste docker run command</label>
                  <textarea
                    className="input input-textarea"
                    value={dockerRunCmd}
                    onChange={(e) => setDockerRunCmd(e.target.value)}
                    placeholder="docker run -d --name myapp -p 8080:80 --gpus all nvidia/cuda:latest"
                    rows={5}
                  />
                </div>
                <div className="form-actions">
                  <button className="btn btn-primary" onClick={handleParseCommand} disabled={loading}>
                    {loading ? 'Parsing...' : 'Parse Command'}
                  </button>
                </div>
              </>
            )}

            {tab === 'migrate' && (
              <>
                <p style={{ color: 'var(--color-text-muted)', marginBottom: '1rem', fontSize: '0.875rem' }}>
                  Select containers that were started with <code>docker run</code> (not managed by compose)
                </p>
                <button
                  className="btn btn-secondary"
                  onClick={handleLoadStandalone}
                  disabled={loading}
                >
                  {loading ? 'Scanning...' : 'Scan for Containers'}
                </button>
                {!loading && standaloneContainers.length > 0 && (
                  <>
                    <div className="standalone-list" style={{ marginTop: '1rem', maxHeight: '200px', overflowY: 'auto' }}>
                      {standaloneContainers.map((container) => (
                        <div
                          key={container.id}
                          className={`standalone-item ${selectedContainers.has(container.id) ? 'selected' : ''}`}
                          onClick={() => handleToggleContainer(container.id)}
                        >
                          <input
                            type="checkbox"
                            checked={selectedContainers.has(container.id)}
                            onChange={() => {}}
                            onClick={(e) => e.stopPropagation()}
                          />
                          <div className="standalone-info">
                            <span className="standalone-name">
                              {container.name}
                              {container.hasGpu && <span className="gpu-badge">GPU</span>}
                            </span>
                            <span className="standalone-image">{container.image}</span>
                          </div>
                          <span className="standalone-status">{container.status}</span>
                        </div>
                      ))}
                    </div>
                    <div className="form-actions" style={{ marginTop: '1rem' }}>
                      <button
                        className="btn btn-primary"
                        onClick={handleScanContainers}
                        disabled={loading || selectedContainers.size === 0}
                      >
                        {loading ? 'Scanning...' : `Continue with ${selectedContainers.size} container${selectedContainers.size !== 1 ? 's' : ''}`}
                      </button>
                    </div>
                  </>
                )}
                {!loading && standaloneContainers.length === 0 && standaloneContainers.length > -1 && (
                  <p style={{ color: 'var(--color-text-muted)', marginTop: '1rem', fontSize: '0.875rem' }}>
                    No standalone containers found. All containers appear to be managed by Docker Compose.
                  </p>
                )}
              </>
            )}

            {error && <p className="error-text" style={{ marginTop: '1rem' }}>{error}</p>}
          </div>
        )}

        {step === 'decisions' && (
          <div className="import-content">
            <p style={{ color: 'var(--color-text-muted)', marginBottom: '1rem', fontSize: '0.875rem' }}>
              The following container configurations need your confirmation:
            </p>
            <div className="decisions-list">
              {decisions.map((decision, idx) => {
                const key = `${decision.containerId}:${decision.type}`;
                const isEnabled = acceptedDecisions[key] ?? decision.enabled;
                return (
                  <div key={idx} className="decision-item">
                    <div className="decision-header">
                      <span className="decision-type">
                        {decision.type === 'gpu' && '&#127918; GPU'}
                        {decision.type === 'privileged' && '&#128737; Privileged'}
                        {decision.type === 'capability' && '&#9881; Capability'}
                      </span>
                      <span className="decision-container">{decision.containerName}</span>
                    </div>
                    <p className="decision-message">{decision.message}</p>
                    <div className="decision-actions">
                      <label className="decision-toggle">
                        <input
                          type="checkbox"
                          checked={isEnabled}
                          onChange={(e) => handleDecisionToggle(key, e.target.checked)}
                        />
                        <span>Enable {decision.type}</span>
                      </label>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="form-actions" style={{ marginTop: '1.5rem' }}>
              <button className="btn btn-secondary" onClick={handleBack}>
                Back
              </button>
              <button className="btn btn-primary" onClick={handleConfirmDecisions} disabled={loading}>
                {loading ? 'Generating...' : 'Continue'}
              </button>
            </div>
          </div>
        )}

        {step === 'preview' && (
          <div className="import-content">
            {renderWarnings()}

            <div className="preview-section">
              <label className="input-label">
                docker-compose.yml
                <span className="editable-hint">(editable)</span>
              </label>
              <YamlEditor
                value={editedCompose}
                onChange={setEditedCompose}
                minHeight="200px"
              />
            </div>

            {editedEnv && (
              <div className="preview-section" style={{ marginTop: '1rem' }}>
                <label className="input-label">
                  .env file
                  <span className="editable-hint">(editable)</span>
                </label>
                <YamlEditor
                  value={editedEnv}
                  onChange={setEditedEnv}
                  minHeight="120px"
                />
              </div>
            )}

            <div className="import-save" style={{ marginTop: '1.5rem' }}>
              <div className="input-group">
                <label className="input-label">Project Name</label>
                <input
                  type="text"
                  className="input"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  placeholder="my-project"
                />
              </div>
              <div className="input-group">
                <label className="input-label">Save Path</label>
                <p className="project-path">
                  Files will be saved at: <code>{`projects/${slugify(projectName)}/docker-compose.yml`}</code>
                </p>
              </div>
              {error && <p className="error-text">{error}</p>}
              <div className="form-actions">
                <button className="btn btn-secondary" onClick={handleBack}>
                  Back
                </button>
                <button
                  className="btn btn-primary"
                  onClick={handleSave}
                  disabled={saving || !projectName}
                >
                  {saving ? 'Saving...' : 'Save Files'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function LogsModal({ project, onClose }: { project: Project; onClose: () => void }) {
  const [logs, setLogs] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [following, setFollowing] = useState(true);
  const logRefs = useRef<Record<string, HTMLPreElement | null>>({});
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    const fetchInitialLogs = async () => {
      const { api } = await import('../api');
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
      setLoading(false);
    };
    
    fetchInitialLogs();
  }, [project.containers]);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token || project.containers.length === 0) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/api/events?token=${token}`;

    const connect = () => {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        for (const container of project.containers) {
          ws.send(JSON.stringify({ type: 'subscribe_logs', containerId: container.id }));
        }
      };

      ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          if (message.type === 'log_line' && message.containerId && message.line) {
            setLogs(prev => {
              const containerLogs = prev[message.containerId] || [];
              const newLogs = [...containerLogs, message.line];
              if (newLogs.length > 1000) {
                newLogs.splice(0, newLogs.length - 1000);
              }
              return { ...prev, [message.containerId]: newLogs };
            });
          }
        } catch {}
      };

      ws.onclose = () => {
        reconnectTimeoutRef.current = window.setTimeout(connect, 3000);
      };

      ws.onerror = () => {
        ws.close();
      };
    };

    connect();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        for (const container of project.containers) {
          wsRef.current.send(JSON.stringify({ type: 'unsubscribe_logs', containerId: container.id }));
        }
        wsRef.current.close();
      }
    };
  }, [project.containers]);

  useEffect(() => {
    if (following && scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
    }
  }, [logs, following]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '900px', height: '80vh' }}>
        <div className="modal-header">
          <h2 className="modal-title">Logs - {project.name}</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <label className="toggle-label" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={following}
                onChange={(e) => setFollowing(e.target.checked)}
              />
              Follow logs
            </label>
            <button className="modal-close" onClick={onClose}>&times;</button>
          </div>
        </div>

        {loading ? (
          <div className="loading">
            <div className="spinner" />
            Loading logs...
          </div>
        ) : (
          <div ref={scrollContainerRef} className="logs-container" style={{ height: 'calc(100% - 50px)', overflow: 'auto' }}>
            {project.containers.map((container) => (
              <div key={container.id} style={{ marginBottom: '1.5rem' }}>
                <h4 style={{ marginBottom: '0.5rem', color: 'var(--color-text-muted)', display: 'flex', justifyContent: 'space-between' }}>
                  <span>{container.name}</span>
                  {container.ports && container.ports.length > 0 && (
                    <span style={{ fontSize: '0.75rem' }}>
                      Ports: {container.ports.join(', ')}
                    </span>
                  )}
                </h4>
                <pre
                  ref={(el) => { logRefs.current[container.id] = el; }}
                  style={{
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-all',
                    backgroundColor: 'var(--color-bg-secondary)',
                    padding: '0.75rem',
                    borderRadius: '4px',
                    overflow: 'visible',
                    fontSize: '0.8rem',
                    lineHeight: '1.4'
                  }}
                >
                  {logs[container.id]?.join('\n') || 'No logs available'}
                </pre>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ProjectCard({ project, onRefresh }: { project: Project; onRefresh: () => void }) {
  const [showLogs, setShowLogs] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [deployError, setDeployError] = useState<string | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const { deployProject, updateProjectImages, deleteProject } = useProjects();
  const { logout } = useAuth();

  const handleDeploy = async () => {
    setDeployError(null);
    setDeploying(true);
    try {
      await deployProject(project.id);
    } catch (err) {
      setDeployError(err instanceof Error ? err.message : 'Deploy failed');
    } finally {
      setDeploying(false);
    }
  };

  const handleUpdate = async () => {
    setUpdateError(null);
    setUpdating(true);
    try {
      await updateProjectImages(project.id);
    } catch (err) {
      setUpdateError(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setUpdating(false);
    }
  };

  const handleDelete = async () => {
    if (confirm(`Delete "${project.name}" from management? This won't stop your containers.`)) {
      await deleteProject(project.id);
    }
  };

  const runningCount = project.containers.filter((c) => c.state === 'running').length;
  const totalCount = project.containers.length;

  const allPorts = project.containers
    .filter(c => c.state === 'running' && c.ports && c.ports.length > 0)
    .flatMap(c => c.ports!.map(port => ({ container: c, port: String(port) })));

  return (
    <>
      <div className="card">
        <div className="card-header">
          <div>
            <h3 className="card-title">{project.name}</h3>
            <p className="project-path">{project.path}</p>
          </div>
          <span className={`status-badge ${project.anyRunning ? 'status-running' : 'status-stopped'}`}>
            <span className="status-dot" />
            {project.anyRunning ? 'Running' : 'Stopped'}
          </span>
        </div>

        <div className="project-stats">
          <span>{totalCount} container{totalCount !== 1 ? 's' : ''}</span>
          {totalCount > 0 && <span>{runningCount} running</span>}
        </div>

        {allPorts.length > 0 && (
          <div style={{ marginBottom: '1rem' }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginBottom: '0.5rem' }}>
              Exposed Services
            </div>
            <div className="quick-links" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
              {allPorts.map(({ container, port }) => (
                <a
                  key={`${container.id}-${port}`}
                  href={`http://localhost:${port}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn-sm btn-link"
                  title={`Open ${container.name} (port ${port})`}
                >
                  {container.name}:{port}
                </a>
              ))}
            </div>
          </div>
        )}

        {totalCount > 0 && (
          <div className="container-list">
            {project.containers.map((container) => (
              <ContainerItem key={container.id} container={container} onRefresh={onRefresh} />
            ))}
          </div>
        )}

        <div className="card-actions" style={{ marginTop: '1rem' }}>
          <button
            className="btn btn-sm btn-primary"
            onClick={handleDeploy}
            disabled={deploying}
          >
            {deploying ? 'Deploying...' : 'Deploy'}
          </button>
          <button
            className="btn btn-sm btn-success"
            onClick={handleUpdate}
            disabled={updating}
          >
            {updating ? 'Updating...' : 'Update Images'}
          </button>
          <button
            className="btn btn-sm btn-secondary"
            onClick={() => setShowEditModal(true)}
          >
            Edit Files
          </button>
          <button
            className="btn btn-sm btn-secondary"
            onClick={() => setShowLogs(true)}
          >
            Logs
          </button>
          <button
            className="btn btn-sm btn-danger"
            onClick={handleDelete}
          >
            Remove
          </button>
        </div>
        {(deployError || updateError) && (
          <ErrorOverlay
            type="error"
            messages={[deployError, updateError].filter(Boolean) as string[]}
            onDismiss={() => { setDeployError(null); setUpdateError(null); }}
            className="card-error-overlay"
          />
        )}
      </div>

      {showLogs && <LogsModal project={project} onClose={() => setShowLogs(false)} />}
      {showEditModal && (
        <EditProjectModal
          project={project}
          onClose={() => setShowEditModal(false)}
          onSave={onRefresh}
        />
      )}
    </>
  );
}

export function ProjectsPage() {
  const { projects, loading, error, refetch } = useProjects();
  const [showAddModal, setShowAddModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const { logout, status } = useAuth();

  useWebSocket((message) => {
    if (message.type === 'containers_updated' || message.type === 'project_updated') {
      refetch();
    }
  });

  if (loading) {
    return (
      <div className="loading">
        <div className="spinner" />
        Loading projects...
      </div>
    );
  }

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <img src={bigiconImage} alt="" className="header-icon" />
          <div>
            <h1 className="page-title">HOMER</h1>
            <p className="page-subtitle">HOMElab ManagER</p>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <span style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>
            {status?.username}
          </span>
          <button className="btn btn-secondary" onClick={logout}>
            Logout
          </button>
          <button className="btn btn-secondary" onClick={() => setShowImportModal(true)}>
            Import
          </button>
          <button className="btn btn-primary" onClick={() => setShowAddModal(true)}>
            Add Project
          </button>
        </div>
      </div>

      {error && (
        <div className="card" style={{ borderColor: 'var(--color-danger)' }}>
          <p style={{ color: 'var(--color-danger)' }}>{error}</p>
          <button className="btn btn-secondary btn-sm" onClick={refetch} style={{ marginTop: '0.5rem' }}>
            Retry
          </button>
        </div>
      )}

      {projects.length === 0 && !error ? (
        <div className="empty-state">
          <div className="empty-state-icon">📦</div>
          <h3>No projects yet</h3>
          <p>Add your first Docker Compose project to get started</p>
          <button className="btn btn-primary" onClick={() => setShowAddModal(true)} style={{ marginTop: '1rem' }}>
            Add Project
          </button>
        </div>
      ) : (
        <div className="grid grid-2">
          {projects.map((project) => (
            <ProjectCard key={project.id} project={project} onRefresh={refetch} />
          ))}
        </div>
      )}

      {showAddModal && (
        <AddProjectModal onClose={() => setShowAddModal(false)} onAdd={refetch} />
      )}

      {showImportModal && (
        <ImportModal onClose={() => setShowImportModal(false)} onImport={refetch} />
      )}
    </div>
  );
}
