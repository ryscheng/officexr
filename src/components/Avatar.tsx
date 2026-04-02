import * as THREE from 'three';
import { AvatarCustomization } from '@/types/avatar';

export interface AvatarData {
  id: string;
  name: string;
  image?: string | null;
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
  customization?: AvatarCustomization;
}

export function createAvatar(
  scene: THREE.Scene,
  userData: AvatarData
): THREE.Group {
  const avatarGroup = new THREE.Group();
  const customization = userData.customization || {
    bodyColor: getColorHexFromId(userData.id),
    skinColor: '#ffdbac',
    style: 'default' as const,
    accessories: [],
  };

  // Body style based on customization
  const bodyScale = customization.style === 'athletic' ? { radius: 0.22, height: 0.9 } :
                   customization.style === 'formal' ? { radius: 0.18, height: 0.85 } :
                   { radius: 0.2, height: 0.8 };

  // Create avatar body
  const bodyGeometry = new THREE.CylinderGeometry(bodyScale.radius, bodyScale.radius, bodyScale.height, 8);
  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: customization.bodyColor,
  });
  const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
  body.position.y = 0.4;
  avatarGroup.add(body);

  // Head (sphere)
  const headGeometry = new THREE.SphereGeometry(0.15, 16, 16);
  const headMaterial = new THREE.MeshStandardMaterial({
    color: customization.skinColor,
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

  // Add accessories
  customization.accessories.forEach((accessory) => {
    switch (accessory) {
      case 'hat':
        const hatGeometry = new THREE.CylinderGeometry(0.18, 0.2, 0.1, 8);
        const hatMaterial = new THREE.MeshStandardMaterial({ color: 0x333333 });
        const hat = new THREE.Mesh(hatGeometry, hatMaterial);
        hat.position.y = 1.1;
        avatarGroup.add(hat);
        break;

      case 'glasses':
        const glassesGeometry = new THREE.TorusGeometry(0.05, 0.01, 8, 16);
        const glassesMaterial = new THREE.MeshStandardMaterial({ color: 0x000000 });

        const leftGlass = new THREE.Mesh(glassesGeometry, glassesMaterial);
        leftGlass.position.set(-0.06, 0.98, 0.12);
        leftGlass.rotation.y = Math.PI / 2;
        avatarGroup.add(leftGlass);

        const rightGlass = new THREE.Mesh(glassesGeometry, glassesMaterial);
        rightGlass.position.set(0.06, 0.98, 0.12);
        rightGlass.rotation.y = Math.PI / 2;
        avatarGroup.add(rightGlass);

        // Bridge
        const bridgeGeometry = new THREE.BoxGeometry(0.05, 0.01, 0.01);
        const bridge = new THREE.Mesh(bridgeGeometry, glassesMaterial);
        bridge.position.set(0, 0.98, 0.12);
        avatarGroup.add(bridge);
        break;

      case 'backpack':
        const backpackGeometry = new THREE.BoxGeometry(0.25, 0.3, 0.15);
        const backpackMaterial = new THREE.MeshStandardMaterial({ color: 0x8b4513 });
        const backpack = new THREE.Mesh(backpackGeometry, backpackMaterial);
        backpack.position.set(0, 0.5, -0.25);
        avatarGroup.add(backpack);
        break;

      case 'headphones':
        const headbandGeometry = new THREE.TorusGeometry(0.17, 0.02, 8, 16, Math.PI);
        const headphoneMaterial = new THREE.MeshStandardMaterial({ color: 0x1a1a1a });
        const headband = new THREE.Mesh(headbandGeometry, headphoneMaterial);
        headband.position.y = 1.05;
        headband.rotation.z = Math.PI;
        avatarGroup.add(headband);

        const earPieceGeometry = new THREE.SphereGeometry(0.06, 8, 8);
        const leftEarPiece = new THREE.Mesh(earPieceGeometry, headphoneMaterial);
        leftEarPiece.position.set(-0.18, 0.95, 0);
        avatarGroup.add(leftEarPiece);

        const rightEarPiece = new THREE.Mesh(earPieceGeometry, headphoneMaterial);
        rightEarPiece.position.set(0.18, 0.95, 0);
        avatarGroup.add(rightEarPiece);
        break;

      case 'tie':
        const tieGeometry = new THREE.BoxGeometry(0.08, 0.4, 0.02);
        const tieMaterial = new THREE.MeshStandardMaterial({ color: 0x8b0000 });
        const tie = new THREE.Mesh(tieGeometry, tieMaterial);
        tie.position.set(0, 0.5, 0.21);
        avatarGroup.add(tie);
        break;

      case 'scarf':
        const scarfGeometry = new THREE.TorusGeometry(0.22, 0.04, 8, 16);
        const scarfMaterial = new THREE.MeshStandardMaterial({ color: 0xff6347 });
        const scarf = new THREE.Mesh(scarfGeometry, scarfMaterial);
        scarf.position.y = 0.85;
        scarf.rotation.x = Math.PI / 2;
        avatarGroup.add(scarf);
        break;
    }
  });

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

// Generate a consistent hex color based on user ID
function getColorHexFromId(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = id.charCodeAt(i) + ((hash << 5) - hash);
  }

  const colors = [
    '#3498db', // Blue
    '#e74c3c', // Red
    '#2ecc71', // Green
    '#f39c12', // Orange
    '#9b59b6', // Purple
    '#1abc9c', // Turquoise
    '#f1c40f', // Yellow
    '#e67e22', // Dark Orange
  ];

  return colors[Math.abs(hash) % colors.length];
}
