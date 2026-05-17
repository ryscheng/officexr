/**
 * Pure tiling state machine for the Room editor's Tile tool.
 *
 * SRP: this module owns the state shape and pure transition rules.
 * SceneEditorCanvas (the React/R3F component) owns event handling,
 * rendering, and the useState that holds TileMachineState.
 *
 * OCP: new tiling behaviors (e.g. diagonal axes) can be added here
 * without modifying SceneEditorCanvas.
 */

type Vec3 = [number, number, number];

/** One of the three axis identifiers for tiling. */
export type TileAxis = 'x' | 'y' | 'z';

/** Axes the current kind can tile on, ordered canonically X→Y→Z. */
export function resolveAvailableAxes(
  tilingAxes: { x: boolean; y: boolean; z: boolean },
): TileAxis[] {
  const axes: TileAxis[] = [];
  if (tilingAxes.x) axes.push('x');
  if (tilingAxes.y) axes.push('y');
  if (tilingAxes.z) axes.push('z');
  return axes;
}

/**
 * The generalized tile state machine state.
 *
 * Replaces the hardcoded `TileState` union in SceneEditorCanvas.
 * The axis sequence is dynamic and driven by `kind.tilingAxes`.
 */
export type TileMachineState =
  | { stage: 'idle' }
  | {
      stage: 'placed';
      origin: Vec3;
      kindId: string;
      originCommandId: string;
      /** Axes not yet consumed (first = nextAxis). */
      remainingAxes: TileAxis[];
      /** The axis the next extrusion will use. */
      nextAxis: TileAxis;
    }
  | {
      stage: 'axis-extruded';
      consumedAxis: TileAxis;
      origin: Vec3;
      kindId: string;
      groupId: string;
      /** The row/slab committed so far (not including origin). */
      extrudedRow: readonly Vec3[];
      /** Axes not yet consumed. */
      remainingAxes: TileAxis[];
      /** Next axis, or null when no more axes remain. */
      nextAxis: TileAxis | null;
    };

/**
 * Compute the ghost voxels for the current state + cursor position.
 *
 * Pure — no React, no THREE, no side effects.
 *
 * SRP violation note: Y-axis delta computation (PIXELS_PER_VOXEL screen
 * mapping) stays in SceneEditorCanvas because it requires R3F's camera
 * projection. For Y-axis ghosts in `placed` stage, pass the pre-computed
 * hover voxel (including Y) as `hoverVoxel`. The tileStep.y parameter
 * is used for step-snapping the Y extent.
 *
 * @param state - Current tile machine state.
 * @param hoverVoxel - The cursor's snapped voxel (or null if no hit).
 * @param tileStep - Per-axis tile step derived from bounding dims.
 * @returns Array of voxels to show as ghosts (excludes the origin,
 *   which is already a real placed cube).
 */
export function computeTileGhosts(
  state: TileMachineState,
  hoverVoxel: Vec3 | null,
  tileStep: { x: number; y: number; z: number },
): Vec3[] {
  if (state.stage === 'idle') {
    return hoverVoxel ? [hoverVoxel] : [];
  }

  if (state.stage === 'placed') {
    if (!hoverVoxel) return [];
    const { origin, nextAxis } = state;
    return extrudeAlongAxis(origin, hoverVoxel, nextAxis, tileStep);
  }

  if (state.stage === 'axis-extruded') {
    if (!hoverVoxel || state.nextAxis === null) return [];
    // Replicate the accumulated row/grid (origin + extrudedRow) along nextAxis
    const fullBase: Vec3[] = [state.origin, ...state.extrudedRow];
    return replicateAlongAxis(fullBase, state.origin, hoverVoxel, state.nextAxis, tileStep);
  }

  return [];
}

/**
 * Generate ghost voxels extending from `origin` toward `hover`
 * along the specified axis, stepping by `tileStep[axis]`.
 * Excludes the origin itself (it's already placed).
 */
function extrudeAlongAxis(
  origin: Vec3,
  hover: Vec3,
  axis: TileAxis,
  tileStep: { x: number; y: number; z: number },
): Vec3[] {
  const axisIndex = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
  const step = axis === 'x' ? tileStep.x : axis === 'y' ? tileStep.y : tileStep.z;
  const delta = hover[axisIndex] - origin[axisIndex];
  if (delta === 0) return [];
  const sign = Math.sign(delta);
  const steps = Math.round(Math.abs(delta) / step);
  if (steps === 0) return [];

  const out: Vec3[] = [];
  for (let i = 1; i <= steps; i++) {
    const v: Vec3 = [origin[0], origin[1], origin[2]];
    v[axisIndex] = origin[axisIndex] + sign * i * step;
    out.push(v);
  }
  return out;
}

/**
 * Replicate `base` voxels along `axis`, from 1 step to N steps
 * toward `hover`. The step count is computed from the hover delta
 * relative to `refPoint` (typically the origin).
 */
function replicateAlongAxis(
  base: readonly Vec3[],
  refPoint: Vec3,
  hover: Vec3,
  axis: TileAxis,
  tileStep: { x: number; y: number; z: number },
): Vec3[] {
  const axisIndex = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
  const step = axis === 'x' ? tileStep.x : axis === 'y' ? tileStep.y : tileStep.z;
  const delta = hover[axisIndex] - refPoint[axisIndex];
  if (delta === 0) return [];
  const sign = Math.sign(delta);
  const steps = Math.round(Math.abs(delta) / step);
  if (steps === 0) return [];

  const out: Vec3[] = [];
  for (let i = 1; i <= steps; i++) {
    for (const p of base) {
      const v: Vec3 = [p[0], p[1], p[2]];
      v[axisIndex] = p[axisIndex] + sign * i * step;
      out.push(v);
    }
  }
  return out;
}

/**
 * Switch the next extrusion axis to `axis` if it is in `remainingAxes`.
 * Returns the state unchanged (same reference) if the axis is not available
 * or if the state is `idle`.
 */
export function switchNextAxis(
  state: TileMachineState,
  axis: TileAxis,
): TileMachineState {
  if (state.stage === 'idle') return state;

  if (state.stage === 'placed') {
    if (!state.remainingAxes.includes(axis)) return state;
    return { ...state, nextAxis: axis };
  }

  if (state.stage === 'axis-extruded') {
    if (state.nextAxis === null) return state;
    if (!state.remainingAxes.includes(axis)) return state;
    return { ...state, nextAxis: axis };
  }

  return state;
}
