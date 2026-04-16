import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as THREE from 'three';
import { AvatarAnimationState } from './Avatar';
import { spawnConfetti, updateParticles, Particle, EMOJI_MAP } from './EmojiConfetti';
import SettingsPanel from './SettingsPanel';
import ControlsOverlay from './ControlsOverlay';
import NetworkDebugPanel from './NetworkDebugPanel';
import WhiteboardCanvas from './WhiteboardCanvas';
import WhiteboardToolbar from './WhiteboardToolbar';
import { useWhiteboard } from '@/hooks/useWhiteboard';
import { useNetworkStats } from '@/hooks/useNetworkStats';
import { CameraMode, EnvironmentType } from '@/types/room';
import { supabase } from '@/lib/supabase';
import { useAuth, signOut } from '@/hooks/useAuth';
import { useMotionControls } from '@/hooks/useMotionControls';
import { useRealtimeChannel } from '@/hooks/useRealtimeChannel';
import { useChat } from '@/hooks/useChat';
import { useAvatarCustomization } from '@/hooks/useAvatarCustomization';
import { useScreenSharing } from '@/hooks/useScreenSharing';
import { useJitsi } from '@/hooks/useJitsi';
import { useKeyboardControls } from '@/hooks/useKeyboardControls';
import { usePresence } from '@/hooks/usePresence';
import { useSceneSetup } from '@/hooks/useSceneSetup';
import { useShooting } from '@/hooks/useShooting';
import ConnectionStatusBanner from './room/ConnectionStatusBanner';
import MotionPermissionBanner from './room/MotionPermissionBanner';
import { ScreenShareOverlay, ScreenShareTiles } from './room/ScreenShare';
import JitsiMeetingContainer from './room/JitsiMeetingContainer';
import UserPanel from './room/UserPanel';
import ChatPanel from './room/ChatPanel';
import LoginModal from './room/LoginModal';
import CameraModeIndicator from './room/CameraModeIndicator';
import Crosshair from './room/Crosshair';
import VirtualJoystick from './room/VirtualJoystick';

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
  const myPresenceRef = channelMyPresenceRef;
  const selfMarkerRef = useRef<THREE.Group | null>(null);
  const localAvatarRef = useRef<THREE.Group | null>(null);
  const localAvatarAnimationRef = useRef<AvatarAnimationState | null>(null);
  const localBubbleSphereRef = useRef<THREE.Mesh | null>(null);
  const cameraModeRef = useRef<CameraMode>('first-person');

  // Jitsi voice chat and microphone
  const {
    jitsiRoom,
    jitsiConnected,
    jitsiParticipantCount,
    jitsiError,
    setJitsiError,
    jitsiRetryCount,
    setJitsiRetryCount,
    remoteAudioLevel,
    micMuted,
    micLevel,
    micError,
    handleMuteToggle,
    startMicRef,
    activeJitsiRoom,
    jaasJwt,
    jaasJwtError,
    jitsiRoomRef,
    jitsiApiRef,
    jitsiConnectionGenRef,
    jitsiConnectTimeoutRef,
    jitsiHeartbeatRef,
    jitsiMessageListenerRef,
    jitsiLeaveDebounceRef,
    remoteAudioDecayRef,
    micStreamRef,
    setJitsiConnected,
    setJitsiParticipantCount,
    setRemoteAudioLevel,
    handleProximityChange,
    cleanupJitsi,
  } = useJitsi({
    officeId,
    currentUser,
    userEmail: user?.email,
    channelRef,
    channelSubscribedRef,
    myPresenceRef,
  });

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
    onChatInputFocus,
    onChatInputBlur,
    registerChatListener,
  } = useChat({
    channelRef,
    channelSubscribedRef,
    currentUser,
    currentUserRef,
    showSettings: showSettings,
    keysRef,
  });
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(15); // ortho view size, default 15
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

  // Follow state
  const [followingUserId, setFollowingUserId] = useState<string | null>(null);
  const followingUserIdRef = useRef<string | null>(null);
  followingUserIdRef.current = followingUserId;

  // Whiteboard keyboard shortcut refs (populated after useWhiteboard call)
  const wbToggleRef = useRef<(() => void) | null>(null);
  const wbUndoRef = useRef<(() => void) | null>(null);

  // Keyboard, mouse, and touch input controls
  const {
    cameraMode,
    setCameraMode,
    is2DMode,
    setIs2DMode,
    is2DModeRef,
    showControls,
    setShowControls,
    mouseLockActive,
    joystickKnob,
    setJoystickKnob,
    joystickActive,
    setJoystickActive,
    joystickInputRef,
    playerPositionRef,
    playerYawRef,
    registerInputListeners,
    computeMovement,
  } = useKeyboardControls({
    keysRef,
    cameraModeRef,
    chatVisibleRef,
    motionActiveRef,
    followingUserIdRef,
    setFollowingUserId,
    onWhiteboardToggle: wbToggleRef,
    onWhiteboardUndo: wbUndoRef,
  });
  const isTouchDevice = typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0);
  const fireEmojiRef = useRef<((key: string) => void) | null>(null);

  const [showDebugPanel, setShowDebugPanel] = useState(false);
  const [realtimeRetryAt, setRealtimeRetryAt] = useState<number | null>(null);
  // Trigger renderer resize when debug panel toggles
  useEffect(() => {
    const timer = setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
    return () => clearTimeout(timer);
  }, [showDebugPanel]);

  // Network stats — needs a temporary ref for recordPositionUpdate since usePresence uses it
  const recordPositionUpdateRef = useRef<(userId: string) => void>(() => {});

  // Presence and position management
  const {
    onlineUsers,
    presenceDataRef,
    avatarsRef,
    avatarTargetsRef,
    lastPositionUpdate,
    registerPresenceListeners,
    handleChannelSubscribed,
    setupPresenceTimers,
    tickPresence,
    cleanupPresenceVisuals,
  } = usePresence({
    currentUser,
    userEmail: user?.email,
    userImage: user?.image,
    channelRef,
    channelSubscribedRef,
    myPresenceRef,
    cameraRef,
    cameraModeRef,
    playerPositionRef,
    playerYawRef,
    localAvatarAnimationRef,
    localBubbleSphereRef,
    selfMarkerRef,
    avatarCustomizationRef,
    bubblePrefsRef,
    jitsiRoomRef,
    is2DModeRef,
    followingUserIdRef,
    setFollowingUserId,
    handleProximityChange,
    recordPositionUpdateRef,
  });

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

  // Collaborative whiteboard
  const {
    whiteboardActive,
    setWhiteboardActive,
    strokes: wbStrokes,
    currentStroke: wbCurrentStroke,
    tool: wbTool,
    setTool: setWbTool,
    color: wbColor,
    setColor: setWbColor,
    strokeWidth: wbStrokeWidth,
    setStrokeWidth: setWbStrokeWidth,
    beginStroke: wbBeginStroke,
    continueStroke: wbContinueStroke,
    endStroke: wbEndStroke,
    undo: wbUndo,
    clearAll: wbClearAll,
    registerWhiteboardListeners,
    updateFloorTexture: wbUpdateFloorTexture,
    initWhiteboardMesh,
  } = useWhiteboard({
    channelRef,
    channelSubscribedRef,
    currentUserId: currentUser?.id,
  });
  // Wire whiteboard keyboard shortcut refs
  wbToggleRef.current = () => setWhiteboardActive(!whiteboardActive);
  wbUndoRef.current = wbUndo;

  // Network stats for debug panel
  const networkStats = useNetworkStats(
    channelRef,
    channelSubscribedRef,
    currentUser?.id,
    onlineUsers,
    showDebugPanel,
  );
  recordPositionUpdateRef.current = networkStats.recordPositionUpdate;
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
    channelSend('environment-change', { environment: env });
  };


  // Three.js scene, renderer, camera, environment, local avatar, and resize handling
  const { orthoCameraRef, orthoViewSizeRef } = useSceneSetup({
    containerRef,
    officeId,
    environment,
    currentUser,
    sceneRef,
    rendererRef,
    cameraRef,
    localAvatarRef,
    localAvatarAnimationRef,
    localBubbleSphereRef,
    selfMarkerRef,
    avatarCustomizationRef,
    bubblePrefsRef,
    playerPositionRef,
  });

  const { fireBullet, updateBullets } = useShooting();

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
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    const renderer = rendererRef.current;
    const orthoCamera = orthoCameraRef.current;
    if (!scene || !camera || !renderer || !orthoCamera || !currentUser) return;

    // Movement
    const moveSpeed = 0.1;
    let activeParticles: Particle[] = [];

    // Expose emoji fire function for the emoji picker bar
    const fireEmoji = (emojiKey: string) => {
      activeParticles.push(...spawnConfetti(scene, camera.position.clone(), emojiKey, is2DModeRef.current));
      channelSend('confetti', {
        userId: currentUser.id, key: emojiKey,
        position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
      });
    };
    fireEmojiRef.current = fireEmoji;


    // Register keyboard, mouse, touch, and scroll input handlers
    const cleanupInputListeners = registerInputListeners(
      renderer, camera, scene, orthoCamera, orthoViewSizeRef,
      (emojiKey: string) => {
        activeParticles.push(...spawnConfetti(scene, camera.position.clone(), emojiKey, is2DModeRef.current));
        channelSend('confetti', {
          userId: currentUser.id, key: emojiKey,
          position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
        });
      },
      (newZoom: number) => setZoomLevel(newZoom),
    );

    // Shooting: left-click while pointer is locked fires a bullet
    const handleShootMouseDown = (event: MouseEvent) => {
      if (event.button !== 0) return;
      if (is2DModeRef.current) return;
      if (document.pointerLockElement !== renderer.domElement) return;
      fireBullet(camera, scene, avatarsRef.current);
    };
    renderer.domElement.addEventListener('mousedown', handleShootMouseDown);

    // Supabase Realtime channel — created by useRealtimeChannel, accessed via ref
    const channel = channelRef.current;

    // Initialize whiteboard 3D floor mesh
    initWhiteboardMesh(scene);

    // Animation loop — always start regardless of channel state
    const clock = new THREE.Clock();

    // Called when a bullet hits a remote avatar — trigger a wave
    const handleAvatarHit = (avatarId: string) => {
      const toUserName = presenceDataRef.current.get(avatarId)?.name || 'someone';
      playWaveChime(); // local chime as shooter feedback
      sendWave(avatarId, `${currentUser.name || 'Someone'} hit ${toUserName} with a sparkle! ✨`);
    };

    const animate = () => {
      const delta = clock.getDelta();
      const lerpAlpha = 1 - Math.pow(0.005, delta);

      // Update emoji confetti particles
      activeParticles = updateParticles(activeParticles, delta, scene);

      // Update bullet positions and sparkle trails
      updateBullets(delta, scene, handleAvatarHit);

      // Update whiteboard 3D floor texture if strokes changed
      wbUpdateFloorTexture();

      // Compute player movement, camera positioning, and local avatar animation
      const followTarget = followingUserIdRef.current
        ? avatarTargetsRef.current.get(followingUserIdRef.current)
        : undefined;
      const { moved, broadcastPos, broadcastRot } = computeMovement(
        camera,
        localAvatarRef.current,
        localAvatarAnimationRef.current,
        followTarget,
        bubblePrefsRef.current.radius,
        moveSpeed,
      );

      // Presence tick: position broadcast, avatar lerp, proximity, stale detection, etc.
      tickPresence(delta, lerpAlpha, camera, scene, channel, broadcastPos, broadcastRot, moved);

      // Sync top-down camera to player XZ position with smooth easing
      orthoCamera.position.x += (broadcastPos.x - orthoCamera.position.x) * 0.12;
      orthoCamera.position.z += (broadcastPos.z - orthoCamera.position.z) * 0.12;

      renderer.render(scene, is2DModeRef.current ? orthoCamera : camera);
    };

    renderer.setAnimationLoop(animate);

    // Register presence, chat, screen sharing, and other broadcast listeners
    if (channel) {
      if (!channelSubscribedRef.current) {
        // First-time subscription — register all handlers once. Re-registering on
        // environment changes would create duplicate handlers on the same channel.
        registerPresenceListeners(channel, sceneRef);

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
            activeParticles.push(...spawnConfetti(scene, new THREE.Vector3(position.x, position.y, position.z), key, is2DModeRef.current));
          }
        });

        // Broadcast: screen sharing — registered by useScreenSharing hook
        registerScreenListeners(channel, currentUser.id);

        // Broadcast: whiteboard — registered by useWhiteboard hook
        registerWhiteboardListeners(channel);

        // Broadcast: room environment changes — update scene for all connected users
        channel.on('broadcast', { event: 'environment-change' }, ({ payload }) => {
          const { environment: env } = payload as { environment: string };
          if (typeof env === 'string' && env.length > 0) {
            setEnvironment(env);
          }
        });

        let retryCount = 0;
        const handleChannelStatus = async (status: string) => {
          channelSubscribedRef.current = status === 'SUBSCRIBED';
          if (status === 'SUBSCRIBED') {
            retryCount = 0;
            setRealtimeRetryAt(null);
            await handleChannelSubscribed(channel, scene, camera);
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            // Re-subscribe with exponential backoff (2s, 4s, 8s … capped at 30s).
            const delay = Math.min(30000, 2000 * Math.pow(2, retryCount));
            retryCount++;
            console.warn(`[Channel] ${status} — retrying in ${delay}ms (attempt ${retryCount})`);
            setRealtimeRetryAt(Date.now() + delay);
            setTimeout(() => {
              if (channelRef.current === channel) {
                channel.subscribe(handleChannelStatus);
              }
            }, delay);
          }
        };
        channel.subscribe(handleChannelStatus);
      } else {
        // Already subscribed — effect re-ran due to environment change.
        // Scene was rebuilt and avatars were cleared. Re-sync presence with the new scene.
        void handleChannelSubscribed(channel, scene, camera);
      }
    }

    // Set up presence timers (visibility, heartbeat, offline cleanup)
    const cleanupPresenceTimers = setupPresenceTimers();

    return () => {
      renderer.setAnimationLoop(null);
      cleanupInputListeners();
      renderer.domElement.removeEventListener('mousedown', handleShootMouseDown);

      // Clean up presence timers (visibility, heartbeat, offline cleanup)
      cleanupPresenceTimers();

      // Clean up screen sharing without broadcasting (channel is closing)
      cleanupPeerConnections();

      // Cancel any pending Jitsi leave debounce — component is tearing down
      if (jitsiLeaveDebounceRef.current) {
        clearTimeout(jitsiLeaveDebounceRef.current);
        jitsiLeaveDebounceRef.current = null;
      }
      // Channel cleanup (untrack + removeChannel) is handled by useRealtimeChannel
      // Scene/renderer/avatar/VR cleanup is handled by useSceneSetup

      // Clean up remote presence visuals (avatars, bubble spheres, etc.)
      cleanupPresenceVisuals(scene);
    };
  }, [officeId, currentUser?.id, environment]);

  // ── Callbacks passed to child components ──────────────────────────────────

  const handleFollowUser = (userId: string) => {
    const target = avatarTargetsRef.current.get(userId);
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
    setFollowingUserId(userId);
  };

  const sendWave = (toUserId: string, chatMessage: string) => {
    channelSend('wave', { toUserId });
    sendChatMessage(chatMessage);
  };

  const handleWaveAt = (toUserId: string, toUserName: string) => {
    sendWave(toUserId, `${currentUser?.name || 'Someone'} has waved at ${toUserName} 👋`);
  };

  const handleJitsiRetry = () => {
    setJitsiError(null);
    setJitsiConnected(false);
    setJitsiRetryCount(c => c + 1);
  };

  const handleJitsiApiReady = (api: any) => {
    const myGen = jitsiConnectionGenRef.current;
    console.log('[VoiceChat] onApiReady fired — iframe JS loaded, waiting for videoConferenceJoined');
    console.log('[VoiceChat] Page state at onApiReady — visibilityState:', document.visibilityState, '| hasFocus:', document.hasFocus());
    jitsiApiRef.current = api;
    setJitsiError(null);

    if (jitsiHeartbeatRef.current) { clearInterval(jitsiHeartbeatRef.current); jitsiHeartbeatRef.current = null; }
    if (jitsiMessageListenerRef.current) { window.removeEventListener('message', jitsiMessageListenerRef.current); jitsiMessageListenerRef.current = null; }

    if (jitsiConnectTimeoutRef.current) clearTimeout(jitsiConnectTimeoutRef.current);
    if (jitsiRoomRef.current !== null) {
      jitsiConnectTimeoutRef.current = setTimeout(() => {
        if (jitsiConnectionGenRef.current !== myGen) return;
        console.error('[VoiceChat] Connection timed out after 20s from onApiReady — videoConferenceJoined never fired. Room:', jitsiRoomRef.current);
        setJitsiError('Could not connect to voice chat — the server may be unavailable.');
      }, 20000);
    }

    try {
      const jwtParts = (jaasJwt ?? '').split('.');
      if (jwtParts.length === 3) {
        const hdr = JSON.parse(atob(jwtParts[0].replace(/-/g, '+').replace(/_/g, '/')));
        const pay = JSON.parse(atob(jwtParts[1].replace(/-/g, '+').replace(/_/g, '/')));
        console.log('[VoiceChat] JWT header:', hdr);
        console.log('[VoiceChat] JWT payload (redacted key):', {
          ...pay,
          context: { ...pay.context, user: pay.context?.user },
          iat: pay.iat, exp: pay.exp, nbf: pay.nbf,
          expired: pay.exp < Math.floor(Date.now() / 1000),
          secondsUntilExpiry: pay.exp - Math.floor(Date.now() / 1000),
        });
      }
    } catch (jwtErr) {
      console.warn('[VoiceChat] Could not decode JWT for inspection:', jwtErr);
    }

    if (micMuted) api.executeCommand('toggleAudio');

    if (remoteAudioDecayRef.current) clearInterval(remoteAudioDecayRef.current);
    remoteAudioDecayRef.current = setInterval(() => {
      setRemoteAudioLevel(prev => (prev > 0.01 ? prev * 0.85 : 0));
    }, 80);

    api.addListener('audioLevelsChanged', ({ id, level }: { id: string; level: number }) => {
      void id;
      setRemoteAudioLevel(prev => Math.max(prev, level));
    });

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

    api.addEventListener('videoConferenceJoined', () => {
      if (jitsiConnectionGenRef.current !== myGen) return;
      console.log('[VoiceChat] videoConferenceJoined — connected to room:', jitsiRoomRef.current);
      if (jitsiHeartbeatRef.current) { clearInterval(jitsiHeartbeatRef.current); jitsiHeartbeatRef.current = null; }
      if (jitsiMessageListenerRef.current) { window.removeEventListener('message', jitsiMessageListenerRef.current); jitsiMessageListenerRef.current = null; }
      if (jitsiConnectTimeoutRef.current) { clearTimeout(jitsiConnectTimeoutRef.current); jitsiConnectTimeoutRef.current = null; }
      setJitsiConnected(true);
      setJitsiParticipantCount(api.getNumberOfParticipants?.() ?? 1);
    });

    const onDisconnect = (reason?: string) => {
      if (jitsiConnectionGenRef.current !== myGen) return;
      console.warn('[VoiceChat] Disconnected from voice chat. Reason:', reason ?? '(unknown)');
      if (jitsiHeartbeatRef.current) { clearInterval(jitsiHeartbeatRef.current); jitsiHeartbeatRef.current = null; }
      if (jitsiMessageListenerRef.current) { window.removeEventListener('message', jitsiMessageListenerRef.current); jitsiMessageListenerRef.current = null; }
      setJitsiConnected(false);
      setJitsiParticipantCount(0);
      if (remoteAudioDecayRef.current) { clearInterval(remoteAudioDecayRef.current); remoteAudioDecayRef.current = null; }
      setRemoteAudioLevel(0);
      stopScreenShare();
    };

    api.addEventListener('videoConferenceLeft', () => { console.warn('[VoiceChat] videoConferenceLeft'); onDisconnect('videoConferenceLeft'); });
    api.addEventListener('conferenceTerminated', () => { console.warn('[VoiceChat] conferenceTerminated'); onDisconnect('conferenceTerminated'); });

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
    api.on('cameraError', (e: any) => { console.warn('[VoiceChat] cameraError:', e); });
    api.on('micError', (e: any) => { console.error('[VoiceChat] micError:', e); });
    api.on('dominantSpeakerChanged', (e: any) => { console.log('[VoiceChat] dominantSpeakerChanged:', e); });
    api.addEventListener('readyToClose', () => { console.warn('[VoiceChat] readyToClose — Jitsi wants to close the meeting'); });
    api.on('log', (e: any) => {
      const logArgs: any[] = e?.args ?? [e];
      const lvl: string = (e?.logLevel ?? 'log').toLowerCase();
      const fn = (lvl === 'error' || lvl === 'warn') ? console[lvl as 'error' | 'warn'] : console.log;
      fn('[VoiceChat][jitsi-log]', ...logArgs);
    });

    api.addEventListener('connectionFailed', () => { console.error('[VoiceChat] connectionFailed (addEventListener)'); });
    api.on('connectionFailed', (e: any) => {
      if (jitsiConnectionGenRef.current !== myGen) return;
      console.error('[VoiceChat] connectionFailed:', e);
      setJitsiError('Voice chat connection failed. Check your network connection.');
      onDisconnect('connectionFailed');
    });

    api.addEventListener('conferenceError', () => { console.error('[VoiceChat] conferenceError (check Jitsi logs / jitsi-log entries above)'); });
    api.on('conferenceError', (e: any) => { console.error('[VoiceChat] conferenceError (on):', e); });

    api.on('errorOccurred', (e: any) => {
      if (jitsiConnectionGenRef.current !== myGen) return;
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
      if (jitsiConnectionGenRef.current !== myGen) return;
      console.warn('[VoiceChat] kickedOut:', e);
      setJitsiError('You were disconnected from voice chat.');
      onDisconnect('kickedOut');
    });
  };


  return (
    <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100vh' }}>
    <div ref={containerRef} style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>

      {/* Mouse look active indicator */}
      {mouseLockActive && (
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 50,
          boxShadow: 'inset 0 0 0 4px #00ff00',
        }} />
      )}

      <Crosshair visible={mouseLockActive && !is2DMode} />

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

      {/* 2D mode: Zoom controls + compass rose */}
      {is2DMode && (
        <div style={{
          position: 'absolute', bottom: '20px', left: '20px', zIndex: 150,
          display: 'flex', flexDirection: 'column', gap: '10px', alignItems: 'center',
        }}>
          {/* Compass rose */}
          <div style={{
            width: '64px', height: '64px', position: 'relative',
            background: 'rgba(0,0,0,0.6)', borderRadius: '50%',
            border: '2px solid rgba(255,255,255,0.2)',
          }}>
            {(['N', 'E', 'S', 'W'] as const).map((dir, i) => {
              const angle = i * 90;
              const rad = (angle - 90) * Math.PI / 180;
              const r = 22;
              return (
                <span key={dir} style={{
                  position: 'absolute',
                  left: `${32 + Math.cos(rad) * r - 5}px`,
                  top: `${32 + Math.sin(rad) * r - 7}px`,
                  color: dir === 'N' ? '#f87171' : 'rgba(255,255,255,0.7)',
                  fontSize: '11px', fontWeight: dir === 'N' ? 'bold' : 'normal',
                  fontFamily: 'monospace',
                }}>
                  {dir}
                </span>
              );
            })}
          </div>
          {/* Zoom controls */}
          <div style={{
            background: 'rgba(0,0,0,0.6)', borderRadius: '8px',
            padding: '6px 8px', display: 'flex', alignItems: 'center', gap: '6px',
            border: '1px solid rgba(255,255,255,0.15)',
          }}>
            <button
              onClick={() => (window as any).__officexr_applyZoom?.(orthoViewSizeRef.current * 1.3)}
              style={{
                background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: '4px',
                color: 'white', cursor: 'pointer', width: '24px', height: '24px',
                fontSize: '16px', lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >-</button>
            <span style={{
              color: 'white', fontFamily: 'monospace', fontSize: '11px',
              minWidth: '40px', textAlign: 'center',
            }}>
              {Math.round((15 / zoomLevel) * 100)}%
            </span>
            <button
              onClick={() => (window as any).__officexr_applyZoom?.(orthoViewSizeRef.current * 0.7)}
              style={{
                background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: '4px',
                color: 'white', cursor: 'pointer', width: '24px', height: '24px',
                fontSize: '16px', lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >+</button>
          </div>
        </div>
      )}

      {/* Bottom-right hint to open the controls pane */}
      <div style={{
        position: 'absolute', bottom: '20px', right: '20px',
        color: 'rgba(255,255,255,0.5)', fontFamily: 'monospace', fontSize: '12px',
        pointerEvents: 'none', userSelect: 'none',
      }}>
        ? — {showControls ? 'hide' : 'show'} controls
      </div>

      {motionPermission === 'prompt' && (
        <MotionPermissionBanner onEnable={handleRequestMotionPermission} />
      )}

      <ConnectionStatusBanner
        realtimeRetryAt={realtimeRetryAt}
        jitsiRoom={jitsiRoom}
        jitsiConnected={jitsiConnected}
        jitsiParticipantCount={jitsiParticipantCount}
        remoteAudioLevel={remoteAudioLevel}
        jaasJwt={jaasJwt}
        jaasJwtError={jaasJwtError}
        jitsiError={jitsiError}
        onJitsiRetry={handleJitsiRetry}
        onJitsiDismiss={() => setJitsiError(null)}
      />

      {/* Whiteboard canvas overlay — renders strokes in 2D mode, handles drawing input */}
      <WhiteboardCanvas
        active={whiteboardActive}
        is2DMode={is2DMode}
        strokes={wbStrokes}
        currentStroke={wbCurrentStroke}
        tool={wbTool}
        color={wbColor}
        strokeWidth={wbStrokeWidth}
        orthoCamera={orthoCameraRef.current}
        containerRef={containerRef}
        onBeginStroke={wbBeginStroke}
        onContinueStroke={wbContinueStroke}
        onEndStroke={wbEndStroke}
      />

      {activeShareId && screenShares.has(activeShareId) && (
        <ScreenShareOverlay
          activeShareId={activeShareId}
          screenShares={screenShares}
          currentUserId={currentUserRef.current?.id}
          onClose={() => setActiveShareId(null)}
          onSwitchShare={setActiveShareId}
          onStopShare={stopScreenShare}
        />
      )}

      {screenShares.size > 0 && activeShareId === null && (
        <ScreenShareTiles
          screenShares={screenShares}
          currentUserId={currentUserRef.current?.id}
          onSelect={setActiveShareId}
        />
      )}

      {activeJitsiRoom && jaasJwt && (
        <JitsiMeetingContainer
          retryCount={jitsiRetryCount}
          roomName={activeJitsiRoom}
          appId={import.meta.env.VITE_JAAS_APP_ID ?? ''}
          jwt={jaasJwt}
          displayName={currentUser?.name || 'User'}
          email={user?.email || ''}
          onApiReady={handleJitsiApiReady}
        />
      )}

      <UserPanel
        currentUser={currentUser}
        user={user}
        officeId={officeId}
        onlineUsers={onlineUsers}
        followingUserId={followingUserId}
        networkStats={networkStats}
        micLevel={micLevel}
        micError={micError}
        micMuted={micMuted}
        jitsiRoom={jitsiRoom}
        isSharing={isSharing}
        onFollowUser={handleFollowUser}
        onUnfollow={() => setFollowingUserId(null)}
        onWaveAt={handleWaveAt}
        onMuteToggle={handleMuteToggle}
        onStartMic={() => startMicRef.current?.()}
        onStartShare={startScreenShare}
        onStopShare={stopScreenShare}
        onShowSettings={() => setShowSettings(true)}
        onShowOfficeSelector={onShowOfficeSelector}
        onSignIn={() => setShowLoginModal(true)}
        onSignOut={() => signOut().then(() => navigate('/login'))}
      />

      <ChatPanel
        visible={chatVisible}
        messages={chatMessages}
        input={chatInput}
        onInputChange={setChatInput}
        onSend={(msg) => { sendChatMessage(msg); setChatInput(''); }}
        onClose={() => { setChatVisible(false); setChatInput(''); }}
        onInputFocus={onChatInputFocus}
        onInputBlur={onChatInputBlur}
        chatScrollRef={chatScrollRef}
        chatInputRef={chatInputRef}
      />

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

      {showLoginModal && (
        <LoginModal onClose={() => setShowLoginModal(false)} />
      )}

      {/* Bottom toolbar — whiteboard controls + emoji picker */}
      <div style={{
        position: 'absolute', bottom: '16px', left: '16px',
        display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '6px',
        zIndex: 160,
      }}>
        <WhiteboardToolbar
          active={whiteboardActive}
          onToggle={() => setWhiteboardActive(!whiteboardActive)}
          tool={wbTool}
          onToolChange={setWbTool}
          color={wbColor}
          onColorChange={setWbColor}
          strokeWidth={wbStrokeWidth}
          onStrokeWidthChange={setWbStrokeWidth}
          onUndo={wbUndo}
          onClear={wbClearAll}
          strokeCount={wbStrokes.length}
        />
        <div style={{
          display: 'flex', gap: '6px',
          background: 'rgba(0,0,0,0.55)', borderRadius: '12px',
          padding: '6px 12px', border: '1px solid rgba(255,255,255,0.12)',
        }}>
          {Object.entries(EMOJI_MAP).map(([key, emoji]) => (
            <button
              key={key}
              title={`Press ${key}`}
              onClick={() => fireEmojiRef.current?.(key)}
              style={{
                background: 'rgba(255,255,255,0.08)', border: 'none', borderRadius: '8px',
                cursor: 'pointer', fontSize: '22px', width: '40px', height: '40px',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'background 0.15s',
              }}
              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.2)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.08)'; }}
            >
              {emoji}
            </button>
          ))}
        </div>
      </div>

      <CameraModeIndicator cameraMode={cameraMode} isTouchDevice={isTouchDevice} />

      {isTouchDevice && (
        <VirtualJoystick
          joystickKnob={joystickKnob}
          joystickActive={joystickActive}
          joystickInputRef={joystickInputRef}
          onActiveChange={setJoystickActive}
          onKnobChange={setJoystickKnob}
        />
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
        borderRadius: '6px 6px 0 0',
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
