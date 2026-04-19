import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import { api, setActivePeer as apiSetActivePeer, PeerInstance } from '../api';
import { useWebSocket } from './useWebSocket';

interface PeerContextValue {
  peers: PeerInstance[];
  activePeer: PeerInstance | null;
  selectPeer: (peer: PeerInstance | null) => void;
  reloadPeers: () => void;
}

const PeerContext = createContext<PeerContextValue>({
  peers: [],
  activePeer: null,
  selectPeer: () => {},
  reloadPeers: () => {},
});

export function PeerProvider({ children }: { children: ReactNode }) {
  const [peers, setPeers] = useState<PeerInstance[]>([]);
  const [activePeer, setActivePeerState] = useState<PeerInstance | null>(null);

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

  useEffect(() => {
    reloadPeers();
  }, []);

  const handleWsMessage = useCallback((msg: { type: string; [k: string]: unknown }) => {
    if (msg.type === 'peer_status_changed' && typeof msg.peer_uuid === 'string' && typeof msg.status === 'string') {
      setPeers(prev => prev.map(p => p.uuid === msg.peer_uuid ? { ...p, status: msg.status as PeerInstance['status'] } : p));
    }
  }, []);

  useWebSocket(handleWsMessage);

  const selectPeer = (peer: PeerInstance | null) => {
    setActivePeerState(peer);
    apiSetActivePeer(peer?.uuid ?? null);
  };

  return (
    <PeerContext.Provider value={{ peers, activePeer, selectPeer, reloadPeers }}>
      {children}
    </PeerContext.Provider>
  );
}

export function usePeer() {
  return useContext(PeerContext);
}
