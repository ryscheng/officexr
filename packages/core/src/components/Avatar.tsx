import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { AvatarCustomization } from '@/types/avatar';

export interface AvatarData {
  id: string;
  name: string;
  image?: string | null;
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
  customization?: AvatarCustomization;
}

export interface AvatarAnimationState {
  mixer: THREE.AnimationMixer;
  actions: Map<string, THREE.AnimationAction>;
  activeAction: THREE.AnimationAction | null;
}

// ─── Animation helpers ────────────────────────────────────────────────────────

function normalizeAnimationName(name: string): string {
  // Strip common prefixes: "mixamo.com|Walk" → "Walk", "Armature|Idle" → "Idle"
  const parts = name.split('|');
  const base = parts[parts.length - 1];
  return base.replace(/^Armature\.?/i, '').replace(/^Action\.?/i, '').toLowerCase().trim();
}

function findAnimation(
  actions: Map<string, THREE.AnimationAction>,
  name: string,
): THREE.AnimationAction | undefined {
  if (actions.has(name)) return actions.get(name);
  const lower = name.toLowerCase();
  for (const [key, action] of actions) {
    if (key.includes(lower)) return action;
  }
  return undefined;
}

export function switchAnimation(animState: AvatarAnimationState, desiredName: string): void {
  let action = findAnimation(animState.actions, desiredName);

  // Fallback: if the requested 'walk' clip is absent, play 'idle' instead so
  // the avatar doesn't freeze in its bind pose (T-pose).
  if (!action && desiredName === 'walk') {
    action = findAnimation(animState.actions, 'idle');
  }

  if (action && action === animState.activeAction) return;

  if (action) {
    if (animState.activeAction) {
      animState.activeAction.fadeOut(0.3);
    }
    action.reset().fadeIn(0.3).play();
    animState.activeAction = action;
  } else if (desiredName === 'idle' && animState.activeAction) {
    // No idle animation found — fade out to bind pose
    animState.activeAction.fadeOut(0.5);
    animState.activeAction = null;
  }
}

// ─── Name tag sprite ──────────────────────────────────────────────────────────

function addNameTag(group: THREE.Group, name: string, yOffset: number) {
  // 3D label — normal size, visible in perspective view
  const canvas3d = document.createElement('canvas');
  const ctx3d = canvas3d.getContext('2d')!;
  canvas3d.width = 256;
  canvas3d.height = 64;
  ctx3d.fillStyle = 'rgba(0,0,0,0.7)';
  ctx3d.fillRect(0, 0, 256, 64);
  ctx3d.font = 'bold 24px Arial';
  ctx3d.fillStyle = 'white';
  ctx3d.textAlign = 'center';
  ctx3d.fillText(name || 'User', 128, 40);
  const sprite3d = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas3d) }));
  sprite3d.scale.set(1, 0.25, 1);
  sprite3d.position.y = yOffset;
  sprite3d.userData.nameTagType = '3d';
  group.add(sprite3d);

  // 2D label — larger canvas texture for top-down map readability, hidden by default
  const canvas2d = document.createElement('canvas');
  const ctx2d = canvas2d.getContext('2d')!;
  canvas2d.width = 512;
  canvas2d.height = 128;
  ctx2d.fillStyle = 'rgba(0,0,0,0.85)';
  ctx2d.fillRect(0, 0, 512, 128);
  ctx2d.font = 'bold 58px Arial';
  ctx2d.fillStyle = 'white';
  ctx2d.textAlign = 'center';
  ctx2d.fillText(name || 'User', 256, 90);
  const sprite2d = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas2d) }));
  sprite2d.scale.set(3, 0.75, 3);
  sprite2d.position.y = yOffset;
  sprite2d.userData.nameTagType = '2d';
  sprite2d.visible = false;
  group.add(sprite2d);
}

// ─── Geometric fallback avatar ────────────────────────────────────────────────

