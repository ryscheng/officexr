import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { describe, expect, it } from 'vitest';
import { chooseScreenFace, findScreenFaces, SCREEN_FACE_ATTRIBUTE } from './screenFace.ts';

function monitorGeometry(): THREE.BufferGeometry {
  const base = new THREE.BoxGeometry(0.2, 0.02, 0.15).translate(0, 0.01, 0);
  const neck = new THREE.BoxGeometry(0.04, 0.2, 0.04).translate(0, 0.12, 0);
  const body = new THREE.BoxGeometry(0.6, 0.35, 0.03).translate(0, 0.32, 0);
  return mergeGeometries([base, neck, body]) as THREE.BufferGeometry;
}

describe('findScreenFaces', () => {
  it('ranks the broad faces of the body first and marks only their vertices', () => {
    const found = findScreenFaces(monitorGeometry());
    expect(found).not.toBeNull();
    const [front, back] = found!.faces;
    expect(Math.abs(front.nz)).toBeCloseTo(1);
    expect(Math.abs(back.nz)).toBeCloseTo(1);
    expect(front.nz).toBe(-back.nz);
    expect(front.area).toBeCloseTo(0.6 * 0.35, 3);

    const ids = found!.geometry.getAttribute(SCREEN_FACE_ATTRIBUTE);
    const position = found!.geometry.getAttribute('position');
    for (let v = 0; v < ids.count; v++) {
      if (ids.getX(v) === front.id) expect(position.getZ(v)).toBeCloseTo(front.nz * 0.015);
    }
    expect(found!.geometry.index).toBeNull();
  });

  it('does not touch the source geometry', () => {
    const source = monitorGeometry();
    const attributes = Object.keys(source.attributes);
    findScreenFaces(source);
    expect(Object.keys(source.attributes)).toEqual(attributes);
  });

  it('finds no face on a flat, horizontal model', () => {
    expect(findScreenFaces(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2))).toBeNull();
  });
});

describe('chooseScreenFace', () => {
  const faces = findScreenFaces(monitorGeometry())!.faces;
  const front = faces.find((f) => f.nz > 0)!;
  const back = faces.find((f) => f.nz < 0)!;

  it('picks the face that points at the chair', () => {
    expect(chooseScreenFace(faces, 0, 0, 2)).toBe(front.id);
    expect(chooseScreenFace(faces, 0, 0, -2)).toBe(back.id);
  });

  it('follows the instance yaw', () => {
    expect(chooseScreenFace(faces, Math.PI, 0, 2)).toBe(back.id);
    expect(chooseScreenFace(faces, Math.PI / 2, 2, 0)).toBe(front.id);
  });

  it('lights nothing when no face points at the chair', () => {
    expect(chooseScreenFace(faces.filter((f) => f.id === front.id), 0, 0, -2)).toBe(0);
    expect(chooseScreenFace(faces, 0, 2, 0)).toBe(0);
  });
});
