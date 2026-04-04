import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as THREE from 'three';
import { RealtimeChannel } from '@supabase/supabase-js';
import { JaaSMeeting } from '@jitsi/react-sdk';
import { generateJaaSJwt } from '@/lib/jaasJwt';
import { createAvatar, updateAvatar, AvatarData } from './Avatar';
import SettingsPanel from './SettingsPanel';
import ControlsOverlay from './ControlsOverlay';
import { AvatarCustomization } from '@/types/avatar';
import { supabase } from '@/lib/supabase';
import { useAuth, signOut, signInWithGoogle } from '@/hooks/useAuth';
import { useMotionControls } from '@/hooks/useMotionControls';

const PROXIMITY_RADIUS = 3; // Three.js units — spheres overlap when distance < PROXIMITY_RADIUS * 2

type PresenceEntry = AvatarData & { jitsiRoom?: string | null };

function createBubbleSphere(scene: THREE.Scene): THREE.Mesh {
  const geo = new THREE.SphereGeometry(PROXIMITY_RADIUS, 24, 24);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x4499ff,
    transparent: true,
    opacity: 0.12,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const sphere = new THREE.Mesh(geo, mat);
  scene.add(sphere);
  return sphere;
}

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
  const avatarTargetsRef = useRef<Map<string, { position: THREE.Vector3; rotationY: number }>>(new Map());
  const bubbleSpheresRef = useRef<Map<string, THREE.Mesh>>(new Map());
  const localBubbleSphereRef = useRef<THREE.Mesh | null>(null);
  const presenceDataRef = useRef<Map<string, PresenceEntry>>(new Map());
  const nearbyUserIdsRef = useRef<Set<string>>(new Set());
  const jitsiRoomRef = useRef<string | null>(null);
  const myPresenceRef = useRef<PresenceEntry | null>(null);
  const [userCount, setUserCount] = useState(0);
  const [jitsiRoom, setJitsiRoom] = useState<string | null>(null);
  const [jitsiError, setJitsiError] = useState<string | null>(null);
  const [jitsiConnected, setJitsiConnected] = useState(false);
  const [jaasJwt, setJaasJwt] = useState<string | null>(null);
  const [jaasJwtError, setJaasJwtError] = useState<string | null>(null);
  const [remoteAudioLevel, setRemoteAudioLevel] = useState(0);
  const jitsiApiRef = useRef<any>(null);
  const remoteAudioDecayRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const jitsiConnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [micMuted, setMicMuted] = useState(false);
  const [micLevel, setMicLevel] = useState<number>(0); // 0–1; –1 = failed
  const [micError, setMicError] = useState<string | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const micAudioCtxRef = useRef<AudioContext | null>(null);
  const startMicRef = useRef<(() => Promise<void>) | null>(null);
  const lastPositionUpdate = useRef<number>(0);
  const [showSettings, setShowSettings] = useState(false);
  const [avatarCustomization, setAvatarCustomization] = useState<AvatarCustomization>({
    bodyColor: '#3498db',
    skinColor: '#ffdbac',
    style: 'default',
    accessories: [],
  });
  const avatarCustomizationRef = useRef(avatarCustomization);

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
  const [mouseLockActive, setMouseLockActive] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);
  // Motion controls — device orientation (gyroscope) shared with UserLobby
  const {
    motionPermission,
    motionActiveRef,
    motionCapable,
    recalibrateMotionRef,
    motionDebugRef,
    handleRequestMotionPermission,
    enableMotion,
    disableMotion,
  } = useMotionControls({ cameraRef, rendererRef });
  const joystickInputRef = useRef({ x: 0, y: 0 });
  const [joystickKnob, setJoystickKnob] = useState({ x: 0, y: 0 });
  const [joystickActive, setJoystickActive] = useState(false);
  const isTouchDevice = typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0);
  const [showCreateRoom, setShowCreateRoom] = useState(false);
  const [createRoomName, setCreateRoomName] = useState('');
  const [createRoomLinkAccess, setCreateRoomLinkAccess] = useState(true);
  const [createRoomLoading, setCreateRoomLoading] = useState(false);
  const [createRoomError, setCreateRoomError] = useState<string | null>(null);

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

  // Generate a JaaS JWT from the private key stored in env vars.
  // Regenerated whenever the current user changes (e.g. login/logout).
  // TTL is 1 week; the token is generated client-side via Web Crypto (RS256).
  useEffect(() => {
    const appId      = import.meta.env.VITE_JAAS_APP_ID      as string | undefined;
    const apiKeyId   = import.meta.env.VITE_JAAS_API_KEY_ID  as string | undefined;
    const privateKey = import.meta.env.VITE_JAAS_PRIVATE_KEY as string | undefined;

    if (!appId || !apiKeyId || !privateKey || !currentUser) {
      setJaasJwt(null);
      setJaasJwtError(null);
      return;
    }

    setJaasJwtError(null);
    generateJaaSJwt(appId, apiKeyId, privateKey, {
      id:    currentUser.id,
      name:  currentUser.name || 'User',
      email: user?.email ?? '',
    }).then(jwt => {
      setJaasJwt(jwt);
      setJaasJwtError(null);
    }).catch(err => {
      console.error('JaaS JWT generation failed:', err);
      setJaasJwt(null);
      setJaasJwtError(String(err?.message ?? err));
    });
  }, [currentUser?.id, currentUser?.name, user?.email]);

  // Continuously monitor the local microphone so the mic indicator always reflects
  // real audio input, independent of any Jitsi connection.
  useEffect(() => {
    let animFrameId: number;

    const startMic = async () => {
      // Tear down any prior session before retrying
      cancelAnimationFrame(animFrameId);
      micStreamRef.current?.getTracks().forEach(t => t.stop());
      micStreamRef.current = null;
      await micAudioCtxRef.current?.close();
      micAudioCtxRef.current = null;

      setMicError(null);
      setMicLevel(0);

      // navigator.mediaDevices is only available on secure origins (HTTPS / localhost)
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        setMicLevel(-1);
        setMicError('HTTPS is required — microphone is unavailable on insecure origins');
        return;
      }

      // Query the Permissions API first so we can give precise instructions.
      // Chrome and Safari on iOS both support this; it won't throw but may not resolve.
      let permState: PermissionState | 'unknown' = 'unknown';
      try {
        const status = await navigator.permissions.query({ name: 'microphone' as PermissionName });
        permState = status.state;
      } catch { /* API not available on this browser */ }

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      } catch (err: any) {
        setMicLevel(-1);
        const name: string = err?.name ?? '';
        if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
          if (permState === 'denied') {
            // Browser-level block (Chrome site settings). iOS Settings won't help here.
            setMicError(
              'Blocked in browser settings. Tap the 🔒 icon in the address bar → Site settings → Microphone → Allow'
            );
          } else {
            // OS-level block or permission prompt was dismissed/denied
            setMicError(
              'Permission denied. Check: iOS Settings → ' +
              (navigator.userAgent.includes('CriOS') ? 'Chrome' : 'Safari') +
              ' → Microphone → ON. Then tap "Tap to enable" again.'
            );
          }
        } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
          setMicError('No microphone hardware found on this device');
        } else {
          setMicError(`${name || 'Error'}: ${err?.message ?? 'unknown'}`);
        }
        return;
      }

      micStreamRef.current = stream;

      // iOS/Safari creates AudioContext in 'suspended' state.
      // Calling resume() here works when startMic() is invoked from a user gesture
      // (e.g. the retry button). The auto-attempt on mount may still leave it
      // suspended on iOS — the user tapping the retry button fixes that.
      const audioCtx = new AudioContext();
      micAudioCtxRef.current = audioCtx;
      try { await audioCtx.resume(); } catch { /* best-effort */ }

      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      audioCtx.createMediaStreamSource(stream).connect(analyser);
      const buf = new Uint8Array(analyser.frequencyBinCount);

      const tick = () => {
        if (audioCtx.state === 'running') {
          analyser.getByteFrequencyData(buf);
          const rms = Math.sqrt(buf.reduce((s, v) => s + v * v, 0) / buf.length) / 128;
          setMicLevel(rms);
        }
        animFrameId = requestAnimationFrame(tick);
      };
      tick();
    };

    // Store so the retry button can call startMic() from within a user gesture
    startMicRef.current = startMic;

    // Auto-attempt on mount — works on desktop and modern Android/iOS in most cases
    startMic();

    return () => {
      cancelAnimationFrame(animFrameId);
      micStreamRef.current?.getTracks().forEach(t => t.stop());
      micAudioCtxRef.current?.close();
    };
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
      .select('avatar_body_color, avatar_skin_color, avatar_style, avatar_accessories, avatar_preset_id, avatar_model_url')
      .eq('id', user.id)
      .single()
      .then(({ data }) => {
        if (data) {
          setAvatarCustomization({
            bodyColor: data.avatar_body_color || '#3498db',
            skinColor: data.avatar_skin_color || '#ffdbac',
            style: (data.avatar_style as AvatarCustomization['style']) || 'default',
            accessories: data.avatar_accessories || [],
            presetId: data.avatar_preset_id || null,
            modelUrl: data.avatar_model_url || null,
          });
        }
      });
  }, [user]);

  // Keep the ref in sync and re-track presence whenever customization changes
  // (profile load or manual save) so other users see the updated avatar without
  // tearing down the entire realtime channel.
  useEffect(() => {
    avatarCustomizationRef.current = avatarCustomization;
    const channel = channelRef.current;
    if (!channel || !myPresenceRef.current) return;
    const updated = { ...myPresenceRef.current, customization: avatarCustomization };
    myPresenceRef.current = updated;
    channel.track(updated);
  }, [avatarCustomization]);

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

  // Track a mute toggle function in a ref so onApiReady (inside the Three.js
  // useEffect closure) can always call the latest version.
  const handleMuteToggle = () => {
    const newMuted = !micMuted;
    setMicMuted(newMuted);
    // Silence the local stream so the mic indicator reflects mute state
    micStreamRef.current?.getAudioTracks().forEach(t => { t.enabled = !newMuted; });
    // Mirror in Jitsi if a session is active
    jitsiApiRef.current?.executeCommand('toggleAudio');
  };

  // Start a connection timeout whenever we attempt to join a Jitsi room.
  // Only start the timer when jaasJwt is also available — that's when JaaSMeeting
  // actually mounts. If jwt is null the iframe never renders, so onApiReady will
  // never fire and the old code would always time out and show a spurious error.
  // Also reset all per-session Jitsi state when the room changes.
  useEffect(() => {
    if (jitsiConnectTimeoutRef.current) clearTimeout(jitsiConnectTimeoutRef.current);

    if (!jitsiRoom || !jaasJwt) {
      setJitsiError(null);
      setJitsiConnected(false);
      setRemoteAudioLevel(0);
      jitsiApiRef.current = null;
      if (remoteAudioDecayRef.current) {
        clearInterval(remoteAudioDecayRef.current);
        remoteAudioDecayRef.current = null;
      }
      return;
    }

    console.log('[VoiceChat] Attempting to connect — room:', jitsiRoom, 'jwt length:', jaasJwt?.length);
    setJitsiError(null);
    setJitsiConnected(false);
    jitsiConnectTimeoutRef.current = setTimeout(() => {
      console.error('[VoiceChat] Connection timed out after 15s — videoConferenceJoined never fired. Room:', jitsiRoom);
      setJitsiError('Could not connect to voice chat — the server may be unavailable.');
    }, 15000);

    return () => {
      if (jitsiConnectTimeoutRef.current) clearTimeout(jitsiConnectTimeoutRef.current);
    };
  }, [jitsiRoom, jaasJwt]);

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

    // Local user bubble sphere
    const localSphere = createBubbleSphere(scene);
    localSphere.position.set(camera.position.x, camera.position.y, camera.position.z);
    localBubbleSphereRef.current = localSphere;

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

    // Mouse control mode (desktop) — click to lock pointer, Escape to release.
    // When WebXR is presenting, the XR session drives head orientation; mouse lock is inactive.
    //
    // Track pitch and yaw independently and reconstruct the rotation each frame
    // using 'YXZ' order so roll is always zero (standard FPS camera technique).
    let cameraPitch = 0; // radians — vertical look (X axis)
    let cameraYaw = 0;   // radians — horizontal look (Y axis)
    camera.rotation.order = 'YXZ';

    const handleCanvasClick = () => {
      // Don't fight device orientation with pointer lock on touch devices
      if (!renderer.xr.isPresenting && !motionActiveRef.current) {
        renderer.domElement.requestPointerLock();
      }
    };

    const handleMouseMove = (event: MouseEvent) => {
      if (document.pointerLockElement === renderer.domElement && !renderer.xr.isPresenting) {
        cameraYaw   -= (event.movementX || 0) * 0.002;
        cameraPitch -= (event.movementY || 0) * 0.002;
        cameraPitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, cameraPitch));
        camera.rotation.set(cameraPitch, cameraYaw, 0, 'YXZ');
      }
    };

    const handlePointerLockChange = () => {
      setMouseLockActive(document.pointerLockElement === renderer.domElement);
    };

    renderer.domElement.addEventListener('click', handleCanvasClick);
    renderer.domElement.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('pointerlockchange', handlePointerLockChange);

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
      // Device orientation handles look direction on mobile — skip touch drag
      if (motionActiveRef.current) return;
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
      const state = channel.presenceState<PresenceEntry>();
      const presentIds = new Set<string>();

      Object.values(state).forEach((presences) => {
        presences.forEach((presence) => {
          presentIds.add(presence.id);
          presenceDataRef.current.set(presence.id, presence);
          if (presence.id !== currentUser.id && !avatarsRef.current.has(presence.id)) {
            const avatar = createAvatar(scene, presence);
            avatarsRef.current.set(presence.id, avatar);
            const sphere = createBubbleSphere(scene);
            sphere.position.copy(avatar.position);
            bubbleSpheresRef.current.set(presence.id, sphere);
          }
        });
      });

      // Remove avatars and spheres for users who left
      avatarsRef.current.forEach((_avatar, id) => {
        if (!presentIds.has(id)) {
          scene.remove(avatarsRef.current.get(id)!);
          avatarsRef.current.delete(id);
          avatarTargetsRef.current.delete(id);
          const sphere = bubbleSpheresRef.current.get(id);
          if (sphere) { scene.remove(sphere); bubbleSpheresRef.current.delete(id); }
          presenceDataRef.current.delete(id);
        }
      });

      setUserCount(presentIds.size);

      // When a nearby user's jitsiRoom changes (e.g. their cluster merged with
      // another), re-evaluate our own room assignment so all clusters converge
      // on the same room.
      if (nearbyUserIdsRef.current.size > 0) {
        handleProximityChange(nearbyUserIdsRef.current);
      }
    });

    // Presence: user joined
    channel.on('presence', { event: 'join' }, ({ newPresences }) => {
      newPresences.forEach((presence) => {
        const p = presence as unknown as PresenceEntry;
        presenceDataRef.current.set(p.id, p);
        if (p.id !== currentUser.id && !avatarsRef.current.has(p.id)) {
          const avatar = createAvatar(scene, p);
          avatarsRef.current.set(p.id, avatar);
          const sphere = createBubbleSphere(scene);
          sphere.position.copy(avatar.position);
          bubbleSpheresRef.current.set(p.id, sphere);
          setUserCount((prev) => prev + 1);
        }
      });
    });

    // Presence: user left
    channel.on('presence', { event: 'leave' }, ({ leftPresences }) => {
      leftPresences.forEach((presence) => {
        const p = presence as unknown as PresenceEntry;
        const avatar = avatarsRef.current.get(p.id);
        if (avatar) {
          scene.remove(avatar);
          avatarsRef.current.delete(p.id);
          avatarTargetsRef.current.delete(p.id);
          const sphere = bubbleSpheresRef.current.get(p.id);
          if (sphere) { scene.remove(sphere); bubbleSpheresRef.current.delete(p.id); }
          presenceDataRef.current.delete(p.id);
          setUserCount((prev) => Math.max(0, prev - 1));
        }
      });
    });

    // Broadcast: position updates — store as interpolation targets, smoothed each frame
    channel.on('broadcast', { event: 'position' }, ({ payload }) => {
      const { userId, position, rotation } = payload as {
        userId: string;
        position: { x: number; y: number; z: number };
        rotation: { x: number; y: number; z: number };
      };
      if (avatarsRef.current.has(userId)) {
        avatarTargetsRef.current.set(userId, {
          position: new THREE.Vector3(position.x, position.y, position.z),
          rotationY: rotation.y,
        });
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
        const presence: PresenceEntry = {
          id: currentUser.id,
          name: currentUser.name || 'User',
          image: user?.image || null,
          position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
          rotation: { x: camera.rotation.x, y: camera.rotation.y, z: camera.rotation.z },
          customization: avatarCustomizationRef.current,
          jitsiRoom: null,
        };
        myPresenceRef.current = presence;
        await channel.track(presence);
      }
    });

    // Proximity-based Jitsi room coordination
    const handleProximityChange = (nearbyIds: Set<string>) => {
      if (nearbyIds.size === 0) {
        if (jitsiRoomRef.current !== null) {
          jitsiRoomRef.current = null;
          setJitsiRoom(null);
          if (myPresenceRef.current) {
            const updated = { ...myPresenceRef.current, jitsiRoom: null };
            myPresenceRef.current = updated;
            channelRef.current?.track(updated);
          }
        }
        return;
      }

      // Check if any nearby user already has a Jitsi room
      let existingRoom: string | null = null;
      nearbyIds.forEach(uid => {
        const pd = presenceDataRef.current.get(uid);
        if (pd?.jitsiRoom) existingRoom = pd.jitsiRoom;
      });

      // Deterministic fallback: when no nearby user has a room yet, both
      // sides independently compute the same name using the lexicographically
      // smallest user ID in the group.  This prevents the race where each
      // user generates a different random room before presence propagates.
      const seed = [currentUser.id, ...nearbyIds].sort()[0];
      const roomToJoin = existingRoom || `officexr-${officeId.slice(0, 8)}-${seed.slice(0, 8)}`;
      if (roomToJoin !== jitsiRoomRef.current) {
        jitsiRoomRef.current = roomToJoin;
        setJitsiRoom(roomToJoin);
        if (myPresenceRef.current) {
          const updated = { ...myPresenceRef.current, jitsiRoom: roomToJoin };
          myPresenceRef.current = updated;
          channelRef.current?.track(updated);
        }
      }
    };

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

      // Virtual joystick input (touch devices)
      const { x: jx, y: jy } = joystickInputRef.current;
      if (Math.abs(jx) > 0.05 || Math.abs(jy) > 0.05) {
        direction.addScaledVector(forward, -jy);
        direction.addScaledVector(right, jx);
        moved = true;
      }

      if (direction.length() > 0) {
        direction.normalize();
        camera.position.add(direction.multiplyScalar(moveSpeed));
        camera.position.x = Math.max(-9, Math.min(9, camera.position.x));
        camera.position.z = Math.max(-9, Math.min(9, camera.position.z));
      }

      const now = Date.now();
      // Send position when moving (60ms throttle) OR as a heartbeat every 3s
      // so stationary users are visible for proximity detection on all clients.
      const shouldSend = channelRef.current && (
        (moved && now - lastPositionUpdate.current > 60) ||
        (now - lastPositionUpdate.current > 3000)
      );
      if (shouldSend) {
        channelRef.current!.send({
          type: 'broadcast',
          event: 'position',
          payload: {
            userId: currentUser.id,
            position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
            rotation: { x: camera.rotation.x, y: camera.rotation.y, z: camera.rotation.z },
          },
        });
        lastPositionUpdate.current = now;
        // Keep presence position fresh so users who join mid-session see the right
        // initial avatar position and can correctly evaluate proximity.
        if (myPresenceRef.current) {
          const updatedPresence = {
            ...myPresenceRef.current,
            position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
            rotation: { x: camera.rotation.x, y: camera.rotation.y, z: camera.rotation.z },
          };
          myPresenceRef.current = updatedPresence;
        }
      }

      // Update local bubble sphere position
      if (localBubbleSphereRef.current) {
        localBubbleSphereRef.current.position.set(
          camera.position.x, camera.position.y, camera.position.z
        );
      }

      // Smoothly interpolate remote avatars toward their latest received positions
      avatarTargetsRef.current.forEach((target, uid) => {
        const avatar = avatarsRef.current.get(uid);
        if (avatar) {
          avatar.position.lerp(target.position, 0.15);
          // Lerp rotation via shortest-path on Y axis
          let dy = target.rotationY - avatar.rotation.y;
          if (dy > Math.PI) dy -= Math.PI * 2;
          if (dy < -Math.PI) dy += Math.PI * 2;
          avatar.rotation.y += dy * 0.15;
        }
      });

      // Update remote bubble sphere positions and detect proximity
      const newNearby = new Set<string>();
      bubbleSpheresRef.current.forEach((sphere, uid) => {
        const avatar = avatarsRef.current.get(uid);
        if (avatar) {
          sphere.position.copy(avatar.position);
          // Bubble overlap when centers are within PROXIMITY_RADIUS * 2
          if (camera.position.distanceTo(avatar.position) < PROXIMITY_RADIUS * 2) {
            newNearby.add(uid);
          }
        }
      });

      // Update sphere colors: green when in same room, blue otherwise
      const inRoom = jitsiRoomRef.current !== null;
      const activeMat = inRoom ? 0x44ff99 : 0x4499ff;
      bubbleSpheresRef.current.forEach((sphere) => {
        (sphere.material as THREE.MeshStandardMaterial).color.setHex(activeMat);
      });
      if (localBubbleSphereRef.current) {
        (localBubbleSphereRef.current.material as THREE.MeshStandardMaterial).color.setHex(activeMat);
      }

      // Fire proximity change handler only when the set changes
      const prevNearby = nearbyUserIdsRef.current;
      const setChanged =
        newNearby.size !== prevNearby.size ||
        [...newNearby].some(id => !prevNearby.has(id)) ||
        [...prevNearby].some(id => !newNearby.has(id));
      if (setChanged) {
        nearbyUserIdsRef.current = newNearby;
        handleProximityChange(newNearby);
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
      renderer.domElement.removeEventListener('click', handleCanvasClick);
      renderer.domElement.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('pointerlockchange', handlePointerLockChange);
      if (document.pointerLockElement === renderer.domElement) {
        document.exitPointerLock();
      }
      renderer.domElement.removeEventListener('touchstart', handleTouchStart);
      renderer.domElement.removeEventListener('touchmove', handleTouchMove);
      renderer.domElement.removeEventListener('touchend', handleTouchEnd);

      supabase.removeChannel(channel);
      channelRef.current = null;

      if (localBubbleSphereRef.current) {
        scene.remove(localBubbleSphereRef.current);
        localBubbleSphereRef.current = null;
      }
      bubbleSpheresRef.current.clear();
      presenceDataRef.current.clear();
      nearbyUserIdsRef.current = new Set();

      if (vrButton?.parentNode) {
        vrButton.parentNode.removeChild(vrButton);
      }
      if (containerRef.current && renderer.domElement.parentNode) {
        containerRef.current.removeChild(renderer.domElement);
      }
      renderer.dispose();
    };
  }, [officeId, currentUser, environment]);

  const handleSaveSettings = async (settings: AvatarCustomization) => {
    if (!user) return;

    const { error } = await supabase.from('profiles').upsert({
      id: user.id,
      avatar_body_color: settings.bodyColor,
      avatar_skin_color: settings.skinColor,
      avatar_style: settings.style,
      avatar_accessories: settings.accessories,
      avatar_preset_id: settings.presetId ?? null,
      avatar_model_url: settings.modelUrl ?? null,
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

  function validateSlug(value: string): string | null {
    if (!value) return 'Room name is required.';
    if (value.length < 2) return 'Must be at least 2 characters.';
    if (value.length > 50) return 'Must be 50 characters or fewer.';
    if (!/^[a-z0-9-]+$/.test(value)) return 'Only lowercase letters, numbers, and hyphens allowed.';
    if (value.startsWith('-') || value.endsWith('-')) return 'Cannot start or end with a hyphen.';
    if (/--/.test(value)) return 'No consecutive hyphens allowed.';
    return null;
  }

  const handleCreateRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    const slugError = validateSlug(createRoomName);
    if (slugError) { setCreateRoomError(slugError); return; }
    setCreateRoomLoading(true);
    setCreateRoomError(null);
    try {
      const { data: office, error: officeError } = await supabase
        .from('offices')
        .insert({ name: createRoomName, link_access: createRoomLinkAccess })
        .select()
        .single();
      if (officeError) throw officeError;
      await supabase.from('office_members').insert({
        office_id: office.id,
        user_id: user.id,
        role: 'owner',
      });
      setShowCreateRoom(false);
      setCreateRoomName('');
      setCreateRoomLinkAccess(true);
      onShowOfficeSelector?.();
    } catch {
      setCreateRoomError('Failed to create room. Please try again.');
    } finally {
      setCreateRoomLoading(false);
    }
  };

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100vh' }}>
      {/* Green outline when mouse look mode is active */}
      {mouseLockActive && (
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 50,
          boxShadow: 'inset 0 0 0 4px #00ff00',
        }} />
      )}

      <ControlsOverlay
        motionPermission={motionPermission}
        motionCapable={motionCapable}
        onRecalibrate={() => recalibrateMotionRef.current?.()}
        onEnableMotion={enableMotion}
        onDisableMotion={disableMotion}
        motionDebugRef={motionDebugRef}
        showChat
        extras={
          <p style={{ margin: '5px 0', color: '#60a5fa', fontSize: '11px' }}>
            Walk near others to voice chat
          </p>
        }
      />

      {/* iOS motion permission prompt */}
      {motionPermission === 'prompt' && (
        <div style={{
          position: 'absolute', bottom: '30px', left: '50%',
          transform: 'translateX(-50%)', zIndex: 200,
          background: 'rgba(0,0,0,0.85)', color: 'white',
          padding: '14px 20px', borderRadius: '10px',
          fontFamily: 'monospace', textAlign: 'center',
          border: '1px solid rgba(255,255,255,0.2)',
          display: 'flex', alignItems: 'center', gap: '12px',
        }}>
          <span style={{ fontSize: '13px', color: 'rgba(255,255,255,0.75)' }}>
            Enable gyroscope to look around by moving your device
          </span>
          <button
            onClick={handleRequestMotionPermission}
            style={{
              padding: '8px 16px', background: '#6366f1', color: 'white',
              border: 'none', borderRadius: '6px', cursor: 'pointer',
              fontSize: '13px', fontWeight: '600', whiteSpace: 'nowrap',
            }}
          >
            Enable Motion
          </button>
        </div>
      )}

      {/* Jitsi voice chat error banner */}
      {jitsiError && (
        <div style={{
          position: 'absolute', top: '20px', left: '50%', transform: 'translateX(-50%)',
          background: 'rgba(185, 28, 28, 0.92)', color: 'white',
          padding: '10px 16px', borderRadius: '8px', zIndex: 300,
          fontFamily: 'monospace', fontSize: '13px',
          display: 'flex', alignItems: 'center', gap: '12px',
          boxShadow: '0 2px 12px rgba(0,0,0,0.5)', maxWidth: '90vw',
        }}>
          <span>⚠️ {jitsiError}</span>
          <button
            onClick={() => setJitsiError(null)}
            style={{
              background: 'none', border: 'none', color: 'white',
              cursor: 'pointer', fontSize: '18px', lineHeight: 1, padding: 0, flexShrink: 0,
            }}
          >
            ×
          </button>
        </div>
      )}

      {/* Voice chat status indicator — always visible, reflects full Jitsi state */}
      {(() => {
        let bg: string;
        let icon: string;
        let label: string;
        const missing = [
          !import.meta.env.VITE_JAAS_APP_ID     && 'VITE_JAAS_APP_ID',
          !import.meta.env.VITE_JAAS_API_KEY_ID && 'VITE_JAAS_API_KEY_ID',
          !import.meta.env.VITE_JAAS_PRIVATE_KEY && 'VITE_JAAS_PRIVATE_KEY',
        ].filter(Boolean) as string[];
        const jaasConfigured = missing.length === 0;
        if (jaasJwtError) {
          bg = 'rgba(185, 28, 28, 0.92)';  // red — credentials invalid
          icon = '❌';
          label = `Voice chat credential error: ${jaasJwtError}`;
        } else if (!jaasConfigured) {
          bg = 'rgba(75, 85, 99, 0.92)';   // grey — not configured
          icon = '⚙️';
          label = `Voice chat not configured — missing: ${missing.join(', ')}`;
        } else if (!jaasJwt) {
          bg = 'rgba(75, 85, 99, 0.92)';   // grey — JWT pending
          icon = '⏳';
          label = 'Voice chat initializing…';
        } else if (!jitsiRoom) {
          bg = 'rgba(55, 65, 81, 0.92)';   // dark — idle
          icon = '🔇';
          label = 'Walk near others to voice chat';
        } else if (jitsiConnected) {
          bg = 'rgba(0, 160, 90, 0.92)';   // green — active
          icon = '🟢';
          label = `Voice active · ${nearbyUserIdsRef.current.size + 1} in range`;
        } else {
          bg = 'rgba(180, 120, 0, 0.92)';  // amber — connecting
          icon = '🟡';
          label = 'Voice connecting…';
        }
        return (
          <div
            style={{
              position: 'absolute', top: '20px', left: '50%', transform: 'translateX(-50%)',
              background: bg,
              borderRadius: '8px', padding: '8px 16px', color: 'white', zIndex: 200,
              display: 'flex', alignItems: 'center', gap: '10px', fontFamily: 'monospace',
              boxShadow: '0 2px 12px rgba(0,0,0,0.4)', transition: 'background 0.4s',
            }}
          >
            <span style={{ fontSize: '16px' }}>{icon}</span>
            <span style={{ fontSize: '13px' }}>{label}</span>
            {/* Remote audio level bar — visible when connected */}
            {jitsiConnected && (
              <div title="Remote audio level" style={{
                display: 'flex', alignItems: 'center', gap: '2px',
              }}>
                {[0.15, 0.35, 0.55, 0.75, 0.95].map((thresh, i) => (
                  <div key={i} style={{
                    width: '4px',
                    height: `${8 + i * 3}px`,
                    borderRadius: '2px',
                    background: remoteAudioLevel >= thresh
                      ? (thresh > 0.7 ? '#f87171' : thresh > 0.45 ? '#fbbf24' : '#4ade80')
                      : 'rgba(255,255,255,0.25)',
                    transition: 'background 0.1s',
                  }} />
                ))}
              </div>
            )}
          </div>
        );
      })()}

      {/* Jitsi audio iframe — kept in-viewport (bottom-right corner) but invisible.
          opacity:0 hides it from users while keeping it "visible" to Chrome so the
          browser does NOT throttle the cross-origin iframe's JS timers.
          Positioning it fully off-screen (top:-400px) causes Chrome to suspend the
          iframe's task queue, preventing Jitsi from initiating the XMPP connection.
          The allow attribute is required for microphone access in cross-origin iframes. */}
      {jitsiRoom && jaasJwt && (
        <div style={{
          position: 'fixed', bottom: 0, right: 0,
          width: '480px', height: '270px',
          opacity: 0, pointerEvents: 'none', zIndex: -1,
        }}>
          <JaaSMeeting
            appId={import.meta.env.VITE_JAAS_APP_ID ?? ''}
            jwt={jaasJwt}
            roomName={jitsiRoom}
            configOverwrite={{
              startWithAudioMuted: false,
              startWithVideoMuted: true,
              prejoinPageEnabled: false,
              disableModeratorIndicator: true,
              enableNoisyMicDetection: false,
              disableDeepLinking: true,
            }}
            interfaceConfigOverwrite={{
              TOOLBAR_BUTTONS: [],
              SHOW_JITSI_WATERMARK: false,
              SHOW_WATERMARK_FOR_GUESTS: false,
            }}
            userInfo={{
              displayName: currentUser?.name || 'User',
              email: user?.email || '',
            }}
            getIFrameRef={(iframeRef) => {
              iframeRef.style.width = '480px';
              iframeRef.style.height = '270px';
              // Required for microphone/camera access inside cross-origin iframes
              (iframeRef as unknown as HTMLIFrameElement).allow =
                'camera; microphone; display-capture; autoplay; screen-wake-lock';
            }}
            onApiReady={api => {
              console.log('[VoiceChat] onApiReady fired — iframe JS loaded, waiting for videoConferenceJoined');
              jitsiApiRef.current = api;
              setJitsiError(null);

              // onApiReady means the iframe JS loaded — NOT that the conference was
              // joined. Wait for videoConferenceJoined before marking as connected.
              // The 15s timeout keeps running: if videoConferenceJoined never fires
              // we still want to show the "server unavailable" error.

              // If user was muted before the API loaded, sync into Jitsi
              if (micMuted) api.executeCommand('toggleAudio');

              // Remote audio level — decay toward 0 between events
              if (remoteAudioDecayRef.current) clearInterval(remoteAudioDecayRef.current);
              remoteAudioDecayRef.current = setInterval(() => {
                setRemoteAudioLevel(prev => (prev > 0.01 ? prev * 0.85 : 0));
              }, 80);

              api.addListener('audioLevelsChanged', ({ id, level }: { id: string; level: number }) => {
                void id;
                setRemoteAudioLevel(prev => Math.max(prev, level));
              });

              // Only mark connected when actually inside the conference room
              api.addEventListener('videoConferenceJoined', () => {
                console.log('[VoiceChat] videoConferenceJoined — connected to room:', jitsiRoom);
                if (jitsiConnectTimeoutRef.current) {
                  clearTimeout(jitsiConnectTimeoutRef.current);
                  jitsiConnectTimeoutRef.current = null;
                }
                setJitsiConnected(true);
              });

              const onDisconnect = (reason?: string) => {
                console.warn('[VoiceChat] Disconnected from voice chat. Reason:', reason ?? '(unknown)');
                setJitsiConnected(false);
                if (remoteAudioDecayRef.current) {
                  clearInterval(remoteAudioDecayRef.current);
                  remoteAudioDecayRef.current = null;
                }
                setRemoteAudioLevel(0);
              };

              api.addEventListener('videoConferenceLeft', () => {
                console.warn('[VoiceChat] videoConferenceLeft');
                onDisconnect('videoConferenceLeft');
              });
              api.addEventListener('conferenceTerminated', () => {
                console.warn('[VoiceChat] conferenceTerminated');
                onDisconnect('conferenceTerminated');
              });

              // connectionFailed / errorOccurred can surface via addEventListener too
              api.addEventListener('connectionFailed', () => {
                console.error('[VoiceChat] connectionFailed (addEventListener)');
              });

              api.on('connectionFailed', (e: any) => {
                console.error('[VoiceChat] connectionFailed:', e);
                setJitsiError('Voice chat connection failed. Check your network connection.');
                onDisconnect('connectionFailed');
              });

              api.addEventListener('conferenceError', () => {
                console.error('[VoiceChat] conferenceError (see Jitsi logs above for details)');
              });

              api.on('errorOccurred', (e: any) => {
                console.error('[VoiceChat] errorOccurred:', e);
                if (e?.error?.isFatal) {
                  setJitsiError('Voice chat encountered a fatal error. Try moving away and back.');
                  onDisconnect('errorOccurred (fatal)');
                }
              });

              api.on('kickedOut', (e: any) => {
                console.warn('[VoiceChat] kickedOut:', e);
                setJitsiError('You were disconnected from voice chat.');
                onDisconnect('kickedOut');
              });
            }}
          />
        </div>
      )}

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

        {/* Microphone indicator + mute toggle — always visible */}
        <div style={{
          marginTop: '8px', paddingTop: '8px',
          borderTop: '1px solid rgba(255,255,255,0.15)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {/* VU meter: 5 segments driven by live mic level */}
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: '2px', height: '18px' }}
                 title={micLevel < 0 ? (micError ?? 'Microphone unavailable') : micMuted ? 'Muted' : 'Microphone active'}>
              {[0.08, 0.22, 0.40, 0.62, 0.85].map((thresh, i) => (
                <div key={i} style={{
                  width: '4px',
                  height: `${6 + i * 3}px`,
                  borderRadius: '2px',
                  background: micMuted || micLevel < 0
                    ? 'rgba(255,255,255,0.2)'
                    : micLevel >= thresh
                      ? (thresh > 0.55 ? '#f87171' : thresh > 0.3 ? '#fbbf24' : '#4ade80')
                      : 'rgba(255,255,255,0.2)',
                  transition: 'background 0.08s',
                }} />
              ))}
            </div>

            {micLevel < 0 ? (
              /* Error state: tap to retry (user gesture unlocks iOS mic + AudioContext) */
              <button
                onClick={() => startMicRef.current?.()}
                title="Tap to request microphone access"
                style={{
                  background: 'rgba(220,38,38,0.8)', border: 'none', borderRadius: '4px',
                  cursor: 'pointer', color: 'white', fontSize: '12px', padding: '3px 8px',
                }}
              >
                🎤 Tap to enable
              </button>
            ) : (
              /* Normal state: mute toggle */
              <>
                <button
                  onClick={handleMuteToggle}
                  title={micMuted ? 'Unmute microphone' : 'Mute microphone'}
                  style={{
                    background: micMuted ? 'rgba(220,38,38,0.8)' : 'rgba(255,255,255,0.15)',
                    border: 'none', borderRadius: '4px', cursor: 'pointer',
                    color: 'white', fontSize: '13px', padding: '3px 8px',
                    transition: 'background 0.2s',
                  }}
                >
                  {micMuted ? '🔇' : '🎤'}
                </button>
                <span style={{ fontSize: '11px', color: '#aaa' }}>
                  {micMuted ? 'Muted' : 'Live'}
                </span>
              </>
            )}
          </div>

          {/* Show actual error reason below the buttons when mic failed */}
          {micLevel < 0 && micError && (
            <div style={{ fontSize: '10px', color: '#f87171', marginTop: '4px', maxWidth: '160px', wordBreak: 'break-word' }}>
              {micError}
            </div>
          )}
        </div>
        <p style={{ margin: '5px 0', fontSize: '12px', color: '#888' }}>
          Office: {officeId === 'global' ? 'Global' : 'Private'}
        </p>

        {user && (
          <>
            <button
              onClick={() => setShowCreateRoom(true)}
              style={{
                marginTop: '10px', padding: '8px 16px',
                background: '#7c3aed', color: 'white',
                border: 'none', borderRadius: '4px', cursor: 'pointer',
                fontSize: '14px', width: '100%',
              }}
            >
              + New Room
            </button>
            <button
              onClick={() => setShowSettings(true)}
              style={{
                marginTop: '8px', padding: '8px 16px',
                background: '#3498db', color: 'white',
                border: 'none', borderRadius: '4px', cursor: 'pointer',
                fontSize: '14px', width: '100%',
              }}
            >
              ⚙️ Settings
            </button>
          </>
        )}

        {user ? (
          <>
            {onShowOfficeSelector && (
              <button
                onClick={onShowOfficeSelector}
                style={{
                  marginTop: '10px', padding: '8px 16px',
                  background: '#8b5cf6', color: 'white',
                  border: 'none', borderRadius: '4px', cursor: 'pointer',
                  fontSize: '14px', width: '100%',
                }}
              >
                🏠 Back to Lobby
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
            onClick={() => setShowLoginModal(true)}
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
        onEnvironmentChange={user ? handleEnvironmentChange : undefined}
      />

      {/* Login modal — overlays the scene so the world stays visible behind it */}
      {showLoginModal && (
        <div
          onClick={() => setShowLoginModal(false)}
          style={{
            position: 'absolute', inset: 0, zIndex: 500,
            background: 'rgba(0,0,0,0.65)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: 'white', borderRadius: '12px',
              padding: '40px 36px', maxWidth: '380px', width: '90%',
              boxShadow: '0 8px 40px rgba(0,0,0,0.5)',
              textAlign: 'center',
            }}
          >
            <button
              onClick={() => setShowLoginModal(false)}
              style={{
                position: 'absolute', top: '12px', right: '16px',
                background: 'none', border: 'none', fontSize: '22px',
                cursor: 'pointer', color: '#666', lineHeight: 1,
              }}
            >
              ×
            </button>

            <h1 style={{ margin: '0 0 6px 0', fontSize: '28px', fontWeight: 'bold', color: '#1f2937' }}>
              OfficeXR
            </h1>
            <p style={{ margin: '0 0 28px 0', color: '#6b7280', fontSize: '15px' }}>
              Sign in to access your private rooms
            </p>

            <button
              onClick={() => signInWithGoogle()}
              style={{
                width: '100%', display: 'flex', alignItems: 'center',
                justifyContent: 'center', gap: '12px',
                padding: '12px 20px', borderRadius: '8px', cursor: 'pointer',
                border: '2px solid #e5e7eb', background: 'white',
                color: '#374151', fontSize: '15px', fontWeight: '500',
              }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
              </svg>
              Sign in with Google
            </button>

            <p style={{ margin: '20px 0 0 0', fontSize: '13px', color: '#9ca3af' }}>
              Or continue exploring as a guest — no sign-in required
            </p>
          </div>
        </div>
      )}

      {/* Create room dialog */}
      {showCreateRoom && (
        <div
          onClick={() => { setShowCreateRoom(false); setCreateRoomError(null); setCreateRoomName(''); }}
          style={{
            position: 'absolute', inset: 0, zIndex: 500,
            background: 'rgba(0,0,0,0.65)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background: '#1e1e2e', borderRadius: '12px',
              padding: '32px', width: '380px', maxWidth: '90vw',
              boxShadow: '0 8px 40px rgba(0,0,0,0.6)',
              border: '1px solid rgba(255,255,255,0.08)',
            }}
          >
            <h2 style={{ margin: '0 0 6px 0', fontSize: '20px', fontWeight: '700', color: 'white' }}>
              Create a new room
            </h2>
            <p style={{ margin: '0 0 24px 0', fontSize: '13px', color: 'rgba(255,255,255,0.45)' }}>
              The room name becomes part of its identity — use a short, descriptive slug.
            </p>

            <form onSubmit={handleCreateRoom}>
              <label style={{ display: 'block', fontSize: '12px', fontWeight: '600', color: 'rgba(255,255,255,0.6)', marginBottom: '6px', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                Room name (slug)
              </label>
              <input
                value={createRoomName}
                onChange={e => {
                  const val = e.target.value.toLowerCase().replace(/\s+/g, '-');
                  setCreateRoomName(val);
                  setCreateRoomError(validateSlug(val));
                }}
                placeholder="my-team-room"
                autoFocus
                spellCheck={false}
                style={{
                  width: '100%', padding: '10px 12px',
                  background: 'rgba(255,255,255,0.07)',
                  border: `1px solid ${createRoomError && createRoomName ? '#ef4444' : 'rgba(255,255,255,0.15)'}`,
                  borderRadius: '8px', color: 'white', fontSize: '15px',
                  fontFamily: 'monospace', boxSizing: 'border-box', outline: 'none',
                }}
              />
              <div style={{ minHeight: '20px', marginTop: '6px' }}>
                {createRoomError && createRoomName && (
                  <p style={{ margin: 0, fontSize: '12px', color: '#f87171' }}>{createRoomError}</p>
                )}
                {!createRoomError && createRoomName && (
                  <p style={{ margin: 0, fontSize: '12px', color: '#4ade80' }}>✓ Valid room name</p>
                )}
              </div>

              <label style={{
                display: 'flex', alignItems: 'center', gap: '8px',
                marginTop: '16px', cursor: 'pointer', fontSize: '14px', color: 'rgba(255,255,255,0.7)',
              }}>
                <input
                  type="checkbox"
                  checked={createRoomLinkAccess}
                  onChange={e => setCreateRoomLinkAccess(e.target.checked)}
                  style={{ width: '15px', height: '15px' }}
                />
                Anyone with the link can join
              </label>

              {createRoomError && !createRoomName && (
                <p style={{ margin: '12px 0 0 0', fontSize: '12px', color: '#f87171' }}>{createRoomError}</p>
              )}

              <div style={{ display: 'flex', gap: '8px', marginTop: '24px' }}>
                <button
                  type="submit"
                  disabled={createRoomLoading || !!validateSlug(createRoomName)}
                  style={{
                    flex: 1, padding: '10px',
                    background: createRoomLoading || validateSlug(createRoomName) ? '#4b3f7c' : '#7c3aed',
                    color: 'white', border: 'none', borderRadius: '8px',
                    cursor: createRoomLoading || validateSlug(createRoomName) ? 'not-allowed' : 'pointer',
                    fontSize: '14px', fontWeight: '600',
                    opacity: createRoomLoading || validateSlug(createRoomName) ? 0.6 : 1,
                  }}
                >
                  {createRoomLoading ? 'Creating…' : 'Create Room'}
                </button>
                <button
                  type="button"
                  onClick={() => { setShowCreateRoom(false); setCreateRoomError(null); setCreateRoomName(''); }}
                  style={{
                    flex: 1, padding: '10px',
                    background: 'rgba(255,255,255,0.07)',
                    color: 'rgba(255,255,255,0.7)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '8px', cursor: 'pointer', fontSize: '14px',
                  }}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Virtual joystick — touch devices only */}
      {isTouchDevice && (
        <div
          onTouchStart={e => {
            e.preventDefault();
            setJoystickActive(true);
          }}
          onTouchMove={e => {
            e.preventDefault();
            const touch = e.touches[0];
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
            const cx = rect.left + rect.width / 2;
            const cy = rect.top + rect.height / 2;
            let dx = touch.clientX - cx;
            let dy = touch.clientY - cy;
            const dist = Math.sqrt(dx * dx + dy * dy);
            const maxR = 45;
            if (dist > maxR) {
              dx = (dx / dist) * maxR;
              dy = (dy / dist) * maxR;
            }
            setJoystickKnob({ x: dx, y: dy });
            joystickInputRef.current = { x: dx / maxR, y: dy / maxR };
          }}
          onTouchEnd={() => {
            setJoystickActive(false);
            setJoystickKnob({ x: 0, y: 0 });
            joystickInputRef.current = { x: 0, y: 0 };
          }}
          style={{
            position: 'absolute', bottom: '40px', left: '40px',
            width: '120px', height: '120px', borderRadius: '50%',
            background: 'rgba(255,255,255,0.12)',
            border: '2px solid rgba(255,255,255,0.25)',
            zIndex: 200, touchAction: 'none',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
        >
          <div style={{
            width: '52px', height: '52px', borderRadius: '50%',
            background: joystickActive ? 'rgba(255,255,255,0.45)' : 'rgba(255,255,255,0.25)',
            border: '2px solid rgba(255,255,255,0.5)',
            transform: `translate(${joystickKnob.x}px, ${joystickKnob.y}px)`,
            transition: joystickActive ? 'none' : 'transform 0.15s ease-out',
            pointerEvents: 'none',
          }} />
        </div>
      )}
    </div>
  );
}
