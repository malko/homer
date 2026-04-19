import { createRequire } from 'module';
import { EventEmitter } from 'events';
import { getLocalInstance } from './instance.js';
import { peerQueries, PeerInstance } from '../db/index.js';
import { signPayload } from './peers.js';

const require = createRequire(import.meta.url);

interface NodeWs extends EventEmitter {
  send(data: string): void;
  close(): void;
  readyState: number;
}

interface WsConstructor {
  new (url: string, options?: Record<string, unknown>): NodeWs;
  OPEN: number;
}

const { WebSocket: Ws } = require('ws') as { WebSocket: WsConstructor };

type EventCallback = (event: Record<string, unknown>) => void;

interface Sub {
  callback: EventCallback;
  subMsg: string;
  unsubMsg: string;
}

class PeerWsConnection {
  private ws: NodeWs | null = null;
  private subs = new Map<string, Sub>();
  private closed = false;
  private connecting = false;
  private backoff = 1_000;

  constructor(private peer: PeerInstance, private localUuid: string) {}

  subscribe(subKey: string, callback: EventCallback, subMsg: unknown, unsubMsg: unknown) {
    this.subs.set(subKey, {
      callback,
      subMsg: JSON.stringify(subMsg),
      unsubMsg: JSON.stringify(unsubMsg),
    });
    if (this.ws && this.ws.readyState === Ws.OPEN) {
      this.send(JSON.stringify(subMsg));
    } else if (!this.connecting) {
      this.connect();
    }
  }

  unsubscribe(subKey: string) {
    const sub = this.subs.get(subKey);
    if (!sub) return;
    this.subs.delete(subKey);
    this.send(sub.unsubMsg);
  }

  hasSubscriptions(): boolean {
    return this.subs.size > 0;
  }

  removeSubsForClient(clientPrefix: string) {
    const toRemove: string[] = [];
    this.subs.forEach((sub, key) => {
      if (key.startsWith(clientPrefix)) {
        this.send(sub.unsubMsg);
        toRemove.push(key);
      }
    });
    toRemove.forEach(k => this.subs.delete(k));
  }

  close() {
    this.closed = true;
    this.subs.clear();
    this.ws?.close();
    this.ws = null;
  }

  private send(data: string) {
    if (this.ws && this.ws.readyState === Ws.OPEN) {
      try { this.ws.send(data); } catch {}
    }
  }

  private connect() {
    if (this.closed || this.connecting) return;
    this.connecting = true;

    const wsBase = this.peer.peer_url.replace(/^https?/, p => p === 'https' ? 'wss' : 'ws');
    const timestamp = Date.now();
    const sig = signPayload(this.peer.shared_secret, '', timestamp);
    const url = `${wsBase}/api/peer-events?peer_uuid=${encodeURIComponent(this.localUuid)}&timestamp=${timestamp}&signature=${encodeURIComponent(sig)}`;

    const tlsOpts: Record<string, unknown> = this.peer.peer_ca
      ? { ca: this.peer.peer_ca }
      : { rejectUnauthorized: false };

    const ws = new Ws(url, tlsOpts);
    this.ws = ws;

    ws.on('open', () => {
      this.connecting = false;
      this.backoff = 1_000;
      this.subs.forEach(sub => this.send(sub.subMsg));
    });

    ws.on('message', (data: unknown) => {
      try {
        const event = JSON.parse(String(data)) as Record<string, unknown>;
        this.subs.forEach(sub => {
          try { sub.callback(event); } catch {}
        });
      } catch {}
    });

    ws.on('close', () => {
      this.connecting = false;
      this.ws = null;
      if (!this.closed && this.subs.size > 0) {
        setTimeout(() => this.connect(), this.backoff);
        this.backoff = Math.min(this.backoff * 2, 30_000);
      }
    });

    ws.on('error', () => {});
  }
}

class PeerWsManager {
  private connections = new Map<string, PeerWsConnection>();

  subscribe(
    peerUuid: string,
    subKey: string,
    callback: EventCallback,
    subMsg: unknown,
    unsubMsg: unknown,
  ): boolean {
    const peer = peerQueries.getByUuid(peerUuid);
    if (!peer) return false;

    let conn = this.connections.get(peerUuid);
    if (!conn) {
      const local = getLocalInstance();
      conn = new PeerWsConnection(peer, local.uuid);
      this.connections.set(peerUuid, conn);
    }
    conn.subscribe(subKey, callback, subMsg, unsubMsg);
    return true;
  }

  unsubscribe(peerUuid: string, subKey: string) {
    const conn = this.connections.get(peerUuid);
    if (!conn) return;
    conn.unsubscribe(subKey);
    if (!conn.hasSubscriptions()) {
      conn.close();
      this.connections.delete(peerUuid);
    }
  }

  cleanupClient(clientId: string) {
    this.connections.forEach((conn, peerUuid) => {
      conn.removeSubsForClient(clientId + ':');
      if (!conn.hasSubscriptions()) {
        conn.close();
        this.connections.delete(peerUuid);
      }
    });
  }

  closeAll() {
    this.connections.forEach(c => c.close());
    this.connections.clear();
  }
}

export const peerWsManager = new PeerWsManager();
