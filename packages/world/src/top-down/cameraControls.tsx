import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react';
import {
  INITIAL_CAMERA,
  ZOOM_STEP,
  clampToBounds,
  followStep,
  panBy,
  zoomBy,
  type CameraState,
  type ZoomLimits,
} from './topDownCamera.ts';
import type { ScreenPoint, XZ, XZBounds } from './topDownGeometry.ts';

type Size = { width: number; height: number };

/** What the HUD shows about the 2D camera: whether each button does anything. */
export interface CameraSnapshot {
  canZoomIn: boolean;
  canZoomOut: boolean;
  following: boolean;
}

/** The 2D camera as HUD buttons drive it. */
export interface CameraControls {
  zoomIn(): void;
  zoomOut(): void;
  /** Centres on you again and follows you. */
  recentre(): void;
  getSnapshot(): CameraSnapshot;
  subscribe(cb: () => void): () => void;
}

/**
 * Owns the 2D view's camera. The draw loop reads and writes `state` every frame; the HUD
 * hears about it only when a snapshot field flips, so a smooth follow re-renders nothing.
 */
export class TopDownCameraController implements CameraControls {
  private cam: CameraState = INITIAL_CAMERA;
  /** False until the first `track`, which jumps to you instead of gliding in from the origin. */
  private placed = false;
  private limits: ZoomLimits = { min: INITIAL_CAMERA.zoom, max: INITIAL_CAMERA.zoom };
  private size: Size = { width: 1, height: 1 };
  private snapshot: CameraSnapshot = { canZoomIn: false, canZoomOut: false, following: true };
  private readonly listeners = new Set<() => void>();

  get state(): CameraState {
    return this.cam;
  }

  set state(next: CameraState) {
    this.cam = next;
    this.publish();
  }

  /** Called each frame with the canvas size and the zoom range it allows; re-clamps the zoom. */
  setViewport(limits: ZoomLimits, size: Size): void {
    this.limits = limits;
    this.size = size;
    const zoom = Math.min(Math.max(this.cam.zoom, limits.min), limits.max);
    this.state = zoom === this.cam.zoom ? this.cam : { ...this.cam, zoom };
  }

  /** Follows `target` (you) for one frame; the first call centres on it at once. */
  track(target: XZ, dtSec: number): void {
    if (!this.placed) {
      this.placed = true;
      this.state = { ...this.cam, centre: { x: target.x, z: target.z } };
      return;
    }
    this.state = followStep(this.cam, target, dtSec);
  }

  /** Drags the view by a screen delta, kept over `bounds`; stops following. */
  pan(dx: number, dy: number, bounds: XZBounds | null): void {
    this.state = clampToBounds(panBy(this.cam, dx, dy), bounds);
  }

  /** Zooms by `factor`, about `anchor` when the camera is free. */
  zoom(factor: number, anchor?: ScreenPoint): void {
    this.state = zoomBy(this.cam, factor, this.limits, this.size, anchor);
  }

  zoomIn(): void {
    this.zoom(ZOOM_STEP);
  }

  zoomOut(): void {
    this.zoom(1 / ZOOM_STEP);
  }

  recentre(): void {
    if (!this.cam.following) {
      this.state = { ...this.cam, following: true };
    }
  }

  getSnapshot = (): CameraSnapshot => this.snapshot;

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => void this.listeners.delete(cb);
  };

  private publish(): void {
    // A hair of tolerance so a zoom clamped to the limit reads as "at the limit".
    const next: CameraSnapshot = {
      canZoomIn: this.cam.zoom < this.limits.max - 1e-6,
      canZoomOut: this.cam.zoom > this.limits.min + 1e-6,
      following: this.cam.following,
    };
    const prev = this.snapshot;
    if (next.canZoomIn !== prev.canZoomIn || next.canZoomOut !== prev.canZoomOut || next.following !== prev.following) {
      this.snapshot = next;
      this.listeners.forEach((cb) => cb());
    }
  }
}

const CameraControlsContext = createContext<CameraControls | null>(null);

export function CameraControlsProvider(props: { controls: CameraControls; children?: ReactNode }) {
  return <CameraControlsContext.Provider value={props.controls}>{props.children}</CameraControlsContext.Provider>;
}

const NO_SUBSCRIBE = (): (() => void) => () => {};
const NO_SNAPSHOT = (): CameraSnapshot | null => null;

/**
 * The 2D camera's controls and current snapshot, or null outside the 2D view (the 3D view
 * provides none), so a HUD shared by both views can render zoom buttons conditionally.
 */
export function useCameraControls(): { controls: CameraControls; snapshot: CameraSnapshot } | null {
  const controls = useContext<CameraControls | null>(CameraControlsContext);
  const snapshot = useSyncExternalStore<CameraSnapshot | null>(controls?.subscribe ?? NO_SUBSCRIBE, controls?.getSnapshot ?? NO_SNAPSHOT);
  return controls && snapshot ? { controls, snapshot } : null;
}
