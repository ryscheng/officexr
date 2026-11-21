import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const MONITOR_WIDTH_M = 0.56;
export const MONITOR_HEIGHT_M = 0.34;
const BEZEL_DEPTH_M = 0.03;
const NECK_HEIGHT_M = 0.18;
const SCREEN_INSET_M = 0.02;
const SCREEN_Z_M = BEZEL_DEPTH_M / 2 + 0.001;

const BODY_COLOR = '#1b1e24';
const SCREEN_OFF_COLOR = '#06080c';

function box(w: number, h: number, d: number, x: number, y: number, z: number): THREE.BufferGeometry {
  return new THREE.BoxGeometry(w, h, d).translate(x, y, z);
}

export function createMonitorBodyGeometry(): THREE.BufferGeometry {
  const merged = mergeGeometries([
    box(0.22, 0.015, 0.14, 0, 0.0075, 0),
    box(0.04, NECK_HEIGHT_M, 0.04, 0, NECK_HEIGHT_M / 2, 0),
    box(MONITOR_WIDTH_M, MONITOR_HEIGHT_M, BEZEL_DEPTH_M, 0, NECK_HEIGHT_M + MONITOR_HEIGHT_M / 2, 0),
  ]);
  if (!merged) throw new Error('desk monitor: body parts have mismatched attributes');
  return merged;
}

export function createMonitorScreenGeometry(): THREE.BufferGeometry {
  return new THREE.PlaneGeometry(MONITOR_WIDTH_M - 2 * SCREEN_INSET_M, MONITOR_HEIGHT_M - 2 * SCREEN_INSET_M).translate(
    0,
    NECK_HEIGHT_M + MONITOR_HEIGHT_M / 2,
    SCREEN_Z_M,
  );
}

export const MONITOR_LOCAL_BOUNDS = new THREE.Box3(
  new THREE.Vector3(-MONITOR_WIDTH_M / 2, 0, -0.07),
  new THREE.Vector3(MONITOR_WIDTH_M / 2, NECK_HEIGHT_M + MONITOR_HEIGHT_M, 0.07),
);

// Built from a DataTexture, not a canvas, so it also builds headless.
export function createDesktopTexture(): THREE.DataTexture {
  const w = 32;
  const h = 20;
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const t = y / (h - 1);
    for (let x = 0; x < w; x++) {
      const glow = 1 - Math.hypot(x / (w - 1) - 0.5, t - 0.4);
      const i = (y * w + x) * 4;
      data[i] = Math.round(70 + 90 * glow);
      data[i + 1] = Math.round(130 + 80 * glow);
      data[i + 2] = 255;
      data[i + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

export function createMonitorBodyMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color: BODY_COLOR, roughness: 0.6, metalness: 0.2, transparent: true });
}

export function createMonitorScreenMaterial(desktop: THREE.Texture): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: SCREEN_OFF_COLOR,
    roughness: 0.25,
    metalness: 0,
    emissive: '#ffffff',
    emissiveMap: desktop,
    emissiveIntensity: 0,
    transparent: true,
  });
}
