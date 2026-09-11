/**
 * FuelPro WebSocket Client
 * Real-time sync client for browser/React
 */

type WSMessage = {
  type: string;
  id?: string;
  payload: any;
};

type WSOptions = {
  url?: string;
  stationId: string;
  userId?: string;
  token?: string;
  reconnectInterval?: number;
  maxReconnectAttempts?: number;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onSync?: (data: any) => void;
  onBroadcast?: (data: any) => void;
  onError?: (error: any) => void;
};

const WS_STATES = {
  CONNECTING: "connecting",
  CONNECTED: "connected",
  DISCONNECTED: "disconnected",
  RECONNECTING: "reconnecting",
};

class FuelProWSClient {
  private ws: WebSocket | null = null;
  private options: WSOptions;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private messageQueue: WSMessage[] = [];
  private state = WS_STATES.DISCONNECTED;
  private listeners: Map<string, Set<(data: any) => void>> = new Map();

  constructor(options: WSOptions) {
    this.options = {
      reconnectInterval: 3000,
      maxReconnectAttempts: 10,
      ...options,
    };
  }

  connect() {
    if (this.ws?.readyState === WebSocket.OPEN) return;

    const url = this.options.url || this.getWebSocketUrl();
    console.log(`[WS] Connecting to ${url}`);
    this.state = WS_STATES.CONNECTING;

    try {
      this.ws = new WebSocket(url);
      this.setupEventHandlers();
    } catch (e) {
      console.error("[WS] Connection failed:", e);
      this.scheduleReconnect();
    }
  }

  private getWebSocketUrl() {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const host = this.options.url?.includes("://")
      ? new URL(this.options.url).host
      : window.location.host;
    return `${protocol}//${host}/ws`;
  }

  private setupEventHandlers() {
    if (!this.ws) return;

    this.ws.onopen = () => {
      console.log("[WS] Connected");
      this.state = WS_STATES.CONNECTED;
      this.reconnectAttempts = 0;

      // Authenticate
      this.send({
        type: "auth",
        payload: {
          stationId: this.options.stationId,
          userId: this.options.userId,
          token: this.options.token,
        },
      });

      // Flush queued messages
      this.flushQueue();

      this.options.onConnect?.();
    };

    this.ws.onclose = (event) => {
      console.log(`[WS] Disconnected (${event.code})`);
      this.state = WS_STATES.DISCONNECTED;
      this.options.onDisconnect?.();
      this.scheduleReconnect();
    };

    this.ws.onerror = (error) => {
      console.error("[WS] Error:", error);
      this.options.onError?.(error);
    };

    this.ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        this.handleMessage(message);
      } catch (e) {
        console.error("[WS] Parse error:", e);
      }
    };
  }

  private handleMessage(message: WSMessage) {
    const { type, payload } = message;

    switch (type) {
      case "sync":
        this.options.onSync?.(payload);
        this.emit("sync", payload);
        break;
      case "broadcast":
        this.options.onBroadcast?.(payload);
        this.emit("broadcast", payload);
        break;
      case "pull":
        this.handlePullRequest(payload);
        break;
      case "success":
      case "error":
        this.emit(type, payload);
        break;
    }
  }

  private handlePullRequest(payload: {
    requesterId: string;
    collections: string[];
  }) {
    // Get local data and send back
    const data = this.getLocalData(payload.collections);
    this.send({
      type: "push",
      payload: { data, requesterId: payload.requesterId },
    });
  }

  private getLocalData(collections: string[]) {
    const data: Record<string, any[]> = {};
    collections.forEach((col) => {
      try {
        const key = `fuelpro_${col}_v3`;
        const stored = localStorage.getItem(key);
        data[col] = stored ? JSON.parse(stored) : [];
      } catch {
        data[col] = [];
      }
    });
    return data;
  }

  private scheduleReconnect() {
    if (this.reconnectAttempts >= this.options.maxReconnectAttempts!) {
      console.log("[WS] Max reconnect attempts reached");
      return;
    }

    this.state = WS_STATES.RECONNECTING;
    this.reconnectAttempts++;

    const delay =
      this.options.reconnectInterval! * Math.min(this.reconnectAttempts, 5);
    console.log(
      `[WS] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`,
    );

    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  private flushQueue() {
    while (this.messageQueue.length > 0) {
      const msg = this.messageQueue.shift();
      this.send(msg!);
    }
  }

  send(message: WSMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      this.messageQueue.push(message);
    }
  }

  push(
    collection: string,
    record: any,
    operation: "create" | "update" | "delete",
  ) {
    this.send({
      type: "push",
      payload: { collection, record, operation },
    });
  }

  broadcast(event: string, data: any) {
    this.send({
      type: "broadcast",
      payload: { event, data },
    });
  }

  sync(collections: string[]) {
    this.send({
      type: "sync",
      payload: { collections },
    });
  }

  on(event: string, callback: (data: any) => void) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);
    return () => this.listeners.get(event)?.delete(callback);
  }

  private emit(event: string, data: any) {
    this.listeners.get(event)?.forEach((cb) => cb(data));
  }

  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    this.ws?.close();
    this.state = WS_STATES.DISCONNECTED;
  }

  getState() {
    return this.state;
  }

  isConnected() {
    return this.state === WS_STATES.CONNECTED;
  }
}

// ─── React Hook ───
export function useWebSocket(options: WSOptions) {
  const [connected, setConnected] = useState(false);
  const [lastSync, setLastSync] = useState<any>(null);
  const clientRef = useRef<FuelProWSClient | null>(null);

  useEffect(() => {
    const client = new FuelProWSClient({
      ...options,
      onConnect: () => setConnected(true),
      onDisconnect: () => setConnected(false),
      onSync: (data) => setLastSync(data),
    });

    clientRef.current = client;
    client.connect();

    return () => client.disconnect();
  }, [options.stationId]);

  return {
    connected,
    lastSync,
    client: clientRef.current,
    push: (
      collection: string,
      record: any,
      op: "create" | "update" | "delete",
    ) => clientRef.current?.push(collection, record, op),
    broadcast: (event: string, data: any) =>
      clientRef.current?.broadcast(event, data),
    sync: (collections: string[]) => clientRef.current?.sync(collections),
  };
}

import { useState, useEffect, useRef } from "react";

export { FuelProWSClient };
export default FuelProWSClient;
