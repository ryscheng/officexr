import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as THREE from 'three';
import { RealtimeChannel } from '@supabase/supabase-js';
import { createAvatar, updateAvatar, AvatarData } from './Avatar';
import SettingsPanel from './SettingsPanel';
import { AvatarCustomization } from '@/types/avatar';
import { supabase } from '@/lib/supabase';
import { useAuth, signOut } from '@/hooks/useAuth';

interface OfficeSceneProps {
  officeId: string;
  onLeave: () => void;
  onShowOfficeSelector?: () => void;
}

export default function OfficeScene({ officeId, onLeave, onShowOfficeSelector }: OfficeSceneProps) {
  const { user } = useAuth();
  const navigate = useNavigate();

  // Generate anonymous user data if not logged in
  const anonymousUserRef = useRef<{ id: string; name: string } | null>(null);
  if (!user && !anonymousUserRef.current) {
    const randomId = `anon-${Math.random().toString(36).substr(2, 9)}`;
    const guestNumber = Math.floor(Math.random() * 1000);
    anonymousUserRef.current = {
      id: randomId,
      name: `Guest ${guestNumber}`,
    };
  }

  const currentUser = user || anonymousUserRef.current;
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
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
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  // Load avatar customization from Supabase
  useEffect(() => {
    if (!user) return;

    supabase
      .from('profiles')
      .select('avatar_body_color, avatar_skin_color, avatar_style, avatar_accessories')
      .eq('id', user.id)
      .single()
      .then(({ data }) => {
        if (data) {
          setAvatarCustomization({
            bodyColor: data.avatar_body_color || '#3498db',
            skinColor: data.avatar_skin_color || '#ffdbac',
            style: (data.avatar_style as AvatarCustomization['style']) || 'default',
            accessories: data.avatar_accessories || [],
          });
        }
      });
  }, [user]);

  // Handle chat visibility and Enter key
  useEffect(() => {
    const handleChatKey = (event: KeyboardEvent) => {
      if (showSettings) return;
      if (event.target === chatInputRef.current) return;

      if (event.key === 'Enter') {
        event.preventDefault();

        if (!chatVisible) {
          setChatVisible(true);
          setTimeout(() => chatInputRef.current?.focus(), 50);
        } else if (chatInput.trim() === '') {
          setChatVisible(false);
        } else {
          sendChatMessage(chatInput.trim());
          setChatInput('');
        }
      } else if (event.key === 'Escape' && chatVisible) {
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
      if (hideTimerRef.current) {
        clearTimeout(hideTimerRef.current);
      }
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

  const sendChatMessage = (message: string) => {
    if (!channelRef.current || !currentUser) return;

    const chatMessage: ChatMessage = {
      id: `${Date.now()}-${currentUser.id}`,
      userId: currentUser.id,
      userName: currentUser.name || 'User',
      message,
      timestamp: Date.now(),
    };

    channelRef.current.send({
      type: 'broadcast',
      event: 'chat',
      payload: { message: chatMessage },
    });

    // Add own message to chat immediately
    setChatMessages((prev) => [...prev.slice(-49), chatMessage]);

    // Persist to Supabase for history
    supabase.from('chat_messages').insert({
      office_id: officeId,
      user_id: user?.id ?? null,
      user_name: currentUser.name,
      message,
    });
  };

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

    // Build environment
    const buildEnvironment = () => {
      if (environment === 'corporate') {
        scene.background = new THREE.Color(0x87ceeb);

        const floor = new THREE.Mesh(
          new THREE.PlaneGeometry(30, 30),
          new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.1, metalness: 0.6 })
        );
        floor.rotation.x = -Math.PI / 2;
        floor.receiveShadow = true;
        scene.add(floor);

        const glassWalls = new THREE.Mesh(
          new THREE.BoxGeometry(30, 10, 30),
          new THREE.MeshStandardMaterial({ color: 0x88ccff, transparent: true, opacity: 0.3, metalness: 0.9, roughness: 0.1 })
        );
        glassWalls.position.y = 5;
        scene.add(glassWalls);

        for (let i = -15; i <= 15; i += 5) {
          const frame = new THREE.Mesh(
            new THREE.BoxGeometry(0.2, 10, 0.1),
            new THREE.MeshStandardMaterial({ color: 0x333333 })
          );
          frame.position.set(i, 5, -15);
          scene.add(frame);
        }

        const deskTop = new THREE.Mesh(
          new THREE.BoxGeometry(3, 0.05, 1.5),
          new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.2 })
        );
        deskTop.position.set(0, 0.75, -5);
        scene.add(deskTop);

        [-1.4, 1.4].forEach((x) => {
          const leg = new THREE.Mesh(
            new THREE.BoxGeometry(0.1, 0.75, 1.4),
            new THREE.MeshStandardMaterial({ color: 0x666666 })
          );
          leg.position.set(x, 0.375, -5);
          scene.add(leg);
        });

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

        const confTable = new THREE.Mesh(
          new THREE.BoxGeometry(6, 0.08, 3),
          new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.2, metalness: 0.5 })
        );
        confTable.position.set(-8, 0.75, 5);
        scene.add(confTable);

        [[-9, 3], [-7, 3], [-9, 7], [-7, 7]].forEach(([x, z]) => {
          const chair = new THREE.Mesh(
            new THREE.BoxGeometry(0.5, 0.5, 0.5),
            new THREE.MeshStandardMaterial({ color: 0x333333 })
          );
          chair.position.set(x, 0.5, z);
          scene.add(chair);
        });

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
        scene.background = new THREE.Color(0x87a96b);

        const floor = new THREE.Mesh(
          new THREE.PlaneGeometry(25, 25),
          new THREE.MeshStandardMaterial({ color: 0x8b6914, roughness: 0.9 })
        );
        floor.rotation.x = -Math.PI / 2;
        scene.add(floor);

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

        const ceiling = new THREE.Mesh(
          new THREE.PlaneGeometry(25, 25),
          new THREE.MeshStandardMaterial({ color: 0x654321 })
        );
        ceiling.rotation.x = Math.PI / 2;
        ceiling.position.y = 6;
        scene.add(ceiling);

        const fireplace = new THREE.Mesh(
          new THREE.BoxGeometry(3, 3, 1),
          new THREE.MeshStandardMaterial({ color: 0x696969 })
        );
        fireplace.position.set(0, 1.5, -12);
        scene.add(fireplace);

        const fire = new THREE.Mesh(
          new THREE.BoxGeometry(1, 0.8, 0.5),
          new THREE.MeshStandardMaterial({ color: 0xff4500, emissive: 0xff4500, emissiveIntensity: 1 })
        );
        fire.position.set(0, 0.8, -11.5);
        scene.add(fire);

        const desk = new THREE.Mesh(
          new THREE.BoxGeometry(2.5, 0.15, 1.2),
          new THREE.MeshStandardMaterial({ color: 0x8b4513 })
        );
        desk.position.set(-8, 0.75, -5);
        scene.add(desk);

        const chair = new THREE.Mesh(
          new THREE.BoxGeometry(0.6, 0.6, 0.6),
          new THREE.MeshStandardMaterial({ color: 0x654321 })
        );
        chair.position.set(-8, 0.5, -3.5);
        scene.add(chair);

        const shelf = new THREE.Mesh(
          new THREE.BoxGeometry(2, 4, 0.4),
          new THREE.MeshStandardMaterial({ color: 0x8b4513 })
        );
        shelf.position.set(10, 2, -10);
        scene.add(shelf);

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

        const rug = new THREE.Mesh(
          new THREE.PlaneGeometry(6, 4),
          new THREE.MeshStandardMaterial({ color: 0x8b0000 })
        );
        rug.rotation.x = -Math.PI / 2;
        rug.position.set(0, 0.01, 0);
        scene.add(rug);

        const win = new THREE.Mesh(
          new THREE.PlaneGeometry(4, 2.5),
          new THREE.MeshStandardMaterial({ color: 0x87ceeb, transparent: true, opacity: 0.7 })
        );
        win.position.set(0, 3, 12.4);
        scene.add(win);

      } else {
        // Coffee shop
        scene.background = new THREE.Color(0xf5deb3);

        const floor = new THREE.Mesh(
          new THREE.PlaneGeometry(30, 30),
          new THREE.MeshStandardMaterial({ color: 0xdeb887, roughness: 0.8 })
        );
        floor.rotation.x = -Math.PI / 2;
        scene.add(floor);

        const brickWall = new THREE.MeshStandardMaterial({ color: 0x8b4513, roughness: 0.9 });
        const backWall = new THREE.Mesh(new THREE.BoxGeometry(30, 8, 0.3), brickWall);
        backWall.position.set(0, 4, -15);
        scene.add(backWall);
        [-15, 15].forEach((x) => {
          const wall = new THREE.Mesh(new THREE.BoxGeometry(0.3, 8, 30), brickWall);
          wall.position.set(x, 4, 0);
          scene.add(wall);
        });

        const counter = new THREE.Mesh(
          new THREE.BoxGeometry(8, 1, 1.5),
          new THREE.MeshStandardMaterial({ color: 0x3a3a3a, roughness: 0.3 })
        );
        counter.position.set(-8, 0.5, -10);
        scene.add(counter);

        const machine = new THREE.Mesh(
          new THREE.BoxGeometry(1, 1, 0.8),
          new THREE.MeshStandardMaterial({ color: 0x4a4a4a, metalness: 0.8 })
        );
        machine.position.set(-10, 1.5, -10);
        scene.add(machine);

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

        const chalkboard = new THREE.Mesh(
          new THREE.PlaneGeometry(4, 2),
          new THREE.MeshStandardMaterial({ color: 0x1a1a1a })
        );
        chalkboard.position.set(0, 4, -14.8);
        scene.add(chalkboard);

        [[-5, 0], [5, 0], [0, 8]].forEach(([x, z]) => {
          const cord = new THREE.Mesh(
            new THREE.CylinderGeometry(0.01, 0.01, 2, 8),
            new THREE.MeshStandardMaterial({ color: 0x333333 })
          );
          cord.position.set(x, 6.5, z);
          scene.add(cord);

          const bulb = new THREE.Mesh(
            new THREE.SphereGeometry(0.2, 16, 16),
            new THREE.MeshStandardMaterial({ color: 0xffd700, emissive: 0xffaa00, emissiveIntensity: 0.8 })
          );
          bulb.position.set(x, 5.5, z);
          scene.add(bulb);
        });
      }
    };

    buildEnvironment();

    // Movement
    const moveSpeed = 0.1;
    const keys = keysRef.current;

    const handleKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (chatVisibleRef.current) {
        const navigationKeys = ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'];
        if (navigationKeys.includes(key)) return;
      }
      keys[key] = true;
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (chatVisibleRef.current) {
        const navigationKeys = ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'];
        if (navigationKeys.includes(key)) return;
      }
      keys[key] = false;
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    // Mouse controls
    let mouseDown = false;
    const handleMouseDown = () => { mouseDown = true; };
    const handleMouseUp = () => { mouseDown = false; };
    const handleMouseMove = (event: MouseEvent) => {
      if (mouseDown) {
        camera.rotation.y -= (event.movementX || 0) * 0.002;
        camera.rotation.x -= (event.movementY || 0) * 0.002;
        camera.rotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, camera.rotation.x));
      }
    };

    renderer.domElement.addEventListener('mousedown', handleMouseDown);
    renderer.domElement.addEventListener('mouseup', handleMouseUp);
    renderer.domElement.addEventListener('mousemove', handleMouseMove);

    // Touch controls
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
        const deltaX = event.touches[0].clientX - touchStartX;
        const deltaY = event.touches[0].clientY - touchStartY;
        camera.rotation.y -= deltaX * 0.002;
        camera.rotation.x -= deltaY * 0.002;
        camera.rotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, camera.rotation.x));
        touchStartX = event.touches[0].clientX;
        touchStartY = event.touches[0].clientY;
      }
    };

    const handleTouchEnd = () => { isTouching = false; };

    renderer.domElement.addEventListener('touchstart', handleTouchStart, { passive: true });
    renderer.domElement.addEventListener('touchmove', handleTouchMove, { passive: true });
    renderer.domElement.addEventListener('touchend', handleTouchEnd);

    const handleResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', handleResize);

    // Supabase Realtime channel
    const channelName = `office:${officeId}`;
    const channel = supabase.channel(channelName, {
      config: { presence: { key: currentUser.id } },
    });

    channelRef.current = channel;

    // Load recent chat history from Supabase
    supabase
      .from('chat_messages')
      .select('id, user_id, user_name, message, created_at')
      .eq('office_id', officeId)
      .order('created_at', { ascending: false })
      .limit(50)
      .then(({ data }) => {
        if (data) {
          const messages: ChatMessage[] = data
            .reverse()
            .map((row) => ({
              id: row.id,
              userId: row.user_id || 'unknown',
              userName: row.user_name || 'User',
              message: row.message,
              timestamp: new Date(row.created_at).getTime(),
            }));
          setChatMessages(messages);
        }
      });

    // Presence: sync existing users
    channel.on('presence', { event: 'sync' }, () => {
      const state = channel.presenceState<AvatarData>();
      const presentIds = new Set<string>();

      Object.values(state).forEach((presences) => {
        presences.forEach((presence) => {
          presentIds.add(presence.id);
          if (presence.id !== currentUser.id && !avatarsRef.current.has(presence.id)) {
            const avatar = createAvatar(scene, presence);
            avatarsRef.current.set(presence.id, avatar);
          }
        });
      });

      // Remove avatars for users who left
      avatarsRef.current.forEach((_avatar, id) => {
        if (!presentIds.has(id)) {
          scene.remove(avatarsRef.current.get(id)!);
          avatarsRef.current.delete(id);
        }
      });

      setUserCount(presentIds.size);
    });

    // Presence: user joined
    channel.on('presence', { event: 'join' }, ({ newPresences }) => {
      newPresences.forEach((presence) => {
        const p = presence as unknown as AvatarData;
        if (p.id !== currentUser.id && !avatarsRef.current.has(p.id)) {
          const avatar = createAvatar(scene, p);
          avatarsRef.current.set(p.id, avatar);
          setUserCount((prev) => prev + 1);
        }
      });
    });

    // Presence: user left
    channel.on('presence', { event: 'leave' }, ({ leftPresences }) => {
      leftPresences.forEach((presence) => {
        const p = presence as unknown as AvatarData;
        const avatar = avatarsRef.current.get(p.id);
        if (avatar) {
          scene.remove(avatar);
          avatarsRef.current.delete(p.id);
          setUserCount((prev) => Math.max(0, prev - 1));
        }
      });
    });

    // Broadcast: position updates
    channel.on('broadcast', { event: 'position' }, ({ payload }) => {
      const { userId, position, rotation } = payload as {
        userId: string;
        position: { x: number; y: number; z: number };
        rotation: { x: number; y: number; z: number };
      };
      const avatar = avatarsRef.current.get(userId);
      if (avatar) {
        updateAvatar(avatar, position, rotation);
      }
    });

    // Broadcast: avatar customization updates
    channel.on('broadcast', { event: 'avatar-update' }, ({ payload }) => {
      const { userId, customization } = payload as { userId: string; customization: AvatarCustomization };
      const existingAvatar = avatarsRef.current.get(userId);
      if (existingAvatar) {
        scene.remove(existingAvatar);
        const oldData = existingAvatar.userData as AvatarData;
        const newAvatar = createAvatar(scene, {
          ...oldData,
          customization,
        });
        avatarsRef.current.set(userId, newAvatar);
      }
    });

    // Broadcast: chat messages
    channel.on('broadcast', { event: 'chat' }, ({ payload }) => {
      const { message } = payload as { message: ChatMessage };
      if (message.userId !== currentUser.id) {
        setChatMessages((prev) => [...prev.slice(-49), message]);
      }
    });

    channel.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await channel.track({
          id: currentUser.id,
          name: currentUser.name,
          image: user?.image || null,
          position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
          rotation: { x: camera.rotation.x, y: camera.rotation.y, z: camera.rotation.z },
          customization: avatarCustomization,
        });
      }
    });

    // Animation loop
    const animate = () => {
      const direction = new THREE.Vector3();
      const forward = new THREE.Vector3();
      const right = new THREE.Vector3();

      camera.getWorldDirection(forward);
      forward.y = 0;
      forward.normalize();
      right.crossVectors(forward, new THREE.Vector3(0, 1, 0));

      let moved = false;

      if (keys['w'] || keys['arrowup']) { direction.add(forward); moved = true; }
      if (keys['s'] || keys['arrowdown']) { direction.sub(forward); moved = true; }
      if (keys['a'] || keys['arrowleft']) { direction.sub(right); moved = true; }
      if (keys['d'] || keys['arrowright']) { direction.add(right); moved = true; }

      if (direction.length() > 0) {
        direction.normalize();
        camera.position.add(direction.multiplyScalar(moveSpeed));
        camera.position.x = Math.max(-9, Math.min(9, camera.position.x));
        camera.position.z = Math.max(-9, Math.min(9, camera.position.z));
      }

      const now = Date.now();
      if (moved && channelRef.current && now - lastPositionUpdate.current > 60) {
        channelRef.current.send({
          type: 'broadcast',
          event: 'position',
          payload: {
            userId: currentUser.id,
            position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
            rotation: { x: camera.rotation.x, y: camera.rotation.y, z: camera.rotation.z },
          },
        });
        lastPositionUpdate.current = now;
      }

      renderer.render(scene, camera);
    };

    renderer.setAnimationLoop(animate);

    // VR button
    let vrButton: HTMLButtonElement | null = null;
    if (navigator.xr) {
      navigator.xr.isSessionSupported('immersive-vr').then((supported) => {
        if (!supported) return;
        const button = document.createElement('button');
        button.style.cssText = 'position:absolute;bottom:20px;left:50%;transform:translateX(-50%);padding:12px 24px;border:none;border-radius:4px;background:#1a73e8;color:white;font-size:16px;cursor:pointer;z-index:999;';
        button.textContent = 'ENTER VR';
        button.onclick = () => {
          if (renderer.xr.isPresenting) {
            renderer.xr.getSession()?.end();
          } else {
            renderer.domElement.requestFullscreen?.();
            navigator.xr
              ?.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor'] })
              .then((session) => renderer.xr.setSession(session))
              .catch(() => alert('WebXR not supported or VR device not connected'));
          }
        };
        document.body.appendChild(button);
        vrButton = button;
      });
    }

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

      channel.unsubscribe();
      channelRef.current = null;

      if (vrButton?.parentNode) {
        vrButton.parentNode.removeChild(vrButton);
      }
      if (containerRef.current && renderer.domElement.parentNode) {
        containerRef.current.removeChild(renderer.domElement);
      }
      renderer.dispose();
    };
  }, [avatarCustomization, officeId, currentUser, environment]);

  const handleSaveSettings = async (settings: AvatarCustomization) => {
    if (!user) return;

    const { error } = await supabase.from('profiles').upsert({
      id: user.id,
      avatar_body_color: settings.bodyColor,
      avatar_skin_color: settings.skinColor,
      avatar_style: settings.style,
      avatar_accessories: settings.accessories,
    });

    if (error) throw new Error('Failed to save settings');

    setAvatarCustomization(settings);

    // Broadcast avatar update to other users
    channelRef.current?.send({
      type: 'broadcast',
      event: 'avatar-update',
      payload: { userId: user.id, customization: settings },
    });
  };

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100vh' }}>
      <div
        style={{
          position: 'absolute', top: '20px', left: '20px',
          color: 'white', background: 'rgba(0, 0, 0, 0.7)',
          padding: '15px', borderRadius: '8px', fontFamily: 'monospace', zIndex: 100,
        }}
      >
        <h3 style={{ margin: '0 0 10px 0' }}>Controls:</h3>
        <p style={{ margin: '5px 0' }}>W/A/S/D or Arrow Keys - Move</p>
        <p style={{ margin: '5px 0' }}>Mouse/Touch Drag - Look Around</p>
        <p style={{ margin: '5px 0' }}>Enter - Chat</p>
      </div>

      <div
        style={{
          position: 'absolute', top: '20px', right: '20px',
          color: 'white', background: 'rgba(0, 0, 0, 0.7)',
          padding: '15px', borderRadius: '8px', fontFamily: 'monospace', zIndex: 100,
        }}
      >
        <p style={{ margin: '5px 0' }}>
          <strong>{currentUser?.name}</strong>
          {!user && <span style={{ color: '#888', fontSize: '12px' }}> (Guest)</span>}
        </p>
        <p style={{ margin: '5px 0' }}>Users online: {userCount}</p>
        <p style={{ margin: '5px 0', fontSize: '12px', color: '#888' }}>
          Office: {officeId === 'global' ? 'Global' : 'Private'}
        </p>

        <button
          onClick={() => setShowSettings(true)}
          style={{
            marginTop: '10px', padding: '8px 16px',
            background: '#3498db', color: 'white',
            border: 'none', borderRadius: '4px', cursor: 'pointer',
            fontSize: '14px', width: '100%',
          }}
        >
          ⚙️ Settings
        </button>

        {user ? (
          <>
            {onShowOfficeSelector && officeId !== 'global' && (
              <button
                onClick={onShowOfficeSelector}
                style={{
                  marginTop: '10px', padding: '8px 16px',
                  background: '#8b5cf6', color: 'white',
                  border: 'none', borderRadius: '4px', cursor: 'pointer',
                  fontSize: '14px', width: '100%',
                }}
              >
                🏢 My Offices
              </button>
            )}
            <button
              onClick={() => signOut().then(() => navigate('/login'))}
              style={{
                marginTop: '10px', padding: '8px 16px',
                background: '#ef4444', color: 'white',
                border: 'none', borderRadius: '4px', cursor: 'pointer',
                fontSize: '14px', width: '100%',
              }}
            >
              Sign Out
            </button>
          </>
        ) : (
          <button
            onClick={() => navigate('/login')}
            style={{
              marginTop: '10px', padding: '8px 16px',
              background: '#22c55e', color: 'white',
              border: 'none', borderRadius: '4px', cursor: 'pointer',
              fontSize: '14px', width: '100%',
            }}
          >
            Sign In
          </button>
        )}
      </div>

      {/* Chat UI */}
      {chatVisible && (
        <div
          style={{
            position: 'absolute', bottom: '20px', left: '50%',
            transform: 'translateX(-50%)', width: '500px', maxWidth: '90vw',
            background: 'rgba(0,0,0,0.8)', borderRadius: '8px',
            padding: '10px', zIndex: 200,
          }}
        >
          <div style={{ maxHeight: '200px', overflowY: 'auto', marginBottom: '8px' }}>
            {chatMessages.slice(-20).map((msg) => (
              <div key={msg.id} style={{ color: 'white', fontSize: '14px', marginBottom: '4px' }}>
                <span style={{ color: '#60a5fa', fontWeight: 'bold' }}>{msg.userName}: </span>
                {msg.message}
              </div>
            ))}
          </div>
          <input
            ref={chatInputRef}
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && chatInput.trim()) {
                e.stopPropagation();
                sendChatMessage(chatInput.trim());
                setChatInput('');
              } else if (e.key === 'Escape') {
                setChatVisible(false);
                setChatInput('');
              }
            }}
            placeholder="Type a message..."
            style={{
              width: '100%', padding: '8px', borderRadius: '4px',
              border: 'none', background: 'rgba(255,255,255,0.1)',
              color: 'white', fontSize: '14px', boxSizing: 'border-box',
            }}
          />
        </div>
      )}

      {/* Chat notification (recent messages, chat not open) */}
      {!chatVisible && chatMessages.length > 0 && (
        <div
          style={{
            position: 'absolute', bottom: '20px', left: '50%',
            transform: 'translateX(-50%)', width: '400px', maxWidth: '80vw',
            background: 'rgba(0,0,0,0.6)', borderRadius: '8px',
            padding: '8px 12px', zIndex: 100, pointerEvents: 'none',
          }}
        >
          {chatMessages.slice(-3).map((msg) => (
            <div key={msg.id} style={{ color: 'white', fontSize: '13px', marginBottom: '2px' }}>
              <span style={{ color: '#60a5fa', fontWeight: 'bold' }}>{msg.userName}: </span>
              {msg.message}
            </div>
          ))}
          <div style={{ color: '#888', fontSize: '11px', marginTop: '4px' }}>
            Press Enter to chat
          </div>
        </div>
      )}

      <SettingsPanel
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        currentSettings={avatarCustomization}
        onSave={user ? handleSaveSettings : undefined}
        currentEnvironment={environment}
        onEnvironmentChange={handleEnvironmentChange}
      />
    </div>
  );
}
