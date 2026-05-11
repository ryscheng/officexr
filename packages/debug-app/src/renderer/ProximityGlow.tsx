import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import type { Bus, OfficeState, PlayerId, Store } from '@officexr/sdk';
import { PairTracker, type MeetingArea } from '@officexr/sdk';
import { extrapolatePos } from './Players.tsx';
import type { CameraMode } from './config.ts';
import { BubbleParticles, radialTexture } from './proximity/BubbleParticles.tsx';

interface ProximityGlowProps {
  store: Store;
  bus: Bus;
  selfId: PlayerId;
  /** Visual size of the per-player disc on the ground (shown for
   * `entering` and `exiting` states only). */
  discRadius: number;
  /** Outer radius of the per-player disc on the ground. */
  outerRadius: number;
  /** Pulses per second while pulsing. */
  pulseSpeed: number;
  /** Peak alpha at the bright phase of the pulse / steady. */
  intensity: number;
  /** CSS colour for the entering state (peer in outer band, no contact yet). */
  enteringColor: string;
  /** CSS colour for the entered state (member of a MeetingArea). */
  enteredColor: string;
  /** CSS colour for the exiting state (peer left inner, still in outer; voice still on). */
  exitingColor: string;
  /** Distance (m) *inside* the MeetingArea edge at which the
   * perimeter bubble annulus starts. */
  meetingBorderInset: number;
  /** Distance (m) *outside* the MeetingArea edge at which the
   * perimeter bubble annulus ends. The two offsets together define
   * the annulus thickness; small offsets give a thin ring of
   * bubbles, larger offsets a wider band. */
  meetingBorderOutset: number;
  /** Speed multiplier for the bubble-rise animation. */
  sparkleSpeed: number;
  /** Maximum height (m) bubbles rise to before wrapping back down to
   * the floor. */
  sparkleFloatHeight: number;
  /** User-tunable extra multiplier on per-particle size for both the
   * per-player approach bubbles and the MeetingArea perimeter
   * bubbles. Layered on top of the automatic camera-mode multiplier
   * (fixed mode bumps sizes ~5× by default because the camera sits
   * far above the floor and stock sizes would render as sub-pixel
   * dots). */
  sparkleSize: number;
  /** Current camera mode. Used to derive the automatic sparkle size
   * multiplier — `fixed` is treated as "camera far away" so particles
   * are enlarged to stay visible. */
  cameraMode: CameraMode;
  /** Mutated each frame with the local player's current MeetingArea
   * centroid (lifted to local-player y), or set to null when the
   * local player is not in a conversation. CameraRig reads this ref
   * to drive the conversation-view camera blend. */
  conversationFocusRef: React.MutableRefObject<{ x: number; y: number; z: number } | null>;
}

interface DiscRegistration {
  mesh: THREE.Mesh;
  material: THREE.MeshBasicMaterial;
}

/**
 * Conversation glow + approach sparkles, driven by the position-based
 * `PairTracker` from `@officexr/sdk/spatial`.
 *
 * Visual layout:
 *   - `entering` players (approaching the outer ring of a peer): a
 *     per-player ground disc in the entering colour, with a ring of
 *     slow-floating bubble Sparkles around the approaching player and
 *     the peer they're approaching. Self-involved only — peer↔peer
 *     entering pairs are not rendered to avoid bystander clutter.
 *   - `entered` players (members of a MeetingArea): the per-player disc
 *     is HIDDEN. Instead the MeetingArea itself renders as a single
 *     larger glowing disc covering all members, with an active ring of
 *     sparkles on the outer perimeter. Both visuals (the full-area
 *     glow and the thin perimeter band) replace the per-player disc.
 *   - `exiting` players (ejected from a MeetingArea): per-player disc
 *     re-appears in the exiting colour as the member fades out of the
 *     conversation.
 *
 * The MeetingArea perimeter sparkles are faster than the approach
 * sparkles (controlled by `meetingBorderActivity`) and live in a thin
 * band whose width is `meetingBorderThickness`.
 */
