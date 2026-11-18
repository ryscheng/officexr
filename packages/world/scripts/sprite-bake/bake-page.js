// Runs inside the headless Chromium that `scripts/bake-sprites.ts` drives. Plain JS so it loads
// straight from disk with an import map (no bundler): `three` and its GLTFLoader come from the
// map, every model URL from the driver.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/** Renders at this multiple and scales down, for clean edges without MSAA artefacts on thin parts. */
const SUPERSAMPLE = 2;

const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setClearColor(0x000000, 0);

const loader = new GLTFLoader();
const load = (url) => new Promise((resolve, reject) => loader.load(url, resolve, undefined, reject));

/**
 * Bright, soft light like Gather's art: a sky/floor fill so nothing goes dark, and a key light
 * from the upper left and slightly in front, so tops read lighter than the faces below them.
 */
function lightRig(scene) {
  scene.add(new THREE.HemisphereLight(0xffffff, 0xcdbfae, 2.4));
  const key = new THREE.DirectionalLight(0xffffff, 1.5);
  key.position.set(-0.7, 1.5, 0.9);
  scene.add(key);
  scene.add(new THREE.AmbientLight(0xffffff, 0.35));
}

/**
 * Lambert keeps the KayKit palette textures flat and illustrated (no PBR darkening without an
 * environment map), which is the look the 2D view wants.
 */
function flatten(root) {
  root.traverse((node) => {
    if (!node.isMesh) {
      return;
    }
    const swap = (m) => {
      const flat = new THREE.MeshLambertMaterial({ map: m.map ?? null, color: m.color ?? 0xffffff, transparent: m.transparent, opacity: m.opacity ?? 1 });
      return flat;
    };
    node.material = Array.isArray(node.material) ? node.material.map(swap) : swap(node.material);
  });
}

/**
 * A parallel projection where a metre of depth moves a point `floorScale` metres down the screen
 * and a metre of height `elevation` metres up. Furniture uses floorScale 1 (a "cabinet"
 * projection: the floor maps 1:1 onto the 2D map, so a sprite's footprint lands exactly on its
 * object's); characters use (sin, cos) of a camera pitch, a true orthographic view that shows
 * faces. Depth runs along the projection direction (0, floorScale, elevation).
 */
function obliqueCamera(view, elevation, floorScale = 1) {
  const camera = new THREE.Camera();
  const hw = (view.maxX - view.minX) / 2;
  const hh = (view.maxSy - view.minSy) / 2;
  const cx = (view.minX + view.maxX) / 2;
  const cy = (view.minSy + view.maxSy) / 2;
  const hr = (view.maxK - view.minK) / 2 + 0.01;
  const ck = (view.minK + view.maxK) / 2;
  camera.projectionMatrix.set(
    1 / hw, 0, 0, -cx / hw,
    0, elevation / hh, -floorScale / hh, cy / hh,
    0, -floorScale / hr, -elevation / hr, ck / hr,
    0, 0, 0, 1,
  );
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  camera.matrixWorldAutoUpdate = false;
  return camera;
}

/** The screen window around a world box, padded by `padM` metres. */
function viewOf(box, elevation, padM, floorScale = 1) {
  return {
    minX: box.min.x - padM,
    maxX: box.max.x + padM,
    minSy: box.min.z * floorScale - box.max.y * elevation - padM,
    maxSy: box.max.z * floorScale - box.min.y * elevation + padM,
    minK: floorScale * box.min.y + elevation * box.min.z - 1,
    maxK: floorScale * box.max.y + elevation * box.max.z + 1,
  };
}

/** Renders `scene` through the view into a canvas `w`×`h`, with an optional soft dark outline. */
function shoot(scene, view, elevation, w, h, outline, floorScale = 1) {
  renderer.setSize(w * SUPERSAMPLE, h * SUPERSAMPLE, false);
  renderer.render(scene, obliqueCamera(view, elevation, floorScale));
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const ctx = out.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  if (outline) {
    // A silhouette, tinted and nudged around the sprite, then the sprite on top: the inked edge
    // that keeps furniture legible against the floor, as in pixel-art office sets.
    const sil = document.createElement('canvas');
    sil.width = w;
    sil.height = h;
    const sctx = sil.getContext('2d');
    sctx.drawImage(renderer.domElement, 0, 0, w, h);
    sctx.globalCompositeOperation = 'source-in';
    sctx.fillStyle = outline.colour;
    sctx.fillRect(0, 0, w, h);
    for (let a = 0; a < 8; a++) {
      const t = (a / 8) * Math.PI * 2;
      ctx.drawImage(sil, Math.cos(t) * outline.width, Math.sin(t) * outline.width);
    }
  }
  ctx.drawImage(renderer.domElement, 0, 0, w, h);
  return out;
}

/** Lays frames left to right in one image and returns it with each frame's rect. */
function strip(canvases) {
  const width = canvases.reduce((sum, c) => sum + c.width, 0);
  const height = Math.max(...canvases.map((c) => c.height));
  const sheet = document.createElement('canvas');
  sheet.width = width;
  sheet.height = height;
  const ctx = sheet.getContext('2d');
  let x = 0;
  const rects = canvases.map((c) => {
    ctx.drawImage(c, x, 0);
    const rect = { x, y: 0, w: c.width, h: c.height };
    x += c.width;
    return rect;
  });
  return { sheet, rects };
}

