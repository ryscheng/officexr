import { z } from 'zod';
import { ZNetEvent } from '@officexr/sdk';

/** Actor id of events the server itself originates (e.g.
 * `world:constants`). Its seq is server-wide and monotonic across
 * restarts. Clients must not use it as their `userId`. */
export const SERVER_SELF_ID = 'server';

/** Close code the server uses to retire a socket a newer session of the
 * same login has taken over. Clients must not reconnect after it. */
export const REPLACED_CLOSE_CODE = 4001;

/** Close code the server uses to refuse a `hello`; the close reason says why. */
export const REJECTED_CLOSE_CODE = 4003;

const ZPlayerId = z.string();

/** Arbitrary app-defined presence metadata. */
export const ZPresenceData = z.record(z.string(), z.unknown());

/** Client → server, first frame after the websocket opens. Identifies
 * the caller; server uses it as the `selfId` for the attached hub
 * client. `officeId` picks the room; omitted means the server's default
 * office. There is no authentication — this is debug infra. */
export const ZHelloFrame = z.object({
  t: z.literal('hello'),
  userId: ZPlayerId,
  officeId: z.string().optional(),
  /** Account behind `userId`, which must be the login itself or one of
   * its `sessionPlayerId`s. Omitted means `loginOf(userId)`. */
  login: z.string().optional(),
  /** Signed join token (see `join-token.ts`); required when the server has a token secret. */
  token: z.string().optional(),
});

/** Server → client, immediately after `hello`. Confirms the join and
 * conveys the currently-present peer ids so the client doesn't have to
 * wait for the next presence-change to know who's in the room. */
export const ZHelloAckFrame = z.object({
  t: z.literal('hello-ack'),
  present: z.array(ZPlayerId),
});

/** Server → new client, after `hello-ack`. Streams the server's
 * authoritative store as a sequence of NetEvents so the joiner's
 * SyncEngine processes them with normal `on(broadcast)` logic. */
export const ZSnapshotFrame = z.object({
  t: z.literal('snapshot'),
  events: z.array(ZNetEvent),
});

/** Either direction. Client sends → server fans out to other clients;
 * server sends → forwards from another peer. The server also applies
 * inbound broadcasts to its authoritative store. */
export const ZBroadcastFrame = z.object({
  t: z.literal('broadcast'),
  from: ZPlayerId,
  event: ZNetEvent,
});

/** Client → server. Mirrors the SDK Channel's `trackPresence` —
 * arbitrary app-defined metadata that the server retains and exposes
 * via presence changes. */
export const ZTrackPresenceFrame = z.object({
  t: z.literal('track-presence'),
  data: ZPresenceData,
});

/** Server → clients (other than the one who joined/left). Diff-style
 * presence update. */
export const ZPresenceFrame = z.object({
  t: z.literal('presence'),
  joined: z.array(ZPlayerId),
  left: z.array(ZPlayerId),
});

/** App-level extension frame. Either direction. The server's
 * `onCustomFrame` handler decides what to do with these (e.g. the debug
 * app's `bots:set-count` / `bots:set-mode` control messages). */
export const ZCustomFrame = z.object({
  t: z.literal('custom'),
  /** App-defined sub-kind. */
  kind: z.string(),
  /** Arbitrary JSON-serialisable payload. */
  payload: z.unknown(),
});

/**
 * Frames exchanged over the WebSocket between {@link WsChannel} (client)
 * and {@link RealtimeServer} (Node). JSON-serialised. Each frame has a
 * `t` (type) discriminator so we can extend without breaking older
 * clients.
 */
export const ZFrame = z.discriminatedUnion('t', [
  ZHelloFrame,
  ZHelloAckFrame,
  ZSnapshotFrame,
  ZBroadcastFrame,
  ZTrackPresenceFrame,
  ZPresenceFrame,
  ZCustomFrame,
]);

export type HelloFrame = z.infer<typeof ZHelloFrame>;
export type HelloAckFrame = z.infer<typeof ZHelloAckFrame>;
export type SnapshotFrame = z.infer<typeof ZSnapshotFrame>;
export type BroadcastFrame = z.infer<typeof ZBroadcastFrame>;
export type TrackPresenceFrame = z.infer<typeof ZTrackPresenceFrame>;
export type PresenceFrame = z.infer<typeof ZPresenceFrame>;
export type CustomFrame = z.infer<typeof ZCustomFrame>;
export type Frame = z.infer<typeof ZFrame>;

/** Type guard for narrowing a parsed frame. */
export function isFrame(value: unknown): value is Frame {
  if (!value || typeof value !== 'object') return false;
  const t = (value as { t?: unknown }).t;
  return (
    t === 'hello' ||
    t === 'hello-ack' ||
    t === 'snapshot' ||
    t === 'broadcast' ||
    t === 'track-presence' ||
    t === 'presence' ||
    t === 'custom'
  );
}

export function encodeFrame(frame: Frame): string {
  return JSON.stringify(frame);
}

export function decodeFrame(raw: string): Frame | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isFrame(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
