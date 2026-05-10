import { z } from 'zod';
import type {
  AvatarData,
  PlayerId,
  Stroke,
  Vec3,
  WorldMap,
  WorldSettings,
  ZombieState,
} from '../game-state/types.ts';
import type { SerializedOfficeState } from '../game-state/snapshot.ts';

// --- Envelope ---

export type Envelope = {
  kind: string;
  v: number;
  actorId: PlayerId;
  seq: number;
  t: number;
};

const ZVec3 = z.object({ x: z.number(), y: z.number(), z: z.number() });

const ZAvatarData: z.ZodType<AvatarData> = z.object({
  model: z.string(),
  colors: z.record(z.string(), z.string()).optional(),
  accessories: z.array(z.string()).optional(),
});

const ZStroke: z.ZodType<Stroke> = z.object({
  id: z.string(),
  authorId: z.string(),
  points: z.array(z.object({ x: z.number(), y: z.number() })),
  color: z.string(),
  width: z.number(),
  t: z.number(),
});

const ZZombieEntity = z.object({
  id: z.string(),
  pos: ZVec3,
  hp: z.number(),
  target: z.string().nullable(),
});

const ZZombieState: z.ZodType<ZombieState> = z.object({
  phase: z.enum(['idle', 'wave', 'between']),
  wave: z.number(),
  totalKills: z.number(),
  hostId: z.string().nullable(),
  entities: z.record(z.string(), ZZombieEntity),
  playerHealths: z.record(z.string(), z.number()),
});

const ZPlayerState = z.object({
  id: z.string(),
  name: z.string(),
  pos: ZVec3,
  vel: ZVec3,
  yaw: z.number(),
  hp: z.number(),
  isDead: z.boolean(),
  avatar: ZAvatarData,
  jitsiRoom: z.string().nullable(),
  status: z.enum(['active', 'inactive']),
});

const ZChatMessageObj = z.object({
  id: z.string(),
  authorId: z.string(),
  text: z.string(),
  t: z.number(),
});

const ZInventoryItem = z.object({
  id: z.string(),
  itemId: z.string(),
  qty: z.number(),
  acquiredAt: z.number(),
});

const ZWhiteboardState = z.object({
  strokes: z.array(ZStroke),
  cleared: z.number(),
});

const ZRealtimeState = z.object({
  status: z.enum(['connecting', 'live', 'reconnecting', 'snapshot-pending']),
  snapshotTarget: z.string().nullable(),
  versionWarnings: z.record(z.string(), z.number()),
});

const ZScreenShareSignal = z.object({
  ownerId: z.string(),
  stream: z.null(),
  signalState: z.enum(['idle', 'offering', 'answering', 'connected', 'error']),
});

const ZRuntime = z.object({
  tickRate: z.number(),
  lastTick: z.number(),
  protocolVersion: z.number(),
});

const ZWorldSettings: z.ZodType<WorldSettings> = z.object({
  playerSpeed: z.number(),
  walkAnimSpeed: z.number(),
  idleAnimSpeed: z.number(),
  turnSpeed: z.number(),
  charRadius: z.number(),
  bumpEasingMs: z.number(),
  movementBlockThreshold: z.number(),
});

const ZCubeKind = z.object({ id: z.string(), walkable: z.boolean() });
const ZWorldMap: z.ZodType<WorldMap> = z.object({
  gridSize: z.number().int().positive(),
  cubeSize: z.number().positive(),
  origin: z.object({ x: z.number(), z: z.number() }),
  layers: z.array(
    z.object({
      kind: z.string(),
      cells: z.array(z.object({ i: z.number().int(), j: z.number().int() })),
    }),
  ),
  kinds: z.record(z.string(), ZCubeKind),
});

/**
 * Real shape validation for snapshot:offer.state. Closes the trust-boundary
 * hole previously left by `z.any()` — a malformed snapshot can no longer
 * write garbage into local state via applySnapshot.
 */
const ZSerializedOfficeState: z.ZodType<SerializedOfficeState> = z.object({
  selfId: z.string(),
  officeId: z.string(),
  players: z.record(z.string(), ZPlayerState),
  proximity: z.record(z.string(), z.array(z.string())),
  chat: z.array(ZChatMessageObj),
  whiteboard: ZWhiteboardState,
  zombies: ZZombieState,
  inventory: z.array(ZInventoryItem),
  screenShares: z.record(z.string(), ZScreenShareSignal),
  realtime: ZRealtimeState,
  runtime: ZRuntime,
  worldSettings: ZWorldSettings,
  worldMap: ZWorldMap,
});

