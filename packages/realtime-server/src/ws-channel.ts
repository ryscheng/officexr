import type { Channel, ChannelStatus, NetEvent, PlayerId, PresenceData } from '@officexr/sdk';
import { validateNetEvent } from '@officexr/sdk';
import {
  decodeFrame,
  encodeFrame,
  REPLACED_CLOSE_CODE,
  type CustomFrame,
  type Frame,
  type HelloAckFrame,
} from './protocol.ts';

/**
 * Minimal WebSocket surface that works for both the browser-native
 * `WebSocket` and the `ws` package in Node. We don't import either
 * directly — instead the caller injects a factory or we use the global
 * `WebSocket` (available in modern browsers and Node 22+). This keeps
 * the package free of platform-specific imports.
 */
export interface WsLike {
  readonly readyState: number;
  send(data: string): void;
  close(): void;
  addEventListener(
    type: 'open' | 'message' | 'close' | 'error',
    listener: (event: any) => void,
  ): void;
  removeEventListener(
    type: 'open' | 'message' | 'close' | 'error',
    listener: (event: any) => void,
  ): void;
}

export type WsFactory = (url: string) => WsLike;

const defaultFactory: WsFactory = (url) => {
  const ctor: { new (url: string): WsLike } | undefined =
    typeof globalThis !== 'undefined'
      ? ((globalThis as unknown as { WebSocket?: { new (url: string): WsLike } }).WebSocket)
      : undefined;
  if (!ctor) {
    throw new Error(
      'No global WebSocket available. Pass a wsFactory to WsChannel ' +
        '(e.g. `new WebSocket(url)` from `ws` in older Node).',
    );
  }
  return new ctor(url);
};

const WS_OPEN = 1;

/** About 1 s, doubling per failed attempt up to 30 s, with ±20% jitter. */
export function defaultReconnectDelayMs(attempt: number): number {
  const base = Math.min(30_000, 1_000 * 2 ** attempt);
  return base * (0.8 + Math.random() * 0.4);
}

export interface WsChannelOptions {
  /** Full WebSocket URL the channel connects to. */
  url: string;
  /** PlayerId the server should associate with this connection. */
  userId: PlayerId;
  /** Office to join. Omitted means the server's default office. */
  officeId?: string;
  /** Override the WebSocket constructor. Default uses the global. */
  wsFactory?: WsFactory;
  /** Timeout (ms) for each subscribe / reconnect handshake. Default 10000. */
  handshakeTimeoutMs?: number;
  /** Delay before reconnect attempt `attempt` (0-based). Default {@link defaultReconnectDelayMs}. */
  reconnectDelayMs?: (attempt: number) => number;
}

/**
 * Channel implementation that talks to a {@link RealtimeServer} over a
 * single WebSocket. Mirrors the {@link InMemoryChannel} contract exactly
 * so SDK consumers (SyncEngine, SnapshotHandshake, Communication) treat
 * it identically.
 *
 * Lifecycle:
 *  1. `subscribe()` opens the WS, sends `hello`, waits for `hello-ack`.
 *  2. The server immediately follows with `snapshot` carrying its
 *     authoritative state — these arrive as normal `on(broadcast)`
 *     events so the SDK applies them via its usual path.
 *  3. `send(event)` becomes a `broadcast` frame on the wire.
 *  4. `trackPresence(data)` becomes a `track-presence` frame.
 *  5. Inbound `presence` frames fire the registered presence handler.
 *  6. Once live, an unexpected close reconnects on a fresh socket with
 *     backoff, keeping every registered handler. A
 *     {@link REPLACED_CLOSE_CODE} close is final.
 *  7. `close()` ends the socket; the server fans out a leave to peers.
 */
export class WsChannel implements Channel {
  public readonly userId: PlayerId;
  private readonly url: string;
  private readonly officeId?: string;
  private readonly wsFactory: WsFactory;
  private readonly handshakeTimeoutMs: number;
  private readonly reconnectDelayMs: (attempt: number) => number;

