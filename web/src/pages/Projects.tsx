import { useState, useCallback, useRef, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useProjects } from '../hooks/useProjects';
import { useAuth } from '../hooks/useAuth';
import { useWebSocket } from '../hooks/useWebSocket';
import { usePeer } from '../hooks/usePeer';
import { useToast } from '../hooks/useToast';
import { AppHeader } from '../components/AppHeader';
import { YamlEditor } from '../components/YamlEditor';
import { ProjectDetail } from '../components/ProjectDetail';
import type { TabType } from '../components/ProjectDetail';
import { PROJECT_SOURCES } from '../config/projectSources';
import type { StandaloneContainer, ContainerDecision, ParseWarnings, AutoUpdatePolicy } from '../api';

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'project';
}

// ─── Add Project Selector Modal ───────────────────────────────────────────

type SelectorAction = 'create' | 'docker-run' | 'migrate' | 'existing';

interface AddProjectSelectorModalProps {
  onClose: () => void;
  onSelect: (action: SelectorAction, existingProjectsCount?: number) => void;
}

function AddProjectSelectorModal({ onClose, onSelect }: AddProjectSelectorModalProps) {
  const [existingCount, setExistingCount] = useState<number>(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function checkExisting() {
      try {
        const { api } = await import('../api');
        const result = await api.import.getExistingProjects();
        setExistingCount(result.projects.length);
      } catch (err) {
        console.error('Failed to check existing projects:', err);
      } finally {
        setLoading(false);
      }
    }
    checkExisting();
  }, []);

  const handleSelect = (action: SelectorAction) => {
    onSelect(action, existingCount);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '600px' }}>
        <div className="modal-header">
          <h2 className="modal-title">Ajouter un projet</h2>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>
        <div className="project-source-grid">
          {PROJECT_SOURCES.map((source) => {
            if (source.id === 'existing' && existingCount === 0 && !loading) return null;
            return (
              <button
                key={source.id}
                className="project-source-card"
                onClick={() => handleSelect(source.id as SelectorAction)}
              >
                <span className="project-source-icon">{source.icon}</span>
                <span className="project-source-label">{source.label}</span>
                <span className="project-source-desc">{source.description}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Add Project Modal ──────────────────────────────────────────────────────

const AUTO_UPDATE_POLICY_LABELS: Record<AutoUpdatePolicy, string> = {
  disabled: 'Désactivée',
  all: 'Toutes les mises à jour',
  semver_minor: 'Mises à jour mineures (1.x.x)',
  semver_patch: 'Patches uniquement (1.2.x)',
};

function AddProjectModal({ onClose, onAdd }: { onClose: () => void; onAdd: (projectId: number) => void }) {
  const [name, setName] = useState('');
  const [autoUpdatePolicy, setAutoUpdatePolicy] = useState<AutoUpdatePolicy>('disabled');
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
      const project = await addProject(name, {
        autoUpdate: autoUpdatePolicy !== 'disabled',
        autoUpdatePolicy,
        watchEnabled,
      });
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
          <div className="input-group">
            <label className="input-label">Mise à jour automatique</label>
            <select
              className="input"
              value={autoUpdatePolicy}
              onChange={(e) => setAutoUpdatePolicy(e.target.value as AutoUpdatePolicy)}
            >
              {(Object.keys(AUTO_UPDATE_POLICY_LABELS) as AutoUpdatePolicy[]).map(p => (
                <option key={p} value={p}>{AUTO_UPDATE_POLICY_LABELS[p]}</option>
              ))}
            </select>
            {autoUpdatePolicy !== 'disabled' && autoUpdatePolicy !== 'all' && (
              <p className="form-help">Nécessite que les images utilisent des tags semver (ex: 1.25.3)</p>
            )}
          </div>
          <div className="toggle-group">
            <div className={`toggle ${watchEnabled ? 'toggle-active' : ''}`} onClick={() => setWatchEnabled(!watchEnabled)}>
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

interface ImportModalProps {
  onClose: () => void;
  onImport: () => void;
  initialTab?: 'run' | 'migrate' | 'existing';
}

function ImportModal({ onClose, onImport, initialTab = 'run' }: ImportModalProps) {
  const [step, setStep] = useState<'input' | 'decisions' | 'preview'>('input');
  const [tab, setTab] = useState<'run' | 'migrate' | 'existing'>(() => {
    const valid: ('run' | 'migrate' | 'existing')[] = ['run', 'migrate', 'existing'];
    return valid.includes(initialTab) ? initialTab : 'run';
  });
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
  const [existingProjects, setExistingProjects] = useState<Array<{ name: string; path: string; composeExists: boolean }>>([]);
  const [selectedExisting, setSelectedExisting] = useState<Set<string>>(new Set());
  const [importingExisting, setImportingExisting] = useState(false);
  const [containerSearch, setContainerSearch] = useState('');

  const resetState = () => {
    setStep('input'); setDockerRunCmd(''); setStandaloneContainers([]);
    setSelectedContainers(new Set()); setDecisions([]); setAcceptedDecisions({});
    setWarnings({ unsupported: [], skipped: [] }); setEditedCompose('');
    setEditedEnv(''); setProjectName(''); setError('');
    setExistingProjects([]); setSelectedExisting(new Set());
    setContainerSearch('');
  };

  const handleLoadExistingProjects = async () => {
    setLoading(true);
    try {
      const { api } = await import('../api');
      const result = await api.import.getExistingProjects();
      setExistingProjects(result.projects);
    } catch (err) {
      console.error('Failed to load existing projects:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleExistingProject = (path: string) => {
    const next = new Set(selectedExisting);
    if (next.has(path)) next.delete(path); else next.add(path);
    setSelectedExisting(next);
  };

  const handleImportExistingProjects = async () => {
    if (selectedExisting.size === 0) { setError('Please select at least one project'); return; }
    setImportingExisting(true); setError('');
    try {
      const { api } = await import('../api');
      await api.import.importExisting(Array.from(selectedExisting));
      onImport(); onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import projects');
    } finally {
      setImportingExisting(false);
    }
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
    setLoading(true);
    try {
      const { api } = await import('../api');
      const result = await api.import.containersToCompose(Array.from(selectedContainers), decs);
      setEditedCompose(result.compose); setEditedEnv(result.envContent);
      setWarnings(result.warnings);
      if (!projectName) setProjectName('migrated-project');
      setStep('preview');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate compose');
    } finally {
      setLoading(false);
    }
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
    const steps = tab === 'run' ? ['Input', 'Preview'] : tab === 'migrate' ? ['Select', 'Decisions', 'Preview'] : ['Select Projects'];
    const currentIndex = tab === 'existing' ? 0 : step === 'input' ? 0 : step === 'decisions' ? 1 : 2;
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
      <div className="modal import-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '900px', width: '90vw' }}>
        <div className="modal-header">
          <h2 className="modal-title">Import / Migrate</h2>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>
        {renderStepIndicator()}
        <div className="import-tabs">
          <button className={`import-tab ${tab === 'run' ? 'active' : ''}`} onClick={() => { setTab('run'); resetState(); }}>From docker run</button>
          <button className={`import-tab ${tab === 'migrate' ? 'active' : ''}`} onClick={() => { setTab('migrate'); resetState(); }}>Migrate containers</button>
          <button className={`import-tab ${tab === 'existing' ? 'active' : ''}`} onClick={() => { setTab('existing'); resetState(); }}>Existing projects</button>
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
                    <div style={{ marginTop: '1rem' }}>
                      <input
                        type="text"
                        className="input"
                        placeholder="Search containers..."
                        value={containerSearch}
                        onChange={(e) => setContainerSearch(e.target.value)}
                        style={{ width: '100%' }}
                      />
                    </div>
                    <div className="standalone-list" style={{ marginTop: '0.5rem', maxHeight: '200px', overflowY: 'auto' }}>
                      {standaloneContainers.filter(c => 
                        containerSearch === '' || 
                        c.name.toLowerCase().includes(containerSearch.toLowerCase()) ||
                        c.image.toLowerCase().includes(containerSearch.toLowerCase())
                      ).map((c) => (
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
            {tab === 'existing' && (
              <>
                <p style={{ color: 'var(--color-text-muted)', marginBottom: '1rem', fontSize: '0.875rem' }}>
                  Discover projects in the data folder that are not yet managed
                </p>
                <button className="btn btn-secondary" onClick={handleLoadExistingProjects} disabled={loading}>{loading ? 'Scanning...' : 'Scan for Projects'}</button>
                {!loading && existingProjects.length > 0 && (
                  <>
                    <div className="standalone-list" style={{ marginTop: '1rem', maxHeight: '200px', overflowY: 'auto' }}>
                      {existingProjects.map((p) => (
                        <div key={p.path} className={`standalone-item ${selectedExisting.has(p.path) ? 'selected' : ''}`} onClick={() => handleToggleExistingProject(p.path)}>
                          <input type="checkbox" checked={selectedExisting.has(p.path)} onChange={() => {}} onClick={(e) => e.stopPropagation()} />
                          <div className="standalone-info">
                            <span className="standalone-name">{p.name}</span>
                            <span className="standalone-image">{p.path}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="form-actions" style={{ marginTop: '1rem' }}>
                      <button className="btn btn-primary" onClick={handleImportExistingProjects} disabled={importingExisting || selectedExisting.size === 0}>
                        {importingExisting ? 'Importing...' : `Import ${selectedExisting.size} project${selectedExisting.size !== 1 ? 's' : ''}`}
                      </button>
                    </div>
                  </>
                )}
                {!loading && existingProjects.length === 0 && (
                  <p style={{ color: 'var(--color-text-muted)', marginTop: '1rem', fontSize: '0.875rem' }}>No new projects found in the data folder.</p>
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
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(() => {
    const id = parseInt(searchParams.get('project') ?? '', 10);
    return isNaN(id) ? null : id;
  });
  const [initialTab, setInitialTab] = useState<TabType>(() => {
    const tab = searchParams.get('tab') as TabType | null;
    const valid: TabType[] = ['overview', 'compose', 'env', 'terminal', 'logs', 'proxy'];
    return tab && valid.includes(tab) ? tab : 'overview';
  });

  const selectProject = useCallback((id: number | null, tab: TabType = 'overview') => {
    setSelectedProjectId(id);
    setInitialTab(tab);
    if (id === null) {
      setSearchParams({}, { replace: true });
    } else {
      setSearchParams({ project: String(id), tab }, { replace: true });
    }
  }, [setSearchParams]);

  const handleTabChange = useCallback((tab: TabType) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.set('tab', tab);
      return next;
    }, { replace: true });
  }, [setSearchParams]);
  const [showSelectorModal, setShowSelectorModal] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importInitialTab, setImportInitialTab] = useState<'run' | 'migrate' | 'existing'>('run');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'running' | 'stopped' | 'updatable'>('all');
  const { addToast } = useToast();
  const { status } = useAuth();
  const { activePeer } = usePeer();

  useWebSocket((message) => {
    if (message.type === 'containers_updated' || message.type === 'project_updated') {
      refetch();
    }
    // peer_heartbeat: triggered when remote sends us its container list (new code deployed on both sides)
    if (message.type === 'peer_heartbeat' && message.peer_uuid === activePeer?.uuid) {
      refetch();
    }
    // heartbeat fallback: use local 10s heartbeat to poll remote data when connected to a peer
    if (message.type === 'heartbeat' && activePeer) {
      refetch();
    }
  });

  const handleSelectorAction = (action: SelectorAction) => {
    setShowSelectorModal(false);
    switch (action) {
      case 'create':
        setShowAddModal(true);
        break;
      case 'docker-run':
        setImportInitialTab('run');
        setShowImportModal(true);
        break;
      case 'migrate':
        setImportInitialTab('migrate');
        setShowImportModal(true);
        break;
      case 'existing':
        setImportInitialTab('existing');
        setShowImportModal(true);
        break;
    }
  };

  const handleSelectorClose = () => {
    setShowSelectorModal(false);
  };

  const selectedProject = projects.find(p => p.id === selectedProjectId) ?? null;

  const totalContainers = projects.reduce((acc, p) => acc + p.containers.length, 0);
  const runningContainers = projects.reduce((acc, p) => acc + p.containers.filter(c => c.state === 'running').length, 0);

  const filteredProjects = projects.filter(p => {
    if (search && !p.name.toLowerCase().includes(search.toLowerCase())) return false;
    if (filter === 'running' && !p.anyRunning) return false;
    if (filter === 'stopped' && p.anyRunning) return false;
    if (filter === 'updatable' && !p.update_available) return false;
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
      <AppHeader title={selectedProject ? selectedProject.name : 'Projets'} stats={projects.length > 0 ? `${projects.length} projet${projects.length !== 1 ? 's' : ''} · ${runningContainers}/${totalContainers} running` : undefined}>
        <button className="btn btn-primary btn-sm" onClick={() => setShowSelectorModal(true)}>Ajouter un projet</button>
      </AppHeader>

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
              {(['all', 'running', 'stopped', 'updatable'] as const).map(f => {
                const labels: Record<string, string> = { all: 'All', running: 'Running', stopped: 'Stopped', updatable: 'Updates' };
                return (
                  <button key={f} className={`chip ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)}>
                    {labels[f]}
                    {f === 'updatable' && projects.some(p => p.update_available) && (
                      <span className="update-dot" style={{ marginLeft: '0.25rem' }} />
                    )}
                  </button>
                );
              })}
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
                  onClick={() => selectProject(project.id, 'overview')}
                >
                  <span className={`status-dot-lg ${dotClass}`} />
                  <div className="project-list-item-info">
                    <span className="project-list-item-name">
                      {project.name}
                      {project.update_available && <span className="update-dot" title="Mise à jour disponible" />}
                    </span>
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
              onDelete={() => { selectProject(null); refetch(); }}
              addToast={addToast}
              initialTab={initialTab}
              onTabChange={handleTabChange}
            />
          ) : (
            <div className="empty-state">
              <div className="empty-state-icon">👈</div>
              <h3>Select a project</h3>
              <p>Click a project in the sidebar to view details</p>
              {projects.length === 0 && (
                <button className="btn btn-primary" onClick={() => setShowSelectorModal(true)} style={{ marginTop: '1rem' }}>
                  Add your first project
                </button>
              )}
            </div>
          )}
        </main>
      </div>

      {showSelectorModal && <AddProjectSelectorModal onClose={handleSelectorClose} onSelect={handleSelectorAction} />}
      {showAddModal && <AddProjectModal onClose={() => setShowAddModal(false)} onAdd={(projectId) => { selectProject(projectId, 'compose'); refetch(); }} />}
      {showImportModal && <ImportModal onClose={() => setShowImportModal(false)} onImport={refetch} initialTab={importInitialTab} />}
    </div>
  );
}
