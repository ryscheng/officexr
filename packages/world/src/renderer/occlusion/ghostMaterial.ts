import * as THREE from 'three';

const FADE_VARYING = 'vOcclusionFade';

// No depth write, so the player behind a faded instance stays visible; opacity per instance comes from instanceColor.x.
export function createInstancedGhostMaterial(base: THREE.Material): THREE.Material {
  const ghost = base.clone();
  ghost.transparent = true;
  ghost.depthWrite = false;
  ghost.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nvarying float ${FADE_VARYING};`)
      .replace(
        '#include <color_vertex>',
        THREE.ShaderChunk.color_vertex.replace('vColor.xyz *= instanceColor.xyz;', `${FADE_VARYING} = instanceColor.x;`),
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying float ${FADE_VARYING};`)
      .replace('#include <color_fragment>', `#include <color_fragment>\ndiffuseColor.a *= ${FADE_VARYING};`);
  };
  ghost.customProgramCacheKey = () => 'occlusion-instanced-ghost';
  return ghost;
}

export function createMeshGhostMaterial(base: THREE.Material | THREE.Material[]): THREE.Material | THREE.Material[] {
  const make = (m: THREE.Material) => {
    const ghost = m.clone();
    ghost.transparent = true;
    ghost.depthWrite = false;
    return ghost;
  };
  return Array.isArray(base) ? base.map(make) : make(base);
}

export function setGhostOpacity(material: THREE.Material | THREE.Material[], opacity: number): void {
  for (const m of Array.isArray(material) ? material : [material]) m.opacity = opacity;
}

export function disposeMaterial(material: THREE.Material | THREE.Material[]): void {
  for (const m of Array.isArray(material) ? material : [material]) m.dispose();
}