  private ws: WsLike | null = null;
  private subscribed = false;
  private status: ChannelStatus = 'connecting';
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  /** Settles the in-flight handshake; routed through handleFrame / the close listener. */
  private handshake: { ack: (frame: HelloAckFrame) => void; fail: (err: Error) => void } | null = null;

  private readonly handlers = new Set<(event: NetEvent) => void>();
  private readonly presenceHandlers = new Set<
    (joined: PlayerId[], left: PlayerId[]) => void
  >();
  private readonly statusHandlers = new Set<(status: ChannelStatus) => void>();
  /** Custom-frame listeners keyed by `kind`. Used by app-level
   * extensions like the debug-app's bot-control protocol. */
  private readonly customHandlers = new Map<
    string,
    Set<(payload: unknown) => void>
  >();
  private knownPresent = new Set<PlayerId>();
  private myPresenceData: PresenceData | null = null;

  constructor(opts: WsChannelOptions) {
    this.url = opts.url;
    this.userId = opts.userId;
    this.officeId = opts.officeId;
    this.wsFactory = opts.wsFactory ?? defaultFactory;
    this.handshakeTimeoutMs = opts.handshakeTimeoutMs ?? 10_000;
    this.reconnectDelayMs = opts.reconnectDelayMs ?? defaultReconnectDelayMs;
  }

  async subscribe(): Promise<void> {
    if (this.status !== 'connecting' || this.ws) return;
    await this.connect();
  }

