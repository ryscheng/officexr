import { useEffect, useRef, useCallback } from 'react';
import * as THREE from 'three';
import { AvatarCustomization } from '@/types/avatar';
import { buildAvatarForPreview } from './Avatar';

interface AvatarPreviewProps {
  customization: AvatarCustomization;
}

export default function AvatarPreview({ customization }: AvatarPreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const groupRef = useRef<THREE.Group | null>(null);
  const eyesRef = useRef<THREE.Mesh[]>([]);
  const mouseRef = useRef({ x: 0, y: 0 });
  const rafRef = useRef<number>(0);

  // Rebuild avatar when customization changes
  const rebuildAvatar = useCallback((scene: THREE.Scene, newCustomization: AvatarCustomization) => {
    // Remove old avatar group
    if (groupRef.current) {
      scene.remove(groupRef.current);
      groupRef.current.traverse(child => {
        if ((child as THREE.Mesh).isMesh) {
          const mesh = child as THREE.Mesh;
          mesh.geometry.dispose();
          if (Array.isArray(mesh.material)) mesh.material.forEach(m => m.dispose());
          else mesh.material.dispose();
        }
      });
    }

    const { group, eyes } = buildAvatarForPreview(newCustomization);
    scene.add(group);
    groupRef.current = group;
    eyesRef.current = eyes;
  }, []);

  // Init renderer + scene once
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const size = 200;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(size, size);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setClearColor(0x000000, 0);
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const dir = new THREE.DirectionalLight(0xffffff, 0.8);
    dir.position.set(2, 3, 4);
    scene.add(dir);

    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 10);
    camera.position.set(0, 0.85, 2.0);
    camera.lookAt(0, 0.65, 0);
    cameraRef.current = camera;

    rebuildAvatar(scene, customization);

    const clock = new THREE.Clock();
    const animate = () => {
      rafRef.current = requestAnimationFrame(animate);
      const elapsed = clock.getElapsedTime();

      // Slow idle rotation
      if (groupRef.current) {
        groupRef.current.rotation.y = Math.sin(elapsed * 0.5) * 0.3;
      }

      // Eye tracking — offset eyes toward mouse
      const mx = mouseRef.current.x;
      const my = mouseRef.current.y;
      for (const eye of eyesRef.current) {
        const { restX, restY, restZ } = eye.userData;
        eye.position.x = restX + mx * 0.02;
        eye.position.y = restY + my * 0.012;
        eye.position.z = restZ + Math.abs(mx) * 0.005;
      }

      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(rafRef.current);
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Rebuild when customization changes
  useEffect(() => {
    if (sceneRef.current) {
      rebuildAvatar(sceneRef.current, customization);
    }
  }, [customization, rebuildAvatar]);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    mouseRef.current = {
      x: ((e.clientX - rect.left) / rect.width - 0.5) * 2,
      y: -((e.clientY - rect.top) / rect.height - 0.5) * 2,
    };
  };

  const handleMouseLeave = () => {
    mouseRef.current = { x: 0, y: 0 };
  };

  return (
    <div
      ref={containerRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      style={{
        width: 200,
        height: 200,
        borderRadius: '12px',
        overflow: 'hidden',
        background: 'linear-gradient(135deg, #e8eaf6, #f3e5f5)',
        cursor: 'crosshair',
      }}
    />
  );
}
