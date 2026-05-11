import type { Channel, NetEvent, PlayerId, PresenceData } from '@officexr/sdk';
import { validateNetEvent } from '@officexr/sdk';
import {
  decodeFrame,
  encodeFrame,
  type CustomFrame,
  type Frame,
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

export interface WsChannelOptions {
  /** Full WebSocket URL the channel connects to. */
  url: string;
  /** PlayerId the server should associate with this connection. */
  userId: PlayerId;
  /** Override the WebSocket constructor. Default uses the global. */
  wsFactory?: WsFactory;
  /** Timeout (ms) for the initial subscribe handshake. Default 10000. */
  handshakeTimeoutMs?: number;
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
 *  6. `close()` ends the socket; the server fans out a leave to peers.
 */
export class WsChannel implements Channel {
  public readonly userId: PlayerId;
  private readonly url: string;
  private readonly wsFactory: WsFactory;
  private readonly handshakeTimeoutMs: number;

  private ws: WsLike | null = null;
  private subscribed = false;
  private closed = false;

  private readonly handlers = new Set<(event: NetEvent) => void>();
  private readonly presenceHandlers = new Set<
    (joined: PlayerId[], left: PlayerId[]) => void
  >();
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
    this.wsFactory = opts.wsFactory ?? defaultFactory;
    this.handshakeTimeoutMs = opts.handshakeTimeoutMs ?? 10_000;
  }

  async subscribe(): Promise<void> {
    if (this.subscribed || this.closed) return;
    const ws = this.wsFactory(this.url);
    this.ws = ws;

    ws.addEventListener('message', (e: MessageEvent | { data: unknown }) => {
      const data = (e as { data?: unknown }).data;
      if (typeof data !== 'string') return;
      const frame = decodeFrame(data);
      if (!frame) return;
      this.handleFrame(frame);
    });
    ws.addEventListener('close', () => {
      this.subscribed = false;
      if (!this.closed) {
        // Server-initiated close — surface as a presence-leave for self
        // so the local store doesn't keep stale state. Consumers can
        // reconnect by constructing a new WsChannel.
        this.closed = true;
      }
    });
    ws.addEventListener('error', () => {
      // Don't tear down here; the close event will follow.
    });

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('WsChannel: handshake timeout')),
        this.handshakeTimeoutMs,
      );
      const onOpen = () => {
        ws.send(encodeFrame({ t: 'hello', userId: this.userId }));
      };
      const onAck = (frame: Frame) => {
        if (frame.t !== 'hello-ack') return;
        this.knownPresent = new Set(frame.present);
        this.subscribed = true;
        if (this.myPresenceData) {
          ws.send(encodeFrame({ t: 'track-presence', data: this.myPresenceData }));
        }
        clearTimeout(timer);
        ws.removeEventListener('open', onOpen);
        this.offHelloAck = null;
        resolve();
      };
      this.offHelloAck = onAck;

      if (ws.readyState === WS_OPEN) {
        onOpen();
      } else {
        ws.addEventListener('open', onOpen);
      }
    });
  }

  /** Set during subscribe(); handleFrame routes hello-ack through this
   * so we can resolve the subscribe promise from a frame handler. */
  private offHelloAck: ((frame: Frame) => void) | null = null;

  async send(event: NetEvent): Promise<void> {
    if (this.closed || !this.subscribed || !this.ws) return;
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

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.subscribed = false;
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }
    this.handlers.clear();
    this.presenceHandlers.clear();
    this.customHandlers.clear();
  }

  // --- Custom-frame API used by app-level protocol extensions --------

  /** Send a `{ t: 'custom', kind, payload }` frame to the server. */
  sendCustom(kind: string, payload: unknown): void {
    if (this.closed || !this.subscribed || !this.ws) return;
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
      if (this.offHelloAck) this.offHelloAck(frame);
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
      for (const h of [...this.presenceHandlers]) {
        try {
          h(frame.joined, frame.left);
        } catch (err) {
          console.error('[ws-channel] presence handler threw:', err);
        }
      }
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