function buildGeometricAvatar(group: THREE.Group, customization: AvatarCustomization) {
  const bodyScale =
    customization.style === 'athletic' ? { radius: 0.22, height: 0.9 } :
    customization.style === 'formal'   ? { radius: 0.18, height: 0.85 } :
                                         { radius: 0.2,  height: 0.8 };

  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(bodyScale.radius, bodyScale.radius, bodyScale.height, 8),
    new THREE.MeshStandardMaterial({ color: customization.bodyColor }),
  );
  body.position.y = 0.4;
  group.add(body);

  const headMat = new THREE.MeshStandardMaterial({ color: customization.skinColor });
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 16), headMat);
  head.position.y = 0.95;
  group.add(head);

  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x000000 });
  [-0.06, 0.06].forEach(x => {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 8), eyeMat);
    eye.position.set(x, 0.98, 0.12);
    eye.userData = { isEye: true, restX: x, restY: 0.98, restZ: 0.12 };
    group.add(eye);
  });

  customization.accessories.forEach(acc => {
    switch (acc) {
      case 'hat': {
        const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.2, 0.1, 8), new THREE.MeshStandardMaterial({ color: 0x333333 }));
        hat.position.y = 1.1;
        group.add(hat);
        break;
      }
      case 'glasses': {
        const mat = new THREE.MeshStandardMaterial({ color: 0x000000 });
        [-0.06, 0.06].forEach(x => {
          const g = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.01, 8, 16), mat);
          g.position.set(x, 0.98, 0.12);
          g.rotation.y = Math.PI / 2;
          group.add(g);
        });
        const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.01, 0.01), mat);
        bridge.position.set(0, 0.98, 0.12);
        group.add(bridge);
        break;
      }
      case 'backpack': {
        const bp = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.3, 0.15), new THREE.MeshStandardMaterial({ color: 0x8b4513 }));
        bp.position.set(0, 0.5, -0.25);
        group.add(bp);
        break;
      }
      case 'headphones': {
        const mat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a });
        const band = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.02, 8, 16, Math.PI), mat);
        band.position.y = 1.05;
        band.rotation.z = Math.PI;
        group.add(band);
        [-0.18, 0.18].forEach(x => {
          const cup = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), mat);
          cup.position.set(x, 0.95, 0);
          group.add(cup);
        });
        break;
      }
      case 'tie': {
        const tie = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.4, 0.02), new THREE.MeshStandardMaterial({ color: 0x8b0000 }));
        tie.position.set(0, 0.5, 0.21);
        group.add(tie);
        break;
      }
      case 'scarf': {
        const scarf = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.04, 8, 16), new THREE.MeshStandardMaterial({ color: 0xff6347 }));
        scarf.position.y = 0.85;
        scarf.rotation.x = Math.PI / 2;
        group.add(scarf);
        break;
      }
    }
  });
}

// ─── Mario character builders ─────────────────────────────────────────────────

function buildMarioLuigi(group: THREE.Group, capHex: number, overallsHex: number, shirtHex: number, skinColor: string) {
  const skin = new THREE.MeshStandardMaterial({ color: new THREE.Color(skinColor) });

  const overalls = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.72, 8), new THREE.MeshStandardMaterial({ color: overallsHex }));
  overalls.position.y = 0.36;
  group.add(overalls);

  const shirt = new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.22, 0.30, 8), new THREE.MeshStandardMaterial({ color: shirtHex }));
  shirt.position.y = 0.69;
  group.add(shirt);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 16), skin);
  head.position.y = 1.00;
  group.add(head);

  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x000000 });
  [-0.07, 0.07].forEach(x => {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.028, 8, 8), eyeMat);
    eye.position.set(x, 1.03, 0.15);
    eye.userData = { isEye: true, restX: x, restY: 1.03, restZ: 0.15 };
    group.add(eye);
  });

  const mustMat = new THREE.MeshStandardMaterial({ color: 0x3a1a00 });
  [-0.055, 0.055].forEach(x => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.035, 0.035), mustMat);
    m.position.set(x, 0.95, 0.16);
    group.add(m);
  });

  const capMat = new THREE.MeshStandardMaterial({ color: capHex });
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.23, 0.23, 0.04, 16), capMat);
  brim.position.y = 1.13;
  group.add(brim);

  const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.21, 0.17, 16), capMat);
  crown.position.y = 1.24;
  group.add(crown);

  const letter = new THREE.Mesh(new THREE.CircleGeometry(0.06, 16), new THREE.MeshStandardMaterial({ color: 0xffffff }));
  letter.position.set(0, 1.23, 0.18);
  letter.rotation.x = -0.3;
  group.add(letter);
}

