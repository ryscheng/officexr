import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { applyFrozenLook, FROZEN_OPACITY, frozenShader } from './frozenLook.ts';

describe('applyFrozenLook', () => {
  it('makes standard materials translucent, depth-write free and shader-patched', () => {
    const m = new THREE.MeshStandardMaterial({ color: '#ff0000' });
    applyFrozenLook([m]);
    expect(m.transparent).toBe(true);
    expect(m.opacity).toBe(FROZEN_OPACITY);
    expect(m.depthWrite).toBe(false);
    expect(m.onBeforeCompile).toBe(frozenShader);
  });

  it('leaves other materials translucent without a shader patch', () => {
    const m = new THREE.MeshBasicMaterial();
    const before = m.onBeforeCompile;
    applyFrozenLook([m]);
    expect(m.opacity).toBe(FROZEN_OPACITY);
    expect(m.onBeforeCompile).toBe(before);
  });
});

describe('frozenShader', () => {
  it('desaturates the base colour and adds a rim to the emissive term', () => {
    const shader = {
      uniforms: {} as Record<string, THREE.IUniform>,
      fragmentShader: '#include <common>\n#include <map_fragment>\n#include <emissivemap_fragment>',
    };
    frozenShader(shader);
    expect(shader.uniforms.frozenRimColor).toBeDefined();
    expect(shader.fragmentShader).toContain('uniform vec3 frozenRimColor;');
    expect(shader.fragmentShader).toContain('mix(diffuseColor.rgb, vec3(frozenGrey)');
    expect(shader.fragmentShader).toContain('totalEmissiveRadiance += frozenRimColor');
  });
});
