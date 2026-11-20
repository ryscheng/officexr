import * as THREE from 'three';

export const FROZEN_OPACITY = 0.55;
export const FROZEN_DESATURATION = 0.85;
export const FROZEN_RIM_COLOR = '#9fd0ff';
const FROZEN_RIM_STRENGTH = 0.8;

const RIM_GLSL = `
  float frozenGrey = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(frozenGrey), ${FROZEN_DESATURATION.toFixed(2)});
`;
const RIM_EMISSIVE_GLSL = `
  totalEmissiveRadiance += frozenRimColor * ${FROZEN_RIM_STRENGTH.toFixed(2)}
    * pow(1.0 - saturate(dot(normalize(vNormal), normalize(vViewPosition))), 2.5);
`;

export function frozenShader(shader: { fragmentShader: string; uniforms: Record<string, THREE.IUniform> }): void {
  const rim = new THREE.Color(FROZEN_RIM_COLOR);
  shader.uniforms.frozenRimColor = { value: new THREE.Vector3(rim.r, rim.g, rim.b) };
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nuniform vec3 frozenRimColor;')
    .replace('#include <map_fragment>', `#include <map_fragment>\n${RIM_GLSL}`)
    .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${RIM_EMISSIVE_GLSL}`);
}

/**
 * Turns `materials`, which must already be the avatar's own copies, into the frozen look:
 * mostly grey, translucent, with a soft light-blue rim.
 */
export function applyFrozenLook(materials: THREE.Material[]): void {
  for (const m of materials) {
    m.transparent = true;
    m.opacity = FROZEN_OPACITY;
    // Without this, the avatar's own back faces occlude its front ones.
    m.depthWrite = false;
    if ((m as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
      m.onBeforeCompile = frozenShader;
      m.customProgramCacheKey = () => 'frozen';
      m.needsUpdate = true;
    }
  }
}
