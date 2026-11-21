import * as THREE from 'three';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { cachedCharacterPortrait, storeCharacterPortrait } from '../characters/portraitCache.ts';

const PORTRAIT_PX = 160;
const HEAD_AND_SHOULDERS = 0.36;

interface Studio {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  loader: GLTFLoader;
}

let studio: Studio | null = null;
const pending = new Map<string, Promise<string>>();
let queue: Promise<unknown> = Promise.resolve();

function createStudio(): Studio {
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setPixelRatio(1);
  renderer.setSize(PORTRAIT_PX, PORTRAIT_PX, false);
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8a9a, 1.6));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(1.5, 3, 4);
  scene.add(key);
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  loader.setDRACOLoader(new DRACOLoader().setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.5/'));
  return { renderer, scene, camera: new THREE.PerspectiveCamera(28, 1, 0.05, 50), loader };
}

function frameHead(camera: THREE.PerspectiveCamera, model: THREE.Object3D): void {
  const box = new THREE.Box3().setFromObject(model);
  const height = box.max.y - box.min.y;
  const window = height * HEAD_AND_SHOULDERS;
  const centre = new THREE.Vector3((box.min.x + box.max.x) / 2, box.max.y - window / 2 - height * 0.02, (box.min.z + box.max.z) / 2);
  const distance = window / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  camera.position.set(centre.x, centre.y + window * 0.12, centre.z + distance);
  camera.lookAt(centre);
}

function disposeModel(model: THREE.Object3D): void {
  model.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) {
      return;
    }
    node.geometry.dispose();
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) {
          value.dispose();
        }
      }
      material.dispose();
    }
  });
}

async function render(url: string): Promise<string> {
  studio ??= createStudio();
  const { renderer, scene, camera, loader } = studio;
  const gltf = await loader.loadAsync(url);
  scene.add(gltf.scene);
  try {
    gltf.scene.updateMatrixWorld(true);
    frameHead(camera, gltf.scene);
    renderer.render(scene, camera);
    return renderer.domElement.toDataURL('image/png');
  } finally {
    scene.remove(gltf.scene);
    disposeModel(gltf.scene);
  }
}

export function renderCharacterPortrait(url: string): Promise<string> {
  const known = cachedCharacterPortrait(url);
  if (known) {
    return Promise.resolve(known);
  }
  let job = pending.get(url);
  if (!job) {
    job = queue.then(() => render(url)).then(
      (image) => {
        storeCharacterPortrait(url, image);
        pending.delete(url);
        return image;
      },
      (error: unknown) => {
        pending.delete(url);
        throw error;
      },
    );
    pending.set(url, job);
    queue = job.catch(() => undefined);
  }
  return job;
}
