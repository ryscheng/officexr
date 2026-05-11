import { createServer, type IncomingMessage, type Server as HttpServer } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  applyNetEventToStore,
  createActions,
  createBus,
  createInMemoryChannelHub,
  createStore,
  InMemoryChannel,
  validateNetEvent,
  type Actions,
  type Bus,
  type NetEvent,
  type PlayerId,
  type PresenceData,
  type Store,
} from '@officexr/sdk';
import {
  decodeFrame,
  encodeFrame,
  type CustomFrame,
  type Frame,
} from './protocol.ts';

const DEFAULT_PORT = 8787;
const DEFAULT_PATH = '/ws';
const DEFAULT_OFFICE_ID = 'debug-office';
const SERVER_SELF_ID = 'server';

export interface RealtimeServerOptions {
  /** Port to listen on. Default 8787. */
  port?: number;
  /** WebSocket path. Default '/ws'. */
  path?: string;
  /** OfficeId baked into the authoritative store. Default 'debug-office'. */
  officeId?: string;
}

/**
 * Handler signature for app-level custom frames. Return `true` if the
 * frame was consumed; the server won't emit any further side effects
 * for it. Return `false` to let the server log a warning and drop.
 */
export type CustomFrameHandler = (
  client: WsClient,
  kind: string,
  payload: unknown,
) => boolean;

/**
 * Authoritative game-state server. Owns:
 *  - an `InMemoryChannelHub` that every connected websocket attaches to
 *    via a `WsClient` adapter (and that anyone in-process — e.g. the
 *    debug-app's bot pool — can also attach to with a vanilla
 *    `InMemoryChannel`),
 *  - an SDK `Store` that mirrors every broadcast for late-joiner
 *    snapshots,
 *  - the HTTP/WebSocket plumbing.
 *
 * Designed to be subclassed: see `BotServer` in the debug-app for an
 * example that adds bot orchestration on top of the same hub.
 */
export class RealtimeServer {
  readonly hub: ReturnType<typeof createInMemoryChannelHub>;
  readonly store: Store;
  readonly actions: Actions;
  readonly bus: Bus;
  readonly officeId: string;

  private readonly port: number;
  private readonly path: string;
  private httpServer: HttpServer | null = null;
  private wss: WebSocketServer | null = null;
  private readonly clients = new Map<PlayerId, WsClient>();
  private customHandlers: CustomFrameHandler[] = [];
  /** Detacher for the hub mirror that applies every broadcast to the
   * authoritative store. */
  private offMirror: (() => void) | null = null;

  constructor(opts: RealtimeServerOptions = {}) {
    this.port = opts.port ?? DEFAULT_PORT;
    this.path = opts.path ?? DEFAULT_PATH;
    this.officeId = opts.officeId ?? DEFAULT_OFFICE_ID;
    this.store = createStore({ selfId: SERVER_SELF_ID, officeId: this.officeId });
    this.bus = createBus();
    this.actions = createActions(this.store, this.bus);
    this.hub = createInMemoryChannelHub();

    // Attach a hub-side mirror that applies every broadcast to the
    // authoritative store. We use a plain InMemoryChannel as the mirror
    // adapter; its `on` handler receives every event the hub fans out
    // *except* its own broadcasts (which is what we want — the server
    // doesn't originate broadcasts).
    const mirror = new InMemoryChannel(this.hub, SERVER_SELF_ID);
    void mirror.subscribe();
    const off = mirror.on((event) => {
      const v = validateNetEvent(event);
      if (!v.ok) return;
      applyNetEventToStore(this.actions, v.event, { now: () => Date.now() });
    });
    this.offMirror = () => {
      off();
      mirror.close();
    };
  }

  /** Register a handler for custom (`{ t: 'custom' }`) frames. Returns
   * an unsubscribe function. Handlers are called in registration order;
   * the first to return `true` wins. */
  onCustomFrame(handler: CustomFrameHandler): () => void {
    this.customHandlers.push(handler);
    return () => {
      this.customHandlers = this.customHandlers.filter((h) => h !== handler);
    };
  }

  /** Broadcast a custom frame to a specific client (or every client if
   * `target` is omitted). Used by app-level code to push state changes
   * (e.g. echoing a bot pool's current count back to the browser). */
  sendCustom(kind: string, payload: unknown, target?: PlayerId): void {
    const frame: CustomFrame = { t: 'custom', kind, payload };
    const raw = encodeFrame(frame);
    if (target) {
      const c = this.clients.get(target);
      if (c) c.sendRaw(raw);
      return;
    }
    for (const c of this.clients.values()) c.sendRaw(raw);
  }

