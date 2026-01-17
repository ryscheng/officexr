'use client';

import { useEffect, useRef, useState } from 'react';
import { useSession, signOut } from 'next-auth/react';
import * as THREE from 'three';
import { createAvatar, updateAvatar, AvatarData } from './Avatar';
import SettingsPanel from './SettingsPanel';
import { AvatarCustomization } from '@/types/avatar';

interface OfficeSceneProps {
  officeId: string;
  onLeave: () => void;
  onShowOfficeSelector?: () => void;
}

export default function OfficeScene({ officeId, onLeave, onShowOfficeSelector }: OfficeSceneProps) {
  const { data: session } = useSession();

  // Generate anonymous user data if not logged in
  const anonymousUserRef = useRef<{id: string, name: string} | null>(null);
  if (!session && !anonymousUserRef.current) {
    const randomId = `anon-${Math.random().toString(36).substr(2, 9)}`;
    const guestNumber = Math.floor(Math.random() * 1000);
    anonymousUserRef.current = {
      id: randomId,
      name: `Guest ${guestNumber}`,
    };
  }

  const currentUser = session?.user || anonymousUserRef.current;
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const avatarsRef = useRef<Map<string, THREE.Group>>(new Map());
  const [userCount, setUserCount] = useState(0);
  const lastPositionUpdate = useRef<number>(0);
  const [showSettings, setShowSettings] = useState(false);
  const [avatarCustomization, setAvatarCustomization] = useState<AvatarCustomization>({
    bodyColor: '#3498db',
    skinColor: '#ffdbac',
    style: 'default',
    accessories: [],
  });

  // Chat state
  interface ChatMessage {
    id: string;
    userId: string;
    userName: string;
    message: string;
    timestamp: number;
  }
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatVisible, setChatVisible] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const chatInputRef = useRef<HTMLInputElement>(null);
  const hideTimerRef = useRef<NodeJS.Timeout | null>(null);
  const keysRef = useRef<{ [key: string]: boolean }>({});

  // Load avatar customization from database
  useEffect(() => {
    if (!session?.user) return;

    fetch('/api/avatar')
      .then((res) => res.json())
      .then((data) => {
        if (data.customization) {
          setAvatarCustomization(data.customization);
        }
      })
      .catch((error) => {
        console.error('Error loading avatar customization:', error);
      });
  }, [session]);

  // Handle chat visibility and Enter key
  useEffect(() => {
    const handleChatKey = (event: KeyboardEvent) => {
      // Don't handle Enter if settings panel is open
      if (showSettings) return;

      if (event.key === 'Enter') {
        event.preventDefault();

        if (!chatVisible) {
          // Show chat
          setChatVisible(true);
          // Focus input after a brief delay to ensure it's rendered
          setTimeout(() => chatInputRef.current?.focus(), 50);
        } else if (chatInput.trim() === '') {
          // Hide chat if input is empty
          setChatVisible(false);
        } else {
          // Send message
          if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(
              JSON.stringify({
                type: 'chat',
                message: chatInput.trim(),
              })
            );
            setChatInput('');
          }
        }
      } else if (event.key === 'Escape' && chatVisible) {
        // Hide chat on Escape
        event.preventDefault();
        setChatVisible(false);
        setChatInput('');
      }
    };

    window.addEventListener('keydown', handleChatKey);
    return () => window.removeEventListener('keydown', handleChatKey);
  }, [chatVisible, chatInput, showSettings]);

  // Focus chat input when chat becomes visible
  useEffect(() => {
    if (chatVisible && chatInputRef.current) {
      chatInputRef.current.focus();
    }
  }, [chatVisible]);

  // Auto-hide chat after inactivity
  useEffect(() => {
    if (chatVisible && chatInput === '') {
      // Clear existing timer
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
      }

      // Set new timer to hide after 10 seconds of inactivity
      hideTimerRef.current = setTimeout(() => {
        setChatVisible(false);
      }, 10000);
    }

    return () => {
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
      }
    };
  }, [chatVisible, chatInput]);

  useEffect(() => {
    if (!containerRef.current || !currentUser) return;

    // Scene setup
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87ceeb);
    sceneRef.current = scene;

    // Camera setup
    const camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    camera.position.set(0, 1.6, 5);
    cameraRef.current = camera;

    // Renderer setup
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    // Only enable XR if available (desktop browsers may support it, mobile browsers typically don't)
    if (navigator.xr) {
      renderer.xr.enabled = true;
    }
    rendererRef.current = renderer;
    containerRef.current.appendChild(renderer.domElement);

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(5, 10, 5);
    directionalLight.castShadow = true;
    scene.add(directionalLight);

    // Floor
    const floorGeometry = new THREE.PlaneGeometry(20, 20);
    const floorMaterial = new THREE.MeshStandardMaterial({
      color: 0x808080,
      roughness: 0.8,
    });
    const floor = new THREE.Mesh(floorGeometry, floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    // Walls
    const wallMaterial = new THREE.MeshStandardMaterial({
      color: 0xf0f0f0,
      roughness: 0.7,
    });

    // Back wall
    const backWall = new THREE.Mesh(
      new THREE.BoxGeometry(20, 5, 0.2),
      wallMaterial
    );
    backWall.position.set(0, 2.5, -10);
    scene.add(backWall);

    // Left wall
    const leftWall = new THREE.Mesh(
      new THREE.BoxGeometry(0.2, 5, 20),
      wallMaterial
    );
    leftWall.position.set(-10, 2.5, 0);
    scene.add(leftWall);

    // Right wall
    const rightWall = new THREE.Mesh(
      new THREE.BoxGeometry(0.2, 5, 20),
      wallMaterial
    );
    rightWall.position.set(10, 2.5, 0);
    scene.add(rightWall);

    // Ceiling
    const ceiling = new THREE.Mesh(
      new THREE.PlaneGeometry(20, 20),
      new THREE.MeshStandardMaterial({ color: 0xffffff })
    );
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.y = 5;
    scene.add(ceiling);

    // Create desk
    const createDesk = (x: number, z: number) => {
      const deskGroup = new THREE.Group();

      // Desk top
      const deskTop = new THREE.Mesh(
        new THREE.BoxGeometry(2, 0.1, 1),
        new THREE.MeshStandardMaterial({ color: 0x8b4513 })
      );
      deskTop.position.y = 0.75;
      deskGroup.add(deskTop);

      // Desk legs
      const legGeometry = new THREE.BoxGeometry(0.1, 0.75, 0.1);
      const legMaterial = new THREE.MeshStandardMaterial({ color: 0x696969 });

      const positions = [
        [-0.9, 0.375, -0.4],
        [0.9, 0.375, -0.4],
        [-0.9, 0.375, 0.4],
        [0.9, 0.375, 0.4],
      ];

      positions.forEach((pos) => {
        const leg = new THREE.Mesh(legGeometry, legMaterial);
        leg.position.set(pos[0], pos[1], pos[2]);
        deskGroup.add(leg);
      });

      deskGroup.position.set(x, 0, z);
      return deskGroup;
    };

    // Create chair
    const createChair = (x: number, z: number, rotation: number = 0) => {
      const chairGroup = new THREE.Group();

      // Seat
      const seat = new THREE.Mesh(
        new THREE.BoxGeometry(0.5, 0.1, 0.5),
        new THREE.MeshStandardMaterial({ color: 0x000080 })
      );
      seat.position.y = 0.5;
      chairGroup.add(seat);

      // Backrest
      const backrest = new THREE.Mesh(
        new THREE.BoxGeometry(0.5, 0.5, 0.1),
        new THREE.MeshStandardMaterial({ color: 0x000080 })
      );
      backrest.position.set(0, 0.75, -0.2);
      chairGroup.add(backrest);

      // Legs
      const legGeometry = new THREE.CylinderGeometry(0.03, 0.03, 0.5);
      const legMaterial = new THREE.MeshStandardMaterial({ color: 0x696969 });

      const legPositions = [
        [-0.2, 0.25, -0.2],
        [0.2, 0.25, -0.2],
        [-0.2, 0.25, 0.2],
        [0.2, 0.25, 0.2],
      ];

      legPositions.forEach((pos) => {
        const leg = new THREE.Mesh(legGeometry, legMaterial);
        leg.position.set(pos[0], pos[1], pos[2]);
        chairGroup.add(leg);
      });

      chairGroup.position.set(x, 0, z);
      chairGroup.rotation.y = rotation;
      return chairGroup;
    };

    // Create bookshelf
    const createBookshelf = (x: number, z: number) => {
      const shelfGroup = new THREE.Group();

      // Main structure
      const structure = new THREE.Mesh(
        new THREE.BoxGeometry(1.5, 2, 0.4),
        new THREE.MeshStandardMaterial({ color: 0x654321 })
      );
      structure.position.y = 1;
      shelfGroup.add(structure);

      // Shelves
      for (let i = 0; i < 4; i++) {
        const shelf = new THREE.Mesh(
          new THREE.BoxGeometry(1.4, 0.05, 0.38),
          new THREE.MeshStandardMaterial({ color: 0x8b4513 })
        );
        shelf.position.set(0, 0.2 + i * 0.5, 0);
        shelfGroup.add(shelf);
      }

      shelfGroup.position.set(x, 0, z);
      return shelfGroup;
    };

    // Add office furniture
    scene.add(createDesk(-5, -5));
    scene.add(createChair(-5, -3.5, Math.PI)); // Rotate 180° to face desk

    scene.add(createDesk(5, -5));
    scene.add(createChair(5, -3.5, Math.PI)); // Rotate 180° to face desk

    scene.add(createDesk(-5, 5));
    scene.add(createChair(-5, 6.5, Math.PI)); // Rotate 180° to face desk

    scene.add(createBookshelf(8, -8));
    scene.add(createBookshelf(8, 0));

    // Add some decorative elements (pictures on wall)
    const pictureGeometry = new THREE.PlaneGeometry(1, 0.7);
    const pictureMaterial = new THREE.MeshStandardMaterial({ color: 0xff6347 });
    const picture = new THREE.Mesh(pictureGeometry, pictureMaterial);
    picture.position.set(0, 2.5, -9.9);
    scene.add(picture);

    // Movement variables
    const moveSpeed = 0.1;
    const keys = keysRef.current;

    // Keyboard controls
    const handleKeyDown = (event: KeyboardEvent) => {
      keys[event.key.toLowerCase()] = true;
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      keys[event.key.toLowerCase()] = false;
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    // Mouse controls for looking around
    let mouseDown = false;

    const handleMouseDown = () => {
      mouseDown = true;
    };

    const handleMouseUp = () => {
      mouseDown = false;
    };

    const handleMouseMove = (event: MouseEvent) => {
      if (mouseDown) {
        const deltaX = event.movementX || 0;
        const deltaY = event.movementY || 0;

        camera.rotation.y -= deltaX * 0.002;
        camera.rotation.x -= deltaY * 0.002;
        camera.rotation.x = Math.max(
          -Math.PI / 2,
          Math.min(Math.PI / 2, camera.rotation.x)
        );
      }
    };

    renderer.domElement.addEventListener('mousedown', handleMouseDown);
    renderer.domElement.addEventListener('mouseup', handleMouseUp);
    renderer.domElement.addEventListener('mousemove', handleMouseMove);

    // Touch controls for mobile
    let touchStartX = 0;
    let touchStartY = 0;
    let isTouching = false;

    const handleTouchStart = (event: TouchEvent) => {
      if (event.touches.length === 1) {
        isTouching = true;
        touchStartX = event.touches[0].clientX;
        touchStartY = event.touches[0].clientY;
      }
    };

    const handleTouchMove = (event: TouchEvent) => {
      if (isTouching && event.touches.length === 1) {
        const touchX = event.touches[0].clientX;
        const touchY = event.touches[0].clientY;
        const deltaX = touchX - touchStartX;
        const deltaY = touchY - touchStartY;

        camera.rotation.y -= deltaX * 0.002;
        camera.rotation.x -= deltaY * 0.002;
        camera.rotation.x = Math.max(
          -Math.PI / 2,
          Math.min(Math.PI / 2, camera.rotation.x)
        );

        touchStartX = touchX;
        touchStartY = touchY;
      }
    };

    const handleTouchEnd = () => {
      isTouching = false;
    };

    renderer.domElement.addEventListener('touchstart', handleTouchStart, { passive: true });
    renderer.domElement.addEventListener('touchmove', handleTouchMove, { passive: true });
    renderer.domElement.addEventListener('touchend', handleTouchEnd);

    // Handle window resize
    const handleResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };

    window.addEventListener('resize', handleResize);

    // WebSocket connection
    const connectWebSocket = () => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${protocol}//${window.location.host}/api/ws`);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('WebSocket connected');
        // Send join message
        ws.send(
          JSON.stringify({
            type: 'join',
            userId: currentUser!.id,
            officeId: officeId,
            name: currentUser!.name,
            image: session?.user?.image || null,
            position: {
              x: camera.position.x,
              y: camera.position.y,
              z: camera.position.z,
            },
            rotation: {
              x: camera.rotation.x,
              y: camera.rotation.y,
              z: camera.rotation.z,
            },
            customization: avatarCustomization,
          })
        );
      };

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);

        switch (data.type) {
          case 'users':
            // Add existing users
            data.users.forEach((user: AvatarData) => {
              if (!avatarsRef.current.has(user.id)) {
                const avatar = createAvatar(scene, user);
                avatarsRef.current.set(user.id, avatar);
              }
            });
            setUserCount(data.users.length + 1);
            break;

          case 'user-joined':
            // Add new user
            if (!avatarsRef.current.has(data.user.id)) {
              const avatar = createAvatar(scene, data.user);
              avatarsRef.current.set(data.user.id, avatar);
              setUserCount((prev) => prev + 1);
            }
            break;

          case 'user-left':
            // Remove user
            const avatar = avatarsRef.current.get(data.userId);
            if (avatar) {
              scene.remove(avatar);
              avatarsRef.current.delete(data.userId);
              setUserCount((prev) => Math.max(0, prev - 1));
            }
            break;

          case 'position':
            // Update user position
            const userAvatar = avatarsRef.current.get(data.userId);
            if (userAvatar) {
              updateAvatar(userAvatar, data.position, data.rotation);
            }
            break;

          case 'avatar-update':
            // Update user avatar customization
            const existingAvatar = avatarsRef.current.get(data.userId);
            if (existingAvatar) {
              // Remove old avatar
              scene.remove(existingAvatar);

              // Create new avatar with updated customization
              const oldData = existingAvatar.userData as AvatarData;
              const newAvatarData: AvatarData = {
                id: oldData.id,
                name: oldData.name,
                image: oldData.image,
                position: oldData.position,
                rotation: oldData.rotation,
                customization: data.customization,
              };
              const newAvatar = createAvatar(scene, newAvatarData);
              avatarsRef.current.set(data.userId, newAvatar);
            }
            break;

          case 'chat-history':
            // Load chat history
            setChatMessages(data.messages);
            break;

          case 'chat':
            // Receive new chat message
            setChatMessages((prev) => [...prev, data.message]);
            break;
        }
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
      };

      ws.onclose = () => {
        console.log('WebSocket disconnected');
        // Attempt to reconnect after 3 seconds
        setTimeout(connectWebSocket, 3000);
      };
    };

    connectWebSocket();

    // Animation loop
    const animate = () => {
      // Handle movement
      const direction = new THREE.Vector3();
      const forward = new THREE.Vector3();
      const right = new THREE.Vector3();

      camera.getWorldDirection(forward);
      forward.y = 0;
      forward.normalize();

      right.crossVectors(forward, new THREE.Vector3(0, 1, 0));

      let moved = false;

      if (keys['w'] || keys['arrowup']) {
        direction.add(forward);
        moved = true;
      }
      if (keys['s'] || keys['arrowdown']) {
        direction.sub(forward);
        moved = true;
      }
      if (keys['a'] || keys['arrowleft']) {
        direction.sub(right);
        moved = true;
      }
      if (keys['d'] || keys['arrowright']) {
        direction.add(right);
        moved = true;
      }

      if (direction.length() > 0) {
        direction.normalize();
        camera.position.add(direction.multiplyScalar(moveSpeed));

        // Keep camera within bounds
        camera.position.x = Math.max(-9, Math.min(9, camera.position.x));
        camera.position.z = Math.max(-9, Math.min(9, camera.position.z));
      }

      // Send position updates to server (throttled to 60ms)
      const now = Date.now();
      if (
        moved &&
        wsRef.current?.readyState === WebSocket.OPEN &&
        now - lastPositionUpdate.current > 60
      ) {
        wsRef.current.send(
          JSON.stringify({
            type: 'position',
            position: {
              x: camera.position.x,
              y: camera.position.y,
              z: camera.position.z,
            },
            rotation: {
              x: camera.rotation.x,
              y: camera.rotation.y,
              z: camera.rotation.z,
            },
          })
        );
        lastPositionUpdate.current = now;
      }

      renderer.render(scene, camera);
    };

    renderer.setAnimationLoop(animate);

    // Create VR button
    const createVRButton = () => {
      const button = document.createElement('button');
      button.style.position = 'absolute';
      button.style.bottom = '20px';
      button.style.left = '50%';
      button.style.transform = 'translateX(-50%)';
      button.style.padding = '12px 24px';
      button.style.border = 'none';
      button.style.borderRadius = '4px';
      button.style.background = '#1a73e8';
      button.style.color = 'white';
      button.style.fontSize = '16px';
      button.style.cursor = 'pointer';
      button.style.zIndex = '999';
      button.textContent = 'ENTER VR';

      button.onclick = () => {
        if (renderer.xr.isPresenting) {
          renderer.xr.getSession()?.end();
        } else {
          renderer.domElement.requestFullscreen?.();
          navigator.xr
            ?.requestSession('immersive-vr', {
              optionalFeatures: ['local-floor', 'bounded-floor'],
            })
            .then((session) => {
              renderer.xr.setSession(session);
            })
            .catch((err) => {
              console.error('Error starting VR session:', err);
              alert('WebXR not supported or VR device not connected');
            });
        }
      };

      // Check if WebXR is available
      if (navigator.xr) {
        navigator.xr.isSessionSupported('immersive-vr').then((supported) => {
          if (supported) {
            document.body.appendChild(button);
          } else {
            button.textContent = 'VR NOT SUPPORTED';
            button.style.background = '#666';
            button.style.cursor = 'not-allowed';
            document.body.appendChild(button);
          }
        });
      } else {
        button.textContent = 'WEBXR NOT AVAILABLE';
        button.style.background = '#666';
        button.style.cursor = 'not-allowed';
        document.body.appendChild(button);
      }

      return button;
    };

    const vrButton = createVRButton();

    // Cleanup
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('resize', handleResize);
      renderer.domElement.removeEventListener('mousedown', handleMouseDown);
      renderer.domElement.removeEventListener('mouseup', handleMouseUp);
      renderer.domElement.removeEventListener('mousemove', handleMouseMove);
      renderer.domElement.removeEventListener('touchstart', handleTouchStart);
      renderer.domElement.removeEventListener('touchmove', handleTouchMove);
      renderer.domElement.removeEventListener('touchend', handleTouchEnd);

      if (wsRef.current) {
        wsRef.current.close();
      }

      if (vrButton && vrButton.parentNode) {
        vrButton.parentNode.removeChild(vrButton);
      }

      if (containerRef.current && renderer.domElement.parentNode) {
        containerRef.current.removeChild(renderer.domElement);
      }

      renderer.dispose();
    };
  }, [avatarCustomization, officeId, currentUser]);

  const handleSaveSettings = async (settings: AvatarCustomization) => {
    try {
      const response = await fetch('/api/avatar', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(settings),
      });

      if (!response.ok) {
        throw new Error('Failed to save settings');
      }

      setAvatarCustomization(settings);

      // Broadcast avatar update to other users
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: 'avatar-update',
            customization: settings,
          })
        );
      }
    } catch (error) {
      console.error('Error saving avatar settings:', error);
      throw error;
    }
  };

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100vh' }}>
      <div
        style={{
          position: 'absolute',
          top: '20px',
          left: '20px',
          color: 'white',
          background: 'rgba(0, 0, 0, 0.7)',
          padding: '15px',
          borderRadius: '8px',
          fontFamily: 'monospace',
          zIndex: 100,
        }}
      >
        <h3 style={{ margin: '0 0 10px 0' }}>Controls:</h3>
        <p style={{ margin: '5px 0' }}>W/A/S/D or Arrow Keys - Move</p>
        <p style={{ margin: '5px 0' }}>Mouse/Touch Drag - Look Around</p>
        <p style={{ margin: '5px 0' }}>Enter - Chat</p>
      </div>

      <div
        style={{
          position: 'absolute',
          top: '20px',
          right: '20px',
          color: 'white',
          background: 'rgba(0, 0, 0, 0.7)',
          padding: '15px',
          borderRadius: '8px',
          fontFamily: 'monospace',
          zIndex: 100,
        }}
      >
        <p style={{ margin: '5px 0' }}>
          <strong>{currentUser?.name}</strong>
          {!session && <span style={{ color: '#888', fontSize: '12px' }}> (Guest)</span>}
        </p>
        <p style={{ margin: '5px 0' }}>Users online: {userCount}</p>
        <p style={{ margin: '5px 0', fontSize: '12px', color: '#888' }}>
          Office: {officeId === 'global' ? 'Global' : 'Private'}
        </p>

        {session ? (
          <>
            {session && (
              <button
                onClick={() => setShowSettings(true)}
                style={{
                  marginTop: '10px',
                  padding: '8px 16px',
                  background: '#3498db',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '14px',
                  width: '100%',
                }}
              >
                ⚙️ Avatar Settings
              </button>
            )}
            {onShowOfficeSelector && officeId !== 'global' && (
              <button
                onClick={onShowOfficeSelector}
                style={{
                  marginTop: '10px',
                  padding: '8px 16px',
                  background: '#8b5cf6',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '14px',
                  width: '100%',
                }}
              >
                🏢 My Offices
              </button>
            )}
            {officeId !== 'global' && (
              <button
                onClick={onLeave}
                style={{
                  marginTop: '10px',
                  padding: '8px 16px',
                  background: '#f59e0b',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer',
                  fontSize: '14px',
                  width: '100%',
                }}
              >
                🚪 Leave Office
              </button>
            )}
            <button
              onClick={() => signOut()}
              style={{
                marginTop: '10px',
                padding: '8px 16px',
                background: '#dc2626',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '14px',
                width: '100%',
              }}
            >
              Sign Out
            </button>
          </>
        ) : (
          <button
            onClick={() => window.location.href = '/login'}
            style={{
              marginTop: '10px',
              padding: '8px 16px',
              background: '#10b981',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
              fontSize: '14px',
              width: '100%',
            }}
          >
            🔑 Sign In
          </button>
        )}
      </div>

      <SettingsPanel
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        currentSettings={avatarCustomization}
        onSave={handleSaveSettings}
      />

      {/* Chat UI */}
      {chatVisible && (
        <div
          style={{
            position: 'absolute',
            bottom: '20px',
            left: '20px',
            width: '400px',
            maxHeight: '300px',
            background: 'rgba(0, 0, 0, 0.8)',
            borderRadius: '8px',
            padding: '10px',
            color: 'white',
            fontFamily: 'monospace',
            zIndex: 100,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {/* Messages */}
          <div
            style={{
              flex: 1,
              overflowY: 'auto',
              marginBottom: '10px',
              maxHeight: '220px',
            }}
          >
            {chatMessages.slice(-10).map((msg) => (
              <div
                key={msg.id}
                style={{
                  marginBottom: '8px',
                  wordWrap: 'break-word',
                }}
              >
                <span
                  style={{
                    color: msg.userId === session?.user?.id ? '#3498db' : '#2ecc71',
                    fontWeight: 'bold',
                  }}
                >
                  {msg.userName}
                </span>
                : {msg.message}
              </div>
            ))}
            {chatMessages.length === 0 && (
              <div style={{ color: '#888', fontSize: '14px' }}>
                No messages yet. Type a message and press Enter to send.
              </div>
            )}
          </div>

          {/* Input */}
          <input
            ref={chatInputRef}
            type="text"
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            placeholder="Type a message... (Esc to close)"
            style={{
              width: '100%',
              padding: '8px',
              background: 'rgba(255, 255, 255, 0.1)',
              border: '1px solid rgba(255, 255, 255, 0.3)',
              borderRadius: '4px',
              color: 'white',
              fontSize: '14px',
              outline: 'none',
            }}
          />
        </div>
      )}

      {/* Chat hint when hidden */}
      {!chatVisible && !showSettings && (
        <div
          style={{
            position: 'absolute',
            bottom: '20px',
            left: '20px',
            padding: '8px 12px',
            background: 'rgba(0, 0, 0, 0.6)',
            color: 'white',
            borderRadius: '4px',
            fontSize: '12px',
            fontFamily: 'monospace',
            zIndex: 100,
          }}
        >
          Press Enter to chat
        </div>
      )}

      {/* Mobile Navigation Controls */}
      <div
        style={{
          position: 'absolute',
          bottom: '20px',
          right: '20px',
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 60px)',
          gridTemplateRows: 'repeat(3, 60px)',
          gap: '5px',
          zIndex: 100,
        }}
        onTouchStart={(e) => e.preventDefault()}
      >
        {/* Forward */}
        <div style={{ gridColumn: '2', gridRow: '1' }}>
          <button
            onTouchStart={() => { keysRef.current['w'] = true; }}
            onTouchEnd={() => { keysRef.current['w'] = false; }}
            onMouseDown={() => { keysRef.current['w'] = true; }}
            onMouseUp={() => { keysRef.current['w'] = false; }}
            onMouseLeave={() => { keysRef.current['w'] = false; }}
            style={{
              width: '100%',
              height: '100%',
              background: 'rgba(255, 255, 255, 0.3)',
              border: '2px solid rgba(255, 255, 255, 0.5)',
              borderRadius: '8px',
              color: 'white',
              fontSize: '24px',
              cursor: 'pointer',
              userSelect: 'none',
              touchAction: 'none',
            }}
          >
            ▲
          </button>
        </div>

        {/* Left */}
        <div style={{ gridColumn: '1', gridRow: '2' }}>
          <button
            onTouchStart={() => { keysRef.current['a'] = true; }}
            onTouchEnd={() => { keysRef.current['a'] = false; }}
            onMouseDown={() => { keysRef.current['a'] = true; }}
            onMouseUp={() => { keysRef.current['a'] = false; }}
            onMouseLeave={() => { keysRef.current['a'] = false; }}
            style={{
              width: '100%',
              height: '100%',
              background: 'rgba(255, 255, 255, 0.3)',
              border: '2px solid rgba(255, 255, 255, 0.5)',
              borderRadius: '8px',
              color: 'white',
              fontSize: '24px',
              cursor: 'pointer',
              userSelect: 'none',
              touchAction: 'none',
            }}
          >
            ◄
          </button>
        </div>

        {/* Backward */}
        <div style={{ gridColumn: '2', gridRow: '2' }}>
          <button
            onTouchStart={() => { keysRef.current['s'] = true; }}
            onTouchEnd={() => { keysRef.current['s'] = false; }}
            onMouseDown={() => { keysRef.current['s'] = true; }}
            onMouseUp={() => { keysRef.current['s'] = false; }}
            onMouseLeave={() => { keysRef.current['s'] = false; }}
            style={{
              width: '100%',
              height: '100%',
              background: 'rgba(255, 255, 255, 0.3)',
              border: '2px solid rgba(255, 255, 255, 0.5)',
              borderRadius: '8px',
              color: 'white',
              fontSize: '24px',
              cursor: 'pointer',
              userSelect: 'none',
              touchAction: 'none',
            }}
          >
            ▼
          </button>
        </div>

        {/* Right */}
        <div style={{ gridColumn: '3', gridRow: '2' }}>
          <button
            onTouchStart={() => { keysRef.current['d'] = true; }}
            onTouchEnd={() => { keysRef.current['d'] = false; }}
            onMouseDown={() => { keysRef.current['d'] = true; }}
            onMouseUp={() => { keysRef.current['d'] = false; }}
            onMouseLeave={() => { keysRef.current['d'] = false; }}
            style={{
              width: '100%',
              height: '100%',
              background: 'rgba(255, 255, 255, 0.3)',
              border: '2px solid rgba(255, 255, 255, 0.5)',
              borderRadius: '8px',
              color: 'white',
              fontSize: '24px',
              cursor: 'pointer',
              userSelect: 'none',
              touchAction: 'none',
            }}
          >
            ►
          </button>
        </div>
      </div>
    </div>
  );
}
