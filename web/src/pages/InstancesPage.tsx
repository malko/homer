import { useEffect, useState } from 'react';
import { AppHeader } from '../components/AppHeader';
import { api, LocalInstanceInfo, PeerInstance, DiscoveredPeer, ApiError } from '../api';

interface PairingData {
  request_id: string;
  local_code: string;
  remote_code: string;
  peer_name: string;
}

interface ConflictResolution {
  username: string;
  password_local: string;
  password_remote: string;
}

type PairingStep =
  | { type: 'idle' }
  | { type: 'form' }
  | ({ type: 'codes' } & PairingData)
  | ({ type: 'confirming' } & PairingData)
  | ({ type: 'conflicts' } & PairingData & { conflicts: string[] })
  | ({ type: 'resolving' } & PairingData & { conflicts: string[] })
  | { type: 'done'; peer_name: string };

interface PendingRequest {
  id: string;
  peer_uuid: string | null;
  peer_name: string | null;
  peer_url: string | null;
  local_code: string;
  expires_at: number;
}

export function InstancesPage() {
  const [self, setSelf] = useState<LocalInstanceInfo | null>(null);
  const [peers, setPeers] = useState<PeerInstance[]>([]);
  const [pending, setPending] = useState<PendingRequest[]>([]);
  const [discovered, setDiscovered] = useState<DiscoveredPeer[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [pairingStep, setPairingStep] = useState<PairingStep>({ type: 'idle' });
  const [peerUrl, setPeerUrl] = useState('');
  const [enteredCode, setEnteredCode] = useState('');
  const [pairingError, setPairingError] = useState<string | null>(null);
  const [conflictResolutions, setConflictResolutions] = useState<ConflictResolution[]>([]);

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

  const handleDiscover = async () => {
    setScanning(true);
    setError(null);
    try {
      const result = await api.instances.discover();
      setDiscovered(result.peers);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Découverte impossible');
    } finally {
      setScanning(false);
    }
  };

  const handleInitiate = async () => {
    setPairingError(null);
    try {
      const result = await api.instances.initiatePairing(peerUrl.trim());
      setPairingStep({
        type: 'codes',
        request_id: result.request_id,
        local_code: result.local_code,
        remote_code: result.remote_code,
        peer_name: result.peer_name,
      });
      setPeerUrl('');
    } catch (err) {
      setPairingError(err instanceof ApiError ? err.message : 'Impossible de contacter le pair');
    }
  };

  const handleConfirm = async () => {
    if (pairingStep.type !== 'codes') return;
    const data: PairingData = {
      request_id: pairingStep.request_id,
      local_code: pairingStep.local_code,
      remote_code: pairingStep.remote_code,
      peer_name: pairingStep.peer_name,
    };
    setPairingError(null);
    setPairingStep({ type: 'confirming', ...data });
    try {
      const result = await api.instances.confirmPairing(data.request_id, enteredCode.trim());
      if (result.conflicts && result.conflicts.length > 0) {
        setConflictResolutions(result.conflicts.map(u => ({ username: u, password_local: '', password_remote: '' })));
        setPairingStep({ type: 'conflicts', ...data, conflicts: result.conflicts });
        setEnteredCode('');
      } else {
        setPairingStep({ type: 'done', peer_name: result.peer_name ?? data.peer_name });
        setEnteredCode('');
        await loadData();
      }
    } catch (err) {
      setPairingError(err instanceof ApiError ? err.message : 'Confirmation échouée');
      setPairingStep({ type: 'codes', ...data });
    }
  };

  const handleResolveConflicts = async () => {
    if (pairingStep.type !== 'conflicts') return;
    const data: PairingData = {
      request_id: pairingStep.request_id,
      local_code: pairingStep.local_code,
      remote_code: pairingStep.remote_code,
      peer_name: pairingStep.peer_name,
    };
    setPairingError(null);
    setPairingStep({ type: 'resolving', ...data, conflicts: pairingStep.conflicts });
    try {
      const result = await api.instances.resolvePairing(data.request_id, conflictResolutions);
      setPairingStep({ type: 'done', peer_name: result.peer_name ?? data.peer_name });
      setConflictResolutions([]);
      await loadData();
    } catch (err) {
      setPairingError(err instanceof ApiError ? err.message : 'Résolution échouée');
      setPairingStep({ type: 'conflicts', ...data, conflicts: pairingStep.conflicts });
    }
  };

  const updateConflictResolution = (username: string, field: 'password_local' | 'password_remote', value: string) => {
    setConflictResolutions(prev => prev.map(r => r.username === username ? { ...r, [field]: value } : r));
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
                <span className="instances-label">Identifiant</span>
                <span className="instances-value instances-value--mono">{self.uuid}</span>
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
                        className="btn btn-danger btn-sm"
                        onClick={() => handleUnpair(peer.uuid, peer.name)}
                      >
                        Désappairer
                      </button>
                    </div>
                  </div>
                  <div className="instances-row">
                    <span className="instances-label">URL</span>
                    <span className="instances-value">{peer.url}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Appairages reçus en attente */}
        {pending.length > 0 && (
          <section className="instances-section">
            <h2>Demandes d'appairage reçues</h2>
            <ul className="instances-list">
              {pending.map((req) => (
                <li key={req.id} className="instances-card">
                  <div className="instances-row">
                    <span className="instances-label">{req.peer_name ?? req.peer_uuid ?? 'Inconnu'}</span>
                    <span className="instances-value">{req.peer_url}</span>
                  </div>
                  <div className="instances-row">
                    <span className="instances-label">Code à afficher à l'admin distant</span>
                    <span className="instances-value instances-value--mono instances-code">{req.local_code}</span>
                  </div>
                  <div className="instances-row">
                    <span className="instances-label" />
                    <button className="btn btn-sm" onClick={() => handleCancelPairing(req.id)}>
                      Annuler
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Initier un appairage */}
        <section className="instances-section">
          <div className="instances-section-header">
            <h2>Appairer une instance</h2>
            {pairingStep.type === 'idle' && (
              <button className="btn btn-primary" onClick={() => setPairingStep({ type: 'form' })}>
                Appairer
              </button>
            )}
          </div>

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
            </div>
          )}

          {(pairingStep.type === 'codes' || pairingStep.type === 'confirming') && (
            <div className="instances-card">
              {pairingError && <div className="message message--error" style={{ marginBottom: '0.75rem' }}>{pairingError}</div>}
              <p className="instances-label" style={{ marginBottom: '0.75rem' }}>
                Appairage avec <strong>{pairingStep.peer_name}</strong> en cours. Échangez les codes avec l'admin de l'instance distante.
              </p>

              <div className="instances-pairing-codes">
                <div className="instances-code-block">
                  <div className="instances-code-label">Votre code (à communiquer à l'admin distant)</div>
                  <div className="instances-code-display">{pairingStep.local_code}</div>
                </div>
                <div className="instances-code-block">
                  <div className="instances-code-label">Code affiché sur l'instance distante (à saisir ici)</div>
                  <div className="instances-code-display">
                    {pairingStep.remote_code}
                    <span className="instances-code-hint"> (attendu)</span>
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem', alignItems: 'center' }}>
                <input
                  className="form-input instances-value--mono"
                  type="text"
                  placeholder="Code vu sur l'instance distante"
                  maxLength={6}
                  value={enteredCode}
                  onChange={e => setEnteredCode(e.target.value.replace(/\D/g, ''))}
                  onKeyDown={e => e.key === 'Enter' && enteredCode.length === 6 && handleConfirm()}
                  disabled={pairingStep.type === 'confirming'}
                  style={{ width: '10rem', letterSpacing: '0.2em', textAlign: 'center' }}
                />
                <button
                  className="btn btn-primary"
                  onClick={handleConfirm}
                  disabled={enteredCode.length !== 6 || pairingStep.type === 'confirming'}
                >
                  {pairingStep.type === 'confirming' ? 'Confirmation…' : 'Confirmer'}
                </button>
                <button
                  className="btn"
                  disabled={pairingStep.type === 'confirming'}
                  onClick={() => { setPairingStep({ type: 'idle' }); setPairingError(null); setEnteredCode(''); }}
                >
                  Annuler
                </button>
              </div>
            </div>
          )}

          {(pairingStep.type === 'conflicts' || pairingStep.type === 'resolving') && (
            <div className="instances-card">
              {pairingError && <div className="message message--error" style={{ marginBottom: '0.75rem' }}>{pairingError}</div>}
              <p className="instances-label" style={{ marginBottom: '0.75rem' }}>
                Des utilisateurs portent le même nom sur les deux instances. Prouvez votre accès aux deux comptes pour les fusionner.
              </p>
              {conflictResolutions.map((res) => (
                <div key={res.username} className="instances-card" style={{ marginBottom: '0.75rem', background: 'var(--color-surface-raised)' }}>
                  <div className="instances-row" style={{ marginBottom: '0.5rem' }}>
                    <span className="instances-label">Utilisateur</span>
                    <strong className="instances-value--mono">{res.username}</strong>
                  </div>
                  <div style={{ display: 'flex', gap: '0.75rem' }}>
                    <label style={{ flex: 1 }}>
                      <span className="instances-label" style={{ display: 'block', marginBottom: '0.25rem' }}>Mot de passe local</span>
                      <input
                        className="form-input"
                        type="password"
                        placeholder="Mot de passe sur cette instance"
                        value={res.password_local}
                        onChange={e => updateConflictResolution(res.username, 'password_local', e.target.value)}
                        disabled={pairingStep.type === 'resolving'}
                      />
                    </label>
                    <label style={{ flex: 1 }}>
                      <span className="instances-label" style={{ display: 'block', marginBottom: '0.25rem' }}>Mot de passe distant</span>
                      <input
                        className="form-input"
                        type="password"
                        placeholder={`Mot de passe sur ${pairingStep.peer_name}`}
                        value={res.password_remote}
                        onChange={e => updateConflictResolution(res.username, 'password_remote', e.target.value)}
                        disabled={pairingStep.type === 'resolving'}
                      />
                    </label>
                  </div>
                </div>
              ))}
              <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
                <button
                  className="btn btn-primary"
                  onClick={handleResolveConflicts}
                  disabled={
                    pairingStep.type === 'resolving' ||
                    conflictResolutions.some(r => !r.password_local || !r.password_remote)
                  }
                >
                  {pairingStep.type === 'resolving' ? 'Résolution…' : 'Valider et appairer'}
                </button>
                <button
                  className="btn"
                  disabled={pairingStep.type === 'resolving'}
                  onClick={() => { setPairingStep({ type: 'idle' }); setPairingError(null); setConflictResolutions([]); }}
                >
                  Annuler
                </button>
              </div>
            </div>
          )}

          {pairingStep.type === 'done' && (
            <div className="instances-card">
              <div className="message message--success">
                ✓ Instance "{pairingStep.peer_name}" appairée avec succès.
              </div>
              <button
                className="btn"
                style={{ marginTop: '0.75rem' }}
                onClick={() => setPairingStep({ type: 'idle' })}
              >
                Fermer
              </button>
            </div>
          )}
        </section>

        {/* Découverte mDNS */}
        <section className="instances-section">
          <div className="instances-section-header">
            <h2>Découverte sur le réseau local</h2>
            <button className="btn btn-primary" onClick={handleDiscover} disabled={scanning}>
              {scanning ? 'Analyse…' : 'Découvrir'}
            </button>
          </div>
          {discovered === null ? (
            <p className="instances-empty">
              Lancez une découverte pour détecter les autres instances HOMER via mDNS.
            </p>
          ) : discovered.length === 0 ? (
            <p className="instances-empty">Aucune autre instance détectée sur le réseau local.</p>
          ) : (
            <ul className="instances-list">
              {discovered.map((peer) => (
                <li key={peer.uuid} className="instances-card">
                  <div className="instances-row">
                    <span className="instances-label">{peer.name}</span>
                    <span className="instances-value">{peer.address}:{peer.port}</span>
                  </div>
                  <div className="instances-row">
                    <span className="instances-label">UUID</span>
                    <span className="instances-value instances-value--mono">{peer.uuid}</span>
                  </div>
                  {peer.url && (
                    <div className="instances-row">
                      <span className="instances-label">URL</span>
                      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                        <span className="instances-value">{peer.url}</span>
                        <button
                          className="btn btn-sm btn-primary"
                          onClick={() => {
                            setPeerUrl(peer.url!);
                            setPairingStep({ type: 'form' });
                            window.scrollTo({ top: 0, behavior: 'smooth' });
                          }}
                        >
                          Appairer
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
