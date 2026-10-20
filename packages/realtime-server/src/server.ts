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
  /** Office served to clients whose `hello` omits `officeId`. Default 'debug-office'. */
  officeId?: string;
}

/**
 * Handler signature for app-level custom frames. `room` is the sender's
 * room; replies should go through it. Return `true` if the frame was
 * consumed; the server won't emit any further side effects for it.
 * Return `false` to let the server log a warning and drop.
 */
export type CustomFrameHandler = (
  client: WsClient,
  kind: string,
  payload: unknown,
  room: Room,
) => boolean;

/**
 * One office's authoritative state: an `InMemoryChannelHub` every
 * websocket client (via `WsClient`) and in-process peer (e.g. bots)
 * attaches to, plus an SDK `Store` that mirrors every broadcast for
 * late-joiner snapshots.
 */
export class Room {
  readonly hub = createInMemoryChannelHub();
  readonly store: Store;
  readonly actions: Actions;
  readonly bus: Bus;
  readonly clients = new Map<PlayerId, WsClient>();
  private readonly offMirror: () => void;

  constructor(readonly officeId: string) {
    this.store = createStore({ selfId: SERVER_SELF_ID, officeId });
    this.bus = createBus();
    this.actions = createActions(this.store, this.bus);

    // The mirror receives every hub fan-out except its own broadcasts,
    // which is what we want: the server doesn't originate broadcasts.
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

  close(): void {
    for (const c of [...this.clients.values()]) c.terminate();
    this.clients.clear();
    this.offMirror();
  }

  /** Send a custom frame to one client, or every client if `target` is
   * omitted. */
  sendCustom(kind: string, payload: unknown, target?: PlayerId): void {
    const frame: CustomFrame = { t: 'custom', kind, payload };
    const raw = encodeFrame(frame);
    if (target) {
      this.clients.get(target)?.sendRaw(raw);
      return;
    }
    for (const c of this.clients.values()) c.sendRaw(raw);
  }

  /** Build the snapshot events sent to a freshly-joined client:
   * `presence:position` and (for players who have announced a name) the
   * equivalent `avatar:update` for every other present player.
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
  buildSnapshotFor(joinerId: PlayerId): NetEvent[] {
    const state = this.store.getState();
    const events: NetEvent[] = [];
    const present = new Set([...this.hub.present(), ...this.clients.keys()]);
    let seq = 1;

    for (const [id, p] of Object.entries(state.players)) {
      if (id === joinerId || !present.has(id)) continue;
      events.push({
        kind: 'presence:position',
        v: 1,
        actorId: id as PlayerId,
        seq: seq++,
        t: Date.now(),
        pos: p.pos,
        vel: p.vel,
        yaw: p.yaw,
        isAirborne: p.isAirborne ?? false,
      });
      // The store's default name is '', so a name means the player sent
      // an avatar:update.
      if (p.name) {
        events.push({
          kind: 'avatar:update',
          v: 1,
          actorId: id as PlayerId,
          seq: seq++,
          t: Date.now(),
          avatar: p.avatar,
          name: p.name,
        });
      }
    }
    return events;
  }
}

/**
 * Game-state server hosting one {@link Room} per office. Clients pick
 * their office in the `hello` frame; a missing `officeId` means the
 * default room, which lives for the server's lifetime so in-process
 * peers (see `BotServer`) can attach to it.
 *
 * Designed to be subclassed: see `BotServer` in the debug-app for an
 * example (in `@officexr/world`) that adds bot orchestration on top of the
 * default room's hub.
 */
export class RealtimeServer {
  readonly defaultRoom: Room;

  private readonly rooms = new Map<string, Room>();
  private readonly port: number;
  private readonly path: string;
  private httpServer: HttpServer | null = null;
  private wss: WebSocketServer | null = null;
  private customHandlers: CustomFrameHandler[] = [];

  constructor(opts: RealtimeServerOptions = {}) {
    this.port = opts.port ?? DEFAULT_PORT;
    this.path = opts.path ?? DEFAULT_PATH;
    this.defaultRoom = new Room(opts.officeId ?? DEFAULT_OFFICE_ID);
    this.rooms.set(this.defaultRoom.officeId, this.defaultRoom);
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

  /** Send a custom frame to the default room (see {@link Room.sendCustom}). */
  sendCustom(kind: string, payload: unknown, target?: PlayerId): void {
    this.defaultRoom.sendCustom(kind, payload, target);
  }

  async start(): Promise<void> {
    if (this.httpServer) return;
    const http = createServer((req, res) => {
      if (req.url === '/health' && req.method === 'GET') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({ ok: true, offices: [...this.rooms.keys()] }),
        );
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
    for (const room of this.rooms.values()) room.close();
    this.rooms.clear();
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
  }

  private roomFor(officeId: unknown): Room {
    const id =
      typeof officeId === 'string' && officeId !== ''
        ? officeId
        : this.defaultRoom.officeId;
    let room = this.rooms.get(id);
    if (!room) {
      room = new Room(id);
      this.rooms.set(id, room);
    }
    return room;
  }

  private onConnection(ws: WebSocket, _req: IncomingMessage): void {
    let client: WsClient | null = null;
    let room: Room | null = null;

    ws.on('message', (raw) => {
      const text = typeof raw === 'string' ? raw : raw.toString('utf8');
      const frame = decodeFrame(text);
      if (!frame) return;

      if (frame.t === 'hello') {
        if (client) return; // already greeted
        room = this.roomFor(frame.officeId);
        client = this.acceptClient(room, ws, frame.userId);
        return;
      }
      if (!client || !room) return; // any other frame before hello is dropped

      this.handleFrame(room, client, frame);
    });

    ws.on('close', () => {
      if (client && room) this.removeClient(room, client);
    });

    ws.on('error', () => {
      // close will follow
    });
  }

  private acceptClient(room: Room, ws: WebSocket, userId: PlayerId): WsClient {
    // Honor identity-checked detach: if a stale client with the same id
    // exists (rare — only on rapid reconnect), retire it first.
    room.clients.get(userId)?.terminate();

    const channel = new InMemoryChannel(room.hub, userId);
    const client = new WsClient(userId, ws, channel);
    room.clients.set(userId, client);

    // Wire the channel into the hub. _deliver routes hub broadcasts
    // back out to this client's websocket; presence-change forwards
    // peer joins/leaves.
    void channel.subscribe();
    client.attach();

    // Send hello-ack + snapshot synchronously so the client's subscribe
    // handshake resolves quickly.
    ws.send(
      encodeFrame({
        t: 'hello-ack',
        present: room.hub.present().filter((id) => id !== userId),
      }),
    );
    const snapEvents = room.buildSnapshotFor(userId);
    if (snapEvents.length > 0) {
      ws.send(encodeFrame({ t: 'snapshot', events: snapEvents }));
    }

    return client;
  }

  private removeClient(room: Room, client: WsClient): void {
    client.detach();
    // A replaced client's late close must not evict its successor or a
    // room recreated since.
    if (room.clients.get(client.userId) !== client) return;
    room.clients.delete(client.userId);
    if (
      room.clients.size === 0 &&
      room !== this.defaultRoom &&
      this.rooms.get(room.officeId) === room
    ) {
      room.close();
      this.rooms.delete(room.officeId);
    }
  }

  private handleFrame(room: Room, client: WsClient, frame: Frame): void {
    switch (frame.t) {
      case 'broadcast': {
        const v = validateNetEvent(frame.event);
        if (!v.ok) return;
        // Trust frame.from from the client; the server doesn't enforce
        // identity (debug infra). Routing happens via the hub.
        room.hub.broadcast(client.userId, v.event);
        return;
      }
      case 'track-presence': {
        const data = (frame as { data?: PresenceData }).data ?? {};
        room.hub.trackPresence(client.userId, data);
        return;
      }
      case 'custom': {
        for (const h of this.customHandlers) {
          try {
            if (h(client, frame.kind, frame.payload, room)) return;
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

  attach(): void {
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