function buildToad(group: THREE.Group, skinColor: string) {
  const skin = new THREE.MeshStandardMaterial({ color: new THREE.Color(skinColor) });

  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.55, 8), new THREE.MeshStandardMaterial({ color: 0x4a7cc7 }));
  body.position.y = 0.28;
  group.add(body);

  const vest = new THREE.Mesh(new THREE.CylinderGeometry(0.20, 0.19, 0.32, 8), new THREE.MeshStandardMaterial({ color: 0xfafafa }));
  vest.position.y = 0.52;
  group.add(vest);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 16), skin);
  head.position.y = 0.82;
  group.add(head);

  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x000000 });
  [-0.06, 0.06].forEach(x => {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 8), eyeMat);
    eye.position.set(x, 0.85, 0.13);
    eye.userData = { isEye: true, restX: x, restY: 0.85, restZ: 0.13 };
    group.add(eye);
  });

  // Red mushroom cap
  const cap = new THREE.Mesh(
    new THREE.SphereGeometry(0.30, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.55),
    new THREE.MeshStandardMaterial({ color: 0xdd2222 })
  );
  cap.position.y = 0.90;
  group.add(cap);

  // White spots
  const spotMat = new THREE.MeshStandardMaterial({ color: 0xffffff });
  [[-0.16, 0.96, 0.10], [0.16, 0.96, 0.10], [0, 1.18, 0.02], [-0.09, 1.10, 0.22], [0.09, 1.10, 0.22]].forEach(([x, y, z]) => {
    const spot = new THREE.Mesh(new THREE.CircleGeometry(0.055, 12), spotMat);
    spot.position.set(x, y, z);
    spot.lookAt(new THREE.Vector3(x * 3, y * 3, z * 3));
    group.add(spot);
  });
}

function buildPeach(group: THREE.Group, skinColor: string) {
  const skin = new THREE.MeshStandardMaterial({ color: new THREE.Color(skinColor) });

  const dress = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.40, 0.90, 8), new THREE.MeshStandardMaterial({ color: 0xf5a8c8 }));
  dress.position.y = 0.45;
  group.add(dress);

  const bodice = new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.24, 0.28, 8), new THREE.MeshStandardMaterial({ color: 0xfafafa }));
  bodice.position.y = 0.88;
  group.add(bodice);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 16), skin);
  head.position.y = 1.16;
  group.add(head);

  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x2255cc });
  [-0.065, 0.065].forEach(x => {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.028, 8, 8), eyeMat);
    eye.position.set(x, 1.19, 0.15);
    eye.userData = { isEye: true, restX: x, restY: 1.19, restZ: 0.15 };
    group.add(eye);
  });

  const hairMat = new THREE.MeshStandardMaterial({ color: 0xf5d57a });
  [-0.16, 0.16].forEach(x => {
    const puff = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 10), hairMat);
    puff.position.set(x, 1.21, -0.04);
    group.add(puff);
  });

  const crownMat = new THREE.MeshStandardMaterial({ color: 0xffd700 });
  const crownBase = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.06, 16), crownMat);
  crownBase.position.y = 1.34;
  group.add(crownBase);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const pt = new THREE.Mesh(new THREE.ConeGeometry(0.026, 0.09, 4), crownMat);
    pt.position.set(Math.sin(a) * 0.13, 1.42, Math.cos(a) * 0.13);
    group.add(pt);
  }
}

