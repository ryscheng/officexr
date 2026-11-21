import * as THREE from 'three';
import { SCREEN_FACE_ATTRIBUTE } from './screenFace.ts';

export const SCREEN_GLOW_FLAG = 'screenGlow';
const GLOW_RGB = new THREE.Color('#8fb8ff');

const COMMON = `#include <common>
attribute float ${SCREEN_FACE_ATTRIBUTE};
varying float vScreenFace;
varying float vScreenGlow;
varying float vScreenSelect;`;

const FRAGMENT_COMMON = `#include <common>
varying float vScreenFace;
varying float vScreenGlow;
varying float vScreenSelect;`;

const EMISSIVE = `#include <emissivemap_fragment>
float screenLit = step(0.5, vScreenFace) * (1.0 - step(0.5, abs(vScreenFace - vScreenSelect)));
totalEmissiveRadiance += vec3(${GLOW_RGB.r.toFixed(4)}, ${GLOW_RGB.g.toFixed(4)}, ${GLOW_RGB.b.toFixed(4)}) * screenLit * max(vScreenGlow, 0.0);`;

const INSTANCE_COLOUR = 'vColor.xyz *= instanceColor.xyz;';
const GLOW_FROM_INSTANCE = 'vScreenGlow = instanceColor.y;\nvScreenSelect = instanceColor.z;';

// instanceColor.y is the glow and .z the lit face id: the same buffer layout on a mesh and on its occlusion ghost.
export function screenGlowColorChunk(fadeFromX: boolean): string {
  const chunk = THREE.ShaderChunk.color_vertex.replace(
    INSTANCE_COLOUR,
    `${fadeFromX ? 'vOcclusionFade = instanceColor.x;\n' : ''}${GLOW_FROM_INSTANCE}`,
  );
  return `vScreenFace = ${SCREEN_FACE_ATTRIBUTE};\nvScreenGlow = 0.0;\nvScreenSelect = 0.0;\n${chunk}`;
}

export function patchScreenGlowShader(shader: { vertexShader: string; fragmentShader: string }, fadeFromX: boolean): void {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `${COMMON}${fadeFromX ? '\nvarying float vOcclusionFade;' : ''}`)
    .replace('#include <color_vertex>', screenGlowColorChunk(fadeFromX));
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `${FRAGMENT_COMMON}${fadeFromX ? '\nvarying float vOcclusionFade;' : ''}`)
    .replace('#include <emissivemap_fragment>', EMISSIVE);
}

// An owned copy: the glTF's own material stays untouched for every other mount that shares it.
export function createScreenGlowMaterial(base: THREE.Material): THREE.Material {
  const material = base.clone();
  material.userData[SCREEN_GLOW_FLAG] = true;
  material.onBeforeCompile = (shader) => patchScreenGlowShader(shader, false);
  material.customProgramCacheKey = () => 'screen-glow';
  return material;
}

export function hasScreenGlow(material: THREE.Material): boolean {
  return material.userData[SCREEN_GLOW_FLAG] === true;
}
