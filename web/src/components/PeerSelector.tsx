import { usePeer } from '../hooks/usePeer';
import type { PeerInstance } from '../api';

function peerLabel(p: PeerInstance): string {
  if (p.url) {
    try { return new URL(p.url).hostname; } catch {}
  }
  return p.name;
}

export function PeerSelector() {
  const { peers, activePeer, selectPeer } = usePeer();

  if (peers.length === 0) return null;

  const onlineCount = peers.filter(p => p.status === 'online').length;

  return (
    <div className="peer-selector">
      <select
        className="peer-selector-select"
        value={activePeer?.uuid ?? ''}
        onChange={e => {
          const uuid = e.target.value;
          selectPeer(uuid ? (peers.find(p => p.uuid === uuid) ?? null) : null);
        }}
        title={`${onlineCount}/${peers.length} pairs en ligne`}
      >
        <option value="">Instance locale</option>
        {peers.map(p => (
          <option key={p.uuid} value={p.uuid} disabled={p.status !== 'online'}>
            {peerLabel(p)}{p.status !== 'online' ? ' (hors ligne)' : ''}
          </option>
        ))}
      </select>
      {activePeer && (
        <span className="peer-selector-badge" title={`Connecté à ${peerLabel(activePeer)}`}>
          ⇄
        </span>
      )}
    </div>
  );
}
