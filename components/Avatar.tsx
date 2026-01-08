import * as THREE from 'three';
import { useEffect, useRef } from 'react';

export interface AvatarData {
  id: string;
  name: string;
  image?: string | null;
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
}

export function createAvatar(
  scene: THREE.Scene,
  userData: AvatarData
): THREE.Group {
  const avatarGroup = new THREE.Group();

  // Create a simple avatar representation
  // Body (cylinder)
  const bodyGeometry = new THREE.CylinderGeometry(0.2, 0.2, 0.8, 8);
  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: getColorFromId(userData.id),
  });
  const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
  body.position.y = 0.4;
  avatarGroup.add(body);

  // Head (sphere)
  const headGeometry = new THREE.SphereGeometry(0.15, 16, 16);
  const headMaterial = new THREE.MeshStandardMaterial({
    color: 0xffdbac, // Skin tone
  });
  const head = new THREE.Mesh(headGeometry, headMaterial);
  head.position.y = 0.95;
  avatarGroup.add(head);

  // Eyes
  const eyeGeometry = new THREE.SphereGeometry(0.03, 8, 8);
  const eyeMaterial = new THREE.MeshStandardMaterial({ color: 0x000000 });

  const leftEye = new THREE.Mesh(eyeGeometry, eyeMaterial);
  leftEye.position.set(-0.06, 0.98, 0.12);
  avatarGroup.add(leftEye);

  const rightEye = new THREE.Mesh(eyeGeometry, eyeMaterial);
  rightEye.position.set(0.06, 0.98, 0.12);
  avatarGroup.add(rightEye);

  // Name tag
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (context) {
    canvas.width = 256;
    canvas.height = 64;
    context.fillStyle = 'rgba(0, 0, 0, 0.7)';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.font = 'bold 24px Arial';
    context.fillStyle = 'white';
    context.textAlign = 'center';
    context.fillText(userData.name || 'User', canvas.width / 2, 40);
  }

  const texture = new THREE.CanvasTexture(canvas);
  const nameTagMaterial = new THREE.SpriteMaterial({ map: texture });
  const nameTag = new THREE.Sprite(nameTagMaterial);
  nameTag.scale.set(1, 0.25, 1);
  nameTag.position.y = 1.4;
  avatarGroup.add(nameTag);

  // Set position and rotation
  avatarGroup.position.set(
    userData.position.x,
    userData.position.y,
    userData.position.z
  );
  avatarGroup.rotation.set(
    userData.rotation.x,
    userData.rotation.y,
    userData.rotation.z
  );

  // Store user data
  avatarGroup.userData = userData;

  scene.add(avatarGroup);
  return avatarGroup;
}

export function updateAvatar(
  avatar: THREE.Group,
  position: { x: number; y: number; z: number },
  rotation: { x: number; y: number; z: number }
) {
  // Smooth interpolation
  avatar.position.lerp(new THREE.Vector3(position.x, position.y, position.z), 0.1);
  avatar.rotation.y = rotation.y;
}

// Generate a consistent color based on user ID
function getColorFromId(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = id.charCodeAt(i) + ((hash << 5) - hash);
  }

  const colors = [
    0x3498db, // Blue
    0xe74c3c, // Red
    0x2ecc71, // Green
    0xf39c12, // Orange
    0x9b59b6, // Purple
    0x1abc9c, // Turquoise
    0xf1c40f, // Yellow
    0xe67e22, // Dark Orange
  ];

  return colors[Math.abs(hash) % colors.length];
}
