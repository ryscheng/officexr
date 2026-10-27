/**
 * Map authoring document. A Map composes one or more Rooms — each
 * room is a separately-authored `RoomDocument` (see `commands.ts`) —
 * into a single playable world. The map adds:
 *
 *   - per-instance `RoomInstance` placement (voxel-coord offset +
 *     quarter-turn yaw)
 *   - `SpawnPoint`s in continuous world coords for character spawns
 *   - `MapEnvironment` (sun + Sky + Stars + HDRI) for the scene's
 *     visual backdrop
 *
 * Runtime: `compileMap()` (studio-side) recompiles each referenced
 * RoomDocument, offsets cube positions by the RoomInstance position,
 * applies the quarter-turn rotation, namespaces ids, and emits a flat
 * `WorldObjects` the SDK store can broadcast.
 */

/**
 * One placement of a room in a map. Multiple `RoomInstance`s can
 * reference the same `roomName` so the same authored room can be
 * placed twice (e.g. mirrored east/west wings).
 *
 * `position` is in voxel coords, the unit room commands use.
 * `rotationY` is a quarter turn (0|1|2|3) about +Y around the room origin.
 */
export interface RoomInstance {
  id: string;
  roomName: string;
  position: [number, number, number];
  rotationY?: 0 | 1 | 2 | 3;
  /** Everyone inside this placed room shares one voice + screenshare call. */
  voiceZone?: boolean;
}

/**
 * A character spawn point in CONTINUOUS WORLD COORDS. Spawn points
 * are gameplay markers, not voxel structures, so they don't need to
 * snap to the cube grid — a designer can place a spawn between cubes
 * or above the floor as needed.
 */
export interface SpawnPoint {
  id: string;
  label?: string;
  position: [number, number, number];
}

/** Directional sun. Replaces the local Leva state today in
 * `renderer/panels/LightingPanel.ts` so the map persists the chosen
 * sun position rather than relying on per-mount defaults. */
export interface MapSunSettings {
  positionX: number;
  positionY: number;
  positionZ: number;
  color: string;
  intensity: number;
}

/** drei `<Sky>` shader settings (mapped 1:1 to its props). */
export interface MapSkySettings {
  enabled: boolean;
  turbidity: number;
  rayleigh: number;
  inclination: number;
  azimuth: number;
}

/** drei `<Stars>` particle-shader settings (mapped 1:1 to its props). */
export interface MapStarsSettings {
  enabled: boolean;
  radius: number;
  depth: number;
  count: number;
  factor: number;
  saturation: number;
  fade: boolean;
}

/** drei `<Environment>` HDRI settings. `url` is the only required
 * field; the rest match its props. */
export interface MapHdriSettings {
  url: string;
  intensity: number;
  background: boolean;
}

/** Full lighting / sky / stars / HDRI bag for one map. Any of `sky`,
 * `stars`, `hdri` may be null when disabled, so the on-disk shape is
 * explicit about "not configured" vs "configured but disabled". */
export interface MapEnvironment {
  sun: MapSunSettings;
  sky: MapSkySettings | null;
  stars: MapStarsSettings | null;
  hdri: MapHdriSettings | null;
  ambientIntensity: number;
}

export interface MapDocumentV1 {
  schemaVersion: 1;
  name: string;
  title?: string;
  updatedAt?: number;
  rooms: RoomInstance[];
  spawnPoints: SpawnPoint[];
  environment: MapEnvironment;
}

/** Same shape as v1, but a placement's position and rotation now apply to baked layouts too. */
export interface MapDocumentV2 extends Omit<MapDocumentV1, 'schemaVersion'> {
  schemaVersion: 2;
}

/** Any map version found on disk. */
export type SerializedMap = MapDocumentV1 | MapDocumentV2;

export const DEFAULT_MAP_ENVIRONMENT: MapEnvironment = {
  sun: { positionX: 20, positionY: 40, positionZ: 20, color: '#ffffff', intensity: 1.4 },
  sky: null,
  stars: null,
  hdri: null,
  ambientIntensity: 0.15,
};

export function emptyMapDocument(name: string, title?: string): MapDocumentV2 {
  return {
    schemaVersion: 2,
    name,
    title,
    updatedAt: Date.now(),
    rooms: [],
    spawnPoints: [],
    environment: { ...DEFAULT_MAP_ENVIRONMENT, sun: { ...DEFAULT_MAP_ENVIRONMENT.sun } },
  };
}
