import * as THREE from 'three';

const BODY_COLOR = 0x2d5a27;
const HEAD_COLOR = 0x4a7a3a;
const ARM_COLOR = 0x2d5a27;
const LEG_COLOR = 0x1a3a16;
const EYE_COLOR = 0xff2200;

export function createZombieMesh(id: string): THREE.Group {
  const group = new THREE.Group();

  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.3, 0.35, 1.2, 8),
    new THREE.MeshStandardMaterial({ color: BODY_COLOR }),
  );
  body.position.y = 0.6;
  group.add(body);

  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.28, 8, 8),
    new THREE.MeshStandardMaterial({ color: HEAD_COLOR }),
  );
  head.position.y = 1.5;
  group.add(head);

  const eyeGeo = new THREE.SphereGeometry(0.07, 6, 6);
  const eyeMat = new THREE.MeshBasicMaterial({ color: EYE_COLOR });
  const leftEye = new THREE.Mesh(eyeGeo, eyeMat);
  leftEye.position.set(-0.1, 1.55, 0.23);
  const rightEye = new THREE.Mesh(eyeGeo, eyeMat);
  rightEye.position.set(0.1, 1.55, 0.23);
  group.add(leftEye, rightEye);

  // Arms stretched forward (outstretched zombie pose)
  const armGeo = new THREE.CylinderGeometry(0.07, 0.07, 0.75, 6);
  const armMat = new THREE.MeshStandardMaterial({ color: ARM_COLOR });
  const leftArm = new THREE.Mesh(armGeo, armMat);
  leftArm.rotation.z = Math.PI / 2.5;
  leftArm.rotation.x = -Math.PI / 4;
  leftArm.position.set(-0.5, 1.15, 0.25);
  const rightArm = new THREE.Mesh(armGeo, armMat);
  rightArm.rotation.z = -Math.PI / 2.5;
  rightArm.rotation.x = -Math.PI / 4;
  rightArm.position.set(0.5, 1.15, 0.25);
  group.add(leftArm, rightArm);

  const legGeo = new THREE.CylinderGeometry(0.1, 0.08, 0.7, 6);
  const legMat = new THREE.MeshStandardMaterial({ color: LEG_COLOR });
  const leftLeg = new THREE.Mesh(legGeo, legMat);
  leftLeg.position.set(-0.16, 0.0, 0);
  const rightLeg = new THREE.Mesh(legGeo, legMat);
  rightLeg.position.set(0.16, 0.0, 0);
  group.add(leftLeg, rightLeg);

  group.userData.zombieId = id;
  group.traverse((child: THREE.Object3D) => {
    if ((child as THREE.Mesh).isMesh) child.userData.zombieId = id;
  });

  return group;
}

export function makeAvatarGhost(avatar: THREE.Group): void {
  avatar.traverse((child: THREE.Object3D) => {
    if ((child as THREE.Mesh).isMesh) {
      const mesh = child as THREE.Mesh;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      (mats as THREE.Material[]).forEach((mat) => {
        (mat as THREE.MeshStandardMaterial).transparent = true;
        (mat as THREE.MeshStandardMaterial).opacity = 0.25;
      });
    }
  });
}

export function restoreAvatarOpacity(avatar: THREE.Group): void {
  avatar.traverse((child: THREE.Object3D) => {
    if ((child as THREE.Mesh).isMesh) {
      const mesh = child as THREE.Mesh;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      (mats as THREE.Material[]).forEach((mat) => {
        (mat as THREE.MeshStandardMaterial).transparent = false;
        (mat as THREE.MeshStandardMaterial).opacity = 1.0;
      });
    }
  });
}

export function applyZombieSceneEffects(scene: THREE.Scene): void {
  scene.userData.zombieSavedBackground = (scene.background as THREE.Color | null)?.clone() ?? null;
  scene.userData.zombieSavedFog = scene.fog;
  scene.background = new THREE.Color(0x050505);
  scene.fog = new THREE.FogExp2(0x0a0a0a, 0.045);

  scene.traverse((obj: THREE.Object3D) => {
    if (
      obj instanceof THREE.AmbientLight ||
      obj instanceof THREE.DirectionalLight ||
      obj instanceof THREE.HemisphereLight
    ) {
      obj.userData.zombieSavedIntensity = obj.intensity;
      if (obj instanceof THREE.HemisphereLight) {
        obj.userData.zombieSavedSkyColor = obj.color.clone();
        obj.userData.zombieSavedGroundColor = obj.groundColor.clone();
        obj.color.set(0x1a0505);
        obj.groundColor.set(0x0a0000);
      } else {
        obj.userData.zombieSavedColor = (obj as THREE.DirectionalLight | THREE.AmbientLight).color.clone();
        (obj as THREE.DirectionalLight | THREE.AmbientLight).color.set(
          obj instanceof THREE.AmbientLight ? 0x330000 : 0x550000,
        );
      }
      obj.intensity *= 0.18;
    }
  });
}

export function removeZombieSceneEffects(scene: THREE.Scene): void {
  if (scene.userData.zombieSavedBackground !== undefined) {
    scene.background = scene.userData.zombieSavedBackground as THREE.Color | null;
    delete scene.userData.zombieSavedBackground;
  }
  if (scene.userData.zombieSavedFog !== undefined) {
    scene.fog = scene.userData.zombieSavedFog as THREE.Fog | THREE.FogExp2 | null;
    delete scene.userData.zombieSavedFog;
  }

  scene.traverse((obj: THREE.Object3D) => {
    if (
      (obj instanceof THREE.AmbientLight ||
        obj instanceof THREE.DirectionalLight ||
        obj instanceof THREE.HemisphereLight) &&
      obj.userData.zombieSavedIntensity !== undefined
    ) {
      obj.intensity = obj.userData.zombieSavedIntensity as number;
      if (obj instanceof THREE.HemisphereLight) {
        if (obj.userData.zombieSavedSkyColor) obj.color.copy(obj.userData.zombieSavedSkyColor as THREE.Color);
        if (obj.userData.zombieSavedGroundColor) obj.groundColor.copy(obj.userData.zombieSavedGroundColor as THREE.Color);
        delete obj.userData.zombieSavedSkyColor;
        delete obj.userData.zombieSavedGroundColor;
      } else {
        if (obj.userData.zombieSavedColor) {
          (obj as THREE.DirectionalLight | THREE.AmbientLight).color.copy(obj.userData.zombieSavedColor as THREE.Color);
        }
        delete obj.userData.zombieSavedColor;
      }
      delete obj.userData.zombieSavedIntensity;
    }
  });
}
