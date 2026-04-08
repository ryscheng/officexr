import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as THREE from 'three';
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js';
import liliensteinHdriUrl from '../assets/hdri/lilienstein_4k.exr?url';
import { JaaSMeeting } from '@jitsi/react-sdk';
import { generateJaaSJwt } from '@/lib/jaasJwt';
import { createAvatar, updateAvatar, AvatarData, AvatarAnimationState, switchAnimation } from './Avatar';
import { EMOJI_MAP, spawnConfetti, updateParticles, Particle } from './EmojiConfetti';
import SettingsPanel from './SettingsPanel';
import ControlsOverlay from './ControlsOverlay';
import NetworkDebugPanel, { SignalIcon } from './NetworkDebugPanel';
import { useNetworkStats } from '@/hooks/useNetworkStats';
import { AvatarCustomization, BubblePreferences, loadBubblePrefs } from '@/types/avatar';
import { PresenceEntry, CameraMode, EnvironmentType, ChatMessage, ScreenShare } from '@/types/room';
import { supabase } from '@/lib/supabase';
import { useAuth, signOut, signInWithGoogle } from '@/hooks/useAuth';
import { useMotionControls } from '@/hooks/useMotionControls';
import { useRealtimeChannel } from '@/hooks/useRealtimeChannel';
import { useChat } from '@/hooks/useChat';
import { useAvatarCustomization } from '@/hooks/useAvatarCustomization';
import { useScreenSharing } from '@/hooks/useScreenSharing';



