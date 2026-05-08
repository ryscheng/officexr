export type PlayerId = string;

export type Vec3 = { x: number; y: number; z: number };

export type AvatarData = {
  model: string;
  colors?: Record<string, string>;
  accessories?: string[];
};

export type PlayerState = {
  id: PlayerId;
  name: string;
  pos: Vec3;
  vel: Vec3;
  yaw: number;
  hp: number;
  isDead: boolean;
  avatar: AvatarData;
  jitsiRoom: string | null;
  status: 'active' | 'inactive';
  tRecv?: number;
};

export type ChatMessage = {
  id: string;
  authorId: PlayerId;
  text: string;
  t: number;
};

export type Stroke = {
  id: string;
  authorId: PlayerId;
  points: Array<{ x: number; y: number }>;
  color: string;
  width: number;
  t: number;
};

export type WhiteboardState = {
  strokes: Stroke[];
  cleared: number;
};

export type ZombieEntity = {
  id: string;
  pos: Vec3;
  hp: number;
  target: PlayerId | null;
};

export type ZombieState = {
  phase: 'idle' | 'wave' | 'between';
  wave: number;
  totalKills: number;
  hostId: PlayerId | null;
  entities: Record<string, ZombieEntity>;
  playerHealths: Record<PlayerId, number>;
};

export type InventoryItem = {
  id: string;
  itemId: string;
  qty: number;
  acquiredAt: number;
};

// Opaque reference; the SDK is DOM-free so we don't bind to MediaStream
// here. The Communication layer (which runs in a DOM environment) treats
// this as a real MediaStream. Snapshots strip this field.
export type MediaStreamRef = unknown;

export type ScreenShareSignal = {
  ownerId: PlayerId;
  stream: MediaStreamRef | null;
  signalState: 'idle' | 'offering' | 'answering' | 'connected' | 'error';
};

export type RealtimeStatus = 'connecting' | 'live' | 'reconnecting' | 'snapshot-pending';

export type RealtimeState = {
  status: RealtimeStatus;
  snapshotTarget: PlayerId | null;
  versionWarnings: Record<string, number>;
};

export type BubblePrefs = {
  radius: number;
  visible: boolean;
};

export type OfficeState = {
  selfId: PlayerId;
  officeId: string;
  players: Record<PlayerId, PlayerState>;
  proximity: Record<PlayerId, Set<PlayerId>>;
  chat: ChatMessage[];
  whiteboard: WhiteboardState;
  zombies: ZombieState;
  inventory: InventoryItem[];
  screenShares: Record<PlayerId, ScreenShareSignal>;
  realtime: RealtimeState;
  runtime: {
    tickRate: number;
    lastTick: number;
    protocolVersion: number;
  };
};

export type GameEvent =
  | { kind: 'player:join'; playerId: PlayerId }
  | { kind: 'player:leave'; playerId: PlayerId }
  | { kind: 'player:moved'; playerId: PlayerId; pos: Vec3; yaw: number }
  | { kind: 'proximity:entering'; otherId: PlayerId }
  | { kind: 'proximity:entered'; otherId: PlayerId }
  | { kind: 'proximity:exiting'; otherId: PlayerId }
  | { kind: 'proximity:exited'; otherId: PlayerId }
  | { kind: 'chat:message'; msg: ChatMessage }
  | { kind: 'whiteboard:stroke'; stroke: Stroke }
  | { kind: 'combat:hit'; targetId: PlayerId; dmg: number; byId: PlayerId }
  | { kind: 'combat:killed'; targetId: PlayerId; byId: PlayerId }
  | { kind: 'inventory:added'; item: InventoryItem }
  | { kind: 'inventory:removed'; itemId: string }
  | { kind: 'voice:room-changed'; roomId: string | null }
  | { kind: 'realtime:version-warning'; eventKind: string }
  | { kind: 'realtime:status-changed'; status: RealtimeStatus };

export type GameEventKind = GameEvent['kind'];