/**
 * One kind at yaw 0, 90, 180 and 270. Each frame's anchor is the pixel of the model's
 * (min x, y = 0, min z) corner: where the 2D view puts the instance's footprint corner.
 */
window.bakeKind = async ({ url, scale, ppm, elevation, outline }) => {
  const gltf = await load(url);
  const model = gltf.scene;
  flatten(model);
  model.scale.setScalar(scale);
  const frames = [];
  const canvases = [];
  for (const yawDeg of [0, 90, 180, 270]) {
    const scene = new THREE.Scene();
    lightRig(scene);
    const pivot = new THREE.Group();
    pivot.rotation.y = (yawDeg * Math.PI) / 180;
    pivot.add(model);
    scene.add(pivot);
    scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(pivot, true);
    const padM = 4 / ppm;
    const view = viewOf(box, elevation, padM);
    const w = Math.max(1, Math.ceil((view.maxX - view.minX) * ppm));
    const h = Math.max(1, Math.ceil((view.maxSy - view.minSy) * ppm));
    canvases.push(shoot(scene, view, elevation, w, h, outline));
    frames.push({ yawDeg, ax: (box.min.x - view.minX) * ppm, ay: (box.min.z - view.minSy) * ppm });
    pivot.remove(model);
  }
  const { sheet, rects } = strip(canvases);
  return { image: sheet.toDataURL('image/webp', 0.92), frames: frames.map((f, i) => ({ ...rects[i], ...f })) };
};

const DIRECTIONS = { down: 0, left: -Math.PI / 2, right: Math.PI / 2, up: Math.PI };

/**
 * A character sheet: one row per direction (down, left, right, up), columns idle, the walk cycle,
 * then seated. Every cell shares one size and anchors on the feet, so frames swap in place.
 */
window.bakeCharacter = async ({ url, walk, idle, sitPose, walkFrames, ppm, pitchDeg, outline }) => {
  const elevation = Math.cos((pitchDeg * Math.PI) / 180);
  const floorScale = Math.sin((pitchDeg * Math.PI) / 180);
  const [character, walkGltf, idleGltf] = await Promise.all([load(url), load(walk.url), load(idle.url)]);
  const model = character.scene;
  flatten(model);
  const mixer = new THREE.AnimationMixer(model);
  const clip = (gltf, name) => gltf.animations.find((a) => a.name === name);
  const walkClip = clip(walkGltf, walk.name);
  const idleClip = clip(idleGltf, idle.name);
  const sitTracks = Object.entries(sitPose).map(([bone, [x, y, z]]) => {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler((x * Math.PI) / 180, (y * Math.PI) / 180, (z * Math.PI) / 180, 'XYZ'));
    return new THREE.QuaternionKeyframeTrack(`${THREE.PropertyBinding.sanitizeNodeName(bone)}.quaternion`, [0, 1], [...q.toArray(), ...q.toArray()]);
  });
  const sitClip = new THREE.AnimationClip('Sit', 1, [...idleClip.tracks.filter((t) => !sitTracks.some((s) => s.name === t.name)), ...sitTracks]);
  const poses = [
    { clip: idleClip, t: 0 },
    ...Array.from({ length: walkFrames }, (_, i) => ({ clip: walkClip, t: (i / walkFrames) * walkClip.duration })),
    { clip: sitClip, t: 0, sit: true },
  ];
  // A fixed window around the feet, roomy enough for a stride and raised arms.
  const box = new THREE.Box3(new THREE.Vector3(-0.75, 0, -0.6), new THREE.Vector3(0.75, 2.7, 0.6));
  const view = viewOf(box, elevation, 0, floorScale);
  const w = Math.ceil((view.maxX - view.minX) * ppm);
  const h = Math.ceil((view.maxSy - view.minSy) * ppm);
  const rows = [];
  for (const [direction, yaw] of Object.entries(DIRECTIONS)) {
    const cells = [];
    for (const pose of poses) {
      mixer.stopAllAction();
      const action = mixer.clipAction(pose.clip);
      action.reset().play();
      mixer.setTime(pose.t);
      const scene = new THREE.Scene();
      lightRig(scene);
      const pivot = new THREE.Group();
      pivot.rotation.y = yaw;
      // Seated: the hips drop onto a chair-height seat (SIT_POSE_HIP_HEIGHT in the 3D view).
      pivot.position.y = pose.sit ? -0.35 : 0;
      pivot.add(model);
      scene.add(pivot);
      scene.updateMatrixWorld(true);
      cells.push(shoot(scene, view, elevation, w, h, outline, floorScale));
      pivot.remove(model);
    }
    rows.push({ direction, cells });
  }
  const sheet = document.createElement('canvas');
  sheet.width = w * poses.length;
  sheet.height = h * rows.length;
  const ctx = sheet.getContext('2d');
  rows.forEach((row, r) => row.cells.forEach((c, i) => ctx.drawImage(c, i * w, r * h)));
  return {
    image: sheet.toDataURL('image/webp', 0.92),
    cell: { w, h },
    anchor: { x: (0 - view.minX) * ppm, y: (0 - view.minSy) * ppm },
    directions: rows.map((r) => r.direction),
    columns: { idle: 0, walk: [1, walkFrames], sit: walkFrames + 1 },
  };
};

window.bakeReady = true;