function createBubbleSphere(scene: THREE.Scene, radius: number, color: number): THREE.Mesh {
  const geo = new THREE.SphereGeometry(radius, 24, 24);
  const mat = new THREE.MeshStandardMaterial({
    color,
    transparent: true,
    opacity: 0.12,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const sphere = new THREE.Mesh(geo, mat);
  scene.add(sphere);
  return sphere;
}

function hexStringToInt(hex: string): number {
  return parseInt(hex.replace('#', ''), 16);
}

interface OfficeSceneProps {
  officeId: string;
  onLeave: () => void;
  onShowOfficeSelector?: () => void;
}

export default function OfficeScene({ officeId, onLeave, onShowOfficeSelector }: OfficeSceneProps) {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  // Generate anonymous user data if not logged in (wait for auth to resolve first)
  const anonymousUserRef = useRef<{ id: string; name: string } | null>(null);
  if (!authLoading && !user && !anonymousUserRef.current) {
    const randomId = `anon-${Math.random().toString(36).substr(2, 9)}`;
    const guestNumber = Math.floor(Math.random() * 1000);
    anonymousUserRef.current = {
      id: randomId,
      name: `Guest ${guestNumber}`,
    };
  }

  const currentUser = user || anonymousUserRef.current;
  // Keep currentUser in a ref so closures inside the Three.js useEffect always
  // see the latest value without being listed as a dep (which would tear down and
  // recreate the entire scene + channel on every token refresh).
  const currentUserRef = useRef(currentUser);
  currentUserRef.current = currentUser;
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const {
    channelRef,
    channelSubscribedRef,
    myPresenceRef: channelMyPresenceRef,
    send: channelSend,
    track: channelTrack,
  } = useRealtimeChannel({ officeId, userId: currentUser?.id });
  // Pending customization updates received before the target avatar existed
  const pendingAvatarUpdatesRef = useRef<Map<string, AvatarCustomization>>(new Map());
  const avatarsRef = useRef<Map<string, THREE.Group>>(new Map());
  const avatarAnimationsRef = useRef<Map<string, AvatarAnimationState>>(new Map());
  const avatarPrevPositionsRef = useRef<Map<string, THREE.Vector3>>(new Map());
  const avatarTargetsRef = useRef<Map<string, { position: THREE.Vector3; rotationY: number }>>(new Map());
  const bubbleSpheresRef = useRef<Map<string, THREE.Mesh>>(new Map());
  const remoteBubblePrefsRef = useRef<Map<string, BubblePreferences>>(new Map());
  const selfMarkerRef = useRef<THREE.Group | null>(null);
  const presenceDataRef = useRef<Map<string, PresenceEntry>>(new Map());
  const nearbyUserIdsRef = useRef<Set<string>>(new Set());
  const jitsiRoomRef = useRef<string | null>(null);
  const myPresenceRef = channelMyPresenceRef;
  const recentlyLeftRef = useRef<Map<string, { id: string; name: string; email: string | null; leftAt: number }>>(new Map());
  const [onlineUsers, setOnlineUsers] = useState<Array<{ id: string; name: string; email: string | null; status: 'active' | 'inactive' | 'offline' }>>([]);
  const [jitsiRoom, setJitsiRoom] = useState<string | null>(null);
  const [jitsiError, setJitsiError] = useState<string | null>(null);
  const [jitsiConnected, setJitsiConnected] = useState(false);
  const [jitsiParticipantCount, setJitsiParticipantCount] = useState(0);
  const [jitsiRetryCount, setJitsiRetryCount] = useState(0);
  const [jaasJwt, setJaasJwt] = useState<string | null>(null);
  const [jaasJwtError, setJaasJwtError] = useState<string | null>(null);
  const [remoteAudioLevel, setRemoteAudioLevel] = useState(0);
  const jitsiApiRef = useRef<any>(null);
  const remoteAudioDecayRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const jitsiConnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const jitsiHeartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const jitsiMessageListenerRef = useRef<((evt: MessageEvent) => void) | null>(null);
  const jitsiLeaveDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const jitsiConnectionGenRef = useRef(0);

  // Screen sharing
  const {
    screenShares,
    activeShareId,
    setActiveShareId,
    isSharing,
    startScreenShare,
    stopScreenShare,
    registerScreenListeners,
    cleanupPeerConnections,
  } = useScreenSharing({
    channelRef,
    currentUserRef,
    presenceDataRef,
  });

  const [micMuted, setMicMuted] = useState(false);
  const [micLevel, setMicLevel] = useState<number>(0); // 0–1; –1 = failed
  const [micError, setMicError] = useState<string | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const micAudioCtxRef = useRef<AudioContext | null>(null);
  const startMicRef = useRef<(() => Promise<void>) | null>(null);
  const lastPositionUpdate = useRef<number>(0);
  const lastSeenAt = useRef<Map<string, number>>(new Map());
  const lastBroadcastPositionRef = useRef<Map<string, { position: THREE.Vector3; rotationY: number; time: number }>>(new Map());
  const localAvatarRef = useRef<THREE.Group | null>(null);
  const localAvatarAnimationRef = useRef<AvatarAnimationState | null>(null);
  const localBubbleSphereRef = useRef<THREE.Mesh | null>(null);
  const cameraModeRef = useRef<CameraMode>('first-person');

  // Avatar customization hook
  const {
    avatarCustomization,
    avatarCustomizationRef,
    currentUserRole,
    handleSaveSettings,
    handleBubblePrefsChange,
    bubblePrefsRef,
    showSettings,
    setShowSettings,
  } = useAvatarCustomization({
    user,
    anonymousUserRef,
    officeId,
    channelRef,
    channelSubscribedRef,
    myPresenceRef,
    sceneRef,
    localAvatarRef,
    localAvatarAnimationRef,
    localBubbleSphereRef,
    cameraModeRef,
    jitsiRoomRef,
  });

  const keysRef = useRef<{ [key: string]: boolean }>({});

  // Chat
  const {
    chatMessages,
    chatVisible,
    setChatVisible,
    chatInput,
    setChatInput,
    chatInputRef,
    chatScrollRef,
    chatVisibleRef,
    sendChatMessage,
    registerChatListener,
  } = useChat({
    channelRef,
    channelSubscribedRef,
    currentUser,
    currentUserRef,
    showSettings: showSettings,
    keysRef,
  });
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

  const [showDebugPanel, setShowDebugPanel] = useState(false);
  // Trigger renderer resize when debug panel toggles
  useEffect(() => {
    const timer = setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
    return () => clearTimeout(timer);
  }, [showDebugPanel]);

  // Network stats for debug panel
  const networkStats = useNetworkStats(
    channelRef,
    channelSubscribedRef,
    currentUser?.id,
    onlineUsers,
    showDebugPanel,
  );
  const recordPositionUpdateRef = useRef(networkStats.recordPositionUpdate);
  recordPositionUpdateRef.current = networkStats.recordPositionUpdate;
  const [is2DMode, setIs2DMode] = useState(false);
  const [showControls, setShowControls] = useState(false);
  const is2DModeRef = useRef(false);
  is2DModeRef.current = is2DMode;
  const [cameraMode, setCameraMode] = useState<CameraMode>('first-person');
  cameraModeRef.current = cameraMode;
  // In third-person the player position is tracked separately from camera position
  const playerPositionRef = useRef(new THREE.Vector3(0, 0, 5));
  const playerYawRef = useRef(0);
  const [followingUserId, setFollowingUserId] = useState<string | null>(null);
  const followingUserIdRef = useRef<string | null>(null);
  followingUserIdRef.current = followingUserId;
  // Environment settings — arbitrary string; unknown values render as 'corporate'
  const [environment, setEnvironment] = useState<EnvironmentType>('corporate');

  // Load environment from the office record so all users start with the same scene
  useEffect(() => {
    if (!officeId || officeId === 'global') return;
    supabase
      .from('offices')
      .select('environment')
      .eq('id', officeId)
      .single()
      .then(({ data, error }) => {
        if (error) {
          console.error('[Environment] Failed to load:', error);
          return;
        }
        if (data?.environment) {
          setEnvironment(data.environment);
        }
      });
  }, [officeId]);

  // Generate a JaaS JWT from the private key stored in env vars.
  // Regenerated whenever the current user changes (e.g. login/logout).
  // TTL is 1 week; the token is generated client-side via Web Crypto (RS256).
  useEffect(() => {
    const appId      = import.meta.env.VITE_JAAS_APP_ID      as string | undefined;
    const apiKeyId   = import.meta.env.VITE_JAAS_API_KEY_ID  as string | undefined;
    const privateKeyB64 = import.meta.env.VITE_JAAS_PRIVATE_KEY as string | undefined;
    const privateKey = privateKeyB64 ? atob(privateKeyB64) : undefined;

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

  const handleEnvironmentChange = (env: EnvironmentType) => {
    setEnvironment(env);

    // Persist to DB — only owners/admins can update offices (enforced by RLS)
    if (officeId && officeId !== 'global') {
      supabase.from('offices').update({ environment: env }).eq('id', officeId)
        .then(({ error }) => {
        if (error) console.error('[Environment] Failed to save:', error);
      });
    }

    // Broadcast to all currently connected users — must happen before
    // setEnvironment triggers the scene rebuild that recreates the channel
    if (channelRef.current && channelSubscribedRef.current) {
      channelRef.current.send({
        type: 'broadcast',
        event: 'environment-change',
        payload: { environment: env },
      }).then((result: string) => {
        if (result !== 'ok') console.error('[Environment] Broadcast failed:', result);
      });
    }
  };


  // Avatar customization loading, saving, and presence tracking handled by useAvatarCustomization

  // Chat effects are handled by useChat hook

  // Exit pointer lock when switching to 2D mode
  useEffect(() => {
    if (is2DMode && document.pointerLockElement) {
      document.exitPointerLock();
    }
  }, [is2DMode]);


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

  // Thoroughly clean up all Jitsi resources (intervals, listeners, API, timeouts).
  // Called on room change, retry, and unmount to prevent leaked intervals.
  const cleanupJitsi = useCallback(() => {
    jitsiConnectionGenRef.current++; // invalidate any in-flight callbacks from this session
    if (jitsiConnectTimeoutRef.current) {
      clearTimeout(jitsiConnectTimeoutRef.current);
      jitsiConnectTimeoutRef.current = null;
    }
    if (jitsiHeartbeatRef.current) {
      clearInterval(jitsiHeartbeatRef.current);
      jitsiHeartbeatRef.current = null;
    }
    if (jitsiMessageListenerRef.current) {
      window.removeEventListener('message', jitsiMessageListenerRef.current);
      jitsiMessageListenerRef.current = null;
    }
    if (remoteAudioDecayRef.current) {
      clearInterval(remoteAudioDecayRef.current);
      remoteAudioDecayRef.current = null;
    }
    if (jitsiApiRef.current) {
      try { jitsiApiRef.current.dispose(); } catch { /* already disposed */ }
      jitsiApiRef.current = null;
    }
  }, []);

  // Screen sharing functions are provided by useScreenSharing

  // Pre-warm: connect to a personal idle room as soon as the JWT is ready so
  // the Jitsi SDK bundle is downloaded and the XMPP connection is established
  // before the user ever enters proximity range.
  //
  // The idle room name is keyed by the current user's own ID (the same formula
  // used by handleProximityChange). If this user has the lexicographically
  // lowest ID among nearby users — roughly half of all encounters — the prewarm
  // room IS the proximity room, so voice becomes instant with zero reconnect.
  // In other cases the SDK is already cached and only the XMPP room switch
  // (~3–8 s) is needed instead of a cold start (~10–18 s).
  const jitsiPrewarmRoom = jaasJwt && currentUser
    ? `officexr-${officeId.slice(0, 8)}-${currentUser.id.slice(0, 8)}`
    : null;
  // The room JaaSMeeting actually connects to.
  const activeJitsiRoom = jitsiRoom ?? jitsiPrewarmRoom;

  // Reset Jitsi state when the active room changes and start a safety timeout
  // for iframe loading. The tighter XMPP-connection timeout starts in onApiReady.
  useEffect(() => {
    // Clean up everything from the previous Jitsi session (intervals, listeners, API)
    cleanupJitsi();
    // Capture generation AFTER cleanupJitsi incremented it — guards all async callbacks below
    const connectionGen = jitsiConnectionGenRef.current;

    if (!activeJitsiRoom || !jaasJwt) {
      setJitsiError(null);
      setJitsiConnected(false);
      setRemoteAudioLevel(0);
      return;
    }

    const isProximity = jitsiRoomRef.current !== null;
    console.log('[VoiceChat] Connecting — room:', activeJitsiRoom, isProximity ? '(proximity)' : '(prewarm)', 'jwt length:', jaasJwt?.length);
    setJitsiError(null);
    setJitsiConnected(false);
    // Only surface load errors for proximity rooms; silently retry for prewarm.
    if (isProximity) {
      jitsiConnectTimeoutRef.current = setTimeout(() => {
        if (jitsiConnectionGenRef.current !== connectionGen) return; // stale — a newer connection superseded this one
        console.error('[VoiceChat] Jitsi iframe never loaded after 30s. Room:', activeJitsiRoom);
        setJitsiError('Voice chat failed to load. Check your network connection.');
      }, 30000);
    }

    return () => {
      cleanupJitsi();
    };
  }, [activeJitsiRoom, jaasJwt, jitsiRetryCount, cleanupJitsi]);

  const playWaveChime = () => {
    try {
      const ctx = new AudioContext();
      // Two-note ding-dong: C5 then E5
      const notes = [523.25, 659.25];
      notes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        osc.connect(gain);
        gain.connect(ctx.destination);
        const start = ctx.currentTime + i * 0.18;
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(0.35, start + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.5);
        osc.start(start);
        osc.stop(start + 0.5);
      });
      setTimeout(() => ctx.close(), 1200);
    } catch {
      // AudioContext not available — silently skip
    }
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

    // Orthographic camera for 2D top-down mode
    let orthoViewSize = 15; // mutable so scroll wheel can zoom in/out
    const orthoAspect = window.innerWidth / window.innerHeight;
    const orthoCamera = new THREE.OrthographicCamera(
      -orthoViewSize * orthoAspect, orthoViewSize * orthoAspect,
      orthoViewSize, -orthoViewSize,
      0.1, 200,
    );
    orthoCamera.position.set(camera.position.x, 80, camera.position.z);
    orthoCamera.up.set(0, 0, -1); // north (-Z) is up on screen
    orthoCamera.lookAt(camera.position.x, 0, camera.position.z);

    // Renderer setup
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    if (navigator.xr) {
      renderer.xr.enabled = true;
    }
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    rendererRef.current = renderer;
    containerRef.current.appendChild(renderer.domElement);

    // Load HDRI skybox for the global lobby
    let hdriTexture: THREE.DataTexture | null = null;
    if (officeId === 'global') {
      const exrLoader = new EXRLoader();
      exrLoader.load(liliensteinHdriUrl, (texture) => {
        texture.mapping = THREE.EquirectangularReflectionMapping;
        scene.background = texture;
        scene.environment = texture;
        hdriTexture = texture;
      });
    }

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(5, 10, 5);
    directionalLight.castShadow = true;
    scene.add(directionalLight);

    // Build environment
    const buildEnvironment = () => {
      // Unknown scene names fall back to the default corporate office
      const resolvedEnv = ['corporate', 'cabin'].includes(environment) ? environment : 'corporate';
      if (resolvedEnv === 'corporate') {
        scene.background = new THREE.Color(0xadc8e0);

        // ── FLOOR (light warm carpet) ──
        const floor = new THREE.Mesh(
          new THREE.PlaneGeometry(30, 30),
          new THREE.MeshStandardMaterial({ color: 0xd4c9b0, roughness: 0.8 })
        );
        floor.rotation.x = -Math.PI / 2;
        floor.receiveShadow = true;
        scene.add(floor);

        // ── CEILING (white grid pattern) ──
        const ceilCanvas = document.createElement('canvas');
        ceilCanvas.width = 256; ceilCanvas.height = 256;
        const cCtx = ceilCanvas.getContext('2d')!;
        cCtx.fillStyle = '#f4f4f4';
        cCtx.fillRect(0, 0, 256, 256);
        cCtx.strokeStyle = '#cccccc';
        cCtx.lineWidth = 2;
        for (let ci = 0; ci <= 256; ci += 32) {
          cCtx.beginPath(); cCtx.moveTo(ci, 0); cCtx.lineTo(ci, 256); cCtx.stroke();
          cCtx.beginPath(); cCtx.moveTo(0, ci); cCtx.lineTo(256, ci); cCtx.stroke();
        }
        const ceilTex = new THREE.CanvasTexture(ceilCanvas);
        ceilTex.wrapS = THREE.RepeatWrapping;
        ceilTex.wrapT = THREE.RepeatWrapping;
        ceilTex.repeat.set(10, 10);
        const ceiling = new THREE.Mesh(
          new THREE.PlaneGeometry(30, 30),
          new THREE.MeshStandardMaterial({ map: ceilTex, roughness: 0.9 })
        );
        ceiling.rotation.x = Math.PI / 2;
        ceiling.position.y = 10;
        scene.add(ceiling);

        // ── FLOOR-TO-CEILING GLASS WALLS WITH STEEL STUDS ──
        const glassMat = new THREE.MeshStandardMaterial({
          color: 0x99ccee, transparent: true, opacity: 0.18,
          metalness: 0.1, roughness: 0.0, side: THREE.DoubleSide,
        });
        const steelMat = new THREE.MeshStandardMaterial({
          color: 0x607080, metalness: 0.85, roughness: 0.2,
        });
        const wallH = 10;

        // Four glass panels
        const northGlass = new THREE.Mesh(new THREE.BoxGeometry(30, wallH, 0.08), glassMat);
        northGlass.position.set(0, wallH / 2, -15); scene.add(northGlass);
        const southGlass = new THREE.Mesh(new THREE.BoxGeometry(30, wallH, 0.08), glassMat);
        southGlass.position.set(0, wallH / 2, 15); scene.add(southGlass);
        const eastGlass = new THREE.Mesh(new THREE.BoxGeometry(0.08, wallH, 30), glassMat);
        eastGlass.position.set(15, wallH / 2, 0); scene.add(eastGlass);
        const westGlass = new THREE.Mesh(new THREE.BoxGeometry(0.08, wallH, 30), glassMat);
        westGlass.position.set(-15, wallH / 2, 0); scene.add(westGlass);

        // Steel studs along N/S walls every 3 units
        const studGeo = new THREE.BoxGeometry(0.1, wallH, 0.1);
        for (let sx = -15; sx <= 15; sx += 3) {
          const sn = new THREE.Mesh(studGeo, steelMat);
          sn.position.set(sx, wallH / 2, -15); scene.add(sn);
          const ss = new THREE.Mesh(studGeo, steelMat);
          ss.position.set(sx, wallH / 2, 15); scene.add(ss);
        }
        // Steel studs along E/W walls (skip ±15 corners already covered above)
        const studGeoEW = new THREE.BoxGeometry(0.1, wallH, 0.1);
        for (let sz = -12; sz <= 12; sz += 3) {
          const se = new THREE.Mesh(studGeoEW, steelMat);
          se.position.set(15, wallH / 2, sz); scene.add(se);
          const sw = new THREE.Mesh(studGeoEW, steelMat);
          sw.position.set(-15, wallH / 2, sz); scene.add(sw);
        }
        // Horizontal top rail
        const trN = new THREE.Mesh(new THREE.BoxGeometry(30, 0.12, 0.12), steelMat);
        trN.position.set(0, wallH - 0.06, -15); scene.add(trN);
        const trS = new THREE.Mesh(new THREE.BoxGeometry(30, 0.12, 0.12), steelMat);
        trS.position.set(0, wallH - 0.06, 15); scene.add(trS);
        const trE = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 30), steelMat);
        trE.position.set(15, wallH - 0.06, 0); scene.add(trE);
        const trW = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 30), steelMat);
        trW.position.set(-15, wallH - 0.06, 0); scene.add(trW);

        // ── NYC SKYLINE (buildings visible through floor-to-ceiling windows) ──
        // Buildings are centered at y = h/2 - 10 so they span above and below the windows,
        // giving the impression of being on an upper floor of a skyscraper.
        const bldMatA = new THREE.MeshStandardMaterial({ color: 0x8898aa, metalness: 0.5, roughness: 0.6 });
        const bldMatB = new THREE.MeshStandardMaterial({ color: 0xa0aabb, metalness: 0.4, roughness: 0.5 });
        const bldMatC = new THREE.MeshStandardMaterial({ color: 0x778899, metalness: 0.6, roughness: 0.4 });
        const bldMats = [bldMatA, bldMatB, bldMatC];

        // [x, z, width, height, depth, mat index]
        const bldgs = [
          // North skyline
          [-22, -28, 8, 50, 8, 0], [-14, -24, 6, 34, 6, 1], [-5, -32, 10, 65, 10, 2],
          [3, -26, 7, 42, 7, 0], [10, -23, 5, 28, 5, 1], [17, -30, 8, 58, 8, 2],
          [25, -25, 7, 46, 7, 0], [-20, -38, 5, 30, 5, 1], [0, -40, 8, 44, 8, 2],
          [14, -36, 7, 55, 7, 0], [-10, -22, 4, 38, 4, 1], [22, -35, 6, 50, 6, 2],
          // South skyline
          [-20, 27, 7, 48, 7, 1], [-12, 23, 5, 32, 5, 2], [-4, 30, 9, 60, 9, 0],
          [4, 25, 6, 38, 6, 1], [12, 28, 8, 44, 8, 2], [20, 24, 5, 36, 5, 0],
          [-16, 37, 6, 40, 6, 1], [6, 35, 7, 55, 7, 2], [26, 32, 5, 42, 5, 0],
          // East skyline
          [28, -20, 7, 52, 7, 0], [24, -10, 5, 38, 5, 1], [30, 1, 8, 60, 8, 2],
          [26, 11, 6, 34, 6, 0], [28, 20, 7, 48, 7, 1], [22, -32, 5, 40, 5, 2],
          // West skyline
          [-28, -18, 7, 44, 7, 2], [-24, -6, 5, 30, 5, 0], [-32, 4, 9, 68, 9, 1],
          [-26, 14, 6, 50, 6, 2], [-30, -28, 8, 42, 8, 0], [-22, 22, 5, 36, 5, 1],
          // Corner fill
          [28, -28, 8, 55, 8, 1], [-28, 28, 7, 46, 7, 2],
          [28, 28, 6, 38, 6, 0], [-28, -28, 9, 62, 9, 1],
        ];
        bldgs.forEach(([bx, bz, bw, bh, bd, mi]) => {
          const bld = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bd), bldMats[mi]);
          bld.position.set(bx, bh / 2 - 10, bz);
          scene.add(bld);
        });

        // Street far below (visible through lower portion of windows)
        const streetGround = new THREE.Mesh(
          new THREE.PlaneGeometry(300, 300),
          new THREE.MeshStandardMaterial({ color: 0x3a3a44, roughness: 0.95 })
        );
        streetGround.rotation.x = -Math.PI / 2;
        streetGround.position.y = -30;
        scene.add(streetGround);

        // ── CORNER A: 8 DESKS IN 2 ROWS OF 4 (far-left, x<0, z<0) ──
        const deskTopMat = new THREE.MeshStandardMaterial({ color: 0xf0ece2, roughness: 0.4 });
        const deskLegMat = new THREE.MeshStandardMaterial({ color: 0x909090, metalness: 0.7, roughness: 0.3 });
        const monMat = new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 0.4 });
        const chairMat = new THREE.MeshStandardMaterial({ color: 0x263244, roughness: 0.7 });

        const addDesk = (cx: number, cz: number) => {
          const dH = 0.75;
          // Desk top
          const top = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.05, 0.8), deskTopMat);
          top.position.set(cx, dH, cz); scene.add(top);
          // Four legs
          [[-0.7, -0.35], [0.7, -0.35], [-0.7, 0.35], [0.7, 0.35]].forEach(([dx, dz]) => {
            const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, dH, 0.05), deskLegMat);
            leg.position.set(cx + dx, dH / 2, cz + dz); scene.add(leg);
          });
          // Monitor (faces -z, person sits at +z side)
          const mon = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.44, 0.04), monMat);
          mon.position.set(cx, dH + 0.27, cz - 0.28); scene.add(mon);
          // Chair (behind desk toward +z)
          const seat = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.07, 0.55), chairMat);
          seat.position.set(cx, 0.48, cz + 0.72); scene.add(seat);
          const back = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.55, 0.06), chairMat);
          back.position.set(cx, 0.79, cz + 0.98); scene.add(back);
        };

        // Row 1 at x=-13, Row 2 at x=-10.5; 4 desks each at z=-13,-11,-9,-7
        [-13, -11, -9, -7].forEach((dz) => { addDesk(-13, dz); addDesk(-10.5, dz); });

        // ── CORNER B: RESTING AREA — 2 COUCHES + COFFEE TABLE (far-right, x>0, z<0) ──
        const sofaMat = new THREE.MeshStandardMaterial({ color: 0x7a5c4a, roughness: 0.8 });
        const cushionMat = new THREE.MeshStandardMaterial({ color: 0x9a7060, roughness: 0.9 });
        const ctMat = new THREE.MeshStandardMaterial({ color: 0x3a2210, roughness: 0.3 });

        const addSofa = (cx: number, cz: number, backOnNorth: boolean) => {
          const sW = 2.4;
          const base = new THREE.Mesh(new THREE.BoxGeometry(sW, 0.45, 0.9), sofaMat);
          base.position.set(cx, 0.225, cz); scene.add(base);
          const cushion = new THREE.Mesh(new THREE.BoxGeometry(sW - 0.1, 0.14, 0.8), cushionMat);
          cushion.position.set(cx, 0.52, cz); scene.add(cushion);
          const backZ = backOnNorth ? cz - 0.38 : cz + 0.38;
          const backrest = new THREE.Mesh(new THREE.BoxGeometry(sW, 0.65, 0.18), sofaMat);
          backrest.position.set(cx, 0.7, backZ); scene.add(backrest);
          [-(sW / 2 - 0.1), sW / 2 - 0.1].forEach((dx) => {
            const arm = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.22, 0.9), sofaMat);
            arm.position.set(cx + dx, 0.56, cz); scene.add(arm);
          });
        };

        addSofa(10, -12.2, true);   // back against north wall, faces south
        addSofa(10,  -7.8, false);  // back on south side, faces north
        // Coffee table between the two couches
        const ctTop = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.06, 0.8), ctMat);
        ctTop.position.set(10, 0.44, -10); scene.add(ctTop);
        [[-0.5, -0.32], [0.5, -0.32], [-0.5, 0.32], [0.5, 0.32]].forEach(([dx, dz]) => {
          const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.44, 0.06), ctMat);
          leg.position.set(10 + dx, 0.22, -10 + dz); scene.add(leg);
        });

        // ── CORNER C: WATER COOLER + PING PONG TABLE (near-right, x>0, z>0) ──
        // Water cooler
        const wcBase = new THREE.Mesh(
          new THREE.BoxGeometry(0.38, 1.0, 0.32),
          new THREE.MeshStandardMaterial({ color: 0xe0e0e0, metalness: 0.3, roughness: 0.4 })
        );
        wcBase.position.set(13.5, 0.5, 13.5); scene.add(wcBase);
        const wcJug = new THREE.Mesh(
          new THREE.CylinderGeometry(0.13, 0.13, 0.38, 16),
          new THREE.MeshStandardMaterial({ color: 0x80bbff, transparent: true, opacity: 0.75, roughness: 0.1 })
        );
        wcJug.position.set(13.5, 1.19, 13.5); scene.add(wcJug);

        // Ping pong table (regulation ~2.74 × 1.525 m, height 0.76 m)
        const ppX = 9.5, ppZ = 11;
        const ppTop = new THREE.Mesh(
          new THREE.BoxGeometry(2.74, 0.05, 1.525),
          new THREE.MeshStandardMaterial({ color: 0x1a6e1a, roughness: 0.6 })
        );
        ppTop.position.set(ppX, 0.76, ppZ); scene.add(ppTop);
        // Center line
        const ppLine = new THREE.Mesh(
          new THREE.BoxGeometry(0.02, 0.002, 1.525),
          new THREE.MeshStandardMaterial({ color: 0xffffff })
        );
        ppLine.position.set(ppX, 0.786, ppZ); scene.add(ppLine);
        // Net
        const ppNet = new THREE.Mesh(
          new THREE.BoxGeometry(2.74, 0.15, 0.015),
          new THREE.MeshStandardMaterial({ color: 0xf8f8f8, transparent: true, opacity: 0.85 })
        );
        ppNet.position.set(ppX, 0.835, ppZ); scene.add(ppNet);
        // Legs
        const ppLegM = new THREE.MeshStandardMaterial({ color: 0x444444, metalness: 0.5 });
        [[-1.3, -0.71], [1.3, -0.71], [-1.3, 0.71], [1.3, 0.71]].forEach(([dx, dz]) => {
          const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.76, 0.05), ppLegM);
          leg.position.set(ppX + dx, 0.38, ppZ + dz); scene.add(leg);
        });

        // ── CORNER D: CONFERENCE TABLE + 8 CHAIRS (near-left, x<0, z>0) ──
        const confTMat = new THREE.MeshStandardMaterial({ color: 0x2c1f0e, roughness: 0.15 });
        const confCMat = new THREE.MeshStandardMaterial({ color: 0x1a1f2e, roughness: 0.7 });
        const cfX = -9, cfZ = 10;

        // Table top (5 × 2.5 m)
        const confTTop = new THREE.Mesh(new THREE.BoxGeometry(5, 0.07, 2.5), confTMat);
        confTTop.position.set(cfX, 0.75, cfZ); scene.add(confTTop);
        [[-1.8, -0.9], [1.8, -0.9], [-1.8, 0.9], [1.8, 0.9]].forEach(([dx, dz]) => {
          const leg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.75, 0.1), confTMat);
          leg.position.set(cfX + dx, 0.375, cfZ + dz); scene.add(leg);
        });

        // bdx/bdz = direction from seat to backrest; sideways = backrest faces Z instead of X
        const addConfChair = (cx: number, cz: number, bdx: number, bdz: number, sideways = false) => {
          const seat = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.07, 0.55), confCMat);
          seat.position.set(cx, 0.5, cz); scene.add(seat);
          const back = new THREE.Mesh(
            sideways ? new THREE.BoxGeometry(0.07, 0.55, 0.5) : new THREE.BoxGeometry(0.5, 0.55, 0.07),
            confCMat
          );
          back.position.set(cx + bdx, 0.79, cz + bdz); scene.add(back);
        };

        // 3 chairs on south side (backs toward south, +z)
        [cfX - 1.5, cfX, cfX + 1.5].forEach((x) => addConfChair(x, cfZ + 1.7, 0, 0.3));
        // 3 chairs on north side (backs toward north, -z)
        [cfX - 1.5, cfX, cfX + 1.5].forEach((x) => addConfChair(x, cfZ - 1.7, 0, -0.3));
        // 1 chair on west end (back toward west, -x)
        addConfChair(cfX - 2.8, cfZ, -0.3, 0, true);
        // 1 chair on east end (back toward east, +x)
        addConfChair(cfX + 2.8, cfZ, 0.3, 0, true);

      } else if (resolvedEnv === 'cabin') {
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

    if (officeId === 'global') {
      // For the global lobby use the HDRI skybox — just add a ground plane so avatars have something to stand on
      const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(200, 200),
        new THREE.MeshStandardMaterial({ color: 0x4a7c59, roughness: 1, metalness: 0 })
      );
      ground.rotation.x = -Math.PI / 2;
      ground.receiveShadow = true;
      scene.add(ground);
    } else {
      buildEnvironment();
    }

    // Local user bubble sphere
    const localSphere = createBubbleSphere(scene, bubblePrefsRef.current.radius, hexStringToInt(bubblePrefsRef.current.idleColor));
    localSphere.position.set(camera.position.x, camera.position.y, camera.position.z);
    localBubbleSphereRef.current = localSphere;

    // Self marker: visible only in 2D top-down mode to show the player's own position/name
    {
      const selfMarker = new THREE.Group();

      // Disc representing self (white so it stands out from other avatars)
      const disc = new THREE.Mesh(
        new THREE.CylinderGeometry(0.3, 0.3, 0.08, 16),
        new THREE.MeshStandardMaterial({ color: 0xffffff }),
      );
      disc.position.y = 0.04;
      selfMarker.add(disc);

      // Small forward-arrow cone (points in -Z = north)
      const arrow = new THREE.Mesh(
        new THREE.ConeGeometry(0.1, 0.28, 3),
        new THREE.MeshStandardMaterial({ color: 0xffffff }),
      );
      arrow.rotation.x = Math.PI / 2;
      arrow.position.set(0, 0.1, -0.4);
      selfMarker.add(arrow);

      // 2D name label with "(You)" indicator
      const selfCanvas = document.createElement('canvas');
      const selfCtx = selfCanvas.getContext('2d')!;
      selfCanvas.width = 640;
      selfCanvas.height = 128;
      selfCtx.fillStyle = 'rgba(255,255,255,0.92)';
      selfCtx.fillRect(0, 0, 640, 128);
      selfCtx.font = 'bold 56px Arial';
      selfCtx.fillStyle = '#111111';
      selfCtx.textAlign = 'center';
      selfCtx.fillText(`${currentUser.name || 'You'} (You)`, 320, 88);
      const selfSprite = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(selfCanvas) }),
      );
      selfSprite.scale.set(4, 0.8, 4);
      selfSprite.position.y = 1.8;
      selfMarker.add(selfSprite);

      selfMarker.position.set(camera.position.x, 0, camera.position.z);
      selfMarker.visible = false; // shown only in 2D mode
      scene.add(selfMarker);
      selfMarkerRef.current = selfMarker;
    }

    // Local avatar for third-person view — hidden in first-person
    {
      const localAvatarData: AvatarData = {
        id: currentUser.id,
        name: currentUser.name || 'You',
        position: { x: camera.position.x, y: 0, z: camera.position.z },
        rotation: { x: 0, y: 0, z: 0 },
        customization: avatarCustomizationRef.current,
      };
      const localAvatar = createAvatar(scene, localAvatarData, (animState) => {
        localAvatarAnimationRef.current = animState;
      });
      localAvatar.visible = false;
      localAvatarRef.current = localAvatar;
    }

    // Initialize player position from camera
    playerPositionRef.current.set(camera.position.x, 0, camera.position.z);

    // Movement
    const moveSpeed = 0.1;
    const keys = keysRef.current;
    let activeParticles: Particle[] = [];

    const handleKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (chatVisibleRef.current) {
        const navigationKeys = ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'v', '?'];
        if (navigationKeys.includes(key)) return;
      }
      // Emoji confetti (keys 1-5) — skip when typing in chat
      if (!chatVisibleRef.current && event.key in EMOJI_MAP) {
        activeParticles.push(...spawnConfetti(scene, camera.position.clone(), event.key));
        if (channelRef.current && channelSubscribedRef.current) {
          channelRef.current.send({
            type: 'broadcast', event: 'confetti',
            payload: {
              userId: currentUser.id, key: event.key,
              position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
            },
          });
        }
      }
      if (key === 'c' && !chatVisibleRef.current) {
        setCameraMode(prev => {
          const modes: CameraMode[] = ['first-person', 'third-person-behind', 'third-person-front'];
          const next = modes[(modes.indexOf(prev) + 1) % modes.length];
          cameraModeRef.current = next;
          // When returning to first-person, snap camera to player position
          if (next === 'first-person' && cameraRef.current) {
            const pp = playerPositionRef.current;
            cameraRef.current.position.set(pp.x, 1.6, pp.z);
            cameraRef.current.rotation.set(cameraPitch, cameraYaw, 0, 'YXZ');
          }
          return next;
        });
        return;
      }
      if (key === 'v') {
        setIs2DMode(v => !v);
        return;
      }
      if (key === '?') {
        setShowControls(v => !v);
        return;
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
      // Also skip in 2D mode — no mouse look there
      if (!renderer.xr.isPresenting && !motionActiveRef.current && !is2DModeRef.current) {
        renderer.domElement.requestPointerLock();
      }
    };

    const handleMouseMove = (event: MouseEvent) => {
      if (is2DModeRef.current) return;
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
      // Also skip in 2D mode — no look controls there
      if (motionActiveRef.current || is2DModeRef.current) return;
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
      const container = containerRef.current;
      const w = container ? container.clientWidth : window.innerWidth;
      const h = container ? container.clientHeight : window.innerHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      const newAspect = w / h;
      orthoCamera.left = -orthoViewSize * newAspect;
      orthoCamera.right = orthoViewSize * newAspect;
      orthoCamera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    // Scroll wheel zoom for 2D mode only
    const handleWheel = (event: WheelEvent) => {
      if (!is2DModeRef.current) return;
      event.preventDefault();
      const zoomFactor = 1 + event.deltaY * 0.001;
      orthoViewSize = Math.max(3, Math.min(40, orthoViewSize * zoomFactor));
      const aspect = window.innerWidth / window.innerHeight;
      orthoCamera.left = -orthoViewSize * aspect;
      orthoCamera.right = orthoViewSize * aspect;
      orthoCamera.top = orthoViewSize;
      orthoCamera.bottom = -orthoViewSize;
      orthoCamera.updateProjectionMatrix();
    };
    renderer.domElement.addEventListener('wheel', handleWheel, { passive: false });

    // Supabase Realtime channel — created by useRealtimeChannel, accessed via ref
    const channel = channelRef.current;
    if (!channel) return;

    const rebuildOnlineUsers = () => {
      const active = [...presenceDataRef.current.values()].map(p => ({
        id: p.id,
        name: p.name,
        email: p.email ?? null,
        status: (p.status ?? 'active') as 'active' | 'inactive' | 'offline',
      }));
      const offline = [...recentlyLeftRef.current.values()].map(u => ({
        id: u.id,
        name: u.name,
        email: u.email,
        status: 'offline' as const,
      }));
      setOnlineUsers([...active, ...offline]);
    };

    // Use latest broadcast position (if fresh) instead of stale presence position
    // when creating avatars from presence events. This prevents the visual glitch
    // where an avatar briefly appears at its old/join position then teleports.
    const freshPositionData = (p: PresenceEntry): PresenceEntry => {
      const recent = lastBroadcastPositionRef.current.get(p.id);
      if (recent && Date.now() - recent.time < 15000) {
        return {
          ...p,
          position: { x: recent.position.x, y: p.position?.y ?? 1.6, z: recent.position.z },
          rotation: { ...(p.rotation ?? { x: 0, y: 0, z: 0 }), y: recent.rotationY },
        };
      }
      return p;
    };

    // Presence: sync existing users
    channel.on('presence', { event: 'sync' }, () => {
      const state = channel.presenceState<PresenceEntry>();
      const presentIds = new Set<string>();

      Object.values(state).forEach((presences) => {
        presences.forEach((presence) => {
          presentIds.add(presence.id);
          presenceDataRef.current.set(presence.id, presence);
          recentlyLeftRef.current.delete(presence.id);
          if (presence.id !== currentUser.id && !avatarsRef.current.has(presence.id)) {
            const fresh = freshPositionData(presence);
            const pending = pendingAvatarUpdatesRef.current.get(presence.id);
            const avatar = createAvatar(scene, pending ? { ...fresh, customization: pending } : fresh, (animState) => {
              if (animState) avatarAnimationsRef.current.set(presence.id, animState);
            });
            avatarsRef.current.set(presence.id, avatar);
            if (pending) pendingAvatarUpdatesRef.current.delete(presence.id);
            const rPrefs = remoteBubblePrefsRef.current.get(presence.id);
            const sphere = createBubbleSphere(scene, rPrefs?.radius ?? bubblePrefsRef.current.radius, rPrefs ? hexStringToInt(rPrefs.idleColor) : hexStringToInt(bubblePrefsRef.current.idleColor));
            sphere.position.copy(avatar.position);
            bubbleSpheresRef.current.set(presence.id, sphere);
            // Seed proximity target from presence so the user is immediately
            // visible to proximity detection instead of waiting for a broadcast.
            if (fresh.position && !avatarTargetsRef.current.has(presence.id)) {
              avatarTargetsRef.current.set(presence.id, {
                position: new THREE.Vector3(fresh.position.x, 0, fresh.position.z),
                rotationY: fresh.rotation?.y ?? 0,
              });
              lastSeenAt.current.set(presence.id, Date.now());
            }
          }
        });
      });

      // Remove avatars and spheres for users who left
      avatarsRef.current.forEach((_avatar, id) => {
        if (!presentIds.has(id)) {
          const anim = avatarAnimationsRef.current.get(id);
          if (anim) { anim.mixer.stopAllAction(); avatarAnimationsRef.current.delete(id); }
          avatarPrevPositionsRef.current.delete(id);
          scene.remove(avatarsRef.current.get(id)!);
          avatarsRef.current.delete(id);
          avatarTargetsRef.current.delete(id);
          lastSeenAt.current.delete(id);
          const sphere = bubbleSpheresRef.current.get(id);
          if (sphere) { scene.remove(sphere); bubbleSpheresRef.current.delete(id); }
          presenceDataRef.current.delete(id);
        }
      });

      rebuildOnlineUsers();
    });

    // Presence: user joined
    channel.on('presence', { event: 'join' }, ({ newPresences }) => {
      newPresences.forEach((presence) => {
        const p = presence as unknown as PresenceEntry;
        presenceDataRef.current.set(p.id, p);
        recentlyLeftRef.current.delete(p.id);
        if (p.id !== currentUser.id && !avatarsRef.current.has(p.id)) {
          const fresh = freshPositionData(p);
          const pending = pendingAvatarUpdatesRef.current.get(p.id);
          const avatar = createAvatar(scene, pending ? { ...fresh, customization: pending } : fresh, (animState) => {
            if (animState) avatarAnimationsRef.current.set(p.id, animState);
          });
          avatarsRef.current.set(p.id, avatar);
          if (pending) pendingAvatarUpdatesRef.current.delete(p.id);
          const rPrefs2 = remoteBubblePrefsRef.current.get(p.id);
          const sphere = createBubbleSphere(scene, rPrefs2?.radius ?? bubblePrefsRef.current.radius, rPrefs2 ? hexStringToInt(rPrefs2.idleColor) : hexStringToInt(bubblePrefsRef.current.idleColor));
          sphere.position.copy(avatar.position);
          bubbleSpheresRef.current.set(p.id, sphere);
          if (fresh.position && !avatarTargetsRef.current.has(p.id)) {
            avatarTargetsRef.current.set(p.id, {
              position: new THREE.Vector3(fresh.position.x, 0, fresh.position.z),
              rotationY: fresh.rotation?.y ?? 0,
            });
            lastSeenAt.current.set(p.id, Date.now());
          }
        }
      });
      rebuildOnlineUsers();
    });

    // Presence: user left
    channel.on('presence', { event: 'leave' }, ({ leftPresences }) => {
      leftPresences.forEach((presence) => {
        const p = presence as unknown as PresenceEntry;
        // Stop following this user if we were
        if (followingUserIdRef.current === p.id) setFollowingUserId(null);
        // Clean up visual avatar, animation, and sphere if they still exist
        const anim = avatarAnimationsRef.current.get(p.id);
        if (anim) { anim.mixer.stopAllAction(); avatarAnimationsRef.current.delete(p.id); }
        avatarPrevPositionsRef.current.delete(p.id);
        const avatar = avatarsRef.current.get(p.id);
        if (avatar) { scene.remove(avatar); avatarsRef.current.delete(p.id); }
        const sphere = bubbleSpheresRef.current.get(p.id);
        if (sphere) { scene.remove(sphere); bubbleSpheresRef.current.delete(p.id); }
        // Always clean up all tracking data — the avatar may have already been
        // removed by stale detection while the user was backgrounded.
        avatarTargetsRef.current.delete(p.id);
        lastSeenAt.current.delete(p.id);
        lastBroadcastPositionRef.current.delete(p.id);
        remoteBubblePrefsRef.current.delete(p.id);
        const hadData = presenceDataRef.current.has(p.id);
        presenceDataRef.current.delete(p.id);
        if (avatar || hadData) {
          recentlyLeftRef.current.set(p.id, { id: p.id, name: p.name, email: p.email ?? null, leftAt: Date.now() });
          rebuildOnlineUsers();
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
      // Record position update for network stats tracking
      recordPositionUpdateRef.current(userId);
      // Accept updates from any known user (incl. those whose avatar was removed
      // as stale but whose Supabase presence is still active).
      if (presenceDataRef.current.has(userId)) {
        // Only update the interpolation target when position changed meaningfully.
        // Heartbeat broadcasts repeat the same position every 2 s; without this
        // guard the lerp restarts each time, causing visible micro-jitter.
        const newPos = new THREE.Vector3(position.x, 0, position.z);
        const existing = avatarTargetsRef.current.get(userId);
        if (!existing || existing.position.distanceToSquared(newPos) > 0.0001
            || Math.abs(existing.rotationY - rotation.y) > 0.01) {
          if (!existing) {
            // User appearing after stale deletion — snap avatar to avoid a lerp jump
            const avatar = avatarsRef.current.get(userId);
            if (avatar) avatar.position.copy(newPos);
          }
          avatarTargetsRef.current.set(userId, {
            position: newPos,
            rotationY: rotation.y,
          });
        }
        lastSeenAt.current.set(userId, Date.now());
        // Cache the latest broadcast position so presence-based avatar creation
        // can use a fresh position instead of the stale one in Supabase presence.
        lastBroadcastPositionRef.current.set(userId, {
          position: newPos.clone(),
          rotationY: rotation.y,
          time: Date.now(),
        });

        // When our animation loop is throttled (tab hidden), run a proximity
        // check here so voice chat can start/stop while we're in the background.
        if (document.visibilityState === 'hidden' && cameraRef.current) {
          const camPos = cameraRef.current.position;
          const newNearby = new Set<string>();
          avatarTargetsRef.current.forEach((target, uid) => {
            const dx = camPos.x - target.position.x;
            const dz = camPos.z - target.position.z;
            if (Math.sqrt(dx * dx + dz * dz) < bubblePrefsRef.current.radius * 2) {
              newNearby.add(uid);
            }
          });
          const prevNearby = nearbyUserIdsRef.current;
          const setChanged =
            newNearby.size !== prevNearby.size ||
            [...newNearby].some(id => !prevNearby.has(id)) ||
            [...prevNearby].some(id => !newNearby.has(id));
          if (setChanged) {
            nearbyUserIdsRef.current = newNearby;
            handleProximityChange(newNearby);
          }
        }
      }
    });

    // Broadcast: avatar customization updates
    channel.on('broadcast', { event: 'avatar-update' }, ({ payload }) => {
      const { userId, customization } = payload as { userId: string; customization: AvatarCustomization };
      const existingAvatar = avatarsRef.current.get(userId);
      if (existingAvatar) {
        const oldAnim = avatarAnimationsRef.current.get(userId);
        if (oldAnim) { oldAnim.mixer.stopAllAction(); avatarAnimationsRef.current.delete(userId); }
        avatarPrevPositionsRef.current.delete(userId);
        scene.remove(existingAvatar);
        const oldData = existingAvatar.userData as AvatarData;
        const newAvatar = createAvatar(scene, {
          ...oldData,
          customization,
        }, (animState) => {
          if (animState) avatarAnimationsRef.current.set(userId, animState);
        });
        avatarsRef.current.set(userId, newAvatar);
        pendingAvatarUpdatesRef.current.delete(userId);
      } else {
        // Avatar not yet created (e.g., position update hasn't arrived yet).
        // Store the customization and apply it when the avatar is created.
        pendingAvatarUpdatesRef.current.set(userId, customization);
      }
    });

    // Broadcast: chat messages — registered by useChat hook
    registerChatListener(channel);

    // Broadcast: targeted wave — play chime only for the recipient
    channel.on('broadcast', { event: 'wave' }, ({ payload }) => {
      const { toUserId } = payload as { toUserId: string };
      if (toUserId === currentUser.id) {
        playWaveChime();
      }
    });

    // Broadcast: emoji confetti from other users
    channel.on('broadcast', { event: 'confetti' }, ({ payload }) => {
      const { userId, key, position } = payload as { userId: string; key: string; position: { x: number; y: number; z: number } };
      if (userId !== currentUser.id) {
        activeParticles.push(...spawnConfetti(scene, new THREE.Vector3(position.x, position.y, position.z), key));
      }
    });

    // Broadcast: bubble preferences from other users
    channel.on('broadcast', { event: 'bubble-prefs' }, ({ payload }) => {
      const { userId, prefs } = payload as { userId: string; prefs: BubblePreferences };
      remoteBubblePrefsRef.current.set(userId, prefs);
      const sphere = bubbleSpheresRef.current.get(userId);
      if (sphere) {
        sphere.geometry.dispose();
        sphere.geometry = new THREE.SphereGeometry(prefs.radius, 24, 24);
        if (!jitsiRoomRef.current) {
          (sphere.material as THREE.MeshStandardMaterial).color.setHex(hexStringToInt(prefs.idleColor));
        }
      }
    });

    // Broadcast: screen sharing — registered by useScreenSharing hook
    registerScreenListeners(channel, currentUser.id);

    // Broadcast: room environment changes — update scene for all connected users
    channel.on('broadcast', { event: 'environment-change' }, ({ payload }) => {
      const { environment: env } = payload as { environment: string };
      if (typeof env === 'string' && env.length > 0) {
        setEnvironment(env);
      }
    });

    channel.subscribe(async (status) => {
      channelSubscribedRef.current = status === 'SUBSCRIBED';
      if (status === 'SUBSCRIBED') {
        // On reconnect myPresenceRef already holds the latest state (position, jitsiRoom, etc.).
        // Re-use it so we don't reset position or Jitsi room on a transient disconnect.
        // Always set status to 'active' on (re)connect — if we're subscribing, the tab is open.
        const currentStatus = document.visibilityState === 'visible' ? 'active' : 'inactive';
        const presence: PresenceEntry = myPresenceRef.current
          ? { ...myPresenceRef.current, status: currentStatus }
          : {
              id: currentUser.id,
              name: currentUser.name || 'User',
              email: user?.email ?? null,
              image: user?.image || null,
              position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
              rotation: { x: camera.rotation.x, y: camera.rotation.y, z: camera.rotation.z },
              customization: avatarCustomizationRef.current,
              jitsiRoom: null,
              status: currentStatus,
            };
        myPresenceRef.current = presence;
        await channel.track(presence);

        // Broadcast our bubble preferences so other users see our sphere size/color
        channel.send({
          type: 'broadcast', event: 'bubble-prefs',
          payload: { userId: currentUser.id, prefs: bubblePrefsRef.current },
        });

        // Re-sync presence state to reconcile any join/leave events missed while disconnected.
        const state = channel.presenceState<PresenceEntry>();
        const presentIds = new Set<string>();
        Object.values(state).forEach((presences) => {
          presences.forEach((p) => {
            presentIds.add(p.id);
            presenceDataRef.current.set(p.id, p);
            recentlyLeftRef.current.delete(p.id);
            if (p.id !== currentUser.id && !avatarsRef.current.has(p.id)) {
              const fresh = freshPositionData(p);
              const avatar = createAvatar(scene, fresh, (animState) => {
                if (animState) avatarAnimationsRef.current.set(p.id, animState);
              });
              avatarsRef.current.set(p.id, avatar);
              const rPrefs3 = remoteBubblePrefsRef.current.get(p.id);
              const sphere = createBubbleSphere(scene, rPrefs3?.radius ?? bubblePrefsRef.current.radius, rPrefs3 ? hexStringToInt(rPrefs3.idleColor) : hexStringToInt(bubblePrefsRef.current.idleColor));
              sphere.position.copy(avatar.position);
              bubbleSpheresRef.current.set(p.id, sphere);
              if (fresh.position && !avatarTargetsRef.current.has(p.id)) {
                avatarTargetsRef.current.set(p.id, {
                  position: new THREE.Vector3(fresh.position.x, 0, fresh.position.z),
                  rotationY: fresh.rotation?.y ?? 0,
                });
                lastSeenAt.current.set(p.id, Date.now());
              }
            }
          });
        });
        avatarsRef.current.forEach((_, id) => {
          if (!presentIds.has(id)) {
            const anim = avatarAnimationsRef.current.get(id);
            if (anim) { anim.mixer.stopAllAction(); avatarAnimationsRef.current.delete(id); }
            avatarPrevPositionsRef.current.delete(id);
            scene.remove(avatarsRef.current.get(id)!);
            avatarsRef.current.delete(id);
            avatarTargetsRef.current.delete(id);
            lastSeenAt.current.delete(id);
            const sphere = bubbleSpheresRef.current.get(id);
            if (sphere) { scene.remove(sphere); bubbleSpheresRef.current.delete(id); }
            presenceDataRef.current.delete(id);
          }
        });
        rebuildOnlineUsers();
      }
    });

    // Tab visibility — update presence status so other users see active/inactive indicator
    const handleVisibilityChange = () => {
      if (!channelRef.current || !myPresenceRef.current || !channelSubscribedRef.current) return;
      const newStatus: 'active' | 'inactive' = document.visibilityState === 'visible' ? 'active' : 'inactive';
      const updated = { ...myPresenceRef.current, status: newStatus };
      myPresenceRef.current = updated;
      channelRef.current.track(updated);
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Position heartbeat via setInterval — keeps our position broadcast alive even
    // when the animation loop is throttled by Chrome in a background tab.
    // The animation loop still sends immediate movement updates at 60 ms; this
    // interval covers the 3-second stationary heartbeat independently.
    let lastPresenceTrackTime = 0;
    const positionHeartbeatInterval = setInterval(() => {
      if (!channelRef.current || !channelSubscribedRef.current || !cameraRef.current) return;
      const cam = cameraRef.current;
      const isTP = cameraModeRef.current !== 'first-person';
      const hbPos = isTP
        ? { x: playerPositionRef.current.x, y: 1.6, z: playerPositionRef.current.z }
        : { x: cam.position.x, y: cam.position.y, z: cam.position.z };
      const hbRot = isTP
        ? { x: 0, y: playerYawRef.current, z: 0 }
        : { x: cam.rotation.x, y: cam.rotation.y, z: cam.rotation.z };
      channelRef.current.send({
        type: 'broadcast',
        event: 'position',
        payload: {
          userId: currentUser.id,
          position: hbPos,
          rotation: hbRot,
        },
      });
      lastPositionUpdate.current = Date.now();
      if (myPresenceRef.current) {
        myPresenceRef.current = {
          ...myPresenceRef.current,
          position: hbPos,
          rotation: hbRot,
        };
        // Periodically sync position to Supabase presence so reconnecting
        // users and new joiners see an accurate initial avatar position.
        const trackNow = Date.now();
        if (trackNow - lastPresenceTrackTime > 10000) {
          lastPresenceTrackTime = trackNow;
          channelRef.current.track(myPresenceRef.current);
        }
      }
    }, 2000);

    // Clean up recently-left (offline) users after 15 s
    const offlineCleanupInterval = setInterval(() => {
      const now = Date.now();
      let changed = false;
      recentlyLeftRef.current.forEach((_u, id) => {
        if (now - recentlyLeftRef.current.get(id)!.leftAt > 15000) {
          recentlyLeftRef.current.delete(id);
          changed = true;
        }
      });
      if (changed) rebuildOnlineUsers();
    }, 5000);

    // Proximity-based Jitsi room coordination.
    // Also called from the position broadcast handler (above) when the tab is hidden.
    const handleProximityChange = (nearbyIds: Set<string>) => {
      // Cancel any pending leave debounce whenever proximity state changes
      if (jitsiLeaveDebounceRef.current) {
        clearTimeout(jitsiLeaveDebounceRef.current);
        jitsiLeaveDebounceRef.current = null;
      }

      if (nearbyIds.size === 0) {
        if (jitsiRoomRef.current !== null) {
          // Debounce the leave — if the user re-enters proximity within the window,
          // the debounce is cancelled above and no disconnect happens.
          jitsiLeaveDebounceRef.current = setTimeout(() => {
            jitsiLeaveDebounceRef.current = null;
            if (jitsiRoomRef.current === null) return; // already cleared by a re-entry
            jitsiRoomRef.current = null;
            setJitsiRoom(null);
            if (myPresenceRef.current) {
              const updated = { ...myPresenceRef.current, jitsiRoom: null };
              myPresenceRef.current = updated;
              channelRef.current?.track(updated);
            }
          }, 1500);
        }
        return;
      }

      // Deterministic room name: both sides independently compute the same
      // name using the lexicographically smallest user ID in the group.
      // This avoids the race condition where adopting another user's
      // existing room via presence causes room-name flipping.
      const seed = [currentUser.id, ...nearbyIds].sort()[0];
      const roomToJoin = `officexr-${officeId.slice(0, 8)}-${seed.slice(0, 8)}`;
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
    const clock = new THREE.Clock();
    const STALE_THRESHOLD_MS = 15_000;
    let lastStaleCheck = 0;

    const animate = () => {
      const delta = clock.getDelta(); // seconds since last frame
      // Frame-rate-independent lerp: equivalent to 0.15 at 60 fps, consistent at any rate
      const lerpAlpha = 1 - Math.pow(0.005, delta);

      // Update emoji confetti particles
      activeParticles = updateParticles(activeParticles, delta, scene);

      const direction = new THREE.Vector3();
      let moved = false;

      if (is2DModeRef.current) {
        // 2D top-down mode: WASD/arrows map to compass directions
        if (keys['w'] || keys['arrowup'])    { direction.z -= 1; moved = true; }
        if (keys['s'] || keys['arrowdown'])  { direction.z += 1; moved = true; }
        if (keys['a'] || keys['arrowleft'])  { direction.x -= 1; moved = true; }
        if (keys['d'] || keys['arrowright']) { direction.x += 1; moved = true; }
        const { x: jx, y: jy } = joystickInputRef.current;
        if (Math.abs(jx) > 0.05 || Math.abs(jy) > 0.05) {
          direction.x += jx;
          direction.z -= jy; // joystick up = north
          moved = true;
        }
      } else {
        // 3D mode: movement relative to player facing direction (yaw)
        // In first-person, yaw comes from camera. In third-person, yaw is tracked separately.
        const isThirdPerson = cameraModeRef.current !== 'first-person';
        const yaw = isThirdPerson ? playerYawRef.current : cameraYaw;
        const forward = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
        const right = new THREE.Vector3(-forward.z, 0, forward.x);
        if (keys['w'] || keys['arrowup'])    { direction.add(forward); moved = true; }
        if (keys['s'] || keys['arrowdown'])  { direction.sub(forward); moved = true; }
        if (keys['a'] || keys['arrowleft'])  { direction.sub(right); moved = true; }
        if (keys['d'] || keys['arrowright']) { direction.add(right); moved = true; }
        const { x: jx, y: jy } = joystickInputRef.current;
        if (Math.abs(jx) > 0.05 || Math.abs(jy) > 0.05) {
          direction.addScaledVector(forward, -jy);
          direction.addScaledVector(right, jx);
          moved = true;
        }
      }

      if (direction.length() > 0) {
        direction.normalize();
        // Any manual movement cancels follow mode
        if (followingUserIdRef.current !== null) {
          setFollowingUserId(null);
        }
        const step = direction.multiplyScalar(moveSpeed);
        if (cameraModeRef.current === 'first-person') {
          camera.position.add(step);
          camera.position.x = Math.max(-14.5, Math.min(14.5, camera.position.x));
          camera.position.z = Math.max(-14.5, Math.min(14.5, camera.position.z));
        } else {
          playerPositionRef.current.add(step);
          playerPositionRef.current.x = Math.max(-14.5, Math.min(14.5, playerPositionRef.current.x));
          playerPositionRef.current.z = Math.max(-14.5, Math.min(14.5, playerPositionRef.current.z));
        }
      }

      // Follow mode: snap camera to stay just within proximity of the followed user
      if (followingUserIdRef.current) {
        const followTarget = avatarTargetsRef.current.get(followingUserIdRef.current);
        if (followTarget) {
          const playerPos = cameraModeRef.current === 'first-person'
            ? camera.position : playerPositionRef.current;
          const dir = new THREE.Vector3()
            .subVectors(playerPos, followTarget.position)
            .setY(0)
            .normalize();
          if (dir.lengthSq() < 0.0001) dir.set(1, 0, 0);
          const dest = followTarget.position.clone()
            .addScaledVector(dir, bubblePrefsRef.current.radius * 0.8);
          const destX = Math.max(-14.5, Math.min(14.5, dest.x));
          const destZ = Math.max(-14.5, Math.min(14.5, dest.z));
          const fdx = playerPos.x - destX;
          const fdz = playerPos.z - destZ;
          if (fdx * fdx + fdz * fdz > 0.0001) {
            if (cameraModeRef.current === 'first-person') {
              camera.position.set(destX, 1.6, destZ);
            } else {
              playerPositionRef.current.set(destX, 0, destZ);
            }
            moved = true;
          }
        }
      }

      // Switch local avatar animation based on movement
      if (localAvatarAnimationRef.current) {
        switchAnimation(localAvatarAnimationRef.current, moved ? 'walk' : 'idle');
      }

      // Third-person camera: position camera relative to the player avatar
      const isThirdPerson = cameraModeRef.current !== 'first-person';
      const localAvatar = localAvatarRef.current;
      if (isThirdPerson && localAvatar) {
        // Update player yaw from mouse movement
        playerYawRef.current = cameraYaw;
        const pPos = playerPositionRef.current;
        // Position and rotate the local avatar
        localAvatar.visible = true;
        localAvatar.position.set(pPos.x, 0, pPos.z);
        localAvatar.rotation.y = playerYawRef.current;

        const camDist = 3.5;
        const camHeight = 2.2;
        const yaw = playerYawRef.current;
        if (cameraModeRef.current === 'third-person-behind') {
          // Camera behind: offset in the opposite direction the avatar faces
          camera.position.set(
            pPos.x + Math.sin(yaw) * camDist,
            camHeight,
            pPos.z + Math.cos(yaw) * camDist,
          );
        } else {
          // Camera in front: offset in the direction the avatar faces
          camera.position.set(
            pPos.x - Math.sin(yaw) * camDist,
            camHeight,
            pPos.z - Math.cos(yaw) * camDist,
          );
        }
        // Look at avatar head
        camera.lookAt(pPos.x, 1.4, pPos.z);
      } else if (localAvatar) {
        localAvatar.visible = false;
        // Sync player position from camera when in first-person
        playerPositionRef.current.set(camera.position.x, 0, camera.position.z);
      }

      // Determine broadcast position: always send player position, not camera offset
      const broadcastPos = isThirdPerson
        ? { x: playerPositionRef.current.x, y: 1.6, z: playerPositionRef.current.z }
        : { x: camera.position.x, y: camera.position.y, z: camera.position.z };
      const broadcastRot = isThirdPerson
        ? { x: 0, y: playerYawRef.current, z: 0 }
        : { x: camera.rotation.x, y: camera.rotation.y, z: camera.rotation.z };

      const now = Date.now();
      // Send position when moving (60ms throttle). Stationary heartbeat is
      // handled by positionHeartbeatInterval so it fires even when this loop
      // is throttled in a background tab.
      const shouldSend = channelRef.current && channelSubscribedRef.current &&
        moved && now - lastPositionUpdate.current > 60;
      if (shouldSend) {
        channelRef.current!.send({
          type: 'broadcast',
          event: 'position',
          payload: {
            userId: currentUser.id,
            position: broadcastPos,
            rotation: broadcastRot,
          },
        });
        lastPositionUpdate.current = now;
        // Keep presence position fresh so users who join mid-session see the right
        // initial avatar position and can correctly evaluate proximity.
        if (myPresenceRef.current) {
          const updatedPresence = {
            ...myPresenceRef.current,
            position: broadcastPos,
            rotation: broadcastRot,
          };
          myPresenceRef.current = updatedPresence;
        }
      }

      // Update local bubble sphere position (follows player, not camera offset)
      if (localBubbleSphereRef.current) {
        localBubbleSphereRef.current.position.set(
          broadcastPos.x, broadcastPos.y, broadcastPos.z
        );
      }

      // Smoothly interpolate remote avatars toward their latest received positions
      avatarTargetsRef.current.forEach((target, uid) => {
        const avatar = avatarsRef.current.get(uid);
        if (avatar) {
          avatar.position.lerp(target.position, lerpAlpha);
          // Lerp rotation via shortest-path on Y axis
          let dy = target.rotationY - avatar.rotation.y;
          if (dy > Math.PI) dy -= Math.PI * 2;
          if (dy < -Math.PI) dy += Math.PI * 2;
          avatar.rotation.y += dy * lerpAlpha;

          // Make avatar eyes look toward the local camera
          avatar.traverse((child) => {
            if ((child as THREE.Mesh).isMesh && child.userData.isEye) {
              const eye = child as THREE.Mesh;
              const { restX, restY, restZ } = eye.userData;
              const localCamPos = avatar.worldToLocal(camera.position.clone());
              const edx = localCamPos.x - restX;
              const edy = localCamPos.y - restY;
              const edz = localCamPos.z - restZ;
              const dist = Math.sqrt(edx * edx + edy * edy + edz * edz);
              if (dist > 0.01) {
                const maxOffset = 0.02;
                eye.position.x = restX + (edx / dist) * maxOffset;
                eye.position.y = restY + (edy / dist) * maxOffset;
                eye.position.z = restZ + Math.abs(edx / dist) * 0.005;
              }
            }
          });

          // Switch remote avatar animation based on movement
          const animState = avatarAnimationsRef.current.get(uid);
          if (animState) {
            const prev = avatarPrevPositionsRef.current.get(uid);
            const isMoving = prev ? avatar.position.distanceToSquared(prev) > 0.0001 : false;
            switchAnimation(animState, isMoving ? 'walk' : 'idle');
            avatarPrevPositionsRef.current.set(uid, avatar.position.clone());
          }
        }
      });

      // Update all animation mixers
      avatarAnimationsRef.current.forEach((anim) => { anim.mixer.update(delta); });
      if (localAvatarAnimationRef.current) {
        localAvatarAnimationRef.current.mixer.update(delta);
      }

      // Update remote bubble sphere positions and detect proximity.
      // Use avatarTargetsRef as the source of truth for positions — this covers
      // stale-but-present users whose visual avatar was removed but who are still
      // connected via Supabase presence and may be in an active voice chat.
      const newNearby = new Set<string>();
      avatarTargetsRef.current.forEach((target, uid) => {
        const sphere = bubbleSpheresRef.current.get(uid);
        const avatar = avatarsRef.current.get(uid);
        // Update bubble sphere to follow the interpolated avatar if both exist
        if (avatar && sphere) {
          sphere.position.copy(avatar.position);
        }
        // Proximity uses last-received position, not interpolated avatar position.
        // Use horizontal (XZ) distance only — camera.y is at eye height (~1.6)
        // while targets are at y=0, so 3D distance would shrink effective range.
        const dx = broadcastPos.x - target.position.x;
        const dz = broadcastPos.z - target.position.z;
        if (Math.sqrt(dx * dx + dz * dz) < bubblePrefsRef.current.radius * 2) {
          newNearby.add(uid);
        }
      });

      // Update sphere colors: green when in voice call, per-user idle color otherwise
      const inRoom = jitsiRoomRef.current !== null;
      bubbleSpheresRef.current.forEach((sphere, uid) => {
        const remotePrefs = remoteBubblePrefsRef.current.get(uid);
        const idleColor = remotePrefs ? hexStringToInt(remotePrefs.idleColor) : hexStringToInt(bubblePrefsRef.current.idleColor);
        (sphere.material as THREE.MeshStandardMaterial).color.setHex(inRoom ? 0x44ff99 : idleColor);
      });
      if (localBubbleSphereRef.current) {
        (localBubbleSphereRef.current.material as THREE.MeshStandardMaterial).color.setHex(
          inRoom ? 0x44ff99 : hexStringToInt(bubblePrefsRef.current.idleColor)
        );
      }

      // Periodically remove avatars for users whose position broadcasts have gone stale.
      // This catches abrupt disconnects (crash/network drop) before Supabase fires a leave event.
      if (now - lastStaleCheck > 5000) {
        lastStaleCheck = now;
        lastSeenAt.current.forEach((t, uid) => {
          if (now - t > STALE_THRESHOLD_MS) {
            // Stop waiting for position updates from this user either way.
            lastSeenAt.current.delete(uid);

            // Check whether the user is still registered in Supabase presence.
            const presenceState = channel.presenceState<PresenceEntry>();
            const stillPresent = Object.values(presenceState).some(presences =>
              presences.some(p => p.id === uid)
            );

            if (stillPresent) {
              // User is inactive (tab backgrounded, movements paused) but still
              // connected. Keep the avatar frozen at its last position — it will
              // resume moving if/when the user becomes active again.
              // presenceDataRef is left intact so the online users list stays accurate.
              // However, remove from avatarTargetsRef so proximity detection no longer
              // counts them as nearby — this prevents the voice call from staying open
              // when the user's network dropped but Supabase hasn't fired leave yet.
              // The position broadcast handler will re-add them when updates resume.
              // Exception: keep the entry if we're following this user, so the camera
              // stays anchored at their last position and proximity/audio isn't lost.
              if (followingUserIdRef.current !== uid) {
                avatarTargetsRef.current.delete(uid);
              }
            } else {
              // User truly gone — remove avatar, sphere, animation, and all tracking data.
              if (followingUserIdRef.current === uid) setFollowingUserId(null);
              const staleAnim = avatarAnimationsRef.current.get(uid);
              if (staleAnim) { staleAnim.mixer.stopAllAction(); avatarAnimationsRef.current.delete(uid); }
              avatarPrevPositionsRef.current.delete(uid);
              const stalePresence = presenceDataRef.current.get(uid);
              const staleAvatar = avatarsRef.current.get(uid);
              if (staleAvatar) scene.remove(staleAvatar);
              avatarsRef.current.delete(uid);
              const staleSphere = bubbleSpheresRef.current.get(uid);
              if (staleSphere) { scene.remove(staleSphere); bubbleSpheresRef.current.delete(uid); }
              avatarTargetsRef.current.delete(uid);
              lastBroadcastPositionRef.current.delete(uid);
              presenceDataRef.current.delete(uid);
              if (stalePresence) {
                recentlyLeftRef.current.set(uid, { id: uid, name: stalePresence.name, email: stalePresence.email ?? null, leftAt: Date.now() });
              }
              rebuildOnlineUsers();
            }
          }
        });
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

      // Toggle 3D/2D name tags on all remote avatars based on current view mode
      const in2D = is2DModeRef.current;
      avatarsRef.current.forEach(avatar => {
        avatar.traverse(child => {
          if (child.userData.nameTagType === '3d') child.visible = !in2D;
          if (child.userData.nameTagType === '2d') child.visible = in2D;
        });
      });

      // Update self marker position and visibility in 2D mode
      if (selfMarkerRef.current) {
        selfMarkerRef.current.position.set(broadcastPos.x, 0, broadcastPos.z);
        selfMarkerRef.current.visible = in2D;
      }

      // Sync top-down camera to player XZ position
      orthoCamera.position.x = broadcastPos.x;
      orthoCamera.position.z = broadcastPos.z;

      renderer.render(scene, is2DModeRef.current ? orthoCamera : camera);
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
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      clearInterval(positionHeartbeatInterval);
      clearInterval(offlineCleanupInterval);
      renderer.domElement.removeEventListener('click', handleCanvasClick);
      renderer.domElement.removeEventListener('mousemove', handleMouseMove);
      renderer.domElement.removeEventListener('wheel', handleWheel);
      document.removeEventListener('pointerlockchange', handlePointerLockChange);
      if (document.pointerLockElement === renderer.domElement) {
        document.exitPointerLock();
      }
      renderer.domElement.removeEventListener('touchstart', handleTouchStart);
      renderer.domElement.removeEventListener('touchmove', handleTouchMove);
      renderer.domElement.removeEventListener('touchend', handleTouchEnd);

      // Clean up screen sharing without broadcasting (channel is closing)
      cleanupPeerConnections();

      // Cancel any pending Jitsi leave debounce — component is tearing down
      if (jitsiLeaveDebounceRef.current) {
        clearTimeout(jitsiLeaveDebounceRef.current);
        jitsiLeaveDebounceRef.current = null;
      }
      // Channel cleanup (untrack + removeChannel) is handled by useRealtimeChannel

      if (localBubbleSphereRef.current) {
        scene.remove(localBubbleSphereRef.current);
        localBubbleSphereRef.current = null;
      }
      if (selfMarkerRef.current) {
        scene.remove(selfMarkerRef.current);
        selfMarkerRef.current = null;
      }
      if (localAvatarRef.current) {
        scene.remove(localAvatarRef.current);
        localAvatarRef.current = null;
      }
      // Stop all animation mixers
      avatarAnimationsRef.current.forEach((anim) => { anim.mixer.stopAllAction(); });
      avatarAnimationsRef.current.clear();
      avatarPrevPositionsRef.current.clear();
      if (localAvatarAnimationRef.current) {
        localAvatarAnimationRef.current.mixer.stopAllAction();
        localAvatarAnimationRef.current = null;
      }
      bubbleSpheresRef.current.clear();
      presenceDataRef.current.clear();
      lastSeenAt.current.clear();
      nearbyUserIdsRef.current = new Set();
      pendingAvatarUpdatesRef.current.clear();

      if (vrButton?.parentNode) {
        vrButton.parentNode.removeChild(vrButton);
      }
      if (containerRef.current && renderer.domElement.parentNode) {
        containerRef.current.removeChild(renderer.domElement);
      }
      if (hdriTexture) {
        hdriTexture.dispose();
        hdriTexture = null;
      }
      renderer.dispose();
    };
  }, [officeId, currentUser?.id, environment]);

  // handleBubblePrefsChange and handleSaveSettings are provided by useAvatarCustomization

  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100vh' }}>
    <div ref={containerRef} style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
      {/* Green outline when mouse look mode is active */}
      {mouseLockActive && (
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 50,
          boxShadow: 'inset 0 0 0 4px #00ff00',
        }} />
      )}

      {showControls && (
        <ControlsOverlay
          motionPermission={motionPermission}
          motionCapable={motionCapable}
          onRecalibrate={() => recalibrateMotionRef.current?.()}
          onEnableMotion={enableMotion}
          onDisableMotion={disableMotion}
          motionDebugRef={motionDebugRef}
          is2DMode={is2DMode}
          onToggle2D={() => setIs2DMode(v => !v)}
          showChat
          extras={
            <p style={{ margin: '5px 0', color: '#60a5fa', fontSize: '11px' }}>
              Walk near others to voice chat
            </p>
          }
        />
      )}

      {/* Bottom-right hint to open the controls pane */}
      <div style={{
        position: 'absolute', bottom: '20px', right: '20px',
        color: 'rgba(255,255,255,0.5)', fontFamily: 'monospace', fontSize: '12px',
        pointerEvents: 'none', userSelect: 'none',
      }}>
        ? — {showControls ? 'hide' : 'show'} controls
      </div>

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
          {jitsiRoom && (
            <button
              onClick={() => {
                setJitsiError(null);
                setJitsiConnected(false);
                setJitsiRetryCount(c => c + 1);
              }}
              style={{
                background: 'rgba(255,255,255,0.2)', border: '1px solid rgba(255,255,255,0.4)',
                color: 'white', cursor: 'pointer', fontSize: '12px',
                padding: '4px 10px', borderRadius: '4px', flexShrink: 0,
              }}
            >
              Retry
            </button>
          )}
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
          label = `Voice active · ${jitsiParticipantCount} in call`;
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

      {/* ── Screen share overlay ──────────────────────────────────────────── */}
      {activeShareId && screenShares.has(activeShareId) && (() => {
        const share = screenShares.get(activeShareId)!;
        const isMine = activeShareId === currentUserRef.current?.id;
        return (
          <div style={{
            position: 'fixed', inset: 0, zIndex: 450,
            background: 'rgba(0,0,0,0.92)',
            display: 'flex', flexDirection: 'column',
          }}>
            {/* Header bar */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: '10px',
              padding: '8px 14px', background: 'rgba(0,0,0,0.6)',
              color: 'white', fontFamily: 'monospace', fontSize: '13px', flexShrink: 0,
            }}>
              <span>🖥 {isMine ? 'Your screen' : `${share.name}'s screen`}</span>
              {/* Other active sharers as clickable pills */}
              {[...screenShares.entries()]
                .filter(([id]) => id !== activeShareId)
                .map(([id, s]) => (
                  <button key={id} onClick={() => setActiveShareId(id)} style={{
                    background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: '4px',
                    color: 'white', fontSize: '12px', padding: '2px 8px', cursor: 'pointer',
                  }}>
                    {s.name}
                  </button>
                ))}
              <button
                onClick={() => setActiveShareId(null)}
                title="Minimize"
                style={{
                  marginLeft: 'auto', background: 'rgba(255,255,255,0.1)', border: 'none',
                  borderRadius: '4px', color: 'white', fontSize: '13px',
                  padding: '2px 10px', cursor: 'pointer',
                }}
              >
                ╌ Minimize
              </button>
              {isMine && (
                <button
                  onClick={stopScreenShare}
                  style={{
                    background: 'rgba(220,38,38,0.8)', border: 'none', borderRadius: '4px',
                    color: 'white', fontSize: '12px', padding: '2px 10px', cursor: 'pointer',
                  }}
                >
                  Stop sharing
                </button>
              )}
            </div>
            {/* Video */}
            <video
              ref={el => {
                if (!el) return;
                if (el.srcObject !== share.stream) {
                  el.srcObject = share.stream;
                  el.muted = true; // mute first so autoplay is always allowed
                  el.play()
                    .then(() => { el.muted = isMine; }) // unmute viewer streams after play starts
                    .catch(() => {});
                }
              }}
              autoPlay playsInline
              style={{ flex: 1, width: '100%', objectFit: 'contain', background: 'black' }}
            />
          </div>
        );
      })()}

      {/* Minimized screen share tiles — bottom-right when overlay is closed */}
      {screenShares.size > 0 && activeShareId === null && (() => {
        const tiles = [...screenShares.entries()];
        return (
          <div style={{
            position: 'fixed', bottom: '12px', right: '12px',
            display: 'flex', flexDirection: 'column', gap: '8px',
            zIndex: 300, alignItems: 'flex-end',
          }}>
            {tiles.map(([id, share]) => {
              const isMine = id === currentUserRef.current?.id;
              return (
                <div key={id} style={{
                  width: '240px', background: 'rgba(0,0,0,0.85)',
                  borderRadius: '8px', overflow: 'hidden',
                  border: '1px solid rgba(255,255,255,0.15)',
                  boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
                  cursor: 'pointer',
                }} onClick={() => setActiveShareId(id)}>
                  <video
                    ref={el => {
                      if (!el) return;
                      if (el.srcObject !== share.stream) {
                        el.srcObject = share.stream;
                        el.muted = true;
                        el.play()
                          .then(() => { el.muted = isMine; })
                          .catch(() => {});
                      }
                    }}
                    autoPlay playsInline
                    style={{ width: '100%', display: 'block', aspectRatio: '16/9', objectFit: 'contain', background: 'black' }}
                  />
                  <div style={{
                    padding: '4px 8px', color: 'white', fontSize: '11px',
                    fontFamily: 'monospace', display: 'flex', justifyContent: 'space-between',
                  }}>
                    <span>🖥 {isMine ? 'Your screen' : share.name}</span>
                    <span style={{ opacity: 0.6 }}>click to expand</span>
                  </div>
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* Jitsi audio iframe — kept in-viewport (bottom-right corner) but invisible.
          opacity:0 hides it from users while keeping it "visible" to Chrome so the
          browser does NOT throttle the cross-origin iframe's JS timers.
          Positioning it fully off-screen (top:-400px) causes Chrome to suspend the
          iframe's task queue, preventing Jitsi from initiating the XMPP connection.
          The allow attribute is required for microphone access in cross-origin iframes. */}
      {activeJitsiRoom && jaasJwt && (
        <div key={`${jitsiRetryCount}-${activeJitsiRoom}`} style={{
          position: 'fixed', bottom: 0, right: 0,
          width: '480px', height: '270px',
          opacity: 0, pointerEvents: 'none', zIndex: -1,
        }}>
          <JaaSMeeting
            appId={import.meta.env.VITE_JAAS_APP_ID ?? ''}
            jwt={jaasJwt}
            roomName={activeJitsiRoom}
            configOverwrite={{
              startWithAudioMuted: false,
              startWithVideoMuted: true,
              prejoinPageEnabled: false,
              // Newer Jitsi config format — JaaS may strip the legacy key above
              prejoinConfig: { enabled: false },
              disableModeratorIndicator: true,
              enableNoisyMicDetection: false,
              disableDeepLinking: true,
              // Disable lobby to prevent another join-blocking screen
              lobby: { autoKnock: true, enableChat: false },
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
              // Verify the iframe is actually intersecting the viewport.
              // Chrome throttles cross-origin iframes that are fully off-screen,
              // which prevents Jitsi's XMPP connection from completing.
              const observer = new IntersectionObserver(([entry]) => {
                console.log('[VoiceChat] iframe IntersectionObserver — isIntersecting:', entry.isIntersecting, '| intersectionRatio:', entry.intersectionRatio, '| boundingClientRect:', JSON.stringify(entry.boundingClientRect));
                observer.disconnect();
              });
              observer.observe(iframeRef);
            }}
            onApiReady={api => {
              // Capture the connection generation at the moment this callback fires.
              // If cleanupJitsi() is called before any inner callback runs (i.e. this
              // is a stale iframe from a superseded connection attempt), the gen will
              // have advanced and all state-modifying callbacks below will be no-ops.
              const myGen = jitsiConnectionGenRef.current;
              console.log('[VoiceChat] onApiReady fired — iframe JS loaded, waiting for videoConferenceJoined');
              console.log('[VoiceChat] Page state at onApiReady — visibilityState:', document.visibilityState, '| hasFocus:', document.hasFocus());
              jitsiApiRef.current = api;
              setJitsiError(null);

              // Clean up any leftover intervals/listeners from a prior session
              if (jitsiHeartbeatRef.current) { clearInterval(jitsiHeartbeatRef.current); jitsiHeartbeatRef.current = null; }
              if (jitsiMessageListenerRef.current) { window.removeEventListener('message', jitsiMessageListenerRef.current); jitsiMessageListenerRef.current = null; }

              // Now that the iframe has loaded, replace the 30s safety-net timeout
              // with a tighter 20s timeout for the XMPP connection (proximity only).
              if (jitsiConnectTimeoutRef.current) clearTimeout(jitsiConnectTimeoutRef.current);
              if (jitsiRoomRef.current !== null) {
                jitsiConnectTimeoutRef.current = setTimeout(() => {
                  if (jitsiConnectionGenRef.current !== myGen) return; // stale
                  console.error('[VoiceChat] Connection timed out after 20s from onApiReady — videoConferenceJoined never fired. Room:', jitsiRoomRef.current);
                  setJitsiError('Could not connect to voice chat — the server may be unavailable.');
                }, 20000);
              }

              // Decode JWT header+payload (no crypto needed) to confirm what we sent
              try {
                const jwtParts = (jaasJwt ?? '').split('.');
                if (jwtParts.length === 3) {
                  const hdr = JSON.parse(atob(jwtParts[0].replace(/-/g, '+').replace(/_/g, '/')));
                  const pay = JSON.parse(atob(jwtParts[1].replace(/-/g, '+').replace(/_/g, '/')));
                  console.log('[VoiceChat] JWT header:', hdr);
                  console.log('[VoiceChat] JWT payload (redacted key):', {
                    ...pay,
                    context: {
                      ...pay.context,
                      user: pay.context?.user,
                    },
                    iat: pay.iat, exp: pay.exp, nbf: pay.nbf,
                    expired: pay.exp < Math.floor(Date.now() / 1000),
                    secondsUntilExpiry: pay.exp - Math.floor(Date.now() / 1000),
                  });
                }
              } catch (jwtErr) {
                console.warn('[VoiceChat] Could not decode JWT for inspection:', jwtErr);
              }

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

              // Periodic heartbeat: probe participant count while waiting for join.
              // Stored in a ref so cleanupJitsi() can clear it on unmount/retry.
              let heartbeatCount = 0;
              jitsiHeartbeatRef.current = setInterval(() => {
                heartbeatCount++;
                try {
                  const participants = api.getNumberOfParticipants?.();
                  console.log(`[VoiceChat] Heartbeat #${heartbeatCount} (${heartbeatCount * 3}s elapsed) — participants: ${participants ?? 'n/a'} | visibilityState: ${document.visibilityState} | hasFocus: ${document.hasFocus()}`);
                } catch (e) {
                  console.log(`[VoiceChat] Heartbeat #${heartbeatCount} — getNumberOfParticipants threw:`, e);
                }
              }, 3000);

              // Listen for raw postMessages from the Jitsi iframe.
              // Stored in a ref so cleanupJitsi() can remove it on unmount/retry.
              const onIframeMessage = (evt: MessageEvent) => {
                if (!evt.data || typeof evt.data !== 'object') return;
                const name = evt.data.name ?? evt.data.type ?? evt.data.event;
                if (!name) return;
                const jitsiPrefixes = ['conference.', 'connection.', 'video.', 'chat.', 'participant', 'dominant', 'error', 'ready', 'joined', 'left'];
                const lc = String(name).toLowerCase();
                if (jitsiPrefixes.some(p => lc.includes(p))) {
                  console.log('[VoiceChat] iframe postMessage:', name, evt.data);
                }
              };
              jitsiMessageListenerRef.current = onIframeMessage;
              window.addEventListener('message', onIframeMessage);

              // Only mark connected when actually inside the conference room
              api.addEventListener('videoConferenceJoined', () => {
                if (jitsiConnectionGenRef.current !== myGen) return; // stale — superseded by a newer connection
                console.log('[VoiceChat] videoConferenceJoined — connected to room:', jitsiRoomRef.current);
                // Clear diagnostic intervals/listeners — connection succeeded
                if (jitsiHeartbeatRef.current) { clearInterval(jitsiHeartbeatRef.current); jitsiHeartbeatRef.current = null; }
                if (jitsiMessageListenerRef.current) { window.removeEventListener('message', jitsiMessageListenerRef.current); jitsiMessageListenerRef.current = null; }
                if (jitsiConnectTimeoutRef.current) { clearTimeout(jitsiConnectTimeoutRef.current); jitsiConnectTimeoutRef.current = null; }
                setJitsiConnected(true);
                setJitsiParticipantCount(api.getNumberOfParticipants?.() ?? 1);
              });

              const onDisconnect = (reason?: string) => {
                if (jitsiConnectionGenRef.current !== myGen) return; // stale
                console.warn('[VoiceChat] Disconnected from voice chat. Reason:', reason ?? '(unknown)');
                if (jitsiHeartbeatRef.current) { clearInterval(jitsiHeartbeatRef.current); jitsiHeartbeatRef.current = null; }
                if (jitsiMessageListenerRef.current) { window.removeEventListener('message', jitsiMessageListenerRef.current); jitsiMessageListenerRef.current = null; }
                setJitsiConnected(false);
                setJitsiParticipantCount(0);
                if (remoteAudioDecayRef.current) {
                  clearInterval(remoteAudioDecayRef.current);
                  remoteAudioDecayRef.current = null;
                }
                setRemoteAudioLevel(0);
                stopScreenShare();
              };

              api.addEventListener('videoConferenceLeft', () => {
                console.warn('[VoiceChat] videoConferenceLeft');
                onDisconnect('videoConferenceLeft');
              });
              api.addEventListener('conferenceTerminated', () => {
                console.warn('[VoiceChat] conferenceTerminated');
                onDisconnect('conferenceTerminated');
              });

              // Track participant count for the voice banner
              api.on('participantJoined', (e: any) => {
                console.log('[VoiceChat] participantJoined:', e);
                if (jitsiConnectionGenRef.current !== myGen) return;
                setJitsiParticipantCount(api.getNumberOfParticipants?.() ?? 0);
              });
              api.on('participantLeft', (e: any) => {
                console.log('[VoiceChat] participantLeft:', e);
                if (jitsiConnectionGenRef.current !== myGen) return;
                setJitsiParticipantCount(api.getNumberOfParticipants?.() ?? 0);
              });
              api.on('cameraError', (e: any) => {
                console.warn('[VoiceChat] cameraError:', e);
              });
              api.on('micError', (e: any) => {
                console.error('[VoiceChat] micError:', e);
              });
              api.on('dominantSpeakerChanged', (e: any) => {
                console.log('[VoiceChat] dominantSpeakerChanged:', e);
              });
              api.addEventListener('readyToClose', () => {
                console.warn('[VoiceChat] readyToClose — Jitsi wants to close the meeting');
              });
              api.on('log', (e: any) => {
                const logArgs: any[] = e?.args ?? [e];
                const lvl: string = (e?.logLevel ?? 'log').toLowerCase();
                const fn = (lvl === 'error' || lvl === 'warn') ? console[lvl as 'error' | 'warn'] : console.log;
                fn('[VoiceChat][jitsi-log]', ...logArgs);
              });

              api.addEventListener('connectionFailed', () => {
                console.error('[VoiceChat] connectionFailed (addEventListener)');
              });
              api.on('connectionFailed', (e: any) => {
                if (jitsiConnectionGenRef.current !== myGen) return; // stale
                console.error('[VoiceChat] connectionFailed:', e);
                setJitsiError('Voice chat connection failed. Check your network connection.');
                onDisconnect('connectionFailed');
              });

              api.addEventListener('conferenceError', () => {
                console.error('[VoiceChat] conferenceError (check Jitsi logs / jitsi-log entries above)');
              });
              api.on('conferenceError', (e: any) => {
                console.error('[VoiceChat] conferenceError (on):', e);
              });

              api.on('errorOccurred', (e: any) => {
                if (jitsiConnectionGenRef.current !== myGen) return; // stale
                console.error('[VoiceChat] errorOccurred:', e);
                if (e?.error?.isFatal) {
                  setJitsiError('Voice chat encountered a fatal error. Try moving away and back.');
                  onDisconnect('errorOccurred (fatal)');
                } else if (e?.error?.name === 'connection.passwordRequired' || e?.error?.message?.includes('nbf')) {
                  console.warn('[VoiceChat] JWT auth error (likely clock skew) — retrying');
                  setJitsiError('Voice chat authentication failed (clock sync issue). Reconnecting…');
                  onDisconnect('errorOccurred (auth)');
                }
              });

              api.on('kickedOut', (e: any) => {
                if (jitsiConnectionGenRef.current !== myGen) return; // stale
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
          color: 'white', background: 'rgba(0, 0, 0, 0.72)',
          padding: '14px', borderRadius: '8px', fontFamily: 'monospace', zIndex: 100,
          width: '240px',
        }}
      >
        <p style={{ margin: '0 0 6px 0', fontWeight: 'bold', fontSize: '14px' }}>
          {currentUser?.name}
          {!user && <span style={{ color: '#9ca3af', fontSize: '11px', fontWeight: 'normal' }}> (Guest)</span>}
        </p>
        <p style={{ margin: '0 0 4px 0', fontSize: '13px' }}>Users online: {onlineUsers.length}</p>
        {onlineUsers.length > 0 && (() => {
          const nameCounts: Record<string, number> = {};
          onlineUsers.forEach(u => { nameCounts[u.name] = (nameCounts[u.name] || 0) + 1; });
          return (
            <ul style={{ margin: '2px 0 4px 0', padding: '0 0 0 14px', fontSize: '12px', color: '#d1d5db', listStyle: 'none' }}>
              {onlineUsers.map(u => {
                const displayName = u.name + (nameCounts[u.name] > 1 && u.email ? ` (${u.email})` : '');
                const isSelf = u.id === currentUser?.id;
                const dotColor = u.status === 'active' ? '#4ade80' : u.status === 'inactive' ? '#fbbf24' : '#f87171';
                const dotTitle = u.status === 'active' ? 'Active' : u.status === 'inactive' ? 'Inactive' : 'Offline';
                const canTeleport = !isSelf && u.status !== 'offline';
                return (
                  <li key={u.id} style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '2px' }}>
                    <span
                      title={dotTitle}
                      style={{
                        width: '8px', height: '8px', borderRadius: '50%',
                        background: dotColor, flexShrink: 0, display: 'inline-block',
                      }}
                    />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{displayName}</span>
                    {/* Signal strength indicator — only shown when connection is bad */}
                    {!isSelf && (() => {
                      const peerStats = networkStats.peers.get(u.id);
                      if (peerStats && peerStats.quality !== 'good') {
                        return <SignalIcon quality={peerStats.quality} />;
                      }
                      return null;
                    })()}
                    {canTeleport && (
                      <button
                        title={followingUserId === u.id ? `Stop following ${u.name}` : `Follow ${u.name}`}
                        onClick={() => {
                          if (followingUserId === u.id) {
                            setFollowingUserId(null);
                            return;
                          }
                          // Teleport next to the user if we already have their position,
                          // then begin following. Follow mode starts regardless so the
                          // animation loop will track them as soon as position data arrives.
                          const target = avatarTargetsRef.current.get(u.id);
                          const cam = cameraRef.current;
                          if (target && cam) {
                            const dir = new THREE.Vector3()
                              .subVectors(cam.position, target.position)
                              .setY(0)
                              .normalize();
                            if (dir.lengthSq() < 0.0001) dir.set(1, 0, 0);
                            const dest = target.position.clone()
                              .addScaledVector(dir, bubblePrefsRef.current.radius * 0.8);
                            cam.position.set(dest.x, 1.6, dest.z);
                          }
                          setFollowingUserId(u.id);
                        }}
                        style={{
                          background: 'none', border: 'none', cursor: 'pointer',
                          padding: '0 2px', fontSize: '13px', lineHeight: 1,
                          opacity: followingUserId === u.id ? 1 : 0.7, flexShrink: 0,
                          filter: followingUserId === u.id ? 'brightness(1.8)' : 'none',
                        }}
                        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.opacity = '1'; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.opacity = followingUserId === u.id ? '1' : '0.7'; }}
                      >
                        {followingUserId === u.id ? '⊙' : '⤴'}
                      </button>
                    )}
                    {!isSelf && u.status !== 'offline' && (
                      <button
                        title={`Wave at ${u.name}`}
                        onClick={() => {
                          sendChatMessage(`${currentUser?.name || 'Someone'} has waved at ${u.name} 👋`);
                          channelRef.current?.send({
                            type: 'broadcast',
                            event: 'wave',
                            payload: { toUserId: u.id },
                          });
                        }}
                        style={{
                          background: 'none', border: 'none', cursor: 'pointer',
                          padding: '0 2px', fontSize: '13px', lineHeight: 1,
                          opacity: 0.7, flexShrink: 0,
                        }}
                        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.opacity = '1'; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.opacity = '0.7'; }}
                      >
                        👋
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          );
        })()}

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
                {/* Screen share toggle — only in an active voice call */}
                {jitsiRoom && (
                  <button
                    onClick={isSharing ? stopScreenShare : startScreenShare}
                    title={isSharing ? 'Stop sharing screen' : 'Share your screen'}
                    style={{
                      marginLeft: 'auto',
                      background: isSharing ? 'rgba(220,38,38,0.8)' : 'rgba(255,255,255,0.15)',
                      border: 'none', borderRadius: '4px', cursor: 'pointer',
                      color: 'white', fontSize: '13px', padding: '3px 8px',
                      transition: 'background 0.2s',
                    }}
                  >
                    {isSharing ? '⏹' : '🖥'}
                  </button>
                )}
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
        <p style={{ margin: '0 0 6px 0', fontSize: '11px', color: '#9ca3af' }}>
          Office: {officeId === 'global' ? 'Global' : 'Private'}
        </p>

        {user && (
          <button
            onClick={() => setShowSettings(true)}
            style={{
              marginTop: '6px', padding: '6px', fontSize: '12px',
              background: '#3498db', color: 'white',
              border: 'none', borderRadius: '4px', cursor: 'pointer',
              width: '100%',
            }}
          >
            ⚙️ Settings
          </button>
        )}

        {user ? (
          <>
            {onShowOfficeSelector && (
              <button
                onClick={onShowOfficeSelector}
                style={{
                  marginTop: '5px', padding: '6px', fontSize: '12px',
                  background: '#8b5cf6', color: 'white',
                  border: 'none', borderRadius: '4px', cursor: 'pointer',
                  width: '100%',
                }}
              >
                🏠 Back to Lobby
              </button>
            )}
            <button
              onClick={() => signOut().then(() => navigate('/login'))}
              style={{
                marginTop: '5px', padding: '6px', fontSize: '12px',
                background: '#dc2626', color: 'white',
                border: 'none', borderRadius: '4px', cursor: 'pointer',
                width: '100%',
              }}
            >
              Sign Out
            </button>
          </>
        ) : (
          <button
            onClick={() => setShowLoginModal(true)}
            style={{
              marginTop: '5px', padding: '6px', fontSize: '12px',
              background: '#22c55e', color: 'white',
              border: 'none', borderRadius: '4px', cursor: 'pointer',
              width: '100%',
            }}
          >
            Sign In
          </button>
        )}
      </div>

      {/* Chat UI — focused */}
      {chatVisible && (
        <div
          style={{
            position: 'absolute', bottom: '20px', left: '50%',
            transform: 'translateX(-50%)', width: '500px', maxWidth: '90vw',
            background: 'rgba(0,0,0,0.75)', borderRadius: '8px',
            padding: '10px', zIndex: 200,
          }}
        >
          <div
            ref={chatScrollRef}
            style={{ maxHeight: '50vh', overflowY: 'auto', marginBottom: '8px' }}
          >
            {chatMessages.map((msg) => (
              <div key={msg.id} style={{ color: 'white', fontSize: '14px', marginBottom: '4px' }}>
                <span style={{ color: '#6b7280', fontSize: '11px', marginRight: '6px' }}>
                  {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
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

      {/* Chat notification — unfocused, last 2 messages only */}
      {!chatVisible && chatMessages.length > 0 && (
        <div
          style={{
            position: 'absolute', bottom: '20px', left: '50%',
            transform: 'translateX(-50%)', width: '400px', maxWidth: '80vw',
            background: 'rgba(0,0,0,0.5)', borderRadius: '8px',
            padding: '8px 12px', zIndex: 100, pointerEvents: 'none',
          }}
        >
          {chatMessages.slice(-2).map((msg) => (
            <div key={msg.id} style={{ color: 'white', fontSize: '13px', marginBottom: '2px' }}>
              <span style={{ color: '#6b7280', fontSize: '11px', marginRight: '6px' }}>
                {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
              <span style={{ color: '#60a5fa', fontWeight: 'bold' }}>{msg.userName}: </span>
              {msg.message}
            </div>
          ))}
        </div>
      )}

      <SettingsPanel
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        currentSettings={avatarCustomization}
        onSave={user ? handleSaveSettings : undefined}
        currentEnvironment={environment}
        onEnvironmentChange={(currentUserRole === 'owner' || currentUserRole === 'admin') ? handleEnvironmentChange : undefined}
        officeId={officeId !== 'global' ? officeId : undefined}
        currentUserRole={currentUserRole}
        onBubblePrefsChange={handleBubblePrefsChange}
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

      {/* Camera mode indicator */}
      {cameraMode !== 'first-person' && (
        <div style={{
          position: 'absolute', bottom: isTouchDevice ? '180px' : '20px', left: isTouchDevice ? '40px' : '20px',
          background: 'rgba(0,0,0,0.7)', color: 'white', padding: '6px 12px',
          borderRadius: '6px', fontFamily: 'monospace', fontSize: '12px', zIndex: 200,
          pointerEvents: 'none',
        }}>
          {cameraMode === 'third-person-behind' ? '3rd Person (Behind)' : '3rd Person (Front)'}
          <span style={{ color: '#9ca3af', marginLeft: '8px' }}>C to cycle</span>
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

    {/* Debug panel toggle tab */}
    <button
      onClick={() => setShowDebugPanel(v => !v)}
      style={{
        position: 'absolute', bottom: showDebugPanel ? '220px' : '0px', left: '50%',
        transform: 'translateX(-50%)',
        background: '#1f2937', color: '#9ca3af', border: '1px solid rgba(255,255,255,0.1)',
        borderBottom: showDebugPanel ? 'none' : '1px solid rgba(255,255,255,0.1)',
        borderRadius: showDebugPanel ? '6px 6px 0 0' : '6px 6px 0 0',
        padding: '3px 14px', fontSize: '11px', fontFamily: 'monospace',
        cursor: 'pointer', zIndex: 300,
        transition: 'bottom 0.2s ease',
      }}
    >
      {showDebugPanel ? 'Hide' : 'Network'}
    </button>

    {showDebugPanel && (
      <NetworkDebugPanel stats={networkStats} onClose={() => setShowDebugPanel(false)} />
    )}
    </div>
  );
}
