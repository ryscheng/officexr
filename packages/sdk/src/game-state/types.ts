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

/**
 * World-level movement & animation tunables. These live in OfficeState so
 * they can be broadcast to every client and used uniformly by the local
 * player, AI/bots, and any other agent — there's no "client-private"
 * version. Updating them via `setWorldSettings` triggers a `world:settings`
 * broadcast that peers apply to their stores via `applyRemoteWorldSettings`.
 */
export type WorldSettings = {
  /** Character walking speed in world units per second. */
  playerSpeed: number;
  /** Run speed = playerSpeed × runSpeedMultiplier. Used when the local
   * player holds Shift while moving; can be tuned live via Leva. */
  runSpeedMultiplier: number;
  /** AnimationAction.timeScale for the walk clip (1 = authored). */
  walkAnimSpeed: number;
  /** AnimationAction.timeScale for the run clip. */
  runAnimSpeed: number;
  /** AnimationAction.timeScale for the idle clip. */
  idleAnimSpeed: number;
  /** Maximum angular velocity for the smooth-turn animation, in rad/s. */
  turnSpeed: number;
  /** Collision radius of every character in world units. */
  charRadius: number;
  /** Inner proximity sensor radius — the "actually in speaking range"
   * boundary. Crossing INWARD fires `proximity:entered` (voice joins);
   * crossing OUTWARD fires `proximity:exiting` (voice stays — hysteresis
   * to {@link proximityOuterRadius}). */
  proximityRadius: number;
  /** Outer proximity sensor radius — the "approaching" boundary. Must be
   * ≥ proximityRadius. Crossing INWARD fires `proximity:entering` (visual
   * glow appears); crossing OUTWARD fires `proximity:exited` (voice
   * leaves, glow gone). */
  proximityOuterRadius: number;
  /** Visual bump-back duration when two characters collide, in ms. */
  bumpEasingMs: number;
  /** Hold time before a pair's inner-ring overlap is promoted to
   * `proximity:entered` (admission to a MeetingArea). Prevents flickery
   * conversations triggered by a momentary brush-past. Default 500 ms;
   * tunable live from the Leva Proximity panel. */
  proximityEnterDebounceMs: number;
  /** Horizontal distance (world m) from the MeetingArea centroid at
   * which the camera frames the conversation view. Bigger = more
   * zoomed out; smaller = closer / tighter framing. Same knob is
   * used by all camera modes (fixed/FP/3P) for consistency. */
  conversationCameraDistance: number;
  /** Vertical height (world m) of the camera above the MeetingArea
   * centroid in the conversation view. Combined with
   * `conversationCameraDistance` this determines both the offset
   * length and the pitch angle of the conversation framing. */
  conversationCameraHeight: number;
  /**
   * Fraction of the intent vector that must be blocked before movement is
   * snapped to zero (instead of letting the character slide along the wall
   * at reduced speed). 0 = always slide, 1 = any contact halts movement.
   * Default 0.9: slide while you can make at least 10% progress.
   */
  movementBlockThreshold: number;
  /** World-space position of the sun-like directional light. Drives both
   * the shadow-casting light direction and the visible sun disc in the
   * sky. Broadcast so peers see the same time-of-day. */
  sunPositionX: number;
  sunPositionY: number;
  sunPositionZ: number;
  /** Intensity of the sun-like directional light. */
  sunIntensity: number;
  /** Low ambient fill so shadow-side faces aren't pitch black. */
  ambientIntensity: number;
};

export const DEFAULT_WORLD_SETTINGS: WorldSettings = {
  playerSpeed: 3,
  runSpeedMultiplier: 2,
  walkAnimSpeed: 1,
  runAnimSpeed: 1,
  idleAnimSpeed: 1,
  turnSpeed: 16,
  charRadius: 0.4,
  proximityRadius: 3,
  proximityOuterRadius: 6,
  bumpEasingMs: 180,
  proximityEnterDebounceMs: 500,
  conversationCameraDistance: 7,
  conversationCameraHeight: 5,
  movementBlockThreshold: 0.9,
  sunPositionX: 20,
  sunPositionY: 40,
  sunPositionZ: 20,
  sunIntensity: 1.4,
  ambientIntensity: 0.15,
};

/**
 * Static map data: a square grid of cube cells, each tagged with a kind id.
 * Connected cells of the same kind form one collision group (computed at
 * use-time by the collision module — never broadcast). Kinds carry a
 * `walkable` flag; only non-walkable kinds become obstacles.
 *
 * Layout is run-encoded by kind to keep the wire payload compact when most
 * cells are walkable: each layer lists the (i, j) cells of one kind.
 */
export type CubeKindId = string;
export type CubeKind = { id: CubeKindId; walkable: boolean };
export type CubeKindRegistry = Record<CubeKindId, CubeKind>;
export type WorldMapLayer = {
  kind: CubeKindId;
  cells: Array<{ i: number; j: number }>;
};
export type WorldMap = {
  /** Cells per side (square grid). */
  gridSize: number;
  /** World units per cell. */
  cubeSize: number;
  /** World-space center of cell (0, 0). Defaults to the origin. */
  origin: { x: number; z: number };
  layers: WorldMapLayer[];
  kinds: CubeKindRegistry;
};

export const DEFAULT_WORLD_MAP: WorldMap = {
  gridSize: 50,
  cubeSize: 2,
  origin: { x: 0, z: 0 },
  layers: [],
  kinds: {
    floor: { id: 'floor', walkable: true },
  },
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
  worldSettings: WorldSettings;
  worldMap: WorldMap;
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
  | { kind: 'realtime:status-changed'; status: RealtimeStatus }
  // Cosmetic-only collision signal: emitted when a local move was blocked by
  // another character. Renderers listen and play a small bump-back easing.
  // Never affects state — `pos` is already resolved before this fires.
  | {
      kind: 'collision:char-bump';
      selfId: PlayerId;
      otherId: PlayerId;
      normal: { x: number; z: number };
    };

export type GameEventKind = GameEvent['kind'];
