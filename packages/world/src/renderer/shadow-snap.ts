import * as THREE from 'three';

export interface LightBasis {
  right: THREE.Vector3;
  up: THREE.Vector3;
  back: THREE.Vector3;
}

const ORIGIN = new THREE.Vector3();

/** Axes of the directional shadow camera, oriented as `DirectionalLightShadow.updateMatrices` does (lookAt with default up). */
export function lightBasis(sunOffset: readonly [number, number, number]): LightBasis {
  const m = new THREE.Matrix4().lookAt(
    new THREE.Vector3(...sunOffset),
    ORIGIN,
    THREE.Object3D.DEFAULT_UP,
  );
  const right = new THREE.Vector3();
  const up = new THREE.Vector3();
  const back = new THREE.Vector3();
  m.extractBasis(right, up, back);
  return { right, up, back };
}

/** Quantises `point` to whole shadow-map texels along the light's right/up axes; the depth component is unchanged. Writes into and returns `out`. */
export function snapToShadowTexel(
  point: THREE.Vector3,
  basis: LightBasis,
  texelSize: number,
  out: THREE.Vector3,
): THREE.Vector3 {
  const r = Math.round(point.dot(basis.right) / texelSize) * texelSize;
  const u = Math.round(point.dot(basis.up) / texelSize) * texelSize;
  const d = point.dot(basis.back);
  return out
    .set(0, 0, 0)
    .addScaledVector(basis.right, r)
    .addScaledVector(basis.up, u)
    .addScaledVector(basis.back, d);
}
