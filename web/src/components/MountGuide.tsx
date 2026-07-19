import { useState } from 'react';
import { api } from '../api';
import type { MountGuide as MountGuideData } from '../api';

function ActionButtons({ content, filename }: { content: string; filename?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  const handleDownload = () => {
    const blob = new Blob([content], { type: 'text/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename ?? 'docker-compose.override.yml';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <span className="mount-guide__actions">
      <button type="button" className="btn btn-sm btn-secondary" onClick={handleCopy}>
        {copied ? 'Copié ✓' : 'Copier'}
      </button>
      {filename !== undefined && (
        <button type="button" className="btn btn-sm btn-secondary" onClick={handleDownload}>
          Télécharger
        </button>
      )}
    </span>
  );
}

type ApplyState = 'idle' | 'confirm' | 'applying' | 'waiting' | 'error';

function ApplyButton() {
  const [state, setState] = useState<ApplyState>('idle');
  const [error, setError] = useState('');

  const waitForHomer = async () => {
    // Homer's container is being recreated: poll until the API answers again.
    for (let i = 0; i < 45; i++) {
      await new Promise(r => setTimeout(r, 2000));
      try {
        await api.auth.status();
        window.location.reload();
        return;
      } catch {}
    }
    setError('Homer ne répond toujours pas — vérifiez son état avec docker ps.');
    setState('error');
  };

  const handleApply = async () => {
    if (state === 'idle') {
      setState('confirm');
      return;
    }
    setState('applying');
    setError('');
    try {
      await api.system.applyMountOverride();
      setState('waiting');
      waitForHomer();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Échec de l'application");
      setState('error');
    }
  };

  if (state === 'waiting' || state === 'applying') {
    return (
      <span className="mount-guide__actions" style={{ alignItems: 'center', gap: '0.5rem' }}>
        <span className="spinner" style={{ width: '14px', height: '14px' }} />
        <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
          {state === 'applying' ? 'Lancement…' : 'Homer redémarre, la page se rechargera automatiquement…'}
        </span>
      </span>
    );
  }

  return (
    <span className="mount-guide__actions" style={{ flexDirection: 'column', alignItems: 'flex-end', gap: '0.25rem' }}>
      <button type="button" className={`btn btn-sm ${state === 'confirm' ? 'btn-danger' : 'btn-primary'}`} onClick={handleApply}>
        {state === 'confirm' ? 'Confirmer le redémarrage de Homer' : 'Appliquer et redémarrer Homer'}
      </button>
      {error && <span className="error-text" style={{ fontSize: '0.75rem', maxWidth: '320px' }}>{error}</span>}
    </span>
  );
}

/**
 * Step-by-step instructions to mount external stack directories into Homer's
 * container via a compose override file the user can copy or download, then
 * apply with a single click (a detached helper recreates Homer's stack).
 */
export function MountGuide({ guide }: { guide: MountGuideData }) {
  const overrideBasename = guide.overrideFile?.split('/').pop() ?? 'docker-compose.override.yml';

  return (
    <div className="mount-guide">
      <p className="mount-guide__intro">
        Pour une gestion complète (édition, déploiement, watch), Homer doit pouvoir lire le dossier de la stack.
      </p>
      {guide.overrideFile ? (
        <>
          <div className="mount-guide__step">
            <span className="mount-guide__step-title">
              1. {guide.overrideExists ? 'Complétez le fichier' : 'Créez le fichier'} <code>{guide.overrideFile}</code>
              {guide.overrideExists ? ' en y ajoutant ces volumes :' : ' :'}
            </span>
            <ActionButtons content={guide.overrideContent} filename={overrideBasename} />
          </div>
          <pre className="mount-guide__code">{guide.overrideContent}</pre>
          <div className="mount-guide__step">
            <span className="mount-guide__step-title">
              2. Appliquez (recrée le conteneur Homer, brève interruption) :
            </span>
            <ApplyButton />
          </div>
          {guide.upCommand && (
            <div className="mount-guide__step" style={{ marginTop: '0.375rem' }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>ou manuellement :</span>
              <ActionButtons content={guide.upCommand} />
            </div>
          )}
          {guide.upCommand && <pre className="mount-guide__code">{guide.upCommand}</pre>}
        </>
      ) : (
        <>
          <div className="mount-guide__step">
            <span className="mount-guide__step-title">
              Ajoutez ces volumes au service <code>homer</code> de votre docker-compose.yml, puis relancez avec <code>docker compose up -d</code> :
            </span>
            <ActionButtons content={guide.overrideContent} filename="docker-compose.override.yml" />
          </div>
          <pre className="mount-guide__code">{guide.overrideContent}</pre>
        </>
      )}
    </div>
  );
}
