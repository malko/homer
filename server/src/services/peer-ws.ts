import { createRequire } from 'module';
import { EventEmitter } from 'events';
import { URL } from 'url';
import { getLocalInstance } from './instance.js';
import { peerQueries, PeerInstance } from '../db/index.js';
import { signPayload, resolveMdnsViaSupervisor } from './peers.js';

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
    const readyState = this.ws?.readyState;
    console.log(`[peer-ws] subscribe ${this.peer.peer_name} subKey=${subKey} wsReady=${readyState} subMsg=${JSON.stringify(subMsg)}`);
    if (this.ws && readyState === Ws.OPEN) {
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

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === Ws.OPEN;
  }

  private send(data: string) {
    if (this.ws && this.ws.readyState === Ws.OPEN) {
      try {
        this.ws.send(data);
        console.log(`[peer-ws] send to ${this.peer.peer_name}: ${data.slice(0, 200)}`);
      } catch (e) { console.error('[peer-ws] send error:', e); }
    } else {
      console.warn(`[peer-ws] send dropped (ws not open, readyState=${this.ws?.readyState}): ${data.slice(0, 200)}`);
    }
  }

  sendRaw(data: string): boolean {
    if (this.ws && this.ws.readyState === Ws.OPEN) {
      try { this.ws.send(data); return true; } catch (e) { console.error('[peer-ws] sendRaw error:', e); return false; }
    }
    return false;
  }

  private async connect() {
    if (this.closed || this.connecting) return;
    this.connecting = true;

    const wsBase = this.peer.peer_url.replace(/^https?/, p => p === 'https' ? 'wss' : 'ws').replace(/\/$/, '');
    const timestamp = Date.now();
    const sig = signPayload(this.peer.shared_secret, '', timestamp);
    const qs = `peer_uuid=${encodeURIComponent(this.localUuid)}&timestamp=${timestamp}&signature=${encodeURIComponent(sig)}`;

    // Resolve .local mDNS hostnames via the supervisor (same as peerFetch)
    let connectUrl = `${wsBase}/api/peer-events?${qs}`;
    const wsOpts: Record<string, unknown> = this.peer.peer_ca
      ? { ca: this.peer.peer_ca }
      : { rejectUnauthorized: false };

    try {
      const parsed = new URL(`${wsBase}/api/peer-events`);
      if (parsed.hostname.endsWith('.local')) {
        const ip = await resolveMdnsViaSupervisor(parsed.hostname, 5000);
        const originalHost = parsed.port ? `${parsed.hostname}:${parsed.port}` : parsed.hostname;
        connectUrl = `${parsed.protocol}//${ip}${parsed.port ? `:${parsed.port}` : ''}${parsed.pathname}?${qs}`;
        wsOpts['servername'] = parsed.hostname;
        wsOpts['headers'] = { Host: originalHost };
        console.log(`[peer-ws] Resolved ${parsed.hostname} → ${ip} for ${this.peer.peer_name}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[peer-ws] mDNS resolution failed for ${this.peer.peer_name}: ${msg}`);
      this.connecting = false;
      if (!this.closed && this.subs.size > 0) {
        setTimeout(() => this.connect(), this.backoff);
        this.backoff = Math.min(this.backoff * 2, 30_000);
      }
      return;
    }

    console.log(`[peer-ws] Connecting to ${this.peer.peer_name} (${wsBase}/api/peer-events ...)`);
    const ws = new Ws(connectUrl, wsOpts);
    this.ws = ws;

    ws.on('open', () => {
      console.log(`[peer-ws] Connected to ${this.peer.peer_name} (${this.peer.peer_uuid})`);
      this.connecting = false;
      this.backoff = 1_000;
      this.subs.forEach(sub => this.send(sub.subMsg));
    });

    ws.on('message', (data: unknown) => {
      try {
        const event = JSON.parse(String(data)) as Record<string, unknown>;
        const t = event['type'];
        if (t !== 'heartbeat' && t !== 'containers_updated') {
          console.log(`[peer-ws] recv from ${this.peer.peer_name}: type=${String(t)} subs=${this.subs.size}`);
        }
        this.subs.forEach(sub => {
          try { sub.callback(event); } catch (e) { console.error('[peer-ws] callback error:', e); }
        });
      } catch (e) { console.error('[peer-ws] message parse error:', e); }
    });

    ws.on('close', (code: number, reason: Buffer) => {
      console.log(`[peer-ws] Disconnected from ${this.peer.peer_name} (${this.peer.peer_uuid}) code=${code}`);
      this.connecting = false;
      this.ws = null;
      if (!this.closed && this.subs.size > 0) {
        console.log(`[peer-ws] Reconnecting to ${this.peer.peer_name} in ${this.backoff}ms (${this.subs.size} subs)`);
        setTimeout(() => this.connect(), this.backoff);
        this.backoff = Math.min(this.backoff * 2, 30_000);
      }
    });

    ws.on('error', (err: Error) => {
      console.error(`[peer-ws] Connection error to ${this.peer.peer_name} (${this.peer.peer_uuid}):`, err.message);
    });
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
    if (!peer) {
      console.error(`[peer-ws] subscribe: peer not found: ${peerUuid}`);
      return false;
    }

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

  cleanupClient(clientPrefix: string) {
    this.connections.forEach((conn, peerUuid) => {
      conn.removeSubsForClient(clientPrefix + ':');
      if (!conn.hasSubscriptions()) {
        conn.close();
        this.connections.delete(peerUuid);
      }
    });
  }

  send(peerUuid: string, message: unknown): boolean {
    const conn = this.connections.get(peerUuid);
    if (!conn) return false;
    return conn.sendRaw(JSON.stringify(message));
  }

  isPeerConnected(peerUuid: string): boolean {
    const conn = this.connections.get(peerUuid);
    return conn !== undefined && conn.isConnected();
  }

  closeAll() {
    this.connections.forEach(c => c.close());
    this.connections.clear();
  }
}

export const peerWsManager = new PeerWsManager();
