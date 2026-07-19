import { useState } from 'react';
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

/**
 * Step-by-step instructions to mount external stack directories into Homer's
 * container via a compose override file the user can copy or download.
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
            {guide.upCommand && <ActionButtons content={guide.upCommand} />}
          </div>
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
