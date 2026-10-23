import { createHash, timingSafeEqual } from 'node:crypto';
import {
  createServer,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse,
} from 'node:http';
import { setTimeout as sleep } from 'node:timers/promises';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  applyNetEventToStore,
  createActions,
  createBus,
  createInMemoryChannelHub,
  createStore,
  DEFAULT_WORLD_CONSTANTS,
  InMemoryChannel,
  createSeqCounter,
  parseWorldConstants,
  validateNetEvent,
  type Actions,
  type Bus,
  type NetEvent,
  type PlayerId,
  type PresenceData,
  type Store,
  type WorldConstants,
} from '@officexr/sdk';
import {
  decodeFrame,
  encodeFrame,
  REPLACED_CLOSE_CODE,
  SERVER_SELF_ID,
  type CustomFrame,
  type Frame,
} from './protocol.ts';

const DEFAULT_PORT = 8787;
const DEFAULT_PATH = '/ws';
const DEFAULT_OFFICE_ID = 'debug-office';
const MAX_ADMIN_BODY_BYTES = 1024 * 1024;
const DEFAULT_BOOT_RETRY_MS = 2_000;
const BOOT_RETRY_MAX_MS = 30_000;

export interface RealtimeServerOptions {
  /** Port to listen on. Default 8787. */
  port?: number;
  /** WebSocket path. Default '/ws'. */
  path?: string;
  /** Office served to clients whose `hello` omits `officeId`. Default 'debug-office'. */
  officeId?: string;
  /** Boot source for the world constants. A 404 keeps the defaults;
   * network errors and 5xx are retried with backoff. */
  worldConstantsUrl?: string;
  /** Bearer token for `PUT /admin/world-constants`. Unset or empty
   * disables the route (404). */
  adminToken?: string;
  /** Used for the boot load. Default: global `fetch`. */
  fetch?: typeof fetch;
  /** First boot-load retry delay; doubles per attempt up to 30 s. Default 2000. */
  bootRetryMs?: number;
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
  private readonly mirror: InMemoryChannel;
  private readonly offMirror: () => void;