  /** Opens a socket and resolves once its `hello-ack` has been applied. */
  private connect(): Promise<void> {
    const ws = this.wsFactory(this.url);
    this.ws = ws;

    ws.addEventListener('message', (e: { data?: unknown }) => {
      if (this.ws !== ws || typeof e.data !== 'string') return;
      const frame = decodeFrame(e.data);
      if (frame) this.handleFrame(frame);
    });
    ws.addEventListener('close', (e: { code?: number }) => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.subscribed = false;
      this.handshake?.fail(new Error('WsChannel: closed before handshake'));
      if (e.code === REPLACED_CLOSE_CODE) {
        this.setStatus('replaced');
      } else if (this.status === 'live' || this.status === 'reconnecting') {
        this.setStatus('reconnecting');
        this.scheduleReconnect();
      }
    });
    ws.addEventListener('error', () => {
      // Don't tear down here; the close event will follow.
    });
    const sendHello = () =>
      ws.send(encodeFrame({ t: 'hello', userId: this.userId, officeId: this.officeId }));
    if (ws.readyState === WS_OPEN) {
      sendHello();
    } else {
      ws.addEventListener('open', sendHello);
    }

    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.handshake?.fail(new Error('WsChannel: handshake timeout'));
        ws.close();
      }, this.handshakeTimeoutMs);
      this.handshake = {
        ack: (frame) => {
          clearTimeout(timer);
          this.handshake = null;
          this.onHelloAck(ws, frame);
          resolve();
        },
        fail: (err) => {
          clearTimeout(timer);
          this.handshake = null;
          reject(err);
        },
      };
    });
  }

  private onHelloAck(ws: WsLike, frame: HelloAckFrame): void {
    const previous = this.knownPresent;
    this.knownPresent = new Set(frame.present);
    this.subscribed = true;
    this.reconnectAttempt = 0;
    if (this.myPresenceData) {
      ws.send(encodeFrame({ t: 'track-presence', data: this.myPresenceData }));
    }
    if (this.status === 'reconnecting') {
      const joined = frame.present.filter((id) => !previous.has(id));
      const left = [...previous].filter((id) => !this.knownPresent.has(id));
      if (joined.length > 0 || left.length > 0) {
        this.firePresence(joined, left);
      }
    }
    this.setStatus('live');
  }

  private scheduleReconnect(): void {
    const delay = this.reconnectDelayMs(this.reconnectAttempt++);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      try {
        // A failed attempt closes its socket, which schedules the next one.
        this.connect().catch(() => {});
      } catch {
        this.scheduleReconnect();
      }
    }, delay);
  }

  private setStatus(status: ChannelStatus): void {
    if (this.status === status) return;
    this.status = status;
    for (const h of [...this.statusHandlers]) {
      try {
        h(status);
      } catch (err) {
        console.error('[ws-channel] status handler threw:', err);
      }
    }
  }

  async send(event: NetEvent): Promise<void> {
    if (!this.subscribed || !this.ws) return;
    if (this.ws.readyState !== WS_OPEN) return;
    this.ws.send(encodeFrame({ t: 'broadcast', from: this.userId, event }));
  }

  on(handler: (event: NetEvent) => void): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  trackPresence(data: PresenceData): void {
    this.myPresenceData = data;
    if (this.subscribed && this.ws && this.ws.readyState === WS_OPEN) {
      this.ws.send(encodeFrame({ t: 'track-presence', data }));
    }
  }

  onPresenceChange(
    handler: (joined: PlayerId[], left: PlayerId[]) => void,
  ): () => void {
    this.presenceHandlers.add(handler);
    return () => {
      this.presenceHandlers.delete(handler);
    };
  }

  listPresent(): PlayerId[] {
    return Array.from(this.knownPresent);
  }

  onStatusChange(handler: (status: ChannelStatus) => void): () => void {
    this.statusHandlers.add(handler);
    handler(this.status);
    return () => {
      this.statusHandlers.delete(handler);
    };
  }

  close(): void {
    if (this.status === 'closed') return;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.subscribed = false;
    const ws = this.ws;
    this.ws = null;
    this.handshake?.fail(new Error('WsChannel: closed before handshake'));
    if (ws) {
      try {
        ws.close();
      } catch {
        // ignore
      }
    }
    this.setStatus('closed');
    this.handlers.clear();
    this.presenceHandlers.clear();
    this.statusHandlers.clear();
    this.customHandlers.clear();
  }

  // --- Custom-frame API used by app-level protocol extensions --------

  /** Send a `{ t: 'custom', kind, payload }` frame to the server. */
  sendCustom(kind: string, payload: unknown): void {
    if (!this.subscribed || !this.ws) return;
    if (this.ws.readyState !== WS_OPEN) return;
    const frame: CustomFrame = { t: 'custom', kind, payload };
    this.ws.send(encodeFrame(frame));
  }

  /** Subscribe to a specific custom-frame `kind`. */
  onCustom(kind: string, handler: (payload: unknown) => void): () => void {
    let set = this.customHandlers.get(kind);
    if (!set) {
      set = new Set();
      this.customHandlers.set(kind, set);
    }
    set.add(handler);
    return () => {
      set?.delete(handler);
    };
  }

  // --- Internals ---------------------------------------------------------

  private handleFrame(frame: Frame): void {
    if (frame.t === 'hello-ack') {
      this.handshake?.ack(frame);
      return;
    }
    if (frame.t === 'snapshot') {
      for (const ev of frame.events) {
        const v = validateNetEvent(ev);
        if (!v.ok) continue;
        this.dispatchBroadcast(v.event);
      }
      return;
    }
    if (frame.t === 'broadcast') {
      const v = validateNetEvent(frame.event);
      if (!v.ok) return;
      this.dispatchBroadcast(v.event);
      return;
    }
    if (frame.t === 'presence') {
      for (const id of frame.joined) this.knownPresent.add(id);
      for (const id of frame.left) this.knownPresent.delete(id);
      this.firePresence(frame.joined, frame.left);
      return;
    }
    if (frame.t === 'custom') {
      const set = this.customHandlers.get(frame.kind);
      if (!set) return;
      for (const h of [...set]) {
        try {
          h(frame.payload);
        } catch (err) {
          console.error('[ws-channel] custom handler threw:', err);
        }
      }
      return;
    }
    // hello / track-presence are client→server only; ignore if echoed.
  }

  private firePresence(joined: PlayerId[], left: PlayerId[]): void {
    for (const h of [...this.presenceHandlers]) {
      try {
        h(joined, left);
      } catch (err) {
        console.error('[ws-channel] presence handler threw:', err);
      }
    }
  }

  private dispatchBroadcast(event: NetEvent): void {
    for (const h of [...this.handlers]) {
      try {
        h(event);
      } catch (err) {
        console.error('[ws-channel] handler threw:', err);
      }
    }
  }
}
