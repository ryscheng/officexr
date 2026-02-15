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
  const chatVisibleRef = useRef<boolean>(false);
  const keysRef = useRef<{ [key: string]: boolean }>({});

  // Environment settings
  type EnvironmentType = 'corporate' | 'cabin' | 'coffeeshop';
  const [environment, setEnvironment] = useState<EnvironmentType>('corporate');

  // Load environment preference from localStorage
  useEffect(() => {
    const savedEnv = localStorage.getItem('officeEnvironment') as EnvironmentType;
    if (savedEnv && ['corporate', 'cabin', 'coffeeshop'].includes(savedEnv)) {
      setEnvironment(savedEnv);
    }
  }, []);

  // Save environment preference to localStorage
  const handleEnvironmentChange = (env: EnvironmentType) => {
    setEnvironment(env);
    localStorage.setItem('officeEnvironment', env);
  };

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

  // Sync chatVisible ref and clear navigation keys when chat opens
  useEffect(() => {
    chatVisibleRef.current = chatVisible;

    // Clear all navigation keys when chat opens to stop movement
    if (chatVisible) {
      const keys = keysRef.current;
      keys['w'] = false;
      keys['a'] = false;
      keys['s'] = false;
      keys['d'] = false;
      keys['arrowup'] = false;
      keys['arrowdown'] = false;
      keys['arrowleft'] = false;
      keys['arrowright'] = false;
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

    // Build environment based on selection
    const buildEnvironment = () => {
      if (environment === 'corporate') {
        // Corporate Office - Skysc skyscraper with city view
        scene.background = new THREE.Color(0x87ceeb);

        // Floor - polished marble
        const floor = new THREE.Mesh(
          new THREE.PlaneGeometry(30, 30),
          new THREE.MeshStandardMaterial({
            color: 0x2a2a2a,
            roughness: 0.1,
            metalness: 0.6,
          })
        );
        floor.rotation.x = -Math.PI / 2;
        floor.receiveShadow = true;
        scene.add(floor);

        // Glass walls with city view
        const glassWalls = new THREE.Mesh(
          new THREE.BoxGeometry(30, 10, 30),
          new THREE.MeshStandardMaterial({
            color: 0x88ccff,
            transparent: true,
            opacity: 0.3,
            metalness: 0.9,
            roughness: 0.1,
          })
        );
        glassWalls.position.y = 5;
        scene.add(glassWalls);

        // Window frames
        for (let i = -15; i <= 15; i += 5) {
          const frame = new THREE.Mesh(
            new THREE.BoxGeometry(0.2, 10, 0.1),
            new THREE.MeshStandardMaterial({ color: 0x333333 })
          );
          frame.position.set(i, 5, -15);
          scene.add(frame);
        }

        // Modern desk
        const deskTop = new THREE.Mesh(
          new THREE.BoxGeometry(3, 0.05, 1.5),
          new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.2 })
        );
        deskTop.position.set(0, 0.75, -5);
        scene.add(deskTop);

        // Desk legs
        [-1.4, 1.4].forEach((x) => {
          const leg = new THREE.Mesh(
            new THREE.BoxGeometry(0.1, 0.75, 1.4),
            new THREE.MeshStandardMaterial({ color: 0x666666 })
          );
          leg.position.set(x, 0.375, -5);
          scene.add(leg);
        });

        // Executive chair
        const chairSeat = new THREE.Mesh(
          new THREE.CylinderGeometry(0.4, 0.4, 0.1, 32),
          new THREE.MeshStandardMaterial({ color: 0x1a1a1a })
        );
        chairSeat.position.set(0, 0.5, -3.5);
        scene.add(chairSeat);

        const chairBack = new THREE.Mesh(
          new THREE.BoxGeometry(0.7, 0.8, 0.1),
          new THREE.MeshStandardMaterial({ color: 0x1a1a1a })
        );
        chairBack.position.set(0, 0.9, -3.7);
        scene.add(chairBack);

        // Conference table
        const confTable = new THREE.Mesh(
          new THREE.BoxGeometry(6, 0.08, 3),
          new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.2, metalness: 0.5 })
        );
        confTable.position.set(-8, 0.75, 5);
        scene.add(confTable);

        // Chairs around conference table
        [[-9, 3], [-7, 3], [-9, 7], [-7, 7]].forEach(([x, z]) => {
          const chair = new THREE.Mesh(
            new THREE.BoxGeometry(0.5, 0.5, 0.5),
            new THREE.MeshStandardMaterial({ color: 0x333333 })
          );
          chair.position.set(x, 0.5, z);
          scene.add(chair);
        });

        // Potted plants
        [[5, -10], [-5, -10]].forEach(([x, z]) => {
          const pot = new THREE.Mesh(
            new THREE.CylinderGeometry(0.3, 0.25, 0.6, 8),
            new THREE.MeshStandardMaterial({ color: 0x8b4513 })
          );
          pot.position.set(x, 0.3, z);
          scene.add(pot);

          const plant = new THREE.Mesh(
            new THREE.SphereGeometry(0.4, 8, 8),
            new THREE.MeshStandardMaterial({ color: 0x228b22 })
          );
          plant.position.set(x, 0.9, z);
          scene.add(plant);
        });

      } else if (environment === 'cabin') {
        // Cabin in the woods - warm and cozy
        scene.background = new THREE.Color(0x87a96b);

        // Wood floor
        const floor = new THREE.Mesh(
          new THREE.PlaneGeometry(25, 25),
          new THREE.MeshStandardMaterial({ color: 0x8b6914, roughness: 0.9 })
        );
        floor.rotation.x = -Math.PI / 2;
        scene.add(floor);

        // Log walls
        const wallMat = new THREE.MeshStandardMaterial({ color: 0x8b4513, roughness: 0.8 });

        [-12.5, 12.5].forEach((x) => {
          const wall = new THREE.Mesh(new THREE.BoxGeometry(0.5, 6, 25), wallMat);
          wall.position.set(x, 3, 0);
          scene.add(wall);
        });

        [-12.5, 12.5].forEach((z) => {
          const wall = new THREE.Mesh(new THREE.BoxGeometry(25, 6, 0.5), wallMat);
          wall.position.set(0, 3, z);
          scene.add(wall);
        });

        // Wooden ceiling
        const ceiling = new THREE.Mesh(
          new THREE.PlaneGeometry(25, 25),
          new THREE.MeshStandardMaterial({ color: 0x654321 })
        );
        ceiling.rotation.x = Math.PI / 2;
        ceiling.position.y = 6;
        scene.add(ceiling);

        // Fireplace
        const fireplace = new THREE.Mesh(
          new THREE.BoxGeometry(3, 3, 1),
          new THREE.MeshStandardMaterial({ color: 0x696969 })
        );
        fireplace.position.set(0, 1.5, -12);
        scene.add(fireplace);

        // Fire (glowing orange)
        const fire = new THREE.Mesh(
          new THREE.BoxGeometry(1, 0.8, 0.5),
          new THREE.MeshStandardMaterial({
            color: 0xff4500,
            emissive: 0xff4500,
            emissiveIntensity: 1
          })
        );
        fire.position.set(0, 0.8, -11.5);
        scene.add(fire);

        // Wooden desk
        const desk = new THREE.Mesh(
          new THREE.BoxGeometry(2.5, 0.15, 1.2),
          new THREE.MeshStandardMaterial({ color: 0x8b4513 })
        );
        desk.position.set(-8, 0.75, -5);
        scene.add(desk);

        // Rustic chair
        const chair = new THREE.Mesh(
          new THREE.BoxGeometry(0.6, 0.6, 0.6),
          new THREE.MeshStandardMaterial({ color: 0x654321 })
        );
        chair.position.set(-8, 0.5, -3.5);
        scene.add(chair);

        // Bookshelf
        const shelf = new THREE.Mesh(
          new THREE.BoxGeometry(2, 4, 0.4),
          new THREE.MeshStandardMaterial({ color: 0x8b4513 })
        );
        shelf.position.set(10, 2, -10);
        scene.add(shelf);

        // Books on shelf
        for (let i = 0; i < 3; i++) {
          for (let j = 0; j < 5; j++) {
            const book = new THREE.Mesh(
              new THREE.BoxGeometry(0.15, 0.3, 0.2),
              new THREE.MeshStandardMaterial({ color: Math.random() * 0xffffff })
            );
            book.position.set(9.8 + j * 0.3 - 0.6, 0.5 + i * 1.2, -10);
            scene.add(book);
          }
        }

        // Rug
        const rug = new THREE.Mesh(
          new THREE.PlaneGeometry(6, 4),
          new THREE.MeshStandardMaterial({ color: 0x8b0000 })
        );
        rug.rotation.x = -Math.PI / 2;
        rug.position.set(0, 0.01, 0);
        scene.add(rug);

        // Window with lake view
        const window = new THREE.Mesh(
          new THREE.PlaneGeometry(4, 2.5),
          new THREE.MeshStandardMaterial({
            color: 0x87ceeb,
            transparent: true,
            opacity: 0.7
          })
        );
        window.position.set(0, 3, 12.4);
        scene.add(window);

      } else {
        // Coffee shop - trendy and cozy
        scene.background = new THREE.Color(0xf5deb3);

        // Floor - hardwood
        const floor = new THREE.Mesh(
          new THREE.PlaneGeometry(30, 30),
          new THREE.MeshStandardMaterial({ color: 0xdeb887, roughness: 0.8 })
        );
        floor.rotation.x = -Math.PI / 2;
        scene.add(floor);

        // Brick walls
        const brickWall = new THREE.MeshStandardMaterial({ color: 0x8b4513, roughness: 0.9 });

        const backWall = new THREE.Mesh(
          new THREE.BoxGeometry(30, 8, 0.3),
          brickWall
        );
        backWall.position.set(0, 4, -15);
        scene.add(backWall);

        [-15, 15].forEach((x) => {
          const wall = new THREE.Mesh(
            new THREE.BoxGeometry(0.3, 8, 30),
            brickWall
          );
          wall.position.set(x, 4, 0);
          scene.add(wall);
        });

        // Counter
        const counter = new THREE.Mesh(
          new THREE.BoxGeometry(8, 1, 1.5),
          new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.3 })
        );
        counter.position.set(-8, 0.5, -10);
        scene.add(counter);

        // Espresso machine
        const machine = new THREE.Mesh(
          new THREE.BoxGeometry(1, 1, 0.8),
          new THREE.MeshStandardMaterial({ color: 0x4a4a4a, metalness: 0.8 })
        );
        machine.position.set(-10, 1.5, -10);
        scene.add(machine);

        // Tables
        [[-5, 0], [5, 0], [0, 8]].forEach(([x, z]) => {
          const tableTop = new THREE.Mesh(
            new THREE.CylinderGeometry(1, 1, 0.05, 32),
            new THREE.MeshStandardMaterial({ color: 0x654321 })
          );
          tableTop.position.set(x, 0.75, z);
          scene.add(tableTop);

          const tableLeg = new THREE.Mesh(
            new THREE.CylinderGeometry(0.1, 0.15, 0.75, 16),
            new THREE.MeshStandardMaterial({ color: 0x3a3a3a })
          );
          tableLeg.position.set(x, 0.375, z);
          scene.add(tableLeg);
        });

        // Chairs
        [[-5, -1.5], [-5, 1.5], [5, -1.5], [5, 1.5], [-1.5, 8], [1.5, 8]].forEach(([x, z]) => {
          const chairSeat = new THREE.Mesh(
            new THREE.BoxGeometry(0.5, 0.1, 0.5),
            new THREE.MeshStandardMaterial({ color: 0x654321 })
          );
          chairSeat.position.set(x, 0.5, z);
          scene.add(chairSeat);

          const chairBack = new THREE.Mesh(
            new THREE.BoxGeometry(0.5, 0.6, 0.1),
            new THREE.MeshStandardMaterial({ color: 0x654321 })
          );
          chairBack.position.set(x, 0.8, z - 0.2);
          scene.add(chairBack);
        });

        // Hanging plants
        [[8, -8], [-8, 8]].forEach(([x, z]) => {
          const chain = new THREE.Mesh(
            new THREE.CylinderGeometry(0.02, 0.02, 2, 8),
            new THREE.MeshStandardMaterial({ color: 0x666666 })
          );
          chain.position.set(x, 6, z);
          scene.add(chain);

          const planter = new THREE.Mesh(
            new THREE.CylinderGeometry(0.3, 0.2, 0.4, 16),
            new THREE.MeshStandardMaterial({ color: 0x8b4513 })
          );
          planter.position.set(x, 5, z);
          scene.add(planter);

          const leaves = new THREE.Mesh(
            new THREE.SphereGeometry(0.5, 8, 8),
            new THREE.MeshStandardMaterial({ color: 0x228b22 })
          );
          leaves.position.set(x, 5.3, z);
          scene.add(leaves);
        });

        // Chalkboard menu
        const chalkboard = new THREE.Mesh(
          new THREE.PlaneGeometry(4, 2),
          new THREE.MeshStandardMaterial({ color: 0x1a1a1a })
        );
        chalkboard.position.set(0, 4, -14.8);
        scene.add(chalkboard);

        // Pendant lights
        [[-5, 0], [5, 0], [0, 8]].forEach(([x, z]) => {
          const cord = new THREE.Mesh(
            new THREE.CylinderGeometry(0.01, 0.01, 2, 8),
            new THREE.MeshStandardMaterial({ color: 0x333333 })
          );
          cord.position.set(x, 6.5, z);
          scene.add(cord);

          const bulb = new THREE.Mesh(
            new THREE.SphereGeometry(0.2, 16, 16),
            new THREE.MeshStandardMaterial({
              color: 0xffd700,
              emissive: 0xffaa00,
              emissiveIntensity: 0.8
            })
          );
          bulb.position.set(x, 5.5, z);
          scene.add(bulb);
        });
      }
    };

    buildEnvironment();

    // Movement variables
    const moveSpeed = 0.1;
    const keys = keysRef.current;

    // Keyboard controls
    const handleKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();

      // Ignore navigation keys when chat is visible
      if (chatVisibleRef.current) {
        const navigationKeys = ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'];
        if (navigationKeys.includes(key)) {
          return;
        }
      }

      keys[key] = true;
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();

      // Ignore navigation keys when chat is visible
      if (chatVisibleRef.current) {
        const navigationKeys = ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'];
        if (navigationKeys.includes(key)) {
          return;
        }
      }

      keys[key] = false;
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

    // Create VR button (only if WebXR is supported)
    let vrButton: HTMLButtonElement | null = null;
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

      // Only show button if WebXR is available and supported
      if (navigator.xr) {
        navigator.xr.isSessionSupported('immersive-vr').then((supported) => {
          if (supported) {
            document.body.appendChild(button);
            vrButton = button;
          }
          // Don't show button if VR is not supported
        });
      }
      // Don't show button if navigator.xr doesn't exist
    };

    createVRButton();

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
  }, [avatarCustomization, officeId, currentUser, environment]);

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

        {/* Settings button - available for all users */}
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
          ⚙️ Settings
        </button>

        {session ? (
          <>
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
        onSave={session ? handleSaveSettings : undefined}
        currentEnvironment={environment}
        onEnvironmentChange={handleEnvironmentChange}
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
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();

                if (chatInput.trim() === '') {
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
              } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                setChatVisible(false);
                setChatInput('');
              }
            }}
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
