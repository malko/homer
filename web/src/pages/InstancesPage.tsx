import { useEffect, useRef, useState } from 'react';
import { AppHeader } from '../components/AppHeader';
import { usePeer } from '../hooks/usePeer';
import { api, LocalInstanceInfo, PeerInstance, ApiError } from '../api';

interface PendingRequest {
  id: string;
  peer_uuid: string | null;
  peer_name: string | null;
  peer_url: string | null;
  expires_at: number;
}

type PairingStep =
  | { type: 'idle' }
  | { type: 'form' }
  | { type: 'waiting'; request_id: string; local_code: string; peer_name: string; peer_uuid: string; peer_url: string }
  | { type: 'done'; peer_name: string; peer_uuid: string; peer_url: string; ca_same: boolean };

export function InstancesPage() {
  const { activePeer } = usePeer();
  const [self, setSelf] = useState<LocalInstanceInfo | null>(null);
  const [peers, setPeers] = useState<PeerInstance[]>([]);
  const [pending, setPending] = useState<PendingRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [pairingStep, setPairingStep] = useState<PairingStep>({ type: 'idle' });
  const [peerUrl, setPeerUrl] = useState('');
  const [pairingError, setPairingError] = useState<string | null>(null);

  // B-side approve state
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [approveCode, setApproveCode] = useState('');
  const [approveError, setApproveError] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);

  // CA adoption state (after pairing done)
  const [caAdopting, setCaAdopting] = useState(false);
  const [caAdoptResult, setCaAdoptResult] = useState<'adopted' | 'skipped' | null>(null);
  const [caAdoptError, setCaAdoptError] = useState<string | null>(null);

  // Auto-adopt CA after pairing (checkbox in form)
  const [adoptCaAfterPairing, setAdoptCaAfterPairing] = useState(false);

  // CA adoption for existing peers
  const [peerCaAdopting, setPeerCaAdopting] = useState<string | null>(null);
  const [peerCaAdoptSuccess, setPeerCaAdoptSuccess] = useState<string | null>(null);
  const [peerCaAdoptError, setPeerCaAdoptError] = useState<{ uuid: string; message: string } | null>(null);

  // CA file import
  const [caImporting, setCaImporting] = useState(false);
  const [caImportError, setCaImportError] = useState<string | null>(null);
  const [caImportSuccess, setCaImportSuccess] = useState(false);
  const certInputRef = useRef<HTMLInputElement>(null);
  const keyInputRef = useRef<HTMLInputElement>(null);

  // CA full export (cert + key)
  const [caExportError, setCaExportError] = useState<string | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadData = async () => {
    try {
      const [selfInfo, peerList, pendingList] = await Promise.all([
        api.instances.self(),
        api.instances.list(),
        api.instances.pendingPairings(),
      ]);
      setSelf(selfInfo);
      setPeers(peerList.peers);
      setPending(pendingList.pending);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Erreur lors du chargement');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Poll approval status while waiting
  useEffect(() => {
    if (pairingStep.type !== 'waiting') {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      return;
    }
    const { request_id, peer_name, peer_uuid, peer_url: waitingPeerUrl } = pairingStep;
    const shouldAdoptCa = adoptCaAfterPairing;
    const poll = async () => {
      try {
        const result = await api.instances.pairingStatus(request_id);
        if (result.status === 'approved') {
          clearInterval(pollRef.current!);
          pollRef.current = null;
          const donePeerUuid = result.peer_uuid ?? peer_uuid;
          setPairingStep({
            type: 'done',
            peer_name: result.peer_name ?? peer_name,
            peer_uuid: donePeerUuid,
            peer_url: waitingPeerUrl,
            ca_same: result.ca_same ?? true,
          });
          if (shouldAdoptCa && donePeerUuid) {
            setCaAdopting(true);
            setCaAdoptError(null);
            api.instances.adoptPeerCa(donePeerUuid)
              .then(() => setCaAdoptResult('adopted'))
              .catch(err => setCaAdoptError(err instanceof ApiError ? err.message : 'Adoption de CA échouée'))
              .finally(() => setCaAdopting(false));
          }
          await loadData();
        } else if (result.status === 'expired') {
          clearInterval(pollRef.current!);
          pollRef.current = null;
          setPairingError('La demande a expiré. Veuillez réessayer.');
          setPairingStep({ type: 'idle' });
        }
      } catch {
        // network error, continue polling
      }
    };
    pollRef.current = setInterval(poll, 3000);
    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  }, [pairingStep.type === 'waiting' ? pairingStep.request_id : null]);

  const handleInitiate = async () => {
    setPairingError(null);
    const url = peerUrl.trim();
    try {
      const result = await api.instances.initiatePairing(url);
      setPairingStep({
        type: 'waiting',
        request_id: result.request_id,
        local_code: result.local_code,
        peer_name: result.peer_name,
        peer_uuid: result.peer_uuid,
        peer_url: url,
      });
      setPeerUrl('');
    } catch (err) {
      setPairingError(err instanceof ApiError ? err.message : 'Impossible de contacter le pair');
    }
  };

  const handleCancelWaiting = () => {
    if (pairingStep.type === 'waiting') {
      api.instances.cancelPairing(pairingStep.request_id).catch(() => {});
    }
    setPairingStep({ type: 'idle' });
    setPairingError(null);
  };

  const handleApprove = async (id: string) => {
    setApproving(true);
    setApproveError(null);
    try {
      await api.instances.approvePairing(id, approveCode);
      window.location.reload();
    } catch (err) {
      setApproveError(err instanceof ApiError ? err.message : 'Approbation échouée');
      setApproving(false);
    }
  };

  const handleCancelPairing = (id: string) => {
    api.instances.cancelPairing(id).catch(() => {});
    setPending(prev => prev.filter(p => p.id !== id));
  };

  const handleUnpair = async (uuid: string, name: string) => {
    if (!confirm(`Désappairer "${name}" ?`)) return;
    try {
      await api.instances.unpair(uuid);
      setPeers(prev => prev.filter(p => p.uuid !== uuid));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Désappairage échoué');
    }
  };

  const handleAdoptExistingPeerCa = async (peerUuid: string) => {
    setPeerCaAdopting(peerUuid);
    setPeerCaAdoptError(null);
    setPeerCaAdoptSuccess(null);
    try {
      await api.instances.adoptPeerCa(peerUuid);
      // Full page reload needed: CA adoption changes the local TLS certificate,
      // and the browser must re-establish the TLS session to trust the new one.
      window.location.reload();
    } catch (err) {
      setPeerCaAdoptError({ uuid: peerUuid, message: err instanceof ApiError ? err.message : 'Adoption de CA échouée' });
      setPeerCaAdopting(null);
    }
  };

  const handleExportCa = async () => {
    setCaExportError(null);
    try {
      const ca = await api.proxy.exportCa();
      const triggerDownload = (content: string, filename: string) => {
        const blob = new Blob([content], { type: 'application/x-pem-file' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
      };
      triggerDownload(ca.cert, 'homer-ca.crt');
      triggerDownload(ca.key, 'homer-ca.key');
    } catch (err) {
      setCaExportError(err instanceof ApiError ? err.message : 'Export de CA échoué');
    }
  };

  const handleImportCaFile = async () => {
    const certFile = certInputRef.current?.files?.[0];
    const keyFile = keyInputRef.current?.files?.[0];
    if (!certFile || !keyFile) {
      setCaImportError('Veuillez sélectionner le certificat et la clé privée.');
      return;
    }
    setCaImporting(true);
    setCaImportError(null);
    setCaImportSuccess(false);
    try {
      const readText = (f: File) => new Promise<string>((res, rej) => {
        const r = new FileReader();
        r.onload = e => res(e.target!.result as string);
        r.onerror = () => rej(new Error('Erreur de lecture'));
        r.readAsText(f);
      });
      const [cert, key] = await Promise.all([readText(certFile), readText(keyFile)]);
      await api.proxy.importCa(cert, key);
      setCaImportSuccess(true);
      if (certInputRef.current) certInputRef.current.value = '';
      if (keyInputRef.current) keyInputRef.current.value = '';
    } catch (err) {
      setCaImportError(err instanceof ApiError ? err.message : 'Import de CA échoué');
    } finally {
      setCaImporting(false);
    }
  };

const handleAdoptPeerCa = async (peerUuid: string) => {
    setCaAdopting(true);
    setCaAdoptError(null);
    try {
      await api.instances.adoptPeerCa(peerUuid);
      // Full page reload needed: CA adoption changes the local TLS certificate,
      // and the browser must re-establish the TLS session to trust the new one.
      window.location.reload();
    } catch (err) {
      setCaAdoptError(err instanceof ApiError ? err.message : 'Adoption de CA échouée');
      setCaAdopting(false);
    }
  };

  if (loading) {
    return (
      <div className="page-container">
        <AppHeader title="Fédération" />
        <div className="page-loading"><div className="spinner" />Chargement...</div>
      </div>
    );
  }

  return (
    <div className="page-container">
      <AppHeader title="Fédération" />
      <div className="page-content">
        {error && <div className="message message--error">{error}</div>}

        {activePeer && (
          <div className="message" style={{ background: 'rgba(74, 158, 255, 0.1)', border: '1px solid rgba(74, 158, 255, 0.25)', color: 'var(--text-primary)', marginBottom: '1rem' }}>
            Cette page affiche les informations de l'<strong>instance locale</strong>, indépendamment de l'instance sélectionnée dans la barre de navigation.
          </div>
        )}

        {/* Cette instance */}
        {self && (
          <section className="instances-section">
            <h2>Cette instance</h2>
            <div className="instances-card">
              <div className="instances-row">
                <span className="instances-label">Nom</span>
                <span className="instances-value">{self.name}</span>
              </div>
              <div className="instances-row">
                <span className="instances-label">Version</span>
                <span className="instances-value">{self.version}</span>
              </div>
              {self.url && (
                <div className="instances-row">
                  <span className="instances-label">URL publique</span>
                  <span className="instances-value">{self.url}</span>
                </div>
              )}
            </div>
          </section>
        )}

        {/* Instances appairées */}
        <section className="instances-section">
          <h2>Instances appairées</h2>
          {peers.length === 0 ? (
            <p className="instances-empty">Aucune instance appairée pour le moment.</p>
          ) : (
            <ul className="instances-list">
              {peers.map((peer) => (
                <li key={peer.uuid} className="instances-card">
                  <div className="instances-row">
                    <span className="instances-label">{peer.name}</span>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                      <span className={`instances-status instances-status--${peer.status}`}>
                        {peer.status}
                      </span>
                      <button
                        className="btn btn-sm"
                        disabled={peerCaAdopting === peer.uuid}
                        onClick={() => handleAdoptExistingPeerCa(peer.uuid)}
                        title="Adopter la CA de ce pair pour partager la même autorité dans tout le homelab"
                      >
                        {peerCaAdopting === peer.uuid ? 'Adoption…' : 'Adopter la CA'}
                      </button>
                      <button
                        className="btn btn-danger btn-sm"
                        onClick={() => handleUnpair(peer.uuid, peer.name)}
                      >
                        Désappairer
                      </button>
                    </div>
                  </div>
                  <div className="instances-row">
                    <span className="instances-label">URL</span>
                    <span className="instances-value">{peer.url || '—'}</span>
                  </div>
                  {peerCaAdoptSuccess === peer.uuid && (
                    <div className="message message--success" style={{ marginTop: '0.5rem', fontSize: '0.8rem' }}>
                      ✓ CA adoptée. Relancez le navigateur si vous rencontrez des erreurs de certificat.
                    </div>
                  )}
                  {peerCaAdoptError?.uuid === peer.uuid && (
                    <div className="message message--error" style={{ marginTop: '0.5rem', fontSize: '0.8rem' }}>
                      {peerCaAdoptError.message}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Demandes d'appairage reçues (B's pending) */}
        {pending.length > 0 && (
          <section className="instances-section">
            <h2>Demandes d'appairage reçues</h2>
            <ul className="instances-list">
              {pending.map((req) => (
                <li key={req.id} className="instances-card">
                  <div className="instances-row">
                    <span className="instances-label">{req.peer_name ?? 'Inconnu'}</span>
                    <span className="instances-value">{req.peer_url ?? '—'}</span>
                  </div>
                  {approvingId === req.id ? (
                    <div style={{ marginTop: '0.75rem' }}>
                      <p className="instances-label" style={{ marginBottom: '0.5rem' }}>
                        Saisissez le code affiché sur l'instance distante pour confirmer l'appairage :
                      </p>
                      {approveError && <div className="message message--error" style={{ marginBottom: '0.5rem' }}>{approveError}</div>}
                      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                        <input
                          className="form-input instances-value--mono"
                          type="text"
                          placeholder="000000"
                          maxLength={6}
                          value={approveCode}
                          onChange={e => setApproveCode(e.target.value.replace(/\D/g, ''))}
                          onKeyDown={e => e.key === 'Enter' && approveCode.length === 6 && handleApprove(req.id)}
                          disabled={approving}
                          style={{ width: '9rem', letterSpacing: '0.2em', textAlign: 'center' }}
                        />
                        <button
                          className="btn btn-primary"
                          onClick={() => handleApprove(req.id)}
                          disabled={approveCode.length !== 6 || approving}
                        >
                          {approving ? 'Approbation…' : 'Confirmer'}
                        </button>
                        <button
                          className="btn"
                          disabled={approving}
                          onClick={() => { setApprovingId(null); setApproveCode(''); setApproveError(null); }}
                        >
                          Annuler
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="instances-row" style={{ marginTop: '0.5rem' }}>
                      <button className="btn btn-primary btn-sm" onClick={() => { setApprovingId(req.id); setApproveCode(''); setApproveError(null); }}>
                        Approuver
                      </button>
                      <button className="btn btn-sm" onClick={() => handleCancelPairing(req.id)}>
                        Refuser
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Gestion du CA */}
        <section className="instances-section">
          <h2>Autorité de certification</h2>
          <div className="instances-card">

            {/* Export */}
            <p className="instances-label" style={{ marginBottom: '0.5rem', fontWeight: 600 }}>Exporter</p>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
              <a className="btn btn-sm" href="/api/proxy/root-ca" download="homer-root-ca.crt">
                Télécharger le certificat (.crt)
              </a>
              <button className="btn btn-sm" onClick={handleExportCa}>
                Exporter cert + clé (.crt + .key)
              </button>
            </div>
            {caExportError && <div className="message message--error" style={{ marginBottom: '0.75rem', fontSize: '0.8rem' }}>{caExportError}</div>}
            <p className="instances-label" style={{ marginBottom: '1rem', fontSize: '0.8rem' }}>
              Le certificat seul sert à installer la CA dans le navigateur. L'export cert + clé permet de migrer ce CA sur un autre nœud manuellement (attention : la clé privée est sensible).
            </p>

            {/* Import */}
            <p className="instances-label" style={{ marginBottom: '0.5rem', fontWeight: 600 }}>Importer un CA personnalisé</p>
            <p className="instances-label" style={{ marginBottom: '0.5rem', fontSize: '0.8rem' }}>
              Remplace le CA Caddy par votre propre autorité. Tous les certificats seront régénérés.
            </p>
            {caImportError && <div className="message message--error" style={{ marginBottom: '0.5rem' }}>{caImportError}</div>}
            {caImportSuccess && <div className="message message--success" style={{ marginBottom: '0.5rem' }}>✓ CA importé — les certificats sont en cours de régénération.</div>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <label className="instances-label">
                Certificat (.crt / .pem) :
                <input ref={certInputRef} type="file" accept=".crt,.pem,.cer" style={{ marginLeft: '0.5rem' }} />
              </label>
              <label className="instances-label">
                Clé privée (.key / .pem) :
                <input ref={keyInputRef} type="file" accept=".key,.pem" style={{ marginLeft: '0.5rem' }} />
              </label>
              <button
                className="btn btn-primary"
                style={{ alignSelf: 'flex-start' }}
                onClick={handleImportCaFile}
                disabled={caImporting}
              >
                {caImporting ? 'Import en cours…' : 'Importer le CA'}
              </button>
            </div>
          </div>
        </section>

        {/* Initier un appairage */}
        <section className="instances-section">
          <div className="instances-section-header">
            <h2>Appairer une instance</h2>
            {pairingStep.type === 'idle' && (
              <button className="btn btn-primary" onClick={() => { setPairingStep({ type: 'form' }); setPairingError(null); }}>
                Appairer
              </button>
            )}
          </div>

          {pairingError && pairingStep.type === 'idle' && (
            <div className="message message--error">{pairingError}</div>
          )}

          {pairingStep.type === 'form' && (
            <div className="instances-card">
              {pairingError && <div className="message message--error" style={{ marginBottom: '0.75rem' }}>{pairingError}</div>}
              <label className="instances-label" style={{ display: 'block', marginBottom: '0.5rem' }}>
                URL de l'instance distante
              </label>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <input
                  className="form-input"
                  type="url"
                  placeholder="https://homer-b.local"
                  value={peerUrl}
                  onChange={e => setPeerUrl(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && peerUrl.trim() && handleInitiate()}
                  style={{ flex: 1 }}
                />
                <button
                  className="btn btn-primary"
                  onClick={handleInitiate}
                  disabled={!peerUrl.trim()}
                >
                  Initier
                </button>
                <button className="btn" onClick={() => { setPairingStep({ type: 'idle' }); setPairingError(null); }}>
                  Annuler
                </button>
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '0.75rem', cursor: 'pointer' }}>
                <input type="checkbox" checked={adoptCaAfterPairing} onChange={e => setAdoptCaAfterPairing(e.target.checked)} />
                Adopter le CA de l'instance distante après l'appairage
              </label>
            </div>
          )}

          {pairingStep.type === 'waiting' && (
            <div className="instances-card">
              <p className="instances-label" style={{ marginBottom: '0.75rem' }}>
                Demande envoyée à <strong>{pairingStep.peer_name}</strong>
                {' '}(<span className="instances-value--mono" style={{ fontSize: '0.85em' }}>{pairingStep.peer_url}</span>).
                {' '}Communiquez votre code à l'administrateur de l'instance distante, qui pourra approuver depuis la page Fédération.
              </p>
              <div className="instances-code-block" style={{ marginBottom: '1rem' }}>
                <div className="instances-code-label">Votre code (à communiquer à l'admin distant)</div>
                <div className="instances-code-display">{pairingStep.local_code}</div>
              </div>
              <p className="instances-label" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span className="spinner" style={{ width: '1em', height: '1em', borderWidth: '2px' }} />
                En attente d'approbation…
              </p>
              <button
                className="btn"
                style={{ marginTop: '0.75rem' }}
                onClick={handleCancelWaiting}
              >
                Annuler
              </button>
            </div>
          )}

          {pairingStep.type === 'done' && (
            <div className="instances-card">
              <div className="message message--success">
                ✓ Instance "{pairingStep.peer_name}" ({pairingStep.peer_url}) appairée avec succès.
              </div>
              {!pairingStep.ca_same && caAdoptResult === null && (
                <div style={{ marginTop: '1rem', padding: '0.75rem', backgroundColor: 'rgba(234, 179, 8, 0.1)', borderRadius: '0.375rem', border: '1px solid rgba(234, 179, 8, 0.3)' }}>
                  <p style={{ margin: '0 0 0.5rem', fontSize: '0.875rem', fontWeight: 600 }}>Autorités de certification différentes</p>
                  <p style={{ margin: '0 0 0.75rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    Les deux instances utilisent des CA distinctes. Adopter la CA de l'instance distante permet de partager la même autorité dans tout le homelab.
                  </p>
                  {caAdoptError && <p style={{ margin: '0 0 0.5rem', fontSize: '0.8rem', color: 'var(--color-danger)' }}>{caAdoptError}</p>}
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button
                      className="btn btn-primary"
                      disabled={caAdopting}
                      onClick={() => handleAdoptPeerCa(pairingStep.peer_uuid)}
                    >
                      {caAdopting ? 'Adoption…' : 'Adopter la CA distante'}
                    </button>
                    <button className="btn" disabled={caAdopting} onClick={() => setCaAdoptResult('skipped')}>
                      Garder les CA séparées
                    </button>
                  </div>
                </div>
              )}
              {!pairingStep.ca_same && caAdoptResult === 'adopted' && (
                <div className="message message--success" style={{ marginTop: '0.75rem' }}>
                  ✓ CA adoptée. Relancez le navigateur si vous rencontrez des erreurs de certificat.
                </div>
              )}
              <button
                className="btn"
                style={{ marginTop: '0.75rem' }}
                onClick={() => window.location.reload()}
              >
                Fermer
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
