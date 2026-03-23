import { useState, useCallback, useRef, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useProjects } from '../hooks/useProjects';
import { useAuth } from '../hooks/useAuth';
import { useWebSocket } from '../hooks/useWebSocket';
import { YamlEditor } from '../components/YamlEditor';
import { ProjectDetail } from '../components/ProjectDetail';
import type { StandaloneContainer, ContainerDecision, ParseWarnings } from '../api';
import bigiconImage from '@assets/bigicon.png';

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'project';
}

// ─── Toast ─────────────────────────────────────────────────────────────────

type ToastType = 'success' | 'error' | 'warning';
interface Toast { id: number; type: ToastType; message: string; }

const TOAST_ICONS: Record<ToastType, string> = { success: '✓', error: '✗', warning: '!' };

// ─── Add Project Modal ──────────────────────────────────────────────────────

function AddProjectModal({ onClose, onAdd }: { onClose: () => void; onAdd: (projectId: number) => void }) {
  const [name, setName] = useState('');
  const [autoUpdate, setAutoUpdate] = useState(false);
  const [watchEnabled, setWatchEnabled] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { addProject } = useProjects();
  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameInputRef.current?.focus();
  }, []);

  const slugifiedName = slugify(name);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const project = await addProject(name, { autoUpdate, watchEnabled });
      onAdd(project.id);
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
              ref={nameInputRef}
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
            <div className={`toggle ${autoUpdate ? 'active' : ''}`} onClick={() => setAutoUpdate(!autoUpdate)}>
              <div className="toggle-handle" />
            </div>
            <span className="toggle-label">Auto-update images</span>
          </div>
          <div className="toggle-group">
            <div className={`toggle ${watchEnabled ? 'active' : ''}`} onClick={() => setWatchEnabled(!watchEnabled)}>
              <div className="toggle-handle" />
            </div>
            <span className="toggle-label">Watch for file changes</span>
          </div>
          {error && <p className="error-text">{error}</p>}
          <div className="form-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? 'Adding...' : 'Add Project'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Import Modal ───────────────────────────────────────────────────────────

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
    setStep('input'); setDockerRunCmd(''); setStandaloneContainers([]);
    setSelectedContainers(new Set()); setDecisions([]); setAcceptedDecisions({});
    setWarnings({ unsupported: [], skipped: [] }); setEditedCompose('');
    setEditedEnv(''); setProjectName(''); setError('');
  };

  const handleParseCommand = async () => {
    if (!dockerRunCmd.trim()) { setError('Please enter a docker run command'); return; }
    setLoading(true); setError('');
    try {
      const { api } = await import('../api');
      const result = await api.import.parseRunCommand(dockerRunCmd);
      setEditedCompose(result.compose); setEditedEnv(result.envContent);
      setWarnings(result.warnings); setProjectName(result.service.name);
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
      setStandaloneContainers(result.containers); setSelectedContainers(new Set());
    } catch (err) {
      console.error('Failed to load standalone containers:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleContainer = (id: string) => {
    const next = new Set(selectedContainers);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelectedContainers(next);
  };

  const handleScanContainers = async () => {
    if (selectedContainers.size === 0) { setError('Please select at least one container'); return; }
    setLoading(true); setError('');
    try {
      const { api } = await import('../api');
      const result = await api.import.getDecisions(Array.from(selectedContainers));
      setDecisions(result.decisions);
      const initial: Record<string, boolean> = {};
      for (const d of result.decisions) { initial[`${d.containerId}:${d.type}`] = d.enabled; }
      setAcceptedDecisions(initial);
      if (result.decisions.length > 0) { setStep('decisions'); }
      else { await generateMigrateCompose({}); }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to get decisions');
    } finally {
      setLoading(false);
    }
  };

  const generateMigrateCompose = async (decs: Record<string, boolean>) => {
    const { api } = await import('../api');
    const result = await api.import.containersToCompose(Array.from(selectedContainers), decs);
    setEditedCompose(result.compose); setEditedEnv(result.envContent);
    setWarnings(result.warnings);
    if (!projectName) setProjectName('migrated-project');
  };

  const handleConfirmDecisions = async () => {
    setLoading(true);
    try { await generateMigrateCompose(acceptedDecisions); setStep('preview'); }
    catch (err) { setError(err instanceof Error ? err.message : 'Failed to generate compose'); }
    finally { setLoading(false); }
  };

  const handleSave = async () => {
    if (!projectName) { setError('Please enter a project name'); return; }
    setSaving(true); setError('');
    try {
      const { api } = await import('../api');
      await api.import.saveCompose({ compose: editedCompose, envContent: editedEnv, projectName });
      onImport(); onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const handleBack = () => {
    if (step === 'decisions') setStep('input');
    else if (step === 'preview') {
      if (tab === 'migrate' && decisions.length > 0) setStep('decisions');
      else setStep('input');
    }
  };

  const renderWarnings = () => {
    const all = [...warnings.unsupported, ...warnings.skipped];
    if (all.length === 0) return null;
    return (
      <div className="warning-banner">
        <div className="warning-header"><span className="warning-icon">&#9888;</span><span>Some options require manual attention:</span></div>
        <ul className="warning-list">{all.map((w, i) => <li key={i}>{w}</li>)}</ul>
      </div>
    );
  };

  const renderStepIndicator = () => {
    const steps = tab === 'run' ? ['Input', 'Preview'] : ['Select', 'Decisions', 'Preview'];
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
          <button className={`import-tab ${tab === 'run' ? 'active' : ''}`} onClick={() => { setTab('run'); resetState(); }}>From docker run</button>
          <button className={`import-tab ${tab === 'migrate' ? 'active' : ''}`} onClick={() => { setTab('migrate'); resetState(); }}>Migrate containers</button>
        </div>

        {step === 'input' && (
          <div className="import-content">
            {tab === 'run' && (
              <>
                <div className="input-group">
                  <label className="input-label">Paste docker run command</label>
                  <textarea className="input input-textarea" value={dockerRunCmd} onChange={(e) => setDockerRunCmd(e.target.value)} placeholder="docker run -d --name myapp -p 8080:80 nginx" rows={5} />
                </div>
                <div className="form-actions">
                  <button className="btn btn-primary" onClick={handleParseCommand} disabled={loading}>{loading ? 'Parsing...' : 'Parse Command'}</button>
                </div>
              </>
            )}
            {tab === 'migrate' && (
              <>
                <p style={{ color: 'var(--color-text-muted)', marginBottom: '1rem', fontSize: '0.875rem' }}>
                  Select containers started with <code>docker run</code> (not managed by compose)
                </p>
                <button className="btn btn-secondary" onClick={handleLoadStandalone} disabled={loading}>{loading ? 'Scanning...' : 'Scan for Containers'}</button>
                {!loading && standaloneContainers.length > 0 && (
                  <>
                    <div className="standalone-list" style={{ marginTop: '1rem', maxHeight: '200px', overflowY: 'auto' }}>
                      {standaloneContainers.map((c) => (
                        <div key={c.id} className={`standalone-item ${selectedContainers.has(c.id) ? 'selected' : ''}`} onClick={() => handleToggleContainer(c.id)}>
                          <input type="checkbox" checked={selectedContainers.has(c.id)} onChange={() => {}} onClick={(e) => e.stopPropagation()} />
                          <div className="standalone-info">
                            <span className="standalone-name">{c.name}{c.hasGpu && <span className="gpu-badge">GPU</span>}</span>
                            <span className="standalone-image">{c.image}</span>
                          </div>
                          <span className="standalone-status">{c.status}</span>
                        </div>
                      ))}
                    </div>
                    <div className="form-actions" style={{ marginTop: '1rem' }}>
                      <button className="btn btn-primary" onClick={handleScanContainers} disabled={loading || selectedContainers.size === 0}>
                        {loading ? 'Scanning...' : `Continue with ${selectedContainers.size} container${selectedContainers.size !== 1 ? 's' : ''}`}
                      </button>
                    </div>
                  </>
                )}
                {!loading && standaloneContainers.length === 0 && (
                  <p style={{ color: 'var(--color-text-muted)', marginTop: '1rem', fontSize: '0.875rem' }}>No standalone containers found.</p>
                )}
              </>
            )}
            {error && <p className="error-text" style={{ marginTop: '1rem' }}>{error}</p>}
          </div>
        )}

        {step === 'decisions' && (
          <div className="import-content">
            <p style={{ color: 'var(--color-text-muted)', marginBottom: '1rem', fontSize: '0.875rem' }}>The following configurations need your confirmation:</p>
            <div className="decisions-list">
              {decisions.map((d, idx) => {
                const key = `${d.containerId}:${d.type}`;
                const isEnabled = acceptedDecisions[key] ?? d.enabled;
                return (
                  <div key={idx} className="decision-item">
                    <div className="decision-header">
                      <span className="decision-type">
                        {d.type === 'gpu' && '🎮 GPU'}{d.type === 'privileged' && '🛡 Privileged'}{d.type === 'capability' && '⚙ Capability'}
                      </span>
                      <span className="decision-container">{d.containerName}</span>
                    </div>
                    <p className="decision-message">{d.message}</p>
                    <div className="decision-actions">
                      <label className="decision-toggle">
                        <input type="checkbox" checked={isEnabled} onChange={(e) => setAcceptedDecisions(prev => ({ ...prev, [key]: e.target.checked }))} />
                        <span>Enable {d.type}</span>
                      </label>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="form-actions" style={{ marginTop: '1.5rem' }}>
              <button className="btn btn-secondary" onClick={handleBack}>Back</button>
              <button className="btn btn-primary" onClick={handleConfirmDecisions} disabled={loading}>{loading ? 'Generating...' : 'Continue'}</button>
            </div>
          </div>
        )}

        {step === 'preview' && (
          <div className="import-content">
            {renderWarnings()}
            <div className="preview-section">
              <label className="input-label">docker-compose.yml<span className="editable-hint">(editable)</span></label>
              <YamlEditor value={editedCompose} onChange={setEditedCompose} minHeight="200px" />
            </div>
            {editedEnv && (
              <div className="preview-section" style={{ marginTop: '1rem' }}>
                <label className="input-label">.env file<span className="editable-hint">(editable)</span></label>
                <YamlEditor value={editedEnv} onChange={setEditedEnv} minHeight="120px" />
              </div>
            )}
            <div className="import-save" style={{ marginTop: '1.5rem' }}>
              <div className="input-group">
                <label className="input-label">Project Name</label>
                <input type="text" className="input" value={projectName} onChange={(e) => setProjectName(e.target.value)} placeholder="my-project" />
              </div>
              <div className="input-group">
                <label className="input-label">Save Path</label>
                <p className="project-path">Files will be saved at: <code>{`projects/${slugify(projectName)}/docker-compose.yml`}</code></p>
              </div>
              {error && <p className="error-text">{error}</p>}
              <div className="form-actions">
                <button className="btn btn-secondary" onClick={handleBack}>Back</button>
                <button className="btn btn-primary" onClick={handleSave} disabled={saving || !projectName}>{saving ? 'Saving...' : 'Save Files'}</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Projects Page ──────────────────────────────────────────────────────────

export function ProjectsPage() {
  const { projects, loading, error, refetch } = useProjects();
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [initialTab, setInitialTab] = useState<'overview' | 'compose'>('overview');
  const [searchParams] = useSearchParams();
  useEffect(() => {
    const selectId = searchParams.get('select');
    if (selectId) {
      const id = parseInt(selectId, 10);
      if (!isNaN(id)) setSelectedProjectId(id);
    }
  }, []);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'running' | 'stopped'>('all');
  const [toasts, setToasts] = useState<Toast[]>([]);
  const { logout, status } = useAuth();
  const [showUserMenu, setShowUserMenu] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setShowUserMenu(false);
      }
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const addToast = useCallback((type: ToastType, message: string) => {
    const id = Date.now();
    setToasts(prev => [...prev, { id, type, message }]);
    if (type !== 'error') {
      setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000);
    }
  }, []);

  useWebSocket((message) => {
    if (message.type === 'containers_updated' || message.type === 'project_updated') {
      refetch();
    }
  });

  const selectedProject = projects.find(p => p.id === selectedProjectId) ?? null;

  const totalContainers = projects.reduce((acc, p) => acc + p.containers.length, 0);
  const runningContainers = projects.reduce((acc, p) => acc + p.containers.filter(c => c.state === 'running').length, 0);

  const filteredProjects = projects.filter(p => {
    if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false;
    if (filter === 'running' && !p.anyRunning) return false;
    if (filter === 'stopped' && p.anyRunning) return false;
    return true;
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
    <div className="layout">
      {/* Header */}
      <header className="app-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <Link to="/home" className="header-logo-link">
            <img src={bigiconImage} alt="" className="header-icon" />
            <div>
              <h1 className="page-title">HOMER</h1>
              <p className="page-subtitle">
                <span className="accent">Hom</span>elab manag<span className="accent">er</span>
              </p>
            </div>
          </Link>
          {projects.length > 0 && (
            <span className="header-stats">
              {projects.length} project{projects.length !== 1 ? 's' : ''} · {runningContainers}/{totalContainers} running
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <div className="user-menu-container" ref={userMenuRef}>
            <button className="user-menu-trigger" onClick={(e) => { e.stopPropagation(); setShowUserMenu(!showUserMenu); }}>
              <span>{status?.username}</span>
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ opacity: 0.6 }}>
                <path d="M2 4L6 8L10 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
            {showUserMenu && (
              <div className="user-dropdown">
                <div className="user-dropdown-username">{status?.username}</div>
                <button className="user-dropdown-logout" onClick={logout}>Logout</button>
              </div>
            )}
          </div>
          <button className="btn btn-secondary btn-sm" onClick={() => setShowImportModal(true)}>Import</button>
          <button className="btn btn-primary btn-sm" onClick={() => setShowAddModal(true)}>Add Project</button>
        </div>
      </header>

      {/* Body: sidebar + detail */}
      <div className="layout-body">
        {/* Sidebar */}
        <aside className="sidebar">
          <div className="sidebar-search">
            <input
              className="input"
              placeholder="Search projects..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ marginBottom: '0.5rem' }}
            />
            <div className="filter-chips">
              {(['all', 'running', 'stopped'] as const).map(f => (
                <button key={f} className={`chip ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)}>
                  {f.charAt(0).toUpperCase() + f.slice(1)}
                </button>
              ))}
            </div>
          </div>

          <div className="project-list">
            {error && <p style={{ color: 'var(--color-danger)', fontSize: '0.75rem', padding: '0.5rem' }}>{error}</p>}

            {filteredProjects.length === 0 && !error && (
              <p className="sidebar-empty">
                {projects.length === 0 ? 'No projects yet.' : 'No matches.'}
              </p>
            )}

            {filteredProjects.map(project => {
              const running = project.containers.filter(c => c.state === 'running').length;
              const total = project.containers.length;
              const dotClass = project.allRunning ? 'dot-running' : project.anyRunning ? 'dot-partial' : 'dot-stopped';

              return (
                <div
                  key={project.id}
                  className={`project-list-item ${selectedProjectId === project.id ? 'selected' : ''}`}
                  onClick={() => { setSelectedProjectId(project.id); setInitialTab('overview'); }}
                >
                  <span className={`status-dot-lg ${dotClass}`} />
                  <div className="project-list-item-info">
                    <span className="project-list-item-name">{project.name}</span>
                    <span className="project-list-item-meta">
                      {running}/{total} running
                      {project.auto_update ? ' · auto' : ''}
                      {project.watch_enabled ? ' · watch' : ''}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </aside>

        {/* Detail panel */}
        <main className="main-content" style={{ padding: 0 }}>
          {selectedProject ? (
            <ProjectDetail
              key={selectedProject.id}
              project={selectedProject}
              onRefresh={refetch}
              onDelete={() => { setSelectedProjectId(null); refetch(); }}
              addToast={addToast}
              initialTab={initialTab}
            />
          ) : (
            <div className="empty-state">
              <div className="empty-state-icon">👈</div>
              <h3>Select a project</h3>
              <p>Click a project in the sidebar to view details</p>
              {projects.length === 0 && (
                <button className="btn btn-primary" onClick={() => setShowAddModal(true)} style={{ marginTop: '1rem' }}>
                  Add your first project
                </button>
              )}
            </div>
          )}
        </main>
      </div>

      {/* Toasts */}
      <div className="toast-container">
        {toasts.map(toast => (
          <div key={toast.id} className={`toast toast-${toast.type}`}>
            <span style={{ fontWeight: 700 }}>{TOAST_ICONS[toast.type]}</span>
            <span style={{ flex: 1 }}>{toast.message}</span>
            <button className="toast-dismiss" onClick={() => dismissToast(toast.id)}>×</button>
          </div>
        ))}
      </div>

      {showAddModal && <AddProjectModal onClose={() => setShowAddModal(false)} onAdd={(projectId) => { setInitialTab('compose'); setSelectedProjectId(projectId); refetch(); }} />}
      {showImportModal && <ImportModal onClose={() => setShowImportModal(false)} onImport={refetch} />}
    </div>
  );
}