export function ProximityGlow({
  store,
  bus,
  selfId,
  discRadius,
  outerRadius,
  pulseSpeed,
  intensity,
  enteringColor,
  enteredColor,
  exitingColor,
  meetingBorderInset,
  meetingBorderOutset,
  sparkleSpeed,
  sparkleFloatHeight,
  sparkleSize,
  cameraMode,
  conversationFocusRef,
}: ProximityGlowProps) {
  // Effective per-particle size multiplier — camera-mode auto-bump
  // ×ed with the Leva tunable. `fixed` is overhead-default so stock
  // drei sizes vanish from camera distance; the 5× makes them
  // readable. User can crank `sparkleSize` for additional bias.
  const sparkleSizeMul =
    sparkleSize * (cameraMode === 'fixed' ? 5 : 1);
  const initialIds = useMemo(
    () => Object.keys(store.getState().players),
    [store],
  );
  const [playerIds, setPlayerIds] = useState<string[]>(initialIds);

  useEffect(() => {
    return store.subscribeAll((next: OfficeState, prev: OfficeState) => {
      const a = Object.keys(next.players);
      const b = Object.keys(prev.players);
      if (a.length === b.length && a.every((id, i) => id === b[i])) return;
      setPlayerIds(a);
    });
  }, [store]);

  // Single source-of-truth tracker.
  const tracker = useMemo(() => new PairTracker(), []);
  // Players that should show approach sparkles this frame (self-involved
  // `entering` pairs).
  const sparklingIds = useRef<Set<PlayerId>>(new Set());
  const [sparklingVersion, setSparklingVersion] = useState(0);

  // Live MeetingArea registry exposed as state for the area renderer.
  const [areaSnapshot, setAreaSnapshot] = useState<MeetingArea[]>([]);
  const areaSnapshotKey = useRef<string>('');

  const registry = useRef<Map<string, DiscRegistration>>(new Map());
  const currentI = useRef<Map<string, number>>(new Map());
  const enteringC = useMemo(() => new THREE.Color(enteringColor), [enteringColor]);
  const enteredC = useMemo(() => new THREE.Color(enteredColor), [enteredColor]);
  const exitingC = useMemo(() => new THREE.Color(exitingColor), [exitingColor]);

  const register = useCallback(
    (id: string, entry: DiscRegistration | null) => {
      if (entry) registry.current.set(id, entry);
      else registry.current.delete(id);
    },
    [],
  );

  // Per-area Three.js handles, registered by each MeetingAreaFx
  // instance via callbacks. ProximityGlow's `useFrame` (this one)
  // drives all per-frame updates on these refs directly — that
  // pattern survives React StrictMode's mount-unmount-remount cycle
  // cleanly (R3F's per-component `useFrame` re-registration was
  // flaky after the strict-mode bounce, leaving area discs stuck at
  // opacity 0 / radius 1 / origin position).
  const areaGroupRefs = useRef<Map<string, THREE.Group>>(new Map());
  const areaDiscRefs = useRef<Map<string, THREE.Mesh>>(new Map());
  const areaMatRefs = useRef<Map<string, THREE.MeshBasicMaterial>>(new Map());
  const areaRadiusOuts = useRef<Map<string, React.MutableRefObject<number>>>(
    new Map(),
  );
  /** Smoothed radius per area for visual continuity across frames. */
  const areaRadiusEased = useRef<Map<string, number>>(new Map());
  const areaOpacity = useRef<Map<string, number>>(new Map());

  const tmpVec = useMemo(() => new THREE.Vector3(), []);

  useFrame((state, dt) => {
    const t = state.clock.getElapsedTime();
    const now = performance.now();
    const pulse = 0.5 + 0.5 * Math.sin(t * pulseSpeed * Math.PI * 2);
    const officeState = store.getState();
    const players = officeState.players;
    const ws = officeState.worldSettings;

    // Advance the tracker. Emits bus events itself.
    const out = tracker.tick(players, {
      selfId,
      bus,
      charRadius: ws.charRadius,
      proximityRadius: ws.proximityRadius,
      proximityOuterRadius: ws.proximityOuterRadius,
      enterDebounceMs: ws.proximityEnterDebounceMs,
      nowMs: now,
      dtSec: dt,
    });

    // Update conversation focus ref for the camera.
    const selfPlayer = players[selfId];
    if (out.conversationFocus && selfPlayer) {
      conversationFocusRef.current = {
        x: out.conversationFocus.x,
        y: selfPlayer.pos.y,
        z: out.conversationFocus.z,
      };
    } else {
      conversationFocusRef.current = null;
    }

    // Sparkles around individual players: only for self-involved
    // `entering` pairs. Both ends of the approach light up.
    const nextSparkles = new Set<PlayerId>();
    for (const [key, st] of out.pairStates) {
      if (st !== 'entering') continue;
      const [a, b] = key.split('|') as [PlayerId, PlayerId];
      if (a === selfId) {
        nextSparkles.add(selfId);
        nextSparkles.add(b);
      } else if (b === selfId) {
        nextSparkles.add(selfId);
        nextSparkles.add(a);
      }
    }
    if (!sameSet(sparklingIds.current, nextSparkles)) {
      sparklingIds.current = nextSparkles;
      setSparklingVersion((v) => v + 1);
    }

    // Per-player disc positions / colors. NOTE: `entered` players have
    // their personal disc hidden (the MeetingArea visual covers them),
    // so we force opacity to fade out for those.
    for (const [id, p] of Object.entries(players)) {
      const reg = registry.current.get(id);
      if (!reg) continue;
      const renderPos = extrapolatePos(p, now, tmpVec);
      reg.mesh.position.set(renderPos.x, p.pos.y + 0.15, renderPos.z);

      const discState = out.playerStates.get(id) ?? null;
      // Suppress the per-player disc when the player is currently a
      // member of a MeetingArea — the area's full-surface glow takes
      // over their visual.
      const inMeetingArea = discState === 'entered';
      const isPulsing = discState === 'entering' || discState === 'exiting';
      const target = inMeetingArea
        ? 0
        : isPulsing
          ? intensity * pulse
          : 0;
      const prev = currentI.current.get(id) ?? 0;
      const next = prev + (target - prev) * Math.min(1, 6 * dt);
      currentI.current.set(id, next);
      reg.material.opacity = next;

      const targetColor =
        discState === 'exiting' ? exitingC : enteringC;
      reg.material.color.copy(targetColor);
    }

    // MeetingArea per-frame imperative updates. We position the group
    // at the area centroid, scale the disc to the eased radius,
    // ramp the material opacity, and publish the live radius into
    // the area's radiusRef so its `<BubbleParticles>` ring tracks
    // the dynamic annulus.
    const seenIds = new Set<string>();
    const y = (selfPlayer?.pos.y ?? 0) + 0.15;
    for (const area of out.areas) {
      seenIds.add(area.id);
      // Ease the visible radius for smoothness if the underlying
      // ratchet jumped (e.g. new member just admitted).
      const curR = areaRadiusEased.current.get(area.id) ?? area.radius;
      const easedR = curR + (area.radius - curR) * Math.min(1, 6 * dt);
      areaRadiusEased.current.set(area.id, easedR);
      // Steady-glow at `intensity * 0.85` (a touch dimmer than full
      // per-player disc so the area reads as ambient light, not a
      // sharp spotlight).
      const curOp = areaOpacity.current.get(area.id) ?? 0;
      const easedOp =
        curOp + (intensity * 0.85 - curOp) * Math.min(1, 6 * dt);
      areaOpacity.current.set(area.id, easedOp);
      // Apply transforms to the registered Three.js handles.
      const grp = areaGroupRefs.current.get(area.id);
      const disc = areaDiscRefs.current.get(area.id);
      const mat = areaMatRefs.current.get(area.id);
      const rRef = areaRadiusOuts.current.get(area.id);
      if (grp) grp.position.set(area.center.x, y, area.center.z);
      if (disc) disc.scale.set(easedR, easedR, 1);
      if (mat) mat.opacity = easedOp;
      if (rRef) rRef.current = easedR;
    }
    // Forget per-area state for areas that no longer exist.
    for (const id of [...areaRadiusEased.current.keys()]) {
      if (!seenIds.has(id)) areaRadiusEased.current.delete(id);
    }
    for (const id of [...areaOpacity.current.keys()]) {
      if (!seenIds.has(id)) areaOpacity.current.delete(id);
    }

    // Reconcile the React-rendered list of areas with the tracker's
    // live registry. Only re-render when the membership SET changes
    // (id, members) — we don't trigger renders for per-frame
    // centre/radius updates because those are pushed into refs above.
    const key = areaListKey(out.areas);
    if (key !== areaSnapshotKey.current) {
      areaSnapshotKey.current = key;
      setAreaSnapshot(out.areas.map(cloneArea));
    }
  });

  return (
    <>
      {playerIds.map((id) => (
        <PlayerProximityFx
          key={id}
          id={id}
          radius={discRadius}
          register={register}
          sparkling={sparklingIds.current.has(id)}
          version={sparklingVersion}
          enteringColor={enteringColor}
          sparkleSizeMul={sparkleSizeMul}
          borderInset={meetingBorderInset}
          borderOutset={meetingBorderOutset}
          sparkleSpeed={sparkleSpeed}
          sparkleFloatHeight={sparkleFloatHeight}
          store={store}
          playerId={id}
        />
      ))}
      {areaSnapshot.map((a) => (
        <MeetingAreaFx
          key={a.id}
          id={a.id}
          color={enteredColor}
          borderInset={meetingBorderInset}
          borderOutset={meetingBorderOutset}
          sparkleSpeed={sparkleSpeed}
          sparkleFloatHeight={sparkleFloatHeight}
          sparkleSizeMul={sparkleSizeMul}
          registerGroup={(g) => {
            if (g) areaGroupRefs.current.set(a.id, g);
            else areaGroupRefs.current.delete(a.id);
          }}
          registerMesh={(m) => {
            if (m) areaDiscRefs.current.set(a.id, m);
            else areaDiscRefs.current.delete(a.id);
          }}
          registerMat={(m) => {
            if (m) areaMatRefs.current.set(a.id, m);
            else areaMatRefs.current.delete(a.id);
          }}
          registerRadiusRef={(r) => {
            if (r) areaRadiusOuts.current.set(a.id, r);
            else areaRadiusOuts.current.delete(a.id);
          }}
        />
      ))}
    </>
  );
}

