import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { MONITOR_LOCAL_BOUNDS } from '../deskMonitorModel.ts';
import { MonitorOccluder } from './MonitorOccluder.ts';
import { OccluderRegistry } from './OccluderRegistry.ts';

function setup() {
  const root = new THREE.Group();
  root.position.set(0, 1, 3);
  const material = new THREE.MeshStandardMaterial({ transparent: true, emissiveIntensity: 0.7 });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), material);
  mesh.castShadow = true;
  root.add(mesh);
  root.updateMatrixWorld(true);
  const registry = new OccluderRegistry();
  registry.addOccluder(new MonitorOccluder(root, MONITOR_LOCAL_BOUNDS, [mesh]));
  return { registry, material, mesh };
}

const camera = new THREE.Vector3(0, 1.3, 8);
const head = new THREE.Vector3(0, 1.3, 0);
function run(registry: OccluderRegistry, sec: number, cam = camera) {
  for (let t = 0; t < sec; t += 0.02) registry.updateFades(cam, [head], 0.02, true);
}

describe('monitor occluder', () => {
  it('fades through the material without touching its emissive level, then restores', () => {
    const { registry, material, mesh } = setup();
    run(registry, 0.5);
    expect(registry.fadedCount()).toBe(1);
    expect(material.opacity).toBeCloseTo(0.28, 2);
    expect(material.depthWrite).toBe(false);
    expect(mesh.castShadow).toBe(false);
    material.emissiveIntensity = 1;
    run(registry, 0.1);
    expect(material.emissiveIntensity).toBe(1);
    run(registry, 0.5, new THREE.Vector3(8, 1.3, 0));
    expect(registry.fadedCount()).toBe(0);
    expect(material.opacity).toBe(1);
    expect(material.depthWrite).toBe(true);
    expect(mesh.castShadow).toBe(true);
  });

  it('restoreAll puts a faded monitor back', () => {
    const { registry, material } = setup();
    run(registry, 0.5);
    registry.restoreAll();
    expect(material.opacity).toBe(1);
    expect(registry.fadedCount()).toBe(0);
  });

  it('leaves a monitor off the line of sight alone', () => {
    const { registry, material } = setup();
    run(registry, 0.5, new THREE.Vector3(8, 1.3, 8));
    expect(registry.fadedCount()).toBe(0);
    expect(material.opacity).toBe(1);
  });
});
