/**
 * Application Layer — the programmatic interface that both the UI
 * (React components) and the headless test runners consume.
 *
 * Three layers in this codebase:
 *   1. Application Layer (THIS FILE + ./catalog-service, ./geometry-service,
 *      ./room-service, ./bake-service, ./scene-service). Pure TypeScript.
 *      No React, no THREE, no DOM globals. Dependencies are injected via
 *      constructors / factory functions.
 *   2. UI Layer (React components in studio/ + renderer/). Reads from
 *      the application layer via the `ApplicationProvider` /
 *      `useApplication` React context.
 *   3. World Rendering Layer (renderer/ + R3F components). Receives data
 *      via props or hooks; never imports module-globals.
 *
 * SOLID note (DIP): every dependency in this file is an interface, not a
 * concrete class or module-global. Tests construct mocks by implementing
 * these interfaces. The default implementations live alongside in this
 * folder and are wired together by `createDefaultApi`.
 */

import type { RoomDocument } from '../scenes/commands.ts';
import type { MapDocumentV1 } from '../scenes/map-document.ts';
import type {
  WorldObjectKind,
  WorldObjectKindCatalogV1,
} from '../scenes/world-object-kinds-schema.ts';
import type { ObjectInstance, WorldObjects } from '@officexr/sdk';

export type Vec3 = readonly [number, number, number];

export interface WorldAABB {
  readonly min: Vec3;
  readonly max: Vec3;
}

/** Voxel-grid bounding box. `max` is exclusive (standard half-open range). */
export interface VoxelFootprint {
  readonly min: Vec3;
  readonly max: Vec3;
}

export interface KindDimensions {
  readonly width: number;
  readonly height: number;
  readonly depth: number;
}

// ---------------------------------------------------------------------------
// CatalogService
// ---------------------------------------------------------------------------

/**
 * Owns the in-memory `WorldObjectKindCatalogV1`. Fetches from the
 * configured API path on construction (lazy), notifies subscribers when
 * the catalog changes, and supports per-kind patches that the Object
 * editor uses for live edits.
 */
export interface CatalogService {
  getCatalog(): WorldObjectKindCatalogV1;
  getKind(id: string): WorldObjectKind | undefined;
  listKinds(): readonly WorldObjectKind[];
  /** Replace the entire catalog. Used by the bootstrap fetch result and by
   * the Object editor's "reset to default." Fires all subscribers. */
  replaceCatalog(next: WorldObjectKindCatalogV1): void;
  /** Patch a single kind. Returns the new catalog so callers can persist it. */
  patchKind(id: string, partial: Partial<WorldObjectKind>): WorldObjectKindCatalogV1;
  /** Subscribe to catalog changes. Returns an unsubscribe function. */
  subscribe(listener: () => void): () => void;
  /** Resolves once the upstream fetch has completed (success OR fallback). */
  ready(): Promise<void>;
}

// ---------------------------------------------------------------------------
// InstanceGeometryService — the single source of truth for "where in space?"
// ---------------------------------------------------------------------------

/**
 * Canonical mapping from an `ObjectInstance` to its world-space geometry.
 *
 * Every consumer (renderer, colliders, selection outline, occupancy,
 * snap, drop-to-surface) MUST derive their geometry from here. No
 * ad-hoc per-axis math elsewhere.
 *
 * Conventions baked into the default implementation:
 *   - `position[i]` is an integer voxel anchor.
 *   - **X / Z**: the AABB is *centered* on `position * voxelSize`.
 *     (GLTF meshes for KayKit kinds have a bottom-center origin, so
 *     the renderer's translation is exactly `(cx, by, cz)`.)
 *   - **Y**: the *bottom* of the AABB sits at `position[1] * voxelSize`.
 *     Floor convention. No `+ voxelSize / 2` legacy offset.
 *   - When `kind.dimensions` is undefined, fall back to a one-voxel cube
 *     (`{width: vs, height: vs, depth: vs}`). One canonical fallback.
 */
