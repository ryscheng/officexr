import * as THREE from 'three';
import { SILHOUETTE_OPACITY } from './silhouetteColor.ts';

export interface CharacterSilhouette {
  setVisible(visible: boolean): void;
  setColor(color: string): void;
  dispose(): void;
}

// Draws only where nearer geometry hid the character: the body marks its own pixels in the stencil, so limbs over the torso are not tinted and overlapping twins do not stack opacity.
function createMaterial(color: string): THREE.MeshBasicMaterial {
  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: SILHOUETTE_OPACITY,
    depthFunc: THREE.GreaterDepth,
    depthWrite: false,
    fog: false,
    toneMapped: false,
  });
  material.polygonOffset = true;
  material.polygonOffsetFactor = -1;
  material.polygonOffsetUnits = -4;
  material.stencilWrite = true;
  material.stencilFunc = THREE.EqualStencilFunc;
  material.stencilRef = 0;
  material.stencilZPass = THREE.IncrementWrapStencilOp;
  return material;
}

interface StencilState {
  write: boolean;
  func: THREE.StencilFunc;
  ref: number;
  zPass: THREE.StencilOp;
}

function markBody(material: THREE.Material): StencilState {
  const saved = { write: material.stencilWrite, func: material.stencilFunc, ref: material.stencilRef, zPass: material.stencilZPass };
  material.stencilWrite = true;
  material.stencilFunc = THREE.AlwaysStencilFunc;
  material.stencilRef = 1;
  material.stencilZPass = THREE.ReplaceStencilOp;
  return saved;
}

function unmarkBody(material: THREE.Material, saved: StencilState): void {
  material.stencilWrite = saved.write;
  material.stencilFunc = saved.func;
  material.stencilRef = saved.ref;
  material.stencilZPass = saved.zPass;
}

function addTwin(source: THREE.Mesh, material: THREE.Material): THREE.Mesh {
  const skinned = source as THREE.SkinnedMesh;
  let twin: THREE.Mesh;
  if (skinned.isSkinnedMesh) {
    const skin = new THREE.SkinnedMesh(source.geometry, material);
    skin.bind(skinned.skeleton, skinned.bindMatrix);
    twin = skin;
  } else {
    twin = new THREE.Mesh(source.geometry, material);
  }
  twin.castShadow = false;
  twin.receiveShadow = false;
  twin.frustumCulled = false;
  twin.renderOrder = 1000;
  twin.raycast = () => undefined;
  twin.visible = false;
  source.add(twin);
  return twin;
}

export function createCharacterSilhouette(root: THREE.Object3D, color: string): CharacterSilhouette {
  const material = createMaterial(color);
  const sources: THREE.Mesh[] = [];
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) sources.push(o as THREE.Mesh);
  });
  const twins = sources.map((s) => addTwin(s, material));
  const marked = new Map<THREE.Material, StencilState>();
  for (const s of sources) {
    for (const m of Array.isArray(s.material) ? s.material : [s.material]) {
      if (!marked.has(m)) marked.set(m, markBody(m));
    }
  }
  return {
    setVisible(visible) {
      for (const t of twins) t.visible = visible;
    },
    setColor(next) {
      material.color.set(next);
    },
    dispose() {
      for (const t of twins) t.removeFromParent();
      for (const [m, saved] of marked) unmarkBody(m, saved);
      material.dispose();
    },
  };
}