function buildBowser(group: THREE.Group) {
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.30, 0.28, 0.85, 8), new THREE.MeshStandardMaterial({ color: 0x2e8b34 }));
  body.position.y = 0.43;
  group.add(body);

  const plastron = new THREE.Mesh(new THREE.BoxGeometry(0.30, 0.50, 0.08), new THREE.MeshStandardMaterial({ color: 0xdaa520 }));
  plastron.position.set(0, 0.50, 0.25);
  group.add(plastron);

  const shell = new THREE.Mesh(new THREE.SphereGeometry(0.28, 8, 6, 0, Math.PI * 2, 0, Math.PI * 0.6), new THREE.MeshStandardMaterial({ color: 0x8b6914 }));
  shell.position.set(0, 0.62, -0.22);
  group.add(shell);

  const spikeMat = new THREE.MeshStandardMaterial({ color: 0xdaa520 });
  [[-0.15, 0.85, -0.27], [0, 0.92, -0.35], [0.15, 0.85, -0.27]].forEach(([x, y, z]) => {
    const spike = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.16, 6), spikeMat);
    spike.position.set(x, y, z);
    spike.rotation.x = -0.5;
    group.add(spike);
  });

  const head = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.34, 0.33), new THREE.MeshStandardMaterial({ color: 0xf39c12 }));
  head.position.y = 1.04;
  group.add(head);

  const eyeMat = new THREE.MeshStandardMaterial({ color: 0xcc0000 });
  [-0.11, 0.11].forEach(x => {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 8), eyeMat);
    eye.position.set(x, 1.08, 0.17);
    eye.userData = { isEye: true, restX: x, restY: 1.08, restZ: 0.17 };
    group.add(eye);
  });

  const hornMat = new THREE.MeshStandardMaterial({ color: 0xdaa520 });
  [-0.16, 0.16].forEach(x => {
    const horn = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.18, 8), hornMat);
    horn.position.set(x, 1.26, 0);
    group.add(horn);
  });
}

function buildWario(group: THREE.Group, skinColor: string) {
  const skin = new THREE.MeshStandardMaterial({ color: new THREE.Color(skinColor) });

  const overalls = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.27, 0.72, 8), new THREE.MeshStandardMaterial({ color: 0x8b008b }));
  overalls.position.y = 0.36;
  group.add(overalls);

  const shirt = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.27, 0.30, 8), new THREE.MeshStandardMaterial({ color: 0xf5e642 }));
  shirt.position.y = 0.69;
  group.add(shirt);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.20, 16, 16), skin);
  head.position.y = 1.02;
  group.add(head);

  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x000000 });
  [-0.08, 0.08].forEach(x => {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.032, 8, 8), eyeMat);
    eye.position.set(x, 1.05, 0.18);
    eye.userData = { isEye: true, restX: x, restY: 1.05, restZ: 0.18 };
    group.add(eye);
  });

  const mustMat = new THREE.MeshStandardMaterial({ color: 0xf5e642 });
  [-0.065, 0.065].forEach(x => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.045, 0.04), mustMat);
    m.position.set(x, 0.96, 0.18);
    group.add(m);
  });

  const capMat = new THREE.MeshStandardMaterial({ color: 0xf5e642 });
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.04, 16), capMat);
  brim.position.y = 1.18;
  group.add(brim);
  const capCrown = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.23, 0.17, 16), capMat);
  capCrown.position.y = 1.29;
  group.add(capCrown);
  const letter = new THREE.Mesh(new THREE.CircleGeometry(0.07, 16), new THREE.MeshStandardMaterial({ color: 0x8b008b }));
  letter.position.set(0, 1.28, 0.20);
  letter.rotation.x = -0.3;
  group.add(letter);
}

// ─── Dispatch ─────────────────────────────────────────────────────────────────