  async start(): Promise<void> {
    if (this.httpServer) return;
    const http = createServer((req, res) => {
      if (req.url === '/health' && req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: true, officeId: this.officeId }));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    this.httpServer = http;
    this.wss = new WebSocketServer({ noServer: true });

    http.on('upgrade', (req, socket, head) => {
      const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
      if (url.pathname !== this.path) {
        socket.destroy();
        return;
      }
      this.wss!.handleUpgrade(req, socket, head, (ws) => {
        this.onConnection(ws, req);
      });
    });

    await new Promise<void>((resolve, reject) => {
      const onErr = (err: Error) => reject(err);
      http.once('error', onErr);
      http.listen(this.port, () => {
        http.off('error', onErr);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    for (const c of [...this.clients.values()]) c.terminate();
    this.clients.clear();
    if (this.wss) {
      await new Promise<void>((resolve) => this.wss!.close(() => resolve()));
      this.wss = null;
    }
    if (this.httpServer) {
      await new Promise<void>((resolve, reject) =>
        this.httpServer!.close((err) => (err ? reject(err) : resolve())),
      );
      this.httpServer = null;
    }
    if (this.offMirror) {
      this.offMirror();
      this.offMirror = null;
    }
  }

  /** Build the snapshot events the server sends to a freshly-joined
   * client. Currently only emits `presence:position` for every other
   * player so the joiner sees who's already in the room.
   *
   * We intentionally do **NOT** include `world:settings` or `world:map`
   * here. The browser owns those values (driven by its Leva panel /
   * localStorage); applying the server's copy on connect would
   * silently overwrite the user's persisted settings with SDK
   * defaults, breaking renderer/collision agreement on the floor
   * extent. The browser broadcasts its own world state via
   * `SyncEngine.broadcastWorldState()` after subscribing, and the
   * server's mirror channel + hub fan-out propagate it to bots; bots
   * spawned later inherit the current server state via the
   * `BotServer.getInitialWorld` seed. */
  private buildSnapshotFor(joinerId: PlayerId): NetEvent[] {
    const state = this.store.getState();
    const events: NetEvent[] = [];
    let seq = 1;

    for (const [id, p] of Object.entries(state.players)) {
      if (id === joinerId) continue;
      events.push({
        kind: 'presence:position',
        v: 1,
        actorId: id as PlayerId,
        seq: seq++,
        t: Date.now(),
        pos: p.pos,
        vel: p.vel,
        yaw: p.yaw,
      });
    }
    return events;
  }

  private onConnection(ws: WebSocket, _req: IncomingMessage): void {
    let client: WsClient | null = null;

    ws.on('message', (raw) => {
      const text = typeof raw === 'string' ? raw : raw.toString('utf8');
      const frame = decodeFrame(text);
      if (!frame) return;

      if (frame.t === 'hello') {
        if (client) return; // already greeted
        client = this.acceptClient(ws, frame.userId);
        return;
      }
      if (!client) return; // any other frame before hello is dropped

      this.handleFrame(client, frame);
    });

    ws.on('close', () => {
      if (client) this.removeClient(client);
    });

    ws.on('error', () => {
      // close will follow
    });
  }

  private acceptClient(ws: WebSocket, userId: PlayerId): WsClient {
    // Honor identity-checked detach: if a stale client with the same id
    // exists (rare — only on rapid reconnect), retire it first.
    const existing = this.clients.get(userId);
    if (existing) existing.terminate();

    const channel = new InMemoryChannel(this.hub, userId);
    const client = new WsClient(userId, ws, channel);
    this.clients.set(userId, client);

    // Wire the channel into the hub. _deliver routes hub broadcasts
    // back out to this client's websocket; presence-change forwards
    // peer joins/leaves.
    void channel.subscribe();
    client.attach(this.hub);

    // Send hello-ack + snapshot synchronously so the client's subscribe
    // handshake resolves quickly.
    ws.send(
      encodeFrame({
        t: 'hello-ack',
        present: this.hub.present().filter((id) => id !== userId),
      }),
    );
    const snapEvents = this.buildSnapshotFor(userId);
    if (snapEvents.length > 0) {
      ws.send(encodeFrame({ t: 'snapshot', events: snapEvents }));
    }

    return client;
  }

  private removeClient(client: WsClient): void {
    if (this.clients.get(client.userId) === client) {
      this.clients.delete(client.userId);
    }
    client.detach();
  }

  private handleFrame(client: WsClient, frame: Frame): void {
    switch (frame.t) {
      case 'broadcast': {
        const v = validateNetEvent(frame.event);
        if (!v.ok) return;
        // Trust frame.from from the client; the server doesn't enforce
        // identity (debug infra). Routing happens via the hub.
        this.hub.broadcast(client.userId, v.event);
        return;
      }
      case 'track-presence': {
        const data = (frame as { data?: PresenceData }).data ?? {};
        this.hub.trackPresence(client.userId, data);
        return;
      }
      case 'custom': {
        for (const h of this.customHandlers) {
          try {
            if (h(client, frame.kind, frame.payload)) return;
          } catch (err) {
            console.error('[realtime-server] custom handler threw:', err);
          }
        }
        console.warn(
          `[realtime-server] dropped unhandled custom frame kind="${frame.kind}"`,
        );
        return;
      }
      default:
        // hello / hello-ack / snapshot / presence are server-emitted (or
        // already handled in onConnection); ignore otherwise.
        return;
    }
  }
}

/**
 * One connected browser/Node peer. Bridges hub fan-out (events delivered
 * to the InMemoryChannel) onto the websocket, and conversely surfaces a
 * raw send helper for the server to write control frames.
 */
export class WsClient {
  readonly userId: PlayerId;
  private readonly ws: WebSocket;
  private readonly channel: InMemoryChannel;
  private offBroadcast: (() => void) | null = null;
  private offPresence: (() => void) | null = null;

  constructor(userId: PlayerId, ws: WebSocket, channel: InMemoryChannel) {
    this.userId = userId;
    this.ws = ws;
    this.channel = channel;
  }

  attach(_hub: ReturnType<typeof createInMemoryChannelHub>): void {
    this.offBroadcast = this.channel.on((event) => {
      this.sendRaw(encodeFrame({ t: 'broadcast', from: event.actorId, event }));
    });
    this.offPresence = this.channel.onPresenceChange((joined, left) => {
      this.sendRaw(encodeFrame({ t: 'presence', joined, left }));
    });
  }

  detach(): void {
    if (this.offBroadcast) this.offBroadcast();
    if (this.offPresence) this.offPresence();
    this.offBroadcast = null;
    this.offPresence = null;
    this.channel.close();
  }

  sendRaw(raw: string): void {
    if (this.ws.readyState !== this.ws.OPEN) return;
    this.ws.send(raw);
  }

  terminate(): void {
    this.detach();
    try {
      this.ws.close();
    } catch {
      // ignore
    }
  }
}