interface PlayerProximityFxProps {
  id: string;
  radius: number;
  register: (id: string, entry: DiscRegistration | null) => void;
  sparkling: boolean;
  version: number;
    /** Distance (m) the bubble annulus extends *inside* the area edge. */
  borderInset: number;
  /** Distance (m) the bubble annulus extends *outside* the area edge. */
  borderOutset: number;
  enteringColor: string;
  /** Combined Leva × camera-mode size multiplier for the approach
   * bubbles. */
  sparkleSizeMul: number;
  /** Float-rise speed multiplier (Leva). */
  sparkleSpeed: number;
  /** Maximum height the bubbles rise to before wrapping back down. */
  sparkleFloatHeight: number;
  store: Store;
  playerId: PlayerId;
}

/** One player's proximity FX: ground disc + (conditional) approach
 * bubbles rising from the player's feet. */
function PlayerProximityFx({
  id,
  radius,
  register,
  sparkling,
  enteringColor,
  sparkleSizeMul,
  sparkleSpeed,
  sparkleFloatHeight,
  store,
  playerId,
  borderInset,
  borderOutset,
}: PlayerProximityFxProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.MeshBasicMaterial>(null);
  const groupRef = useRef<THREE.Group>(null);

  useEffect(() => {
    if (meshRef.current && matRef.current) {
      register(id, { mesh: meshRef.current, material: matRef.current });
    }
    return () => register(id, null);
  }, [id, register]);

  // The bubble group has to track the player too.
  const tmpVec = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    if (!groupRef.current) return;
    const p = store.getState().players[playerId];
    if (!p) return;
    const now = performance.now();
    const rp = extrapolatePos(p, now, tmpVec);
    groupRef.current.position.set(rp.x, p.pos.y, rp.z);
  });

  return (
    <>
      <mesh
        ref={meshRef}
        rotation={[-Math.PI / 2, 0, 0]}
        renderOrder={2}
      >
        <circleGeometry args={[radius, 64]} />
        <meshBasicMaterial
          ref={matRef}
          map={radialTexture}
          color={0xffffff}
          transparent
          opacity={0}
          depthWrite={false}
          side={THREE.DoubleSide}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </mesh>
      <group ref={groupRef}>
        {sparkling && (
          <BubbleParticles
            count={120}
            color={enteringColor}
            sizeMul={sparkleSizeMul}
            speedMul={sparkleSpeed}
            floatHeight={sparkleFloatHeight}
            layout="disc"
            innerRadius={0}
            outerRadius={radius}
            innerOffset={borderInset}
            outerOffset={borderOutset}
          />
        )}
      </group>
    </>
  );
}