  /** `takeServerSeq` hands out the server-wide seq for events the server
   * itself originates (actor {@link SERVER_SELF_ID}). */
  constructor(
    readonly officeId: string,
    private readonly takeServerSeq: () => number,
    worldConstants: WorldConstants,
  ) {
    this.store = createStore({ selfId: SERVER_SELF_ID, officeId });
    this.bus = createBus();
    this.actions = createActions(this.store, this.bus);
    this.actions.setWorldConstants(worldConstants);

    // The mirror receives every hub fan-out except its own broadcasts,
    // so server-originated events must also be applied to the store
    // directly (see pushWorldConstants).
    const mirror = new InMemoryChannel(this.hub, SERVER_SELF_ID);
    this.mirror = mirror;
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

  /** Adopt `constants` and fan them out to every hub peer (WS clients
   * and in-process bots). */
  pushWorldConstants(constants: WorldConstants, seq: number): void {
    this.actions.setWorldConstants(constants);
    void this.mirror.send(this.worldConstantsEvent(seq));
  }

  private worldConstantsEvent(seq: number): NetEvent {
    return {
      kind: 'world:constants',
      v: 1,
      actorId: SERVER_SELF_ID,
      seq,
      t: Date.now(),
      constants: this.store.getState().worldConstants,
    };
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

  /** Build the snapshot events sent to a freshly-joined client: the
   * room's `world:constants`, then `presence:position` and (for players
   * who have announced a name) the equivalent `avatar:update` for every
   * other present player.
   *
   * We intentionally do **NOT** include `world:map` here. The browser
   * owns it; applying the server's copy on connect would silently
   * overwrite the user's map with SDK defaults, breaking
   * renderer/collision agreement on the floor extent. The browser
   * broadcasts its own world state via
   * `SyncEngine.broadcastWorldState()` after subscribing, and the
   * server's mirror channel + hub fan-out propagate it to bots; bots
   * spawned later inherit the current server state via the
   * `BotServer.getInitialWorld` seed. */
  buildSnapshotFor(joinerId: PlayerId): NetEvent[] {
    const state = this.store.getState();
    const events: NetEvent[] = [this.worldConstantsEvent(this.takeServerSeq())];
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
  private readonly worldConstantsUrl: string | undefined;
  private readonly adminToken: string | undefined;
  private readonly fetch: typeof fetch;
  private readonly bootRetryMs: number;
  private worldConstants: WorldConstants = DEFAULT_WORLD_CONSTANTS;
  private bootLoad: AbortController | null = null;
  private readonly takeServerSeq = createSeqCounter().next;

  constructor(opts: RealtimeServerOptions = {}) {
    this.port = opts.port ?? DEFAULT_PORT;
    this.path = opts.path ?? DEFAULT_PATH;
    this.worldConstantsUrl = opts.worldConstantsUrl;
    this.adminToken = opts.adminToken;
    this.fetch = opts.fetch ?? globalThis.fetch;
    this.bootRetryMs = opts.bootRetryMs ?? DEFAULT_BOOT_RETRY_MS;
    this.defaultRoom = new Room(
      opts.officeId ?? DEFAULT_OFFICE_ID,
      this.takeServerSeq,
      this.worldConstants,
    );
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
      if (req.url === '/admin/world-constants' && req.method === 'PUT' && this.adminToken) {
        this.putWorldConstants(req, res, this.adminToken).catch(() => res.destroy());
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

    if (this.worldConstantsUrl) {
      const bootLoad = new AbortController();
      this.bootLoad = bootLoad;
      void fetchWorldConstants(this.worldConstantsUrl, this.fetch, this.bootRetryMs, bootLoad.signal).then((constants) => {
        if (constants && !bootLoad.signal.aborted) {
          this.setWorldConstants(constants);
        }
      });
    }
  }

  async stop(): Promise<void> {
    this.bootLoad?.abort();
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

  private setWorldConstants(constants: WorldConstants): void {
    this.worldConstants = constants;
    const seq = this.takeServerSeq();
    for (const room of this.rooms.values()) room.pushWorldConstants(constants, seq);
  }

  private async putWorldConstants(
    req: IncomingMessage,
    res: ServerResponse,
    token: string,
  ): Promise<void> {
    if (!bearerMatches(req.headers.authorization, token)) {
      res.writeHead(401).end();
      return;
    }
    const body = await readBody(req, MAX_ADMIN_BODY_BYTES);
    if (body === null) {
      res.writeHead(413, { connection: 'close' }).end(() => req.destroy());
      return;
    }
    let constants: WorldConstants;
    try {
      constants = parseWorldConstants(JSON.parse(body));
    } catch (err) {
      res.writeHead(400, { 'content-type': 'text/plain' }).end(String((err as Error).message));
      return;
    }
    // A pushed doc is newer than whatever the boot load would return.
    this.bootLoad?.abort();
    this.setWorldConstants(constants);
    res.writeHead(204).end();
  }

  private roomFor(officeId: unknown): Room {
    const id =
      typeof officeId === 'string' && officeId !== ''
        ? officeId
        : this.defaultRoom.officeId;
    // ponytail: office ids and room count are unbounded; fine on a tailnet-only server.
    let room = this.rooms.get(id);
    if (!room) {
      room = new Room(id, this.takeServerSeq, this.worldConstants);
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
        if (frame.userId === SERVER_SELF_ID) {
          ws.close();
          return;
        }
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
    // Newest socket per userId wins; the older one is told why so it stops.
    room.clients.get(userId)?.replace();

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
    ws.send(encodeFrame({ t: 'snapshot', events: room.buildSnapshotFor(userId) }));

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
        // Only the server originates world constants, and a spoofed
        // server actor with a high seq would make peers dedup away every
        // later server push. The retired `world:settings` kind already
        // fails validation.
        if (!v.ok || v.event.kind === 'world:constants' || v.event.actorId === SERVER_SELF_ID) return;
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

/** Fetches the boot constants doc, retrying network errors and 5xx with
 * capped backoff. Resolves `null` (keep the defaults) on a 404, an
 * invalid doc, any other status, or abort. */
async function fetchWorldConstants(
  url: string,
  fetchFn: typeof fetch,
  firstRetryMs: number,
  signal: AbortSignal,
): Promise<WorldConstants | null> {
  for (let delayMs = firstRetryMs; ; delayMs = Math.min(delayMs * 2, BOOT_RETRY_MAX_MS)) {
    const res = await fetchFn(url, { signal }).catch((err: unknown) => {
      if (!signal.aborted) {
        console.warn(`[realtime-server] world constants load failed; retrying in ${delayMs}ms:`, err);
      }
      return null;
    });
    if (signal.aborted) {
      return null;
    }
    if (res?.ok) {
      try {
        return parseWorldConstants(await res.json());
      } catch (err) {
        if (!signal.aborted) {
          console.error('[realtime-server] invalid world constants doc; keeping defaults:', err);
        }
        return null;
      }
    }
    if (res && res.status < 500) {
      if (res.status !== 404) {
        console.error(`[realtime-server] world constants load got ${res.status}; keeping defaults`);
      }
      return null;
    }
    if (res) {
      console.warn(`[realtime-server] world constants load got ${res.status}; retrying in ${delayMs}ms`);
    }
    try {
      await sleep(delayMs, undefined, { signal });
    } catch {
      return null;
    }
  }
}

function bearerMatches(header: string | undefined, token: string): boolean {
  // Hashing equalises lengths, which timingSafeEqual requires.
  const digest = (s: string) => createHash('sha256').update(s).digest();
  return timingSafeEqual(digest(header ?? ''), digest(`Bearer ${token}`));
}

/** Resolves the request body as UTF-8, or `null` once it exceeds `limit` bytes. */
function readBody(req: IncomingMessage, limit: number): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        resolve(null);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
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

  replace(): void {
    this.terminate(REPLACED_CLOSE_CODE, 'replaced');
  }

  terminate(code?: number, reason?: string): void {
    this.detach();
    try {
      this.ws.close(code, reason);
    } catch {
      // ignore
    }
  }
}
