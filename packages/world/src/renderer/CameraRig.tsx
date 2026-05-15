import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useThree, useFrame } from '@react-three/fiber';
import {
  CHAR_HEIGHT_M,
  EYE_HEIGHT,
  FREE_FLY_DEFAULTS,
  TOP_DOWN_CAMERA_DEFAULTS,
  type CameraMode,
} from './config.ts';

const PITCH_MIN = -1.3;
const PITCH_MAX = 1.3;
const MOUSE_SENSITIVITY = 0.0025;
const THIRD_PERSON_RADIUS = 6;

interface CameraRigProps {
  mode: CameraMode;
  /** Provides the local player's world position each frame. */
  playerPosRef: React.RefObject<THREE.Vector3>;
  /** Mutable yaw shared with movement code so WASD is camera-relative. */
  yawRef: React.MutableRefObject<number>;
  pitchRef: React.MutableRefObject<number>;
  /** Set by `ProximityGlow` each frame to the local player's
   * MeetingArea centroid when in a conversation, or `null` otherwise.
   * When non-null, the rig blends in a "conversation view": elevated
   * 3rd-person framing in FP/3P modes, tighter centred leash in
   * fixed mode. The transition is damped (~0.35s τ). */
  conversationFocusRef: React.MutableRefObject<
    { x: number; y: number; z: number } | null
  >;
  /** Horizontal distance (m) from the conversation focus at which the
   * conversation camera sits. Bigger = more zoomed out. Same value
   * is used by all three camera modes for consistency. */
  conversationDistance: number;
  /** Vertical height (m) of the conversation camera above the focus.
   * Combined with `conversationDistance` this implicitly sets the
   * pitch angle of the conversation view via atan(h/d). */
  conversationHeight: number;
  /** Fixed-camera params, updated live from the debug panel. */
  fixed: {
    azimuthDeg: number;
    /** Camera pitch in degrees (negative = looking down). */
    pitchDeg: number;
    /** Camera Y offset above the character. */
    height: number;
    /** Screen-fraction bounds. The actual meter distances are derived each
     * frame from these plus FOV and height — so the leash auto-adjusts when
     * the user changes any of those. Ignored when `distanceM` is set. */
    maxOnScreenFrac: number;
    minOnScreenFrac: number;
    /** Lateral half-width as a fraction of the view's half-width at the far
     * depth. Translates to world units inside the rig. */
    lateralFrac: number;
    fov: number;
    /** Optional direct XZ distance (m) from character to camera. When
     * present, overrides the `maxOnScreenFrac` / `minOnScreenFrac`
     * derivation: the camera is pinned at exactly this distance with
     * zero lateral leash. Used by Mugshot mode to make the framing
     * deterministic across machines (the screen-fraction logic is
     * great for gameplay but makes capture-baseline tests fragile). */
    distanceM?: number;
  };
}

/**
 * Owns the active camera each frame. Three modes:
 *  - first-person: at player eye height, mouse-look (pointer lock)
 *  - third-person: orbits behind player, mouse-look (pointer lock)
 *  - fixed: parked at a configurable azimuth/elevation/distance, looks at player
 */