interface MeetingAreaFxProps {
  id: string;
  color: string;
  /** Distance (m) the bubble annulus extends *inside* the area edge. */
  borderInset: number;
  /** Distance (m) the bubble annulus extends *outside* the area edge. */
  borderOutset: number;
  /** Bubble rise speed multiplier (Leva). */
  sparkleSpeed: number;
  /** Maximum height the bubbles rise to before wrapping. */
  sparkleFloatHeight: number;
  /** Combined Leva × camera-mode size multiplier for the perimeter
   * bubbles. */
  sparkleSizeMul: number;
  /** Callbacks ProximityGlow uses to register each area's three3
   * THREE.js handles (group + disc mesh + disc material). PG's own
   * `useFrame` drives the position / scale / opacity each frame —
   * doing it that way (instead of MeetingAreaFx owning its own
   * `useFrame`) sidesteps a R3F + React StrictMode interaction
   * where the per-component frame callback doesn't re-register after
   * the mount-unmount-remount cycle. The parent `<ProximityGlow>`
   * mounts once and its `useFrame` is stable. */
  registerGroup: (g: THREE.Group | null) => void;
  registerMesh: (m: THREE.Mesh | null) => void;
  registerMat: (m: THREE.MeshBasicMaterial | null) => void;
  registerRadiusRef: (ref: React.MutableRefObject<number> | null) => void;
}

