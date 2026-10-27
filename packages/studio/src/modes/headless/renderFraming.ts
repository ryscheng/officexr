import type { CameraSpec, Vec3 } from './renderParams.ts';

export interface Bounds {
  readonly min: Vec3;
  readonly max: Vec3;
}

export interface FrameSize {
  width: number;
  height: number;
}

export type CameraSetup =
  | {
      type: 'orthographic';
      position: Vec3;
      target: Vec3;
      up: Vec3;
      /** Pixels per metre (R3F sizes the ortho frustum as pixels / zoom). */
      zoom: number;
      near: number;
      far: number;
      metresPerPixel: number;
    }
  | { type: 'perspective'; position: Vec3; target: Vec3; fov: number; near: number; far: number };

const TOP_MARGIN_M = 1;
const TOP_HEIGHT_ABOVE_M = 10;
const ISO_AZIMUTH = Math.PI / 4;
const ISO_ELEVATION = (35 * Math.PI) / 180;
const ISO_MARGIN = 1.1;
const FOV_DEG = 45;
const CUSTOM_NEAR = 0.1;
const CUSTOM_FAR = 2000;

/** Union of per-item AABBs; null when there are none. */
export function unionBounds<T>(items: readonly T[], aabbOf: (item: T) => Bounds): Bounds | null {
  let acc: Bounds | null = null;
  for (const item of items) {
    const box = aabbOf(item);
    acc = acc
      ? {
          min: [Math.min(acc.min[0], box.min[0]), Math.min(acc.min[1], box.min[1]), Math.min(acc.min[2], box.min[2])],
          max: [Math.max(acc.max[0], box.max[0]), Math.max(acc.max[1], box.max[1]), Math.max(acc.max[2], box.max[2])],
        }
      : { min: [...box.min], max: [...box.max] };
  }
  return acc;
}

export function boundsCentre(b: Bounds): Vec3 {
  return [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
}

/** Camera for `spec` that frames `bounds` in a `size` pixel canvas. */
export function frameCamera(spec: CameraSpec, bounds: Bounds, size: FrameSize): CameraSetup {
  const centre = boundsCentre(bounds);
  if (spec.type === 'top') {
    const extentX = bounds.max[0] - bounds.min[0] + 2 * TOP_MARGIN_M;
    const extentZ = bounds.max[2] - bounds.min[2] + 2 * TOP_MARGIN_M;
    const zoom = Math.min(size.width / extentX, size.height / extentZ);
    // The 1 m grid sits at y=0, so the frustum has to reach it even when the scene floats above.
    const eyeY = Math.max(bounds.max[1], 0) + TOP_HEIGHT_ABOVE_M;
    return {
      type: 'orthographic',
      position: [centre[0], eyeY, centre[2]],
      target: [centre[0], 0, centre[2]],
      // -Z is the top of the image, as on a map.
      up: [0, 0, -1],
      zoom,
      near: 0.1,
      far: eyeY - Math.min(bounds.min[1], 0) + TOP_HEIGHT_ABOVE_M,
      metresPerPixel: 1 / zoom,
    };
  }
  if (spec.type === 'iso') {
    const radius =
      Math.hypot(
        bounds.max[0] - bounds.min[0],
        bounds.max[1] - bounds.min[1],
        bounds.max[2] - bounds.min[2],
      ) / 2;
    const vfov = (FOV_DEG * Math.PI) / 180;
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * (size.width / size.height));
    const distance = (ISO_MARGIN * radius) / Math.sin(Math.min(vfov, hfov) / 2);
    const cosEl = Math.cos(ISO_ELEVATION);
    return {
      type: 'perspective',
      position: [
        centre[0] + distance * cosEl * Math.sin(ISO_AZIMUTH),
        centre[1] + distance * Math.sin(ISO_ELEVATION),
        centre[2] + distance * cosEl * Math.cos(ISO_AZIMUTH),
      ],
      target: centre,
      fov: FOV_DEG,
      near: Math.max(0.1, distance - 2 * radius),
      far: distance + 2 * radius + 100,
    };
  }
  return {
    type: 'perspective',
    position: spec.position,
    target: spec.target ?? centre,
    fov: FOV_DEG,
    near: CUSTOM_NEAR,
    far: CUSTOM_FAR,
  };
}
