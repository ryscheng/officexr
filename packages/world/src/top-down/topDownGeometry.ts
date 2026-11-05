export interface XZ {
  x: number;
  z: number;
}

export interface XZBounds {
  min: XZ;
  max: XZ;
}

export interface ScreenPoint {
  x: number;
  y: number;
}

/** World X maps to screen right and world -Z to screen up, matching `GHOST_FORWARD`. */
export interface TopDownTransform {
  scale: number;
  offsetX: number;
  offsetY: number;
}

const FIT_PADDING_PX = 24;

/** Scales and centres `bounds` to fit inside `size`, keeping the aspect ratio. */
export function fitTransform(
  bounds: XZBounds,
  size: { width: number; height: number },
  padding = FIT_PADDING_PX,
): TopDownTransform {
  const w = Math.max(bounds.max.x - bounds.min.x, 1e-6);
  const h = Math.max(bounds.max.z - bounds.min.z, 1e-6);
  const scale = Math.max(
    Math.min((size.width - 2 * padding) / w, (size.height - 2 * padding) / h),
    1e-6,
  );
  return {
    scale,
    offsetX: size.width / 2 - ((bounds.min.x + bounds.max.x) / 2) * scale,
    offsetY: size.height / 2 - ((bounds.min.z + bounds.max.z) / 2) * scale,
  };
}

export function worldToScreen(t: TopDownTransform, p: XZ): ScreenPoint {
  return { x: p.x * t.scale + t.offsetX, y: p.z * t.scale + t.offsetY };
}

export function screenToWorld(t: TopDownTransform, s: ScreenPoint): XZ {
  return { x: (s.x - t.offsetX) / t.scale, z: (s.y - t.offsetY) / t.scale };
}

/** The union of `rects`, or null when there are none. */
export function unionBounds(rects: readonly XZBounds[]): XZBounds | null {
  if (rects.length === 0) {
    return null;
  }
  return {
    min: { x: Math.min(...rects.map((r) => r.min.x)), z: Math.min(...rects.map((r) => r.min.z)) },
    max: { x: Math.max(...rects.map((r) => r.max.x)), z: Math.max(...rects.map((r) => r.max.z)) },
  };
}