export interface InstanceGeometryService {
  readonly voxelSize: number;
  /** AABB of the instance. */
  worldAABB(position: Vec3, kindId: string): WorldAABB;
  /** Convenience: same as `worldAABB(inst.position, inst.kindId)`. */
  worldAABBOfInstance(instance: ObjectInstance): WorldAABB;
  /** Translation to apply to the GLTF mesh root so it lands in the AABB.
   * For bottom-center-origin meshes, equals `(cx, aabb.min.y, cz)`. */
  meshOrigin(position: Vec3, kindId: string): Vec3;
  /** Integer voxel-grid footprint. `max` is exclusive. Used by occupancy. */
  voxelFootprint(position: Vec3, kindId: string): VoxelFootprint;
  /** Per-axis voxel tile step for extrude / tile-tool stepping. */
  tileStep(kindId: string): Vec3;
}

// ---------------------------------------------------------------------------
// RoomService
// ---------------------------------------------------------------------------

/**
 * Wraps `compileScene` / `compileMap` with the canonical geometry-derived
 * tile step. Pure functions; no internal state.
 */
export interface RoomService {
  compileScene(doc: RoomDocument): WorldObjects;
  compileMap(map: MapDocumentV1, rooms: ReadonlyMap<string, RoomDocument>): WorldObjects;
}

// ---------------------------------------------------------------------------
// BakeService
// ---------------------------------------------------------------------------

/**
 * Measures a kind's bounding-box dimensions from its GLTF AABB. Used by
 * both the live "Recompute from GLTF" button AND the headless bake runner
 * so there is exactly ONE measurement code path.
 */
export interface KindLocalAABB {
  readonly min: Readonly<{ x: number; y: number; z: number }>;
  readonly max: Readonly<{ x: number; y: number; z: number }>;
}

/** Combined per-kind measurement: extents (back-compat) PLUS the
 * local-coord AABB (so the geometry service can translate the GLTF's
 * varying origin convention to a uniform anchor-lower-left world AABB). */
export interface KindMeasurement {
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly localAABB: KindLocalAABB;
}

export interface BakeService {
  measureKind(id: string): Promise<KindDimensions>;
  /** Returns the FULL local-coordinate AABB of the GLTF (post-scale).
   * Used to verify the GLTF origin convention (bottom-center vs
   * bottom-corner) so the renderer / wireframe coordinate convention
   * matches what's actually drawn. */
  measureKindLocalAABB(id: string): Promise<KindLocalAABB>;
  /** Measure one kind, returning both extents and local AABB in one
   * GLTF load. Used by the catalog bake to populate `kind.dimensions`
   * + `kind.localAABB` together. */
  measureKindFull(id: string): Promise<KindMeasurement>;
  /** Measure all non-character kinds, returning the FULL measurement
   * (extents + local AABB). Returns a Map keyed by kind id; kinds
   * that fail to load resolve as `null`. */
  measureAll(): Promise<Map<string, KindMeasurement | null>>;
}

// ---------------------------------------------------------------------------
// SceneService
// ---------------------------------------------------------------------------

export interface CameraPose {
  readonly target: Vec3;
  /** Spherical orbit coords (radians for azimuth/elevation; metres for distance). */
  readonly azimuth: number;
  readonly elevation: number;
  readonly distance: number;
}

export interface ProgrammaticScene {
  readonly id: string;
  readonly instances: readonly ObjectInstance[];
  readonly camera: CameraPose;
  /** Source-command ids that should be marked as selected — drives the
   * selection wireframe in visual regression tests. */
  readonly selection: ReadonlySet<string>;
}

/**
 * Static lookup of named scenes used by visual regression tests. Pure;
 * no state. Lives in the application layer so the headless harness and
 * future automated tooling can render the exact same scenes.
 */
export interface SceneService {
  list(): readonly string[];
  load(id: string): ProgrammaticScene;
}

// ---------------------------------------------------------------------------
// ApplicationApi — the umbrella the UI + headless layers consume
// ---------------------------------------------------------------------------

export interface ApplicationApi {
  readonly voxelSize: number;
  readonly catalog: CatalogService;
  readonly geometry: InstanceGeometryService;
  readonly rooms: RoomService;
  readonly bake: BakeService;
  readonly scenes: SceneService;
}