/**
 * Visualises one MeetingArea: a full-surface ground glow + a thin
 * annulus of bubbles rising vertically around the perimeter.
 *
 * Position, disc scale, opacity, and the live radius shared with the
 * bubble annulus are all driven imperatively each frame from the
 * area's `live` ref (published by ProximityGlow). React doesn't
 * re-render for per-frame centre / radius drift.
 */
function MeetingAreaFx({
  id: _id,
  color,
  borderInset,
  borderOutset,
  sparkleSpeed,
  sparkleFloatHeight,
  sparkleSizeMul,
  registerGroup,
  registerMesh,
  registerMat,
  registerRadiusRef,
}: MeetingAreaFxProps) {
  const groupRef = useRef<THREE.Group>(null);
  const discRef = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.MeshBasicMaterial>(null);
  // The live area radius is published into this ref each frame so
  // `BubbleParticles` (which lives as a sibling, NOT inside the
  // scaled disc) can read it and place its particles on the
  // dynamically-sized annulus.
  const radiusRef = useRef(1);

  useEffect(() => {
    registerGroup(groupRef.current);
    registerMesh(discRef.current);
    registerMat(matRef.current);
    registerRadiusRef(radiusRef);
    return () => {
      registerGroup(null);
      registerMesh(null);
      registerMat(null);
      registerRadiusRef(null);
    };
  }, [registerGroup, registerMesh, registerMat, registerRadiusRef]);

  return (
    <group ref={groupRef}>
      <mesh ref={discRef} rotation={[-Math.PI / 2, 0, 0]} renderOrder={2}>
        <circleGeometry args={[1, 96]} />
        <meshBasicMaterial
          ref={matRef}
          map={radialTexture}
          color={color}
          transparent
          opacity={0}
          depthWrite={false}
          side={THREE.DoubleSide}
          blending={THREE.AdditiveBlending}
          toneMapped={false}
        />
      </mesh>
      <BubbleParticles
        count={120}
        color={color}
        sizeMul={sparkleSizeMul}
        speedMul={sparkleSpeed}
        floatHeight={sparkleFloatHeight}
        layout="annulus"
        radiusRef={radiusRef}
        innerOffset={borderInset}
        outerOffset={borderOutset}
      />
    </group>
  );
}

function areaListKey(areas: MeetingArea[]): string {
  // Stable key built from area ids + sorted member lists. Centroid /
  // radius are excluded so per-frame numeric drift doesn't churn
  // React renders.
  const parts: string[] = [];
  for (const a of areas) {
    const members = [...a.members].sort();
    parts.push(`${a.id}:${members.join(',')}`);
  }
  return parts.join('|');
}

function cloneArea(a: MeetingArea): MeetingArea {
  return {
    id: a.id,
    members: new Set(a.members),
    center: { x: a.center.x, z: a.center.z },
    radius: a.radius,
  };
}

function sameSet<T>(a: Set<T>, b: Set<T>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}
