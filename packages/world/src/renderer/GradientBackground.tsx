import React, { useMemo } from 'react';
import * as THREE from 'three';

/**
 * Renders a vertical gradient between two colours as the scene's
 * background. Implemented as a huge inverted sphere (radius ~1500,
 * inside the camera's `far` of 2000) drawn with a tiny custom shader
 * that interpolates between `bottomColor` and `topColor` based on the
 * fragment's normalised Y direction. `depthWrite={false}` plus
 * `renderOrder=-1` keeps it strictly behind everything else without
 * messing with the depth buffer for the regular scene.
 *
 * Use it instead of `drei/Sky` when you want something darker / more
 * stylised — e.g. a space-like background — without paying for the
 * full atmospheric-scattering shader.
 */
export function GradientBackground({
  topColor,
  bottomColor,
  radius = 1500,
}: {
  topColor: string;
  bottomColor: string;
  radius?: number;
}) {
  const uniforms = useMemo(
    () => ({
      uTop: { value: new THREE.Color(topColor) },
      uBottom: { value: new THREE.Color(bottomColor) },
    }),
    // Colours are mutated below via setHex without re-creating the
    // uniforms object so the shader sees fresh values without a
    // material recompile.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Push the latest Leva colours into the existing uniforms each render.
  uniforms.uTop.value.set(topColor);
  uniforms.uBottom.value.set(bottomColor);

  const vertexShader = /* glsl */ `
    varying vec3 vWorldDir;
    void main() {
      // The inverted sphere is centred on the world origin (it's huge
      // enough that small camera offsets don't matter), so the vertex
      // position itself, normalised, is the view-direction.
      vWorldDir = normalize(position);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `;
  const fragmentShader = /* glsl */ `
    precision mediump float;
    uniform vec3 uTop;
    uniform vec3 uBottom;
    varying vec3 vWorldDir;
    void main() {
      // y goes from -1 (straight down) to +1 (straight up). Remap to 0..1
      // so smoothstep gives a slight roll-off at the horizon.
      float t = smoothstep(-0.2, 1.0, vWorldDir.y);
      vec3 col = mix(uBottom, uTop, t);
      gl_FragColor = vec4(col, 1.0);
    }
  `;

  return (
    <mesh renderOrder={-1} frustumCulled={false}>
      <sphereGeometry args={[radius, 32, 16]} />
      <shaderMaterial
        side={THREE.BackSide}
        depthWrite={false}
        depthTest={false}
        uniforms={uniforms}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
      />
    </mesh>
  );
}
