import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as THREE from 'three';
import { JaaSMeeting } from '@jitsi/react-sdk';
import { AvatarAnimationState } from './Avatar';
import { spawnConfetti, updateParticles, Particle } from './EmojiConfetti';
import SettingsPanel from './SettingsPanel';
import ControlsOverlay from './ControlsOverlay';
import NetworkDebugPanel, { SignalIcon } from './NetworkDebugPanel';
import { useNetworkStats } from '@/hooks/useNetworkStats';
import { CameraMode, EnvironmentType } from '@/types/room';
import { supabase } from '@/lib/supabase';
import { useAuth, signOut, signInWithGoogle } from '@/hooks/useAuth';
import { useMotionControls } from '@/hooks/useMotionControls';
import { useRealtimeChannel } from '@/hooks/useRealtimeChannel';
import { useChat } from '@/hooks/useChat';
import { useAvatarCustomization } from '@/hooks/useAvatarCustomization';
import { useScreenSharing } from '@/hooks/useScreenSharing';
import { useJitsi } from '@/hooks/useJitsi';
import { useKeyboardControls } from '@/hooks/useKeyboardControls';
import { usePresence } from '@/hooks/usePresence';
import { useSceneSetup } from '@/hooks/useSceneSetup';

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
  });
  const isTouchDevice = typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0);

  const [showDebugPanel, setShowDebugPanel] = useState(false);
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


    // Register keyboard, mouse, touch, and scroll input handlers
    const cleanupInputListeners = registerInputListeners(
      renderer, camera, scene, orthoCamera, orthoViewSizeRef,
      (emojiKey: string) => {
        activeParticles.push(...spawnConfetti(scene, camera.position.clone(), emojiKey));
        if (channelRef.current && channelSubscribedRef.current) {
          channelRef.current.send({
            type: 'broadcast', event: 'confetti',
            payload: {
              userId: currentUser.id, key: emojiKey,
              position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
            },
          });
        }
      },
    );

    // Supabase Realtime channel — created by useRealtimeChannel, accessed via ref
    const channel = channelRef.current;
    if (!channel) return;

    // Register presence, chat, screen sharing, and other broadcast listeners
    registerPresenceListeners(channel, scene);

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
        await handleChannelSubscribed(channel, scene, camera);
      }
    });

    // Set up presence timers (visibility, heartbeat, offline cleanup)
    const cleanupPresenceTimers = setupPresenceTimers();

    // Animation loop
    const clock = new THREE.Clock();

    const animate = () => {
      const delta = clock.getDelta();
      const lerpAlpha = 1 - Math.pow(0.005, delta);

      // Update emoji confetti particles
      activeParticles = updateParticles(activeParticles, delta, scene);

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

      // Sync top-down camera to player XZ position
      orthoCamera.position.x = broadcastPos.x;
      orthoCamera.position.z = broadcastPos.z;

      renderer.render(scene, is2DModeRef.current ? orthoCamera : camera);
    };

    renderer.setAnimationLoop(animate);

    return () => {
      renderer.setAnimationLoop(null);
      cleanupInputListeners();

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
