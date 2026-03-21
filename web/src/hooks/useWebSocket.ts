import { useEffect, useRef } from 'react';
import { type Container } from '../api';

interface WebSocketMessage {
  type: string;
  containers?: Container[];
  [key: string]: unknown;
}

type MessageHandler = (message: WebSocketMessage) => void;

export function useWebSocket(onMessage: MessageHandler) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<number | undefined>(undefined);
  const handlerRef = useRef<MessageHandler>(onMessage);
  
  useEffect(() => {
    handlerRef.current = onMessage;
  }, [onMessage]);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/api/events?token=${token}`;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        handlerRef.current(message);
      } catch {}
    };

    ws.onclose = () => {
      reconnectTimeoutRef.current = window.setTimeout(() => {
        wsRef.current = null;
      }, 3000);
    };

    ws.onerror = () => {
      ws.close();
    };

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      ws.close();
      wsRef.current = null;
    };
  }, []);

  return wsRef.current;
}