// --- Per-kind payload schemas (without envelope) ---

const ZPresencePosition = z.object({ pos: ZVec3, vel: ZVec3, yaw: z.number() });
const ZAvatarUpdate = z.object({ avatar: ZAvatarData });
const ZChatMessage = z.object({ text: z.string() });
const ZWhiteboardStroke = z.object({ stroke: ZStroke });
const ZShotHit = z.object({ targetId: z.string(), dmg: z.number() });
const ZZombieStatePayload = z.object({ state: ZZombieState });
const ZSnapshotRequest = z.object({});
const ZWorldSettingsPayload = z.object({ settings: ZWorldSettings });
const ZWorldMapPayload = z.object({ map: ZWorldMap });
const ZSnapshotOffer = z.object({
  target: z.string(),
  state: ZSerializedOfficeState,
  seqTable: z.record(z.string(), z.number()),
});

// --- NetEvent tagged union ---
//
// Only kinds with a real consumer in the engine are listed here. The spec
// (refactor-plan/03) lists more (whiteboard:clear/undo, screen:*, bubble:*,
// net:*, loot:open). They will be re-added as the corresponding subsystems
// are wired; until then keeping them out of the protocol prevents peers
// from sending events the receiver silently drops.

type WithEnvelope<K extends string, V extends number, P = {}> = Envelope & { kind: K; v: V } & P;

export type NetEvent =
  | WithEnvelope<'presence:position', 1, { pos: Vec3; vel: Vec3; yaw: number }>
  | WithEnvelope<'avatar:update', 1, { avatar: AvatarData }>
  | WithEnvelope<'chat:message', 1, { text: string }>
  | WithEnvelope<'whiteboard:stroke', 1, { stroke: Stroke }>
  | WithEnvelope<'shot:hit', 1, { targetId: PlayerId; dmg: number }>
  | WithEnvelope<'zombie:state', 1, { state: ZombieState }>
  | WithEnvelope<'snapshot:request', 1>
  | WithEnvelope<
      'snapshot:offer',
      1,
      { target: PlayerId; state: SerializedOfficeState; seqTable: Record<PlayerId, number> }
    >
  | WithEnvelope<'world:settings', 1, { settings: WorldSettings }>
  | WithEnvelope<'world:map', 1, { map: WorldMap }>;

export type NetEventKind = NetEvent['kind'];

// --- PROTOCOL table (versions, schemas, authority) ---

export type Authority = 'local' | 'host';

export type ProtocolEntry = {
  v: number;
  schema: z.ZodTypeAny;
  authority: Authority;
};

export const PROTOCOL: Record<NetEventKind, ProtocolEntry> = {
  'presence:position': { v: 1, schema: ZPresencePosition, authority: 'local' },
  'avatar:update': { v: 1, schema: ZAvatarUpdate, authority: 'local' },
  'chat:message': { v: 1, schema: ZChatMessage, authority: 'local' },
  'whiteboard:stroke': { v: 1, schema: ZWhiteboardStroke, authority: 'local' },
  'shot:hit': { v: 1, schema: ZShotHit, authority: 'local' },
  'zombie:state': { v: 1, schema: ZZombieStatePayload, authority: 'host' },
  'snapshot:request': { v: 1, schema: ZSnapshotRequest, authority: 'local' },
  'snapshot:offer': { v: 1, schema: ZSnapshotOffer, authority: 'local' },
  'world:settings': { v: 1, schema: ZWorldSettingsPayload, authority: 'local' },
  'world:map': { v: 1, schema: ZWorldMapPayload, authority: 'local' },
};

// --- Validation ---

const ZEnvelope = z.object({
  kind: z.string(),
  v: z.number(),
  actorId: z.string(),
  seq: z.number(),
  t: z.number(),
});

export type ValidationResult =
  | { ok: true; event: NetEvent }
  | { ok: false; reason: 'envelope' | 'unknown-kind' | 'schema'; detail?: unknown };

export function validateNetEvent(input: unknown): ValidationResult {
  const env = ZEnvelope.safeParse(input);
  if (!env.success) return { ok: false, reason: 'envelope', detail: env.error };
  const def = PROTOCOL[env.data.kind as NetEventKind];
  if (!def) return { ok: false, reason: 'unknown-kind' };
  const payload = def.schema.safeParse(input);
  if (!payload.success) return { ok: false, reason: 'schema', detail: payload.error };
  return { ok: true, event: input as NetEvent };
}

export function versionMismatch(event: NetEvent): boolean {
  const def = PROTOCOL[event.kind];
  if (!def) return true;
  return def.v !== event.v;
}
