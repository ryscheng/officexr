import { useMemo } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import type { Store } from '@officexr/sdk';
import type { WaterVolume } from '../motion/water.ts';
import { useWaterVolumes } from './useWaterVolumes.ts';

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vWorld;
  uniform float uTime;
  void main() {
    vUv = uv;
    vec3 p = position;
    p.z += sin(p.x * 3.1 + uTime * 1.7) * 0.008 + cos(p.y * 2.7 + uTime * 1.3) * 0.008;
    vec4 world = modelMatrix * vec4(p, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const fragmentShader = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  varying vec3 vWorld;
  uniform float uTime;
  void main() {
    float ripple = sin(vWorld.x * 5.0 + uTime * 1.9) * sin(vWorld.z * 5.0 - uTime * 1.5);
    float glint = smoothstep(0.82, 1.0, ripple);
    vec3 shallow = vec3(0.30, 0.80, 0.88);
    vec3 deep = vec3(0.10, 0.55, 0.74);
    float edge = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y));
    vec3 colour = mix(shallow, deep, smoothstep(0.0, 0.35, edge));
    colour += glint * 0.35 + ripple * 0.03;
    float foam = 1.0 - smoothstep(0.0, 0.035, edge);
    colour = mix(colour, vec3(0.95, 1.0, 1.0), foam * 0.6);
    gl_FragColor = vec4(colour, 0.78);
  }
`;

function Water({ volume, uniforms }: { volume: WaterVolume; uniforms: { uTime: { value: number } } }) {
  const width = volume.maxX - volume.minX;
  const depth = volume.maxZ - volume.minZ;
  return (
    <mesh
      position={[(volume.minX + volume.maxX) / 2, volume.surfaceY, (volume.minZ + volume.maxZ) / 2]}
      rotation={[-Math.PI / 2, 0, 0]}
      renderOrder={2}
    >
      <planeGeometry args={[width, depth, 24, 24]} />
      <shaderMaterial
        transparent
        depthWrite={false}
        side={THREE.DoubleSide}
        uniforms={uniforms}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
      />
    </mesh>
  );
}

export function WaterVolumes({ store }: { store: Store }) {
  const volumes = useWaterVolumes(store);
  const uniforms = useMemo(() => ({ uTime: { value: 0 } }), []);
  useFrame((_, dt) => {
    uniforms.uTime.value += dt;
  });
  return (
    <>
      {volumes.map((v) => (
        <Water key={v.id} volume={v} uniforms={uniforms} />
      ))}
    </>
  );
}