export function CameraRig({
  mode,
  playerPosRef,
  yawRef,
  pitchRef,
  conversationFocusRef,
  conversationDistance,
  conversationHeight,
  fixed,
}: CameraRigProps) {
  const { camera, gl } = useThree();
  const persp = camera as THREE.PerspectiveCamera;

  // Pointer-lock + mouse-look — only active in first/third person modes.
  useEffect(() => {
    const wantsLook = mode === 'first-person' || mode === 'third-person';
    const canvas = gl.domElement;

    if (!wantsLook) {
      if (document.pointerLockElement === canvas) document.exitPointerLock?.();
      return;
    }

    const onMouseDown = () => {
      if (document.pointerLockElement !== canvas) canvas.requestPointerLock?.();
    };
    const onMouseMove = (e: MouseEvent) => {
      if (document.pointerLockElement !== canvas) return;
      yawRef.current -= e.movementX * MOUSE_SENSITIVITY;
      pitchRef.current -= e.movementY * MOUSE_SENSITIVITY;
      if (pitchRef.current < PITCH_MIN) pitchRef.current = PITCH_MIN;
      if (pitchRef.current > PITCH_MAX) pitchRef.current = PITCH_MAX;
    };

    canvas.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mousemove', onMouseMove);
    return () => {
      canvas.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('mousemove', onMouseMove);
      if (document.pointerLockElement === canvas) document.exitPointerLock?.();
    };
  }, [mode, gl, yawRef, pitchRef]);

  // Keep fixed/top-down/free-fly camera fov in sync. Each mode sets its
  // own default; everything else falls back to the gameplay 75°.
  useEffect(() => {
    if (mode === 'fixed') {
      persp.fov = fixed.fov;
    } else if (mode === 'top-down') {
      persp.fov = TOP_DOWN_CAMERA_DEFAULTS.fov;
    } else if (mode === 'free-fly') {
      persp.fov = FREE_FLY_DEFAULTS.fov;
    } else {
      persp.fov = 75;
    }
    persp.updateProjectionMatrix();
  }, [mode, fixed.fov, persp]);

  const target = useRef(new THREE.Vector3());

  // Conversation-view blend state. `convoMix` damps toward 1 while the
  // local player is in a MeetingArea, toward 0 otherwise. The cached
  // focus survives one extra frame after the local player leaves so the
  // damp toward 0 has a valid position to interpolate FROM. Without
  // this we'd snap the camera the moment focus went null.
  const convoMix = useRef(0);
  const lastFocus = useRef(new THREE.Vector3());

  // True when fixed-mode just became active and the camera position needs to
  // snap to a sensible starting point relative to the character.
  const fixedNeedsInit = useRef(false);

  useEffect(() => {
    if (mode === 'fixed') fixedNeedsInit.current = true;
  }, [mode]);

  // --- Free-fly camera state -------------------------------------
  // Persistent (across frames) state for the free-fly mode. Lives in
  // refs so the WASD step in useFrame can mutate without triggering
  // React re-renders. Initialized once per mount; entering / leaving
  // free-fly mode doesn't reset the user's position so toggling Debug
  // ↔ Scenes preserves where they were exploring.
  const freeFlyKeys = useRef(new Set<string>());
  const freeFlyPos = useRef(new THREE.Vector3(...FREE_FLY_DEFAULTS.position));
  const freeFlyYaw = useRef(FREE_FLY_DEFAULTS.yaw);
  const freeFlyPitch = useRef(FREE_FLY_DEFAULTS.pitch);
  const freeFlyDrag = useRef<{
    active: boolean;
    lastX: number;
    lastY: number;
    /** Optional world-space orbit anchor; when set, drag rotates the
     * camera around this point instead of around its own position. */
    orbitAnchor: THREE.Vector3 | null;
  }>({ active: false, lastX: 0, lastY: 0, orbitAnchor: null });

  useEffect(() => {
    if (mode !== 'free-fly') return;
    const canvas = gl.domElement;

    const onKeyDown = (e: KeyboardEvent) => {
      // Don't capture keys while typing into Leva or any input.
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      freeFlyKeys.current.add(e.code.toLowerCase());
    };
    const onKeyUp = (e: KeyboardEvent) => {
      freeFlyKeys.current.delete(e.code.toLowerCase());
    };

    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      // Raycast against the scene to find an orbit anchor: if the
      // pointer-down hits an InstancedMesh tagged as a cube, orbit
      // around that cube's centre while the drag is held; otherwise
      // rotate around the camera position.
      const rect = canvas.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1,
      );
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(ndc, persp);
      // Walk every InstancedMesh in the scene and grab the closest hit.
      const hits: THREE.Intersection[] = [];
      camera.parent?.traverse((o) => {
        const m = o as THREE.Mesh;
        if (
          (m as unknown as THREE.InstancedMesh).isInstancedMesh &&
          m.userData?.isObjectInstanceMesh
        ) {
          raycaster.intersectObject(m, false, hits);
        }
      });
      hits.sort((a, b) => a.distance - b.distance);
      const anchor = hits.length > 0 ? hits[0].point.clone() : null;
      freeFlyDrag.current = {
        active: true,
        lastX: e.clientX,
        lastY: e.clientY,
        orbitAnchor: anchor,
      };
    };
    const onMouseMove = (e: MouseEvent) => {
      const drag = freeFlyDrag.current;
      if (!drag.active) return;
      const dx = e.clientX - drag.lastX;
      const dy = e.clientY - drag.lastY;
      drag.lastX = e.clientX;
      drag.lastY = e.clientY;
      const sens = FREE_FLY_DEFAULTS.rotateSensitivity;
      if (drag.orbitAnchor) {
        // Orbit: rotate camera position around the anchor by yaw/pitch
        // deltas, then keep aiming at the anchor.
        const anchor = drag.orbitAnchor;
        const offset = freeFlyPos.current.clone().sub(anchor);
        const sphYaw = -dx * sens;
        const sphPitch = -dy * sens;
        // Rotate around world-Y for yaw.
        offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), sphYaw);
        // Rotate around the camera's right axis for pitch (clamp so we
        // can't flip past vertical).
        const right = new THREE.Vector3()
          .crossVectors(new THREE.Vector3(0, 1, 0), offset)
          .normalize();
        const currentPitch = Math.atan2(
          offset.y,
          Math.hypot(offset.x, offset.z),
        );
        const nextPitch = THREE.MathUtils.clamp(
          currentPitch + sphPitch,
          -Math.PI / 2 + 0.1,
          Math.PI / 2 - 0.1,
        );
        const dPitch = nextPitch - currentPitch;
        offset.applyAxisAngle(right, dPitch);
        freeFlyPos.current.copy(anchor).add(offset);
        // Keep yaw/pitch state synchronised so post-orbit WASD continues
        // to move forward "toward" what the user was looking at.
        const fwd = anchor.clone().sub(freeFlyPos.current).normalize();
        freeFlyYaw.current = Math.atan2(-fwd.x, -fwd.z);
        freeFlyPitch.current = Math.asin(fwd.y);
      } else {
        // Free look: rotate around camera position.
        freeFlyYaw.current -= dx * sens;
        freeFlyPitch.current -= dy * sens;
        freeFlyPitch.current = THREE.MathUtils.clamp(
          freeFlyPitch.current,
          PITCH_MIN,
          PITCH_MAX,
        );
      }
    };
    const onMouseUp = (e: MouseEvent) => {
      if (e.button !== 0) return;
      freeFlyDrag.current.active = false;
      freeFlyDrag.current.orbitAnchor = null;
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      // Scroll dolly: positive deltaY = zoom out, negative = zoom in.
      const fwd = new THREE.Vector3(
        -Math.sin(freeFlyYaw.current) * Math.cos(freeFlyPitch.current),
        Math.sin(freeFlyPitch.current),
        -Math.cos(freeFlyYaw.current) * Math.cos(freeFlyPitch.current),
      );
      const step =
        -Math.sign(e.deltaY) *
        FREE_FLY_DEFAULTS.dollySensitivity *
        // Scale by the magnitude so trackpad pinch-zoom feels natural.
        Math.min(8, Math.max(1, Math.abs(e.deltaY) / 50));
      freeFlyPos.current.addScaledVector(fwd, step);
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    canvas.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      canvas.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      canvas.removeEventListener('wheel', onWheel);
      freeFlyKeys.current.clear();
      freeFlyDrag.current.active = false;
    };
  }, [mode, gl, camera, persp]);

  useFrame((_, dtSec) => {
    const pos = playerPosRef.current;
    if (!pos) return;
    const yaw = yawRef.current;
    const pitch = pitchRef.current;

    // Damp the conversation-view blend value toward 1 when the local
    // player is in a MeetingArea, otherwise toward 0. τ ≈ 0.35 s.
    const focus = conversationFocusRef.current;
    if (focus) lastFocus.current.set(focus.x, focus.y, focus.z);
    const targetMix = focus ? 1 : 0;
    convoMix.current = THREE.MathUtils.damp(
      convoMix.current,
      targetMix,
      1 / 0.35,
      dtSec,
    );
    const mix = convoMix.current;
    const useFocus = lastFocus.current; // safe to read even when focus===null

    // Derive an FP/3P conversation-pose radius + pitch from the
    // user-tunable horizontal distance + height. r is the spherical
    // radius of the camera around the focus; convoPitchDown is how
    // far below horizontal the camera looks (in radians). Both are
    // shared by FP/3P modes and used inside the lerp below.
    const convoR = Math.hypot(conversationDistance, conversationHeight);
    const convoPitchDown = Math.atan2(
      conversationHeight,
      Math.max(0.01, conversationDistance),
    );

    if (mode === 'first-person') {
      camera.position.set(pos.x, pos.y + EYE_HEIGHT, pos.z);
      target.current.set(
        pos.x - Math.sin(yaw) * Math.cos(pitch),
        pos.y + EYE_HEIGHT + Math.sin(pitch),
        pos.z - Math.cos(yaw) * Math.cos(pitch),
      );
      camera.lookAt(target.current);

      if (mix > 0.001) {
        // Compute a conversation-target camera position: elevated 3rd
        // person centred on the focus, preserving the user's yaw.
        // Lerp BETWEEN first-person and this conversation target by
        // `mix`.
        const convoPos = computeElevatedThirdPerson(
          useFocus,
          yaw,
          convoR,
          -convoPitchDown,
        );
        camera.position.lerp(convoPos, mix);
        target.current.lerp(useFocus, mix);
        camera.lookAt(target.current);
      }
    } else if (mode === 'third-person') {
      const r = THIRD_PERSON_RADIUS;
      const head = target.current.set(pos.x, pos.y + EYE_HEIGHT, pos.z);
      camera.position.set(
        head.x + Math.sin(yaw) * Math.cos(pitch) * r,
        head.y + Math.sin(pitch) * r,
        head.z + Math.cos(yaw) * Math.cos(pitch) * r,
      );
      camera.lookAt(head);

      if (mix > 0.001) {
        const convoPos = computeElevatedThirdPerson(
          useFocus,
          yaw,
          convoR,
          -convoPitchDown,
        );
        camera.position.lerp(convoPos, mix);
        target.current.lerp(useFocus, mix);
        camera.lookAt(target.current);
      }
    } else if (mode === 'top-down') {
      // Studio's Scene mode: high-altitude orthographic-style framing
      // for editing the WorldMap by clicking cells. Uses the existing
      // perspective camera at ~89° down-pitch and a fixed altitude
      // anchored at world origin (not the player) so the editor view
      // doesn't pan when the player walks.
      const td = TOP_DOWN_CAMERA_DEFAULTS;
      camera.position.set(0, td.height, 0.001); // tiny z so lookAt has a stable up
      target.current.set(0, 0, 0);
      camera.lookAt(target.current);
    } else if (mode === 'free-fly') {
      // Free-fly editor camera: WASD/QE strafes through space; mouse-
      // drag (no pointer lock) rotates the view; scroll dollies in/out.
      // All state lives in the `freeFly*` refs above — this branch
      // just ticks position from the held-key set, then aims the
      // camera using the current yaw/pitch.
      const speedBase = FREE_FLY_DEFAULTS.moveSpeed;
      const speed =
        speedBase *
        (freeFlyKeys.current.has('shiftleft') ||
        freeFlyKeys.current.has('shiftright')
          ? FREE_FLY_DEFAULTS.shiftMultiplier
          : 1);
      const step = speed * dtSec;
      const fwdX = -Math.sin(freeFlyYaw.current) * Math.cos(freeFlyPitch.current);
      const fwdY = Math.sin(freeFlyPitch.current);
      const fwdZ = -Math.cos(freeFlyYaw.current) * Math.cos(freeFlyPitch.current);
      const rightX = Math.cos(freeFlyYaw.current);
      const rightZ = -Math.sin(freeFlyYaw.current);
      const k = freeFlyKeys.current;
      if (k.has('keyw')) {
        freeFlyPos.current.x += fwdX * step;
        freeFlyPos.current.y += fwdY * step;
        freeFlyPos.current.z += fwdZ * step;
      }
      if (k.has('keys')) {
        freeFlyPos.current.x -= fwdX * step;
        freeFlyPos.current.y -= fwdY * step;
        freeFlyPos.current.z -= fwdZ * step;
      }
      if (k.has('keyd')) {
        freeFlyPos.current.x += rightX * step;
        freeFlyPos.current.z += rightZ * step;
      }
      if (k.has('keya')) {
        freeFlyPos.current.x -= rightX * step;
        freeFlyPos.current.z -= rightZ * step;
      }
      if (k.has('keye') || k.has('space')) {
        freeFlyPos.current.y += step;
      }
      if (k.has('keyq') || k.has('controlleft') || k.has('controlright')) {
        freeFlyPos.current.y -= step;
      }
      camera.position.copy(freeFlyPos.current);
      target.current.set(
        freeFlyPos.current.x + fwdX,
        freeFlyPos.current.y + fwdY,
        freeFlyPos.current.z + fwdZ,
      );
      camera.lookAt(target.current);
    } else {
      // Fixed-orientation leash camera.
      //   - Orientation comes ONLY from azimuth + pitch — never tracks the
      //     character. The camera does not rotate as the player moves.
      //   - Y is locked at character.y + height (no bobbing).
      //   - XZ position is moved only when XZ distance to the character
      //     leaves [minDistance, maxDistance]. Within bounds the camera
      //     stays put while the character wanders.
      const az = THREE.MathUtils.degToRad(fixed.azimuthDeg);
      const pitch = THREE.MathUtils.degToRad(fixed.pitchDeg);

      // Derive leash distances from screen fractions. The character should
      // occupy ~maxOnScreenFrac of the screen at the near bound, dwindling
      // to ~minOnScreenFrac at the far bound.
      //   screenFrac ≈ charHeight / (2 · distance3D · tan(fov/2))
      //   ⇒ distance3D = charHeight / (2 · frac · tan(fov/2))
      // Then project to XZ depth using the camera's height above the
      // character's center: depth = sqrt(distance3D² − heightOffset²).
      const fovRad = THREE.MathUtils.degToRad(fixed.fov);
      const tanHalfFov = Math.tan(fovRad / 2);
      const heightOffset = Math.max(0, fixed.height - CHAR_HEIGHT_M / 2);
      const safeMaxFrac = Math.max(0.005, fixed.maxOnScreenFrac);
      const safeMinFrac = Math.max(0.001, fixed.minOnScreenFrac);
      const dNear3D = CHAR_HEIGHT_M / (2 * safeMaxFrac * tanHalfFov);
      const dFar3D = CHAR_HEIGHT_M / (2 * safeMinFrac * tanHalfFov);

      // The XZ distance the camera should sit at, derived from the
      // 3D distance + the camera's height above the character. When
      // `heightOffset >= dNear3D`, the requested screen-fraction is
      // geometrically impossible at this height (the camera can't
      // physically get closer than `heightOffset` in 3D), so the
      // formula falls back to a pitch-based XZ that keeps the
      // character along the camera's look direction. Without this
      // fallback the leash clamps the camera to XZ=1m from the
      // player, which puts the character at ~87° below the look
      // direction — far outside the FOV.
      const pitchRad = Math.abs(THREE.MathUtils.degToRad(fixed.pitchDeg));
      const tanPitch = Math.tan(pitchRad);
      const pitchAlignedXZ =
        tanPitch > 0.01 ? heightOffset / tanPitch : heightOffset;

      // Direct-distance mode: the caller has pinned the camera to a
      // specific XZ distance, so we collapse the [min, max] leash to
      // that single value. Lateral leash also collapses — the camera
      // stays exactly at the configured pose regardless of where the
      // character drifts (the character won't be drifting in Mugshot
      // anyway, but determinism here is the whole point).
      const directXZ = fixed.distanceM;
      const minXZ =
        directXZ !== undefined
          ? directXZ
          : dNear3D > heightOffset
            ? Math.sqrt(dNear3D * dNear3D - heightOffset * heightOffset)
            : pitchAlignedXZ * 0.6;
      const maxXZ =
        directXZ !== undefined
          ? directXZ
          : dFar3D > heightOffset
            ? Math.sqrt(dFar3D * dFar3D - heightOffset * heightOffset)
            : pitchAlignedXZ * 1.6;
      const minDistance = Math.max(0.1, minXZ);
      const maxDistance =
        directXZ !== undefined ? minDistance : Math.max(minDistance + 0.5, maxXZ);
      const maxLateral =
        directXZ !== undefined ? 0 : fixed.lateralFrac * maxDistance * tanHalfFov;

      // Initialize position on entry into fixed mode so the character is
      // visible at the default leash distance.
      if (fixedNeedsInit.current) {
        fixedNeedsInit.current = false;
        const initialDist = (minDistance + maxDistance) / 2;
        camera.position.set(
          pos.x + Math.sin(az) * initialDist,
          pos.y + fixed.height,
          pos.z - Math.cos(az) * initialDist,
        );
      }

      // Lock Y to the character's height each frame.
      camera.position.y = pos.y + fixed.height;

      // Decompose the (camera → player) XZ vector into a depth component
      // along the camera's forward axis and a lateral component along the
      // camera's right axis. The two leashes are independent: depth is
      // clamped to [minDistance, maxDistance], lateral to ±maxLateral.
      const forwardX = -Math.sin(az);
      const forwardZ = Math.cos(az);
      const rightX = -Math.cos(az);
      const rightZ = -Math.sin(az);

      const rx = pos.x - camera.position.x;
      const rz = pos.z - camera.position.z;
      const parallel = rx * forwardX + rz * forwardZ;
      const perp = rx * rightX + rz * rightZ;

      const clampedParallel = Math.max(
        minDistance,
        Math.min(maxDistance, parallel),
      );
      const clampedPerp = Math.max(
        -maxLateral,
        Math.min(maxLateral, perp),
      );
      const depthCorrection = parallel - clampedParallel;
      const lateralCorrection = perp - clampedPerp;

      camera.position.x +=
        forwardX * depthCorrection + rightX * lateralCorrection;
      camera.position.z +=
        forwardZ * depthCorrection + rightZ * lateralCorrection;

      // Normal-mode lookAt direction: camera looks toward (azimuth +
      // 180°), tilted by pitch. The look target is camera.position +
      // forward, so orientation is independent of the character's
      // position.
      const lookYaw = az + Math.PI;
      const cosP = Math.cos(pitch);
      const normalLookX = camera.position.x + Math.sin(lookYaw) * cosP;
      const normalLookY = camera.position.y + Math.sin(pitch);
      const normalLookZ = camera.position.z - Math.cos(lookYaw) * cosP;

      if (mix > 0.001) {
        // Conversation framing: preserve the user's azimuth (= where
        // the camera "comes from") and pitch, but place the camera at
        // a closer offset from the FOCUS instead of from the player,
        // and aim it at the focus directly so the participants are
        // centred on screen.
        //
        // The conversation camera sits at (focus + offset), where
        // offset = -forward * conversationDistance + up *
        // conversationHeight. This is essentially the same geometry
        // as the normal fixed camera, but anchored on the
        // MeetingArea centroid and at a shorter (Leva-tunable)
        // distance for zoom-in. `forward` points from camera toward
        // target, so the camera goes "behind" the focus along the
        // azimuth direction.
        const convoPosX = useFocus.x - forwardX * conversationDistance;
        const convoPosY = useFocus.y + conversationHeight;
        const convoPosZ = useFocus.z - forwardZ * conversationDistance;

        // LookAt the focus, slightly raised so we're aiming at chest
        // height rather than at the ground.
        const convoLookX = useFocus.x;
        const convoLookY = useFocus.y + CHAR_HEIGHT_M / 2;
        const convoLookZ = useFocus.z;

        // Blend camera position and look point.
        camera.position.x = THREE.MathUtils.lerp(
          camera.position.x,
          convoPosX,
          mix,
        );
        camera.position.y = THREE.MathUtils.lerp(
          camera.position.y,
          convoPosY,
          mix,
        );
        camera.position.z = THREE.MathUtils.lerp(
          camera.position.z,
          convoPosZ,
          mix,
        );
        camera.lookAt(
          THREE.MathUtils.lerp(normalLookX, convoLookX, mix),
          THREE.MathUtils.lerp(normalLookY, convoLookY, mix),
          THREE.MathUtils.lerp(normalLookZ, convoLookZ, mix),
        );
      } else {
        camera.lookAt(normalLookX, normalLookY, normalLookZ);
      }
    }
  });

  return null;
}

/** Conversation-view camera target: an elevated 3rd-person frame
 * centred on `focus`. `yaw` is the user's current look yaw (so the
 * conversation view rotates with them in FP/3P modes); pitch tilts
 * the camera down, and `r` controls how far the camera sits from the
 * focus point. Returns a fresh Vector3 each call. */
const _convoVec = new THREE.Vector3();
function computeElevatedThirdPerson(
  focus: { x: number; y: number; z: number },
  yaw: number,
  r: number,
  pitch: number,
): THREE.Vector3 {
  const cosP = Math.cos(pitch);
  return _convoVec.set(
    focus.x + Math.sin(yaw) * cosP * r,
    focus.y + Math.sin(-pitch) * r,
    focus.z + Math.cos(yaw) * cosP * r,
  );
}
