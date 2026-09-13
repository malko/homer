import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { api, setActivePeer as apiSetActivePeer, PeerInstance } from '../api';
import { useAuth } from './useAuth';
import { useWebSocket } from './useWebSocket';

interface PeerContextValue {
  peers: PeerInstance[];
  activePeer: PeerInstance | null;
  selectPeer: (peer: PeerInstance | null) => void;
  reloadPeers: () => Promise<void>;
  pendingPairingCount: number;
  setPendingPairingCount: (count: number) => void;
}

const PeerContext = createContext<PeerContextValue>({
  peers: [],
  activePeer: null,
  selectPeer: () => {},
  reloadPeers: async () => {},
  pendingPairingCount: 0,
  setPendingPairingCount: () => {},
});

export function PeerProvider({ children }: { children: ReactNode }) {
  const [peers, setPeers] = useState<PeerInstance[]>([]);
  const [activePeer, setActivePeerState] = useState<PeerInstance | null>(null);
  const [pendingPairingCount, setPendingPairingCount] = useState(0);

  const reloadPeers = () => {
    return api.instances.list()
      .then(r => {
        setPeers(r.peers);
        setActivePeerState(prev => {
          if (!prev) return null;
          const still = r.peers.find(p => p.uuid === prev.uuid);
          if (!still) {
            apiSetActivePeer(null);
            return null;
          }
          return still;
        });
      })
      .catch(() => {});
  };

  const loadPendingCount = useCallback(() => {
    api.instances.pendingPairings()
      .then(r => setPendingPairingCount(r.pending.length))
      .catch(() => {});
  }, []);

  const { status } = useAuth();

  // Both calls require auth — fetching before login resolves fails silently
  // (peers stays []), and since this provider only mounts once for the whole
  // app, nothing retried it after login without this. Re-run whenever
  // authentication becomes true (initial load with an existing session, or
  // right after signing in) so the federation dropdown shows up without a
  // manual refresh.
  useEffect(() => {
    if (!status?.authenticated) return;
    reloadPeers();
    loadPendingCount();
  }, [status?.authenticated, loadPendingCount]);

  const handleWsMessage = useCallback((msg: { type: string; [k: string]: unknown }) => {
    if (msg.type === 'peer_status_changed' && typeof msg.peer_uuid === 'string' && typeof msg.status === 'string') {
      setPeers(prev => prev.map(p => p.uuid === msg.peer_uuid ? { ...p, status: msg.status as PeerInstance['status'] } : p));
    }
    if (msg.type === 'pairing_request') {
      setPendingPairingCount(prev => prev + 1);
    }
  }, []);

  useWebSocket(handleWsMessage);

  const selectPeer = (peer: PeerInstance | null) => {
    setActivePeerState(peer);
    apiSetActivePeer(peer?.uuid ?? null);
  };

  return (
    <PeerContext.Provider value={{ peers, activePeer, selectPeer, reloadPeers, pendingPairingCount, setPendingPairingCount }}>
      {children}
    </PeerContext.Provider>
  );
}

export function usePeer() {
  return useContext(PeerContext);
}