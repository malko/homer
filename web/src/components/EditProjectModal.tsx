import { useState, useEffect, useCallback } from 'react';
import { YamlEditor } from './YamlEditor';
import { ErrorOverlay } from './ErrorOverlay';
import type { Project } from '../api';

interface EditProjectModalProps {
  project: Project;
  onClose: () => void;
  onSave: () => void;
}

export function EditProjectModal({ project, onClose, onSave }: EditProjectModalProps) {
  const [composeContent, setComposeContent] = useState('');
  const [envContent, setEnvContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [overlayMessage, setOverlayMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null);
  const [activeTab, setActiveTab] = useState<'compose' | 'env'>('compose');
  const [hasEnvFile, setHasEnvFile] = useState(false);
  const [composeErrors, setComposeErrors] = useState<string[]>([]);

  const handleComposeValidate = useCallback((isValid: boolean, errors: string[]) => {
    setComposeErrors(errors);
  }, []);

  useEffect(() => {
    const loadFiles = async () => {
      try {
        const { api } = await import('../api');
        const files = await api.projects.readFiles(project.id);
        setComposeContent(files.composeContent);
        setEnvContent(files.envContent);
        setHasEnvFile(!!files.envPath && !!files.envContent);
      } catch (err) {
        setOverlayMessage({
          type: 'error',
          text: err instanceof Error ? err.message : 'Failed to load files',
        });
      } finally {
        setLoading(false);
      }
    };

    loadFiles();
  }, [project.id]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [composeContent, envContent, hasEnvFile, composeErrors]);

  const handleValidate = async () => {
    setValidating(true);
    try {
      const { api } = await import('../api');
      const result = await api.projects.validate(project.id);
      if (result.valid) {
        setOverlayMessage({
          type: 'success',
          text: 'Compose file is valid! Docker accepted the configuration.',
        });
      } else {
        setOverlayMessage({
          type: 'error',
          text: result.error || 'Validation failed',
        });
      }
    } catch (err) {
      setOverlayMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Validation failed',
      });
    } finally {
      setValidating(false);
    }
  };

  const handleSave = async () => {
    if (composeErrors.length > 0) {
      setOverlayMessage({
        type: 'error',
        text: 'Please fix YAML validation errors before saving',
      });
      return;
    }

    setSaving(true);

    try {
      const { api } = await import('../api');
      await api.projects.saveFiles(project.id, {
        composeContent,
        envContent: hasEnvFile ? envContent : undefined,
      });
      onSave();
      onClose();
    } catch (err) {
      setOverlayMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to save files',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal edit-project-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '900px' }}>
        <div className="modal-header">
          <h2 className="modal-title">Edit Project: {project.name}</h2>
          <button className="modal-close" onClick={onClose}>&times;</button>
        </div>

        <div className="edit-project-tabs">
          <button
            className={`edit-project-tab ${activeTab === 'compose' ? 'active' : ''}`}
            onClick={() => setActiveTab('compose')}
          >
            docker-compose.yml
            {composeErrors.length > 0 && <span className="tab-error-badge">{composeErrors.length}</span>}
          </button>
          {hasEnvFile && (
            <button
              className={`edit-project-tab ${activeTab === 'env' ? 'active' : ''}`}
              onClick={() => setActiveTab('env')}
            >
              .env
            </button>
          )}
          {!hasEnvFile && (
            <button
              className="edit-project-tab"
              onClick={() => {
                setHasEnvFile(true);
                setEnvContent('# Environment variables\n');
                setActiveTab('env');
              }}
            >
              + Add .env file
            </button>
          )}
        </div>

        {loading ? (
          <div className="loading">
            <div className="spinner" />
            Loading files...
          </div>
        ) : (
          <>
            {activeTab === 'compose' && (
              <div className="edit-project-content">
                <YamlEditor
                  value={composeContent}
                  onChange={setComposeContent}
                  onValidate={handleComposeValidate}
                  minHeight="400px"
                />
              </div>
            )}

            {activeTab === 'env' && (
              <div className="edit-project-content">
                <YamlEditor
                  value={envContent}
                  onChange={setEnvContent}
                  minHeight="200px"
                />
                <button
                  className="btn btn-sm btn-danger"
                  style={{ marginTop: '0.5rem' }}
                  onClick={() => {
                    setHasEnvFile(false);
                    setActiveTab('compose');
                  }}
                >
                  Remove .env file
                </button>
              </div>
            )}

            <div className="edit-project-footer">
              <div className="project-path" style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                {activeTab === 'compose' ? project.path : project.env_path}
              </div>
              <div className="form-actions">
                <button className="btn btn-secondary" onClick={onClose}>
                  Cancel
                </button>
                {activeTab === 'compose' && (
                  <button
                    className="btn btn-info"
                    onClick={handleValidate}
                    disabled={validating || composeErrors.length > 0}
                  >
                    {validating ? 'Validating...' : 'Validate with Docker'}
                  </button>
                )}
                <button
                  className="btn btn-primary"
                  onClick={handleSave}
                  disabled={saving || composeErrors.length > 0}
                >
                  {saving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </div>
          </>
        )}

        {overlayMessage && (
          <ErrorOverlay
            type={overlayMessage.type}
            messages={[overlayMessage.text]}
            onDismiss={() => setOverlayMessage(null)}
            className="overlay-message-container"
          />
        )}
      </div>
    </div>
  );
}
