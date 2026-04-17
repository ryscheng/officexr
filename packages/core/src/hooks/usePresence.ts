import { useCallback, useRef, useState } from 'react';
import * as THREE from 'three';
import { RealtimeChannel } from '@supabase/supabase-js';
import { PresenceEntry, CameraMode } from '@/types/room';
import { AvatarCustomization, BubblePreferences } from '@/types/avatar';
import { createAvatar, create2DMarker, AvatarData, AvatarAnimationState, switchAnimation } from '@/components/Avatar';

export function createBubbleSphere(scene: THREE.Scene, radius: number, color: number): THREE.Mesh {
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

export function hexStringToInt(hex: string): number {
  return parseInt(hex.replace('#', ''), 16);
}

export interface PresenceHandle {
  onlineUsers: Array<{ id: string; name: string; email: string | null; status: 'active' | 'inactive' | 'offline' }>;
  presenceDataRef: React.MutableRefObject<Map<string, PresenceEntry>>;
  avatarsRef: React.MutableRefObject<Map<string, THREE.Group>>;
  avatarAnimationsRef: React.MutableRefObject<Map<string, AvatarAnimationState>>;
  avatarPrevPositionsRef: React.MutableRefObject<Map<string, THREE.Vector3>>;
  avatarTargetsRef: React.MutableRefObject<Map<string, { position: THREE.Vector3; rotationY: number }>>;
  bubbleSpheresRef: React.MutableRefObject<Map<string, THREE.Mesh>>;
  remoteBubblePrefsRef: React.MutableRefObject<Map<string, BubblePreferences>>;
  nearbyUserIdsRef: React.MutableRefObject<Set<string>>;
  pendingAvatarUpdatesRef: React.MutableRefObject<Map<string, AvatarCustomization>>;
  lastPositionUpdate: React.MutableRefObject<number>;
  /** Register presence and broadcast listeners on a channel. Call before subscribing. */
  registerPresenceListeners: (channel: RealtimeChannel, sceneRef: React.MutableRefObject<THREE.Scene | null>) => void;
  /** Called when the channel status becomes SUBSCRIBED. Tracks presence and re-syncs. */
  handleChannelSubscribed: (channel: RealtimeChannel, scene: THREE.Scene, camera: THREE.PerspectiveCamera) => Promise<void>;
  /** Set up heartbeat, visibility, and offline cleanup timers. Returns cleanup fn. */
  setupPresenceTimers: () => () => void;
  /** Per-frame presence updates: position broadcast, lerp, proximity, stale detection. */
  tickPresence: (
    delta: number,
    lerpAlpha: number,
    camera: THREE.PerspectiveCamera,
    scene: THREE.Scene,
    channel: RealtimeChannel | null,
    broadcastPos: { x: number; y: number; z: number },
    broadcastRot: { x: number; y: number; z: number },
    moved: boolean,
  ) => void;
  /** Clean up all presence visuals from the scene. */
  cleanupPresenceVisuals: (scene: THREE.Scene) => void;
}

interface UsePresenceOptions {
  currentUser: { id: string; name: string | null; email?: string | null; image?: string | null } | null;
  userEmail: string | undefined | null;
  userImage: string | undefined | null;
  channelRef: React.MutableRefObject<RealtimeChannel | null>;
  channelSubscribedRef: React.MutableRefObject<boolean>;
  myPresenceRef: React.MutableRefObject<PresenceEntry | null>;
  cameraRef: React.MutableRefObject<THREE.PerspectiveCamera | null>;
  cameraModeRef: React.MutableRefObject<CameraMode>;
  playerPositionRef: React.MutableRefObject<THREE.Vector3>;
  playerYawRef: React.MutableRefObject<number>;
  localAvatarAnimationRef: React.MutableRefObject<AvatarAnimationState | null>;
  localBubbleSphereRef: React.MutableRefObject<THREE.Mesh | null>;
  selfMarkerRef: React.MutableRefObject<THREE.Group | null>;
  avatarCustomizationRef: React.MutableRefObject<AvatarCustomization>;
  bubblePrefsRef: React.MutableRefObject<BubblePreferences>;
  jitsiRoomRef: React.MutableRefObject<string | null>;
  is2DModeRef: React.MutableRefObject<boolean>;
  followingUserIdRef: React.MutableRefObject<string | null>;
  setFollowingUserId: (id: string | null) => void;
  handleProximityChange: (nearbyIds: Set<string>) => void;
  recordPositionUpdateRef: React.MutableRefObject<(userId: string) => void>;
}

export function usePresence({
  currentUser,
  userEmail,
  userImage,
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
}: UsePresenceOptions): PresenceHandle {
  const [onlineUsers, setOnlineUsers] = useState<Array<{ id: string; name: string; email: string | null; status: 'active' | 'inactive' | 'offline' }>>([]);

  // Presence refs
  const presenceDataRef = useRef<Map<string, PresenceEntry>>(new Map());
  const avatarsRef = useRef<Map<string, THREE.Group>>(new Map());
  const avatarAnimationsRef = useRef<Map<string, AvatarAnimationState>>(new Map());
  const avatarPrevPositionsRef = useRef<Map<string, THREE.Vector3>>(new Map());
  const avatarTargetsRef = useRef<Map<string, { position: THREE.Vector3; rotationY: number }>>(new Map());
  const bubbleSpheresRef = useRef<Map<string, THREE.Mesh>>(new Map());
  const markers2DRef = useRef<Map<string, THREE.Group>>(new Map());
  const remoteBubblePrefsRef = useRef<Map<string, BubblePreferences>>(new Map());
  const nearbyUserIdsRef = useRef<Set<string>>(new Set());
  const recentlyLeftRef = useRef<Map<string, { id: string; name: string; email: string | null; leftAt: number }>>(new Map());
  const lastSeenAt = useRef<Map<string, number>>(new Map());
  const lastBroadcastPositionRef = useRef<Map<string, { position: THREE.Vector3; rotationY: number; time: number }>>(new Map());
  const pendingAvatarUpdatesRef = useRef<Map<string, AvatarCustomization>>(new Map());
  const lastPositionUpdate = useRef<number>(0);

  // Always-current user ID for presence handlers (avoids stale closure with [] deps)
  const currentUserIdRef = useRef(currentUser?.id);
  currentUserIdRef.current = currentUser?.id;

  // Stale detection state (closure-captured by tickPresence)
  const lastStaleCheckRef = useRef(0);
  // Track previous jitsiRoom state to detect prewarm re-entry and force proximity re-check
  const prevJitsiRoomRef = useRef<string | null>(jitsiRoomRef.current);
  const STALE_THRESHOLD_MS = 15_000;

  const rebuildOnlineUsers = useCallback(() => {
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
  }, []);

  const registerPresenceListeners = useCallback((channel: RealtimeChannel, sceneRef: React.MutableRefObject<THREE.Scene | null>) => {
    // Use latest broadcast position when creating avatars to avoid teleport glitches
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

    const createAvatarAndSphere = (presence: PresenceEntry) => {
      const scene = sceneRef.current;
      if (!scene) return;
      const fresh = freshPositionData(presence);
      const pending = pendingAvatarUpdatesRef.current.get(presence.id);
      const avatar = createAvatar(scene, pending ? { ...fresh, customization: pending } : fresh, (animState) => {
        if (animState) avatarAnimationsRef.current.set(presence.id, animState);
      });
      avatarsRef.current.set(presence.id, avatar);
      if (pending) pendingAvatarUpdatesRef.current.delete(presence.id);
      const rPrefs = remoteBubblePrefsRef.current.get(presence.id);
      const sphere = createBubbleSphere(
        scene,
        rPrefs?.radius ?? bubblePrefsRef.current.radius,
        rPrefs ? hexStringToInt(rPrefs.idleColor) : hexStringToInt(bubblePrefsRef.current.idleColor),
      );
      sphere.position.copy(avatar.position);
      bubbleSpheresRef.current.set(presence.id, sphere);
      // 2D top-down map marker
      const marker2D = create2DMarker(scene, {
        id: presence.id,
        name: presence.name,
        customization: (pending ?? fresh.customization) as AvatarCustomization | undefined,
      });
      marker2D.position.set(avatar.position.x, 0, avatar.position.z);
      markers2DRef.current.set(presence.id, marker2D);
      if (fresh.position && !avatarTargetsRef.current.has(presence.id)) {
        avatarTargetsRef.current.set(presence.id, {
          position: new THREE.Vector3(fresh.position.x, 0, fresh.position.z),
          rotationY: fresh.rotation?.y ?? 0,
        });
        lastSeenAt.current.set(presence.id, Date.now());
      }
    };

    const removeAvatarAndSphere = (id: string) => {
      const scene = sceneRef.current;
      const anim = avatarAnimationsRef.current.get(id);
      if (anim) { anim.mixer.stopAllAction(); avatarAnimationsRef.current.delete(id); }
      avatarPrevPositionsRef.current.delete(id);
      const avatar = avatarsRef.current.get(id);
      if (avatar && scene) scene.remove(avatar);
      avatarsRef.current.delete(id);
      avatarTargetsRef.current.delete(id);
      lastSeenAt.current.delete(id);
      const sphere = bubbleSpheresRef.current.get(id);
      if (sphere && scene) { scene.remove(sphere); bubbleSpheresRef.current.delete(id); }
      const marker2D = markers2DRef.current.get(id);
      if (marker2D && scene) { scene.remove(marker2D); markers2DRef.current.delete(id); }
      presenceDataRef.current.delete(id);
    };

    // Presence: sync existing users
    channel.on('presence', { event: 'sync' }, () => {
      const state = channel.presenceState<PresenceEntry>();
      const presentIds = new Set<string>();
      const myId = currentUserIdRef.current;

      Object.values(state).forEach((presences) => {
        presences.forEach((presence) => {
          presentIds.add(presence.id);
          presenceDataRef.current.set(presence.id, presence);
          recentlyLeftRef.current.delete(presence.id);
          if (presence.id !== myId && !avatarsRef.current.has(presence.id)) {
            createAvatarAndSphere(presence);
          }
        });
      });

      // Remove avatars for users who left
      avatarsRef.current.forEach((_avatar, id) => {
        if (!presentIds.has(id)) {
          removeAvatarAndSphere(id);
        }
      });

      rebuildOnlineUsers();
    });

    // Presence: user joined
    channel.on('presence', { event: 'join' }, ({ newPresences }) => {
      const myId = currentUserIdRef.current;
      newPresences.forEach((presence) => {
        const p = presence as unknown as PresenceEntry;
        presenceDataRef.current.set(p.id, p);
        recentlyLeftRef.current.delete(p.id);
        if (p.id !== myId && !avatarsRef.current.has(p.id)) {
          createAvatarAndSphere(p);
        }
      });
      rebuildOnlineUsers();
    });

    // Presence: user left
    channel.on('presence', { event: 'leave' }, ({ leftPresences }) => {
      const scene = sceneRef.current;
      leftPresences.forEach((presence) => {
        const p = presence as unknown as PresenceEntry;
        if (followingUserIdRef.current === p.id) setFollowingUserId(null);
        const anim = avatarAnimationsRef.current.get(p.id);
        if (anim) { anim.mixer.stopAllAction(); avatarAnimationsRef.current.delete(p.id); }
        avatarPrevPositionsRef.current.delete(p.id);
        const avatar = avatarsRef.current.get(p.id);
        if (avatar) { if (scene) scene.remove(avatar); avatarsRef.current.delete(p.id); }
        const sphere = bubbleSpheresRef.current.get(p.id);
        if (sphere) { if (scene) scene.remove(sphere); bubbleSpheresRef.current.delete(p.id); }
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

    // Broadcast: position updates
    channel.on('broadcast', { event: 'position' }, ({ payload }) => {
      const { userId, position, rotation } = payload as {
        userId: string;
        position: { x: number; y: number; z: number };
        rotation: { x: number; y: number; z: number };
      };
      recordPositionUpdateRef.current(userId);

      // Always cache position data, even for users not yet in presenceData.
      // This prevents a race where broadcasts arrive before the 'join' event,
      // so freshPositionData() can use the latest position when the avatar is created.
      const newPos = new THREE.Vector3(position.x, 0, position.z);
      lastSeenAt.current.set(userId, Date.now());
      lastBroadcastPositionRef.current.set(userId, {
        position: newPos.clone(),
        rotationY: rotation.y,
        time: Date.now(),
      });

      if (presenceDataRef.current.has(userId)) {
        const existing = avatarTargetsRef.current.get(userId);
        if (!existing || existing.position.distanceToSquared(newPos) > 0.0001
            || Math.abs(existing.rotationY - rotation.y) > 0.01) {
          if (!existing) {
            const avatar = avatarsRef.current.get(userId);
            if (avatar) avatar.position.copy(newPos);
          }
          avatarTargetsRef.current.set(userId, {
            position: newPos,
            rotationY: rotation.y,
          });
        }

        // When tab is hidden, run proximity check here
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
      const scene = sceneRef.current;
      const { userId, customization } = payload as { userId: string; customization: AvatarCustomization };
      const existingAvatar = avatarsRef.current.get(userId);
      if (existingAvatar && scene) {
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
      } else if (!existingAvatar) {
        pendingAvatarUpdatesRef.current.set(userId, customization);
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
  }, []);

  const handleChannelSubscribed = useCallback(async (channel: RealtimeChannel, scene: THREE.Scene, camera: THREE.PerspectiveCamera) => {
    const myId = currentUser?.id;
    if (!myId) return;

    const currentStatus = document.visibilityState === 'visible' ? 'active' : 'inactive';
    const presence: PresenceEntry = myPresenceRef.current
      ? { ...myPresenceRef.current, status: currentStatus }
      : {
          id: myId,
          name: currentUser.name || 'User',
          email: userEmail ?? null,
          image: userImage || null,
          position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
          rotation: { x: camera.rotation.x, y: camera.rotation.y, z: camera.rotation.z },
          customization: avatarCustomizationRef.current,
          jitsiRoom: null,
          status: currentStatus,
        };
    myPresenceRef.current = presence;
    await channel.track(presence);

    // Broadcast bubble preferences
    channel.send({
      type: 'broadcast', event: 'bubble-prefs',
      payload: { userId: myId, prefs: bubblePrefsRef.current },
    });

    // Re-sync presence state
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

    const state = channel.presenceState<PresenceEntry>();
    const presentIds = new Set<string>();
    Object.values(state).forEach((presences) => {
      presences.forEach((p) => {
        presentIds.add(p.id);
        presenceDataRef.current.set(p.id, p);
        recentlyLeftRef.current.delete(p.id);
        if (p.id !== myId && !avatarsRef.current.has(p.id)) {
          const fresh = freshPositionData(p);
          const avatar = createAvatar(scene, fresh, (animState) => {
            if (animState) avatarAnimationsRef.current.set(p.id, animState);
          });
          avatarsRef.current.set(p.id, avatar);
          const rPrefs = remoteBubblePrefsRef.current.get(p.id);
          const sphere = createBubbleSphere(
            scene,
            rPrefs?.radius ?? bubblePrefsRef.current.radius,
            rPrefs ? hexStringToInt(rPrefs.idleColor) : hexStringToInt(bubblePrefsRef.current.idleColor),
          );
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
  }, [currentUser?.id, userEmail, userImage]);

  const setupPresenceTimers = useCallback((): (() => void) => {
    const myId = currentUser?.id;

    // Tab visibility — update presence status
    const handleVisibilityChange = () => {
      if (!channelRef.current || !myPresenceRef.current || !channelSubscribedRef.current) return;
      const newStatus: 'active' | 'inactive' = document.visibilityState === 'visible' ? 'active' : 'inactive';
      const updated = { ...myPresenceRef.current, status: newStatus };
      myPresenceRef.current = updated;
      channelRef.current.track(updated);
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Position heartbeat — keeps position broadcast alive even in background tabs.
    // We only use broadcast (not presence track) for position updates because calling
    // channel.track() with changed position data causes Supabase to emit a
    // presence_diff with leave (old state) + join (new state) for the same user,
    // producing spurious join/leave events every ~12 s even when alone in the room.
    const positionHeartbeatInterval = setInterval(() => {
      if (!channelRef.current || !channelSubscribedRef.current || !cameraRef.current || !myId) return;
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
        payload: { userId: myId, position: hbPos, rotation: hbRot },
      });
      lastPositionUpdate.current = Date.now();
      if (myPresenceRef.current) {
        myPresenceRef.current = { ...myPresenceRef.current, position: hbPos, rotation: hbRot };
      }
    }, 2000);

    // Clean up recently-left (offline) users after 15s
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

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      clearInterval(positionHeartbeatInterval);
      clearInterval(offlineCleanupInterval);
    };
  }, [currentUser?.id]);

  const tickPresence = useCallback((
    delta: number,
    lerpAlpha: number,
    camera: THREE.PerspectiveCamera,
    scene: THREE.Scene,
    channel: RealtimeChannel | null,
    broadcastPos: { x: number; y: number; z: number },
    broadcastRot: { x: number; y: number; z: number },
    moved: boolean,
  ) => {
    const myId = currentUser?.id;
    const now = Date.now();

    // When jitsiRoom transitions from proximity → prewarm (null), reset nearbyUserIdsRef so
    // the proximity delta-check fires on the next frame even if the nearby set hasn't changed.
    // Without this, handleProximityChange({B_id}) is never called after a leave+rejoin because
    // nearbyUserIdsRef.current still holds the old set and setChanged stays false.
    const wasInRoom = prevJitsiRoomRef.current !== null;
    const isInRoom = jitsiRoomRef.current !== null;
    if (wasInRoom && !isInRoom) {
      nearbyUserIdsRef.current = new Set();
    }
    prevJitsiRoomRef.current = jitsiRoomRef.current;

    // Send position when moving (60ms throttle)
    const shouldSend = channelRef.current && channelSubscribedRef.current &&
      moved && now - lastPositionUpdate.current > 60;
    if (shouldSend && myId) {
      channelRef.current!.send({
        type: 'broadcast',
        event: 'position',
        payload: { userId: myId, position: broadcastPos, rotation: broadcastRot },
      });
      lastPositionUpdate.current = now;
      if (myPresenceRef.current) {
        myPresenceRef.current = {
          ...myPresenceRef.current,
          position: broadcastPos,
          rotation: broadcastRot,
        };
      }
    }

    // Update local bubble sphere position
    if (localBubbleSphereRef.current) {
      localBubbleSphereRef.current.position.set(broadcastPos.x, broadcastPos.y, broadcastPos.z);
    }

    // Smoothly interpolate remote avatars
    avatarTargetsRef.current.forEach((target, uid) => {
      const avatar = avatarsRef.current.get(uid);
      if (avatar) {
        avatar.position.lerp(target.position, lerpAlpha);
        let dy = target.rotationY - avatar.rotation.y;
        if (dy > Math.PI) dy -= Math.PI * 2;
        if (dy < -Math.PI) dy += Math.PI * 2;
        avatar.rotation.y += dy * lerpAlpha;

        // Eye tracking toward local camera
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

    // Update remote bubble sphere and 2D marker positions, detect proximity
    const newNearby = new Set<string>();
    avatarTargetsRef.current.forEach((target, uid) => {
      const sphere = bubbleSpheresRef.current.get(uid);
      const avatar = avatarsRef.current.get(uid);
      if (avatar && sphere) {
        sphere.position.copy(avatar.position);
      }
      // Sync 2D marker to avatar position and rotation
      const marker2D = markers2DRef.current.get(uid);
      if (marker2D && avatar) {
        marker2D.position.set(avatar.position.x, 0, avatar.position.z);
        marker2D.rotation.y = avatar.rotation.y;
      }
      const dx = broadcastPos.x - target.position.x;
      const dz = broadcastPos.z - target.position.z;
      if (Math.sqrt(dx * dx + dz * dz) < bubblePrefsRef.current.radius * 2) {
        newNearby.add(uid);
      }
    });

    // Update sphere colors: green when in voice call, idle color otherwise
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

    // Stale user detection (every 5s)
    if (now - lastStaleCheckRef.current > 5000) {
      lastStaleCheckRef.current = now;
      lastSeenAt.current.forEach((t, uid) => {
        if (now - t > STALE_THRESHOLD_MS) {
          lastSeenAt.current.delete(uid);

          const presenceState = channel?.presenceState<PresenceEntry>() ?? {};
          const stillPresent = Object.values(presenceState).some(presences =>
            presences.some(p => p.id === uid)
          );

          if (stillPresent) {
            if (followingUserIdRef.current !== uid) {
              avatarTargetsRef.current.delete(uid);
            }
          } else {
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
            const staleMarker2D = markers2DRef.current.get(uid);
            if (staleMarker2D) { scene.remove(staleMarker2D); markers2DRef.current.delete(uid); }
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

    // Toggle 3D/2D name tags and 2D markers on remote avatars
    const in2D = is2DModeRef.current;
    avatarsRef.current.forEach(avatar => {
      avatar.traverse(child => {
        if (child.userData.nameTagType === '3d') child.visible = !in2D;
        if (child.userData.nameTagType === '2d') child.visible = in2D;
      });
    });
    markers2DRef.current.forEach(marker => { marker.visible = in2D; });

    // Update self marker position and visibility
    if (selfMarkerRef.current) {
      selfMarkerRef.current.position.set(broadcastPos.x, 0, broadcastPos.z);
      selfMarkerRef.current.visible = in2D;
    }
  }, [currentUser?.id]);

  const cleanupPresenceVisuals = useCallback((scene: THREE.Scene) => {
    avatarAnimationsRef.current.forEach((anim) => { anim.mixer.stopAllAction(); });
    avatarAnimationsRef.current.clear();
    avatarPrevPositionsRef.current.clear();
    avatarsRef.current.forEach((avatar) => scene.remove(avatar));
    avatarsRef.current.clear();
    avatarTargetsRef.current.clear();
    bubbleSpheresRef.current.forEach((sphere) => scene.remove(sphere));
    bubbleSpheresRef.current.clear();
    markers2DRef.current.forEach((marker) => scene.remove(marker));
    markers2DRef.current.clear();
    presenceDataRef.current.clear();
    lastSeenAt.current.clear();
    nearbyUserIdsRef.current = new Set();
  }, []);

  return {
    onlineUsers,
    presenceDataRef,
    avatarsRef,
    avatarAnimationsRef,
    avatarPrevPositionsRef,
    avatarTargetsRef,
    bubbleSpheresRef,
    remoteBubblePrefsRef,
    nearbyUserIdsRef,
    pendingAvatarUpdatesRef,
    lastPositionUpdate,
    registerPresenceListeners,
    handleChannelSubscribed,
    setupPresenceTimers,
    tickPresence,
    cleanupPresenceVisuals,
  };
}
