import type { PlayerId, PresenceData } from '@officexr/sdk';
import type { NetEvent } from '@officexr/sdk';

/**
 * Frames exchanged over the WebSocket between {@link WsChannel} (client)
 * and {@link RealtimeServer} (Node). JSON-serialised. Each frame has a
 * `t` (type) discriminator so we can extend without breaking older
 * clients.
 *
 * NetEvent payloads ride inside `broadcast` frames opaquely so the
 * protocol stays decoupled from SDK additions — anything the SDK's
 * `validateNetEvent` accepts works without protocol changes here.
 */
export type Frame =
  | HelloFrame
  | HelloAckFrame
  | SnapshotFrame
  | BroadcastFrame
  | TrackPresenceFrame
  | PresenceFrame
  | CustomFrame;

/** Client → server, first frame after the websocket opens. Identifies
 * the caller; server uses it as the `selfId` for the attached hub
 * client. There is no authentication — this is debug infra. */
export interface HelloFrame {
  t: 'hello';
  userId: PlayerId;
}

/** Server → client, immediately after `hello`. Confirms the join and
 * conveys the currently-present peer ids so the client doesn't have to
 * wait for the next presence-change to know who's in the room. */
export interface HelloAckFrame {
  t: 'hello-ack';
  present: PlayerId[];
}

/** Server → new client, after `hello-ack`. Streams the server's
 * authoritative store as a sequence of NetEvents so the joiner's
 * SyncEngine processes them with normal `on(broadcast)` logic. */
export interface SnapshotFrame {
  t: 'snapshot';
  events: NetEvent[];
}

/** Either direction. Client sends → server fans out to other clients;
 * server sends → forwards from another peer. The server also applies
 * inbound broadcasts to its authoritative store. */
export interface BroadcastFrame {
  t: 'broadcast';
  from: PlayerId;
  event: NetEvent;
}

/** Client → server. Mirrors the SDK Channel's `trackPresence` —
 * arbitrary app-defined metadata that the server retains and exposes
 * via presence changes. */
export interface TrackPresenceFrame {
  t: 'track-presence';
  data: PresenceData;
}

/** Server → clients (other than the one who joined/left). Diff-style
 * presence update. */
export interface PresenceFrame {
  t: 'presence';
  joined: PlayerId[];
  left: PlayerId[];
}

/** App-level extension frame. Either direction. The server's
 * `onCustomFrame` handler decides what to do with these (e.g. the debug
 * app's `bots:set-count` / `bots:set-mode` control messages). */
export interface CustomFrame {
  t: 'custom';
  /** App-defined sub-kind. */
  kind: string;
  /** Arbitrary JSON-serialisable payload. */
  payload: unknown;
}

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
