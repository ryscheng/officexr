import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createInstancedGhostMaterial } from './occlusion/ghostMaterial.ts';
import { OccluderRegistry } from './occlusion/OccluderRegistry.ts';
import { createScreenGlowMaterial, hasScreenGlow } from './screenGlowShader.ts';

function compile(material: THREE.Material) {
  const shader = {
    vertexShader: '#include <common>\n#include <color_vertex>\nvoid main(){}',
    fragmentShader: '#include <common>\n#include <color_fragment>\n#include <emissivemap_fragment>\nvoid main(){}',
  };
  material.onBeforeCompile(shader as never, undefined as never);
  return shader;
}

describe('screen glow material', () => {
  it('is an owned copy and leaves the glTF material untouched', () => {
    const base = new THREE.MeshStandardMaterial({ color: 0x223344 });
    const glow = createScreenGlowMaterial(base);
    expect(glow).not.toBe(base);
    expect(hasScreenGlow(glow)).toBe(true);
    expect(hasScreenGlow(base)).toBe(false);
    expect(glow.onBeforeCompile).not.toBe(base.onBeforeCompile);
  });

  it('adds emissive on the chosen face from the per-instance colour', () => {
    const shader = compile(createScreenGlowMaterial(new THREE.MeshStandardMaterial()));
    expect(shader.vertexShader).toContain('vScreenGlow = instanceColor.y;');
    expect(shader.vertexShader).toContain('vScreenSelect = instanceColor.z;');
    expect(shader.vertexShader).not.toContain('vColor.xyz *= instanceColor.xyz;');
    expect(shader.fragmentShader).toContain('totalEmissiveRadiance +=');
  });

  it('keeps the glow in the occlusion ghost and fades it from the first channel', () => {
    const ghost = createInstancedGhostMaterial(createScreenGlowMaterial(new THREE.MeshStandardMaterial()));
    const shader = compile(ghost);
    expect(shader.vertexShader).toContain('vOcclusionFade = instanceColor.x;');
    expect(shader.vertexShader).toContain('vScreenGlow = instanceColor.y;');
    expect(shader.fragmentShader).toContain('totalEmissiveRadiance +=');
    expect(shader.fragmentShader).toContain('diffuseColor.a *= vOcclusionFade;');
  });

  it('leaves the plain ghost as it was for a material without glow', () => {
    const shader = compile(createInstancedGhostMaterial(new THREE.MeshStandardMaterial()));
    expect(shader.fragmentShader).not.toContain('totalEmissiveRadiance');
  });
});

describe('occluded screen instance', () => {
  function setup() {
    const geometry = new THREE.BoxGeometry(2, 4, 0.4);
    const material = createScreenGlowMaterial(new THREE.MeshStandardMaterial());
    const mesh = new THREE.InstancedMesh(geometry, material, 2);
    mesh.setMatrixAt(0, new THREE.Matrix4().makeTranslation(0, 2, 3));
    mesh.setMatrixAt(1, new THREE.Matrix4().makeTranslation(6, 2, 3));
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array([1, 0.7, 2, 1, 0.2, 3]), 3);
    const root = new THREE.Group();
    root.add(mesh);
    const registry = new OccluderRegistry();
    registry.addInstanced(mesh, 2);
    return { root, mesh, registry, material };
  }
  const run = (registry: OccluderRegistry, sec: number) => {
    const head = new THREE.Vector3(0, 1.55, 0);
    const chest = new THREE.Vector3(0, 1, 0);
    for (let t = 0; t < sec; t += 0.02) registry.updateFades(new THREE.Vector3(0, 4, 8), [head, chest], 0.02, true);
  };

  it('keeps its glow and face on the ghost, follows later changes, and restores the source exactly', () => {
    const { root, mesh, registry, material } = setup();
    const source = Array.from(mesh.instanceColor!.array);
    run(registry, 0.5);
    const ghost = root.children.find((c) => c !== mesh) as THREE.InstancedMesh;
    expect(ghost.count).toBe(1);
    expect(Array.from(ghost.instanceColor!.array.slice(0, 3))).toEqual([expect.closeTo(0.28, 2), expect.closeTo(0.7, 5), 2]);

    mesh.instanceColor!.array[1] = 1;
    run(registry, 0.1);
    expect(ghost.instanceColor!.array[1]).toBe(1);

    registry.restoreAll();
    expect(ghost.count).toBe(0);
    expect(Array.from(mesh.instanceColor!.array)).toEqual([...source.slice(0, 1), 1, ...source.slice(2)]);
    expect(mesh.material).toBe(material);
  });
});
