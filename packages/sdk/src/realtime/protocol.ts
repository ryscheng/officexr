import { z } from 'zod';
import type {
  AvatarData,
  BubblePrefs,
  PlayerId,
  Stroke,
  Vec3,
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

const ZBubblePrefs: z.ZodType<BubblePrefs> = z.object({
  radius: z.number(),
  visible: z.boolean(),
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

// SerializedOfficeState — reuses runtime shape; we accept any JSON object
// here and trust applySnapshot to layer it onto the local store.
const ZSerializedOfficeState: z.ZodType<SerializedOfficeState> = z.any();

// --- Per-kind payload schemas (without envelope) ---

const ZPresencePosition = z.object({ pos: ZVec3, vel: ZVec3, yaw: z.number() });
const ZAvatarUpdate = z.object({ avatar: ZAvatarData });
const ZChatMessage = z.object({ text: z.string() });
const ZWhiteboardStroke = z.object({ stroke: ZStroke });
const ZWhiteboardClear = z.object({ epoch: z.number() });
const ZWhiteboardUndo = z.object({ strokeId: z.string() });
const ZShotHit = z.object({ targetId: z.string(), dmg: z.number() });
const ZLootOpen = z.object({ itemId: z.string() });
const ZZombieStatePayload = z.object({ state: ZZombieState });
const ZScreenOffer = z.object({ targetId: z.string(), sdp: z.string() });
const ZScreenAnswer = z.object({ targetId: z.string(), sdp: z.string() });
const ZScreenIce = z.object({ targetId: z.string(), candidate: z.unknown() });
const ZScreenStop = z.object({});
const ZBubblePrefsPayload = z.object({ prefs: ZBubblePrefs });
const ZNetPing = z.object({ nonce: z.string() });
const ZNetPong = z.object({ nonce: z.string() });
const ZSnapshotRequest = z.object({});
const ZSnapshotOffer = z.object({
  target: z.string(),
  state: ZSerializedOfficeState,
  seqTable: z.record(z.string(), z.number()),
});

// --- NetEvent tagged union ---

type WithEnvelope<K extends string, V extends number, P = {}> = Envelope & { kind: K; v: V } & P;

export type NetEvent =
  | WithEnvelope<'presence:position', 1, { pos: Vec3; vel: Vec3; yaw: number }>
  | WithEnvelope<'avatar:update', 1, { avatar: AvatarData }>
  | WithEnvelope<'chat:message', 1, { text: string }>
  | WithEnvelope<'whiteboard:stroke', 1, { stroke: Stroke }>
  | WithEnvelope<'whiteboard:clear', 1, { epoch: number }>
  | WithEnvelope<'whiteboard:undo', 1, { strokeId: string }>
  | WithEnvelope<'shot:hit', 1, { targetId: PlayerId; dmg: number }>
  | WithEnvelope<'loot:open', 1, { itemId: string }>
  | WithEnvelope<'zombie:state', 1, { state: ZombieState }>
  | WithEnvelope<'screen:offer', 1, { targetId: PlayerId; sdp: string }>
  | WithEnvelope<'screen:answer', 1, { targetId: PlayerId; sdp: string }>
  | WithEnvelope<'screen:ice', 1, { targetId: PlayerId; candidate: unknown }>
  | WithEnvelope<'screen:stop', 1>
  | WithEnvelope<'bubble:prefs', 1, { prefs: BubblePrefs }>
  | WithEnvelope<'net:ping', 1, { nonce: string }>
  | WithEnvelope<'net:pong', 1, { nonce: string }>
  | WithEnvelope<'snapshot:request', 1>
  | WithEnvelope<
      'snapshot:offer',
      1,
      { target: PlayerId; state: SerializedOfficeState; seqTable: Record<PlayerId, number> }
    >;

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
  'whiteboard:clear': { v: 1, schema: ZWhiteboardClear, authority: 'local' },
  'whiteboard:undo': { v: 1, schema: ZWhiteboardUndo, authority: 'local' },
  'shot:hit': { v: 1, schema: ZShotHit, authority: 'local' },
  'loot:open': { v: 1, schema: ZLootOpen, authority: 'local' },
  'zombie:state': { v: 1, schema: ZZombieStatePayload, authority: 'host' },
  'screen:offer': { v: 1, schema: ZScreenOffer, authority: 'local' },
  'screen:answer': { v: 1, schema: ZScreenAnswer, authority: 'local' },
  'screen:ice': { v: 1, schema: ZScreenIce, authority: 'local' },
  'screen:stop': { v: 1, schema: ZScreenStop, authority: 'local' },
  'bubble:prefs': { v: 1, schema: ZBubblePrefsPayload, authority: 'local' },
  'net:ping': { v: 1, schema: ZNetPing, authority: 'local' },
  'net:pong': { v: 1, schema: ZNetPong, authority: 'local' },
  'snapshot:request': { v: 1, schema: ZSnapshotRequest, authority: 'local' },
  'snapshot:offer': { v: 1, schema: ZSnapshotOffer, authority: 'local' },
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