function buildAvatarGeometry(group: THREE.Group, customization: AvatarCustomization) {
  switch (customization.presetId) {
    case 'mario': buildMarioLuigi(group, 0xe63232, 0x0050c8, 0xe63232, customization.skinColor); break;
    case 'luigi': buildMarioLuigi(group, 0x2e8b34, 0x2e8b34, 0x2e8b34, customization.skinColor); break;
    case 'toad':   buildToad(group, customization.skinColor); break;
    case 'peach':  buildPeach(group, customization.skinColor); break;
    case 'bowser': buildBowser(group); break;
    case 'wario':  buildWario(group, customization.skinColor); break;
    default:       buildGeometricAvatar(group, customization);
  }
}

function nameTagY(presetId?: string | null): number {
  switch (presetId) {
    case 'toad':   return 1.55;
    case 'peach':  return 1.65;
    case 'bowser': return 1.65;
    case 'wario':  return 1.60;
    default:       return 1.40;
  }
}

// ─── GLTF loading ─────────────────────────────────────────────────────────────

const gltfLoader = new GLTFLoader();

function loadGLTFIntoGroup(
  url: string,
  group: THREE.Group,
  fallbackCustomization: AvatarCustomization,
  onAnimationsReady?: (animState: AvatarAnimationState | null) => void,
) {
  // Remove geometry, keep name-tag sprite
  group.children.filter(c => !(c instanceof THREE.Sprite)).forEach(c => group.remove(c));

  gltfLoader.load(
    url,
    (gltf) => {
      const model = gltf.scene;
      const box = new THREE.Box3().setFromObject(model);
      const height = box.max.y - box.min.y;
      if (height > 0) model.scale.setScalar(1.1 / height);
      box.setFromObject(model);
      model.position.y = -box.min.y;
      group.add(model);

      if (gltf.animations.length > 0) {
        const mixer = new THREE.AnimationMixer(model);
        const actions = new Map<string, THREE.AnimationAction>();
        for (const clip of gltf.animations) {
          const key = normalizeAnimationName(clip.name);
          actions.set(key, mixer.clipAction(clip));
        }
        onAnimationsReady?.({ mixer, actions, activeAction: null });
      } else {
        console.warn(
          `[Avatar] GLTF loaded from ${url} has no animation clips — avatar will render in bind pose. Re-export the GLB with Walk/Idle clips.`,
        );
        onAnimationsReady?.(null);
      }
    },
    undefined,
    () => {
      buildAvatarGeometry(group, fallbackCustomization);
      onAnimationsReady?.(null);
    },
  );
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function createAvatar(
  scene: THREE.Scene,
  userData: AvatarData,
  onAnimationsReady?: (animState: AvatarAnimationState | null) => void,
): THREE.Group {
  const group = new THREE.Group();
  group.userData = userData;
  group.position.set(userData.position.x, 0, userData.position.z);
  group.rotation.set(userData.rotation.x, userData.rotation.y, userData.rotation.z);

  const customization: AvatarCustomization = userData.customization ?? {
    bodyColor: getColorHexFromId(userData.id),
    skinColor: '#ffdbac',
    style: 'default',
    accessories: [],
  };

  if (customization.modelUrl) {
    // Placeholder sphere while model loads
    const ph = new THREE.Mesh(
      new THREE.SphereGeometry(0.2, 8, 8),
      new THREE.MeshStandardMaterial({ color: customization.bodyColor, transparent: true, opacity: 0.5 })
    );
    ph.position.y = 0.8;
    group.add(ph);
    addNameTag(group, userData.name, 1.4);
    loadGLTFIntoGroup(customization.modelUrl, group, customization, onAnimationsReady);
  } else {
    buildAvatarGeometry(group, customization);
    addNameTag(group, userData.name, nameTagY(customization.presetId));
    onAnimationsReady?.(null);
  }

  scene.add(group);
  return group;
}

export function updateAvatar(
  avatar: THREE.Group,
  position: { x: number; y: number; z: number },
  rotation: { x: number; y: number; z: number }
) {
  avatar.position.lerp(new THREE.Vector3(position.x, 0, position.z), 0.1);
  avatar.rotation.y = rotation.y;
}

export function buildAvatarForPreview(customization: AvatarCustomization): { group: THREE.Group; eyes: THREE.Mesh[] } {
  const group = new THREE.Group();

  if (customization.modelUrl) {
    // Show a placeholder sphere while the GLTF loads asynchronously
    const ph = new THREE.Mesh(
      new THREE.SphereGeometry(0.2, 8, 8),
      new THREE.MeshStandardMaterial({ color: customization.bodyColor, transparent: true, opacity: 0.5 }),
    );
    ph.position.y = 0.8;
    group.add(ph);
    loadGLTFIntoGroup(customization.modelUrl, group, customization);
    // GLTF models don't have the procedural eye meshes
    return { group, eyes: [] };
  }

  buildAvatarGeometry(group, customization);
  const eyes: THREE.Mesh[] = [];
  group.traverse(child => {
    if ((child as THREE.Mesh).isMesh && child.userData.isEye) {
      eyes.push(child as THREE.Mesh);
    }
  });
  return { group, eyes };
}

function getColorHexFromId(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = id.charCodeAt(i) + ((hash << 5) - hash);
  const colors = ['#3498db', '#e74c3c', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c', '#f1c40f', '#e67e22'];
  return colors[Math.abs(hash) % colors.length];
}

// ─── 2D top-down map marker for remote avatars ──────────────────────────────

/**
 * Creates a flat circular marker with the user's initial and a direction wedge,
 * designed to be viewed from the orthographic top-down camera. Hidden by default.
 */
export function create2DMarker(
  scene: THREE.Scene,
  userData: { id: string; name: string; customization?: AvatarCustomization },
): THREE.Group {
  const group = new THREE.Group();
  group.userData.is2DMarker = true;

  const bodyHex = userData.customization?.bodyColor || getColorHexFromId(userData.id);
  const bodyColorInt = parseInt(bodyHex.replace('#', ''), 16);

  // Shadow disc
  const shadow = new THREE.Mesh(
    new THREE.CylinderGeometry(0.5, 0.5, 0.01, 24),
    new THREE.MeshStandardMaterial({ color: 0x000000, transparent: true, opacity: 0.15 }),
  );
  shadow.position.y = 0.005;
  group.add(shadow);

  // Colored circle with initial
  const initial = (userData.name || '?').charAt(0).toUpperCase();
  const circCanvas = document.createElement('canvas');
  circCanvas.width = 128;
  circCanvas.height = 128;
  const ctx = circCanvas.getContext('2d')!;
  // Filled circle in body color
  ctx.beginPath();
  ctx.arc(64, 64, 60, 0, Math.PI * 2);
  ctx.fillStyle = bodyHex;
  ctx.fill();
  // White border
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
  // Initial letter
  ctx.font = 'bold 64px Arial';
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(initial, 64, 68);
  const circTex = new THREE.CanvasTexture(circCanvas);
  const disc = new THREE.Mesh(
    new THREE.CylinderGeometry(0.38, 0.38, 0.06, 24),
    new THREE.MeshStandardMaterial({ map: circTex }),
  );
  disc.position.y = 0.04;
  group.add(disc);

  // Direction wedge (points in -Z = north by default, rotated to match avatar facing)
  const wedge = new THREE.Mesh(
    new THREE.ConeGeometry(0.1, 0.24, 3),
    new THREE.MeshStandardMaterial({ color: bodyColorInt }),
  );
  wedge.rotation.x = Math.PI / 2;
  wedge.position.set(0, 0.06, -0.52);
  wedge.userData.isDirectionWedge = true;
  group.add(wedge);

  group.position.y = 0;
  group.visible = false; // shown only in 2D mode
  scene.add(group);
  return group;
}
