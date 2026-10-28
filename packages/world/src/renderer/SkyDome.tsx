import React, { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';

/** The sun as the sky draws it: the same direction the directional light shines from. */
export interface SkySun {
  /** Offset of the sun from the player, as in `LightingViewConfig.sunPosition`. */
  position: readonly [number, number, number];
  color: string;
  /** Radius of the disc at `position`'s distance, so the disc keeps the size
   * the old emissive sphere had. */
  discRadius: number;
  /** Scales the corona and glow around the disc; 0 leaves the bare disc. */
  glow: number;
}

/**
 * Unit direction towards the sun and the disc's angular radius in radians.
 * A sun offset of zero length (no meaningful direction) points straight up.
 */
export function sunSkyParams(position: readonly [number, number, number], discRadius: number) {
  const dir = new THREE.Vector3(...position);
  const distance = dir.length();
  if (distance === 0) {
    return { direction: new THREE.Vector3(0, 1, 0), angularRadius: Math.atan(discRadius) };
  }
  return { direction: dir.divideScalar(distance), angularRadius: Math.atan(discRadius / distance) };
}

/** Where the two-stop gradient (no horizon colour) sits at the horizon: smoothstep(-0.2, 1, 0). */
const TWO_STOP_HORIZON_T = 0.0741;

/** The horizon colour: the configured one, else the colour the two-stop gradient has there. */
export function resolveHorizonColor(topColor: string, bottomColor: string, horizonColor?: string) {
  return horizonColor
    ? new THREE.Color(horizonColor)
    : new THREE.Color(bottomColor).lerp(new THREE.Color(topColor), TWO_STOP_HORIZON_T);
}

const vertexShader = /* glsl */ `
  varying vec3 vDir;
  void main() {
    // The dome is re-centred on the camera every frame, so the vertex's
    // object-space position is the view direction.
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  precision highp float;
  uniform vec3 uTop;
  uniform vec3 uHorizon;
  uniform vec3 uBottom;
  uniform bool uHasHorizon;
  uniform bool uShowSun;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform float uSunRadius;
  uniform float uSunGlow;
  varying vec3 vDir;

  void main() {
    vec3 dir = normalize(vDir);
    float y = dir.y;
    vec3 col;
    if (!uHasHorizon) {
      // The original two-stop gradient, kept exact so skies tuned before
      // the horizon colour existed look the same.
      col = mix(uBottom, uTop, smoothstep(-0.2, 1.0, y));
    } else if (y >= 0.0) {
      col = mix(uHorizon, uTop, pow(smoothstep(0.0, 1.0, y), 0.6));
    } else {
      col = mix(uHorizon, uBottom, smoothstep(0.0, 0.35, -y));
    }

    if (uShowSun) {
      float angle = acos(clamp(dot(dir, uSunDir), -1.0, 1.0));
      float x = angle / uSunRadius;

      // Sunrise wash along the horizon on the sun's side of the sky.
      vec2 dirXZ = dir.xz;
      vec2 sunXZ = uSunDir.xz;
      if (dot(dirXZ, dirXZ) > 1e-6 && dot(sunXZ, sunXZ) > 1e-6) {
        float facing = max(dot(normalize(dirXZ), normalize(sunXZ)), 0.0);
        col += uSunColor * 0.18 * uSunGlow * pow(facing, 4.0) * pow(1.0 - abs(y), 8.0);
      }

      // Wide atmospheric glow, then a bright corona hugging the disc,
      // whitened towards the core the way an overexposed sun looks.
      vec3 warm = mix(uSunColor, vec3(1.0), 0.5);
      float outside = max(x - 1.0, 0.0);
      col += uSunColor * uSunGlow * (0.06 * exp(-x / 12.0) + 0.12 * exp(-x / 3.0));
      col += warm * uSunGlow * 0.45 * exp(-outside * 2.8);

      // The disc: white-hot and the brightest thing in the sky, with an
      // edge that blooms into the corona rather than a hard outline.
      float core = 1.0 - smoothstep(0.8, 1.1, x);
      col = mix(col, vec3(1.0, 0.995, 0.97), core);
    }

    // No colour-space conversion: the gradient has always written its
    // linear colours straight out, and existing skies are tuned to that.
    gl_FragColor = vec4(min(col, vec3(1.0)), 1.0);
  }
`;

/**
 * The scene's sky: a vertical gradient (top, optional horizon, bottom) on a
 * huge inverted sphere that follows the camera, with an optional sun drawn
 * into the shader. `depthWrite={false}` plus `renderOrder=-1` keep it behind
 * everything else.
 */
export function SkyDome({
  topColor,
  horizonColor,
  bottomColor,
  sun,
  radius = 1500,
}: {
  topColor: string;
  horizonColor?: string;
  bottomColor: string;
  /** `null` draws no sun. */
  sun: SkySun | null;
  radius?: number;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const uniforms = useMemo(
    () => ({
      uTop: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uBottom: { value: new THREE.Color() },
      uHasHorizon: { value: false },
      uShowSun: { value: false },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color() },
      uSunRadius: { value: 0.05 },
      uSunGlow: { value: 1 },
    }),
    [],
  );

  // Mutate the existing uniforms so changes never recompile the material.
  uniforms.uTop.value.set(topColor);
  uniforms.uHorizon.value.copy(resolveHorizonColor(topColor, bottomColor, horizonColor));
  uniforms.uBottom.value.set(bottomColor);
  uniforms.uHasHorizon.value = horizonColor !== undefined;
  uniforms.uShowSun.value = sun !== null;
  if (sun) {
    const { direction, angularRadius } = sunSkyParams(sun.position, sun.discRadius);
    uniforms.uSunDir.value.copy(direction);
    uniforms.uSunColor.value.set(sun.color);
    uniforms.uSunRadius.value = angularRadius;
    uniforms.uSunGlow.value = sun.glow;
  }

  useFrame(({ camera }) => {
    meshRef.current?.position.copy(camera.position);
  });

  return (
    <mesh ref={meshRef} renderOrder={-1} frustumCulled={false}>
      <sphereGeometry args={[radius, 64, 32]} />
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
