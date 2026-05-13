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
 * Character movement + skeletal-animation tunables.
 */
export type AnimationSettings = {
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
};

/**
 * Proximity-ring geometry + debounce. Drives MeetingArea admission and
 * voice room derivation.
 */
export type ProximitySettings = {
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
  /** Hold time before a pair's inner-ring overlap is promoted to
   * `proximity:entered` (admission to a MeetingArea). Prevents flickery
   * conversations triggered by a momentary brush-past. Default 500 ms;
   * tunable live from the Leva Proximity panel. */
  proximityEnterDebounceMs: number;
};

/**
 * Body-collision tuning.
 */
export type CollisionSettings = {
  /** Collision radius of every character in world units. */
  charRadius: number;
  /** Visual bump-back duration when two characters collide, in ms. */
  bumpEasingMs: number;
  /**
   * Fraction of the intent vector that must be blocked before movement is
   * snapped to zero (instead of letting the character slide along the wall
   * at reduced speed). 0 = always slide, 1 = any contact halts movement.
   * Default 0.9: slide while you can make at least 10% progress.
   */
  movementBlockThreshold: number;
};

/**
 * Camera framing tuning specific to the auto-engaged conversation view.
 */
export type ConversationCameraSettings = {
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
};

/**
 * Scene lighting / time-of-day. Sun position is broadcast so peers see
 * the same shadows.
 */
export type LightingSettings = {
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

/**
 * World-level movement & animation tunables. These live in OfficeState so
 * they can be broadcast to every client and used uniformly by the local
 * player, AI/bots, and any other agent — there's no "client-private"
 * version. Updating them via `setWorldSettings` triggers a `world:settings`
 * broadcast that peers apply to their stores via `applyRemoteWorldSettings`.
 *
 * Composed as the intersection of focused sub-types (Animation,
 * Proximity, Collision, ConversationCamera, Lighting) so consumers can
 * declare narrower signatures (e.g. a movement function asks for
 * `AnimationSettings & CollisionSettings`) without taking the whole bag.
 * Wire format stays a flat object literal.
 */
export type WorldSettings = AnimationSettings &
  ProximitySettings &
  CollisionSettings &
  ConversationCameraSettings &
  LightingSettings;

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
/**
 * Optional rendering hints for a CubeKind. The renderer reads these when
 * painting the floor; absence falls back to per-renderer defaults
 * (today: blue for floor, grey for unknown). Kept loose on purpose —
 * either a flat color, a GLB asset reference, or both. The SDK stays
 * headless: it never imports a renderer or asset loader.
 */
export type CubeKindAppearance = {
  /** CSS hex color, e.g. "#3b82f6". */
  color?: string;
  /** Path to a GLB/GLTF asset (rendered as a tiled instance per cell)
   * if the cell warrants more than a flat-colored block. */
  modelUrl?: string;
};
export type CubeKind = {
  id: CubeKindId;
  walkable: boolean;
  appearance?: CubeKindAppearance;
};
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

/**
 * Per-character override for movement-related tunables. Every field is
 * optional: a present field replaces the world-level default for that
 * character model only; an absent field inherits the corresponding
 * `WorldSettings` value. This is the model layer for tuning Mages
 * faster than Knights, etc.
 */
export type CharacterMovementOverrides = {
  /** Multiplier on `WorldSettings.playerSpeed` for this model. 1 = no
   * change. Resolved as `worldSettings.playerSpeed * speedMultiplier`. */
  speedMultiplier?: number;
  /** Override for `WorldSettings.runSpeedMultiplier` (the Shift-to-run
   * factor). Multiplicative on top of `speedMultiplier`. */
  runSpeedMultiplier?: number;
  /** Override for `WorldSettings.turnSpeed` (rad/s). */
  turnSpeed?: number;
};

export type CharacterCollisionOverrides = {
  /** Override for `WorldSettings.charRadius` (world units). */
  charRadius?: number;
  /** Override for `WorldSettings.bumpEasingMs`. */
  bumpEasingMs?: number;
};

export type CharacterAnimationOverrides = {
  /** Override for `WorldSettings.walkAnimSpeed`. */
  walkAnimSpeed?: number;
  /** Override for `WorldSettings.runAnimSpeed`. */
  runAnimSpeed?: number;
  /** Override for `WorldSettings.idleAnimSpeed`. */
  idleAnimSpeed?: number;
};

/**
 * Per-character config keyed off `AvatarData.model`. Composed as the
 * intersection of focused override sub-types so a caller can ask for
 * a narrow slice (e.g. movement only) without taking the whole bag.
 *
 * Held in `OfficeState.characterConfigs[modelId]`. Broadcast via the
 * `world:characters` NetEvent — every peer (including bots) sees the
 * same per-character tuning.
 */
export type CharacterConfig = CharacterMovementOverrides &
  CharacterCollisionOverrides &
  CharacterAnimationOverrides;

/** Map from model id (e.g. "Barbarian", "Mage") → per-character config. */
export type CharacterConfigs = Record<string, CharacterConfig>;

/**
 * One placed cube in an authored scene. The compiled output of a
 * `SceneDocument` (see `@officexr/world/scenes/commands.ts`) is a flat
 * list of these instances. The renderer reads them as-is and groups
 * them into per-kind `<InstancedMesh>`es; collision builds AABBs from
 * `position` + `cubeSize` (the `cubeSize` lives on `WorldObjects`, not
 * per-instance, so a scene can't accidentally mix scales).
 *
 * `position` is in INTEGER VOXEL COORDS (not world units). Multiply by
 * `WorldObjects.cubeSize` to get world space. `id` is unique per
 * instance and stable across recompiles for the same source command +
 * voxel position. `sourceCommandId` is the editor's hook back into
 * the command list — selecting an instance highlights its source
 * command in the inspector.
 */
export type ObjectInstance = {
  id: string;
  sourceCommandId: string;
  kindId: string;
  position: [number, number, number];
};

/**
 * The compiled, broadcast-ready form of a scene's placed cubes.
 * Lives on `OfficeState.worldObjects`. The studio's Scenes mode owns
 * the canonical command list and pushes the recompiled snapshot here
 * via `actions.setWorldObjects(...)`. The `world:objects` NetEvent
 * mirrors the same shape across peers.
 *
 * `cubeSize` is captured here (not just in `WorldMap`) so a scene
 * authored with a different scale renders correctly even when no
 * legacy WorldMap is loaded.
 */
export type WorldObjects = {
  cubeSize: number;
  instances: ObjectInstance[];
};

export const DEFAULT_WORLD_OBJECTS: WorldObjects = {
  cubeSize: 2,
  instances: [],
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
  /**
   * Per-character tuning overrides keyed by `AvatarData.model`. An empty
   * record means "every character uses the worldSettings defaults".
   * Broadcast via the `world:characters` NetEvent.
   */
  characterConfigs: CharacterConfigs;
  /**
   * Compiled, instance-level scene objects (cubes today; future shapes
   * later). Populated by the studio's Scenes mode from a CAD-style
   * command list (`SceneDocument` in `@officexr/world/scenes`).
   * Broadcast via the `world:objects` NetEvent.
   */
  worldObjects: WorldObjects;
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
