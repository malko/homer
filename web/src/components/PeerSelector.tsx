import { usePeer } from '../hooks/usePeer';

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
          if (!uuid) {
            selectPeer(null);
          } else {
            const peer = peers.find(p => p.uuid === uuid) ?? null;
            selectPeer(peer);
          }
        }}
        title={`${onlineCount}/${peers.length} pairs en ligne`}
      >
        <option value="">Instance locale</option>
        {peers.map(p => (
          <option key={p.uuid} value={p.uuid} disabled={p.status !== 'online'}>
            {p.name}{p.status !== 'online' ? ' (hors ligne)' : ''}
          </option>
        ))}
      </select>
      {activePeer && (
        <span className="peer-selector-badge" title={`Connecté à ${activePeer.name}`}>
          ⇄
        </span>
      )}
    </div>
  );
}
