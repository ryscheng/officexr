import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import {
  Adventurer,
  EndlessGrid,
  type AnimationState,
} from '@officexr/world/renderer';
import type { CharacterName } from '@officexr/world';

export interface CharacterPartHover {
  /** Name of the leaf node the raycast hit (usually a SkinnedMesh
   * like "Body" or "Adventurer_Geo"). */
  meshName: string;
  /** Nearest bone in the skeleton — if the leaf hit is a
   * SkinnedMesh. Bones carry the meaningful joint names
   * ("mixamorig:LeftFoot", "Spine"), so this is what you usually
   * actually want for debugging. */
  boneName: string | null;
  /** Page-space cursor position, for placing the tooltip. */
  clientX: number;
  clientY: number;
}

interface CharacterEditorCanvasProps {
  character: CharacterName;
  /** Animation state to preview when not in control. */
  previewState: AnimationState;
  /** When true, WASD moves the character and the camera follows in
   * third-person. When false, the character stays at origin and the
   * camera orbits via click-drag. */
  inControl: boolean;
  /** Per-character animation timeScale knobs. Plumbed through to
   * Adventurer so tuning sliders take effect live. */
  idleSpeed: number;
  walkSpeed: number;
  runSpeed: number;
  /** Surfaces the mesh+bone under the cursor each frame, or null
   * when the cursor isn't over the canvas. Used by `CharacterApp`
   * to render a DOM tooltip. */
  onPartHover?: (hover: CharacterPartHover | null) => void;
}

/**
 * Standalone R3F canvas for the Characters editor. One avatar in the
 * middle, an endless grid floor, and either:
 *   - **Preview mode** (default): camera orbits the character on
 *     click-drag; mouse wheel dollies in/out; the character plays the
 *     selected `previewState` clip on loop.
 *   - **Control mode**: WASD moves the character (its `motion`
 *     transitions through idle/walking/running by velocity); camera
 *     follows behind at a fixed third-person offset.
 *
 * No SDK store, no peers, no broadcast — purely a previewer.
 */
export function CharacterEditorCanvas(props: CharacterEditorCanvasProps) {
  return (
    <Canvas
      camera={{ position: [0, 2, 5], fov: 45, near: 0.1, far: 200 }}
      style={{ width: '100%', height: '100%', display: 'block' }}
      shadows={false}
    >
      <ambientLight intensity={0.7} />
      <directionalLight position={[10, 20, 10]} intensity={1.2} />
      <color attach="background" args={['#0a0a0a']} />
      <EndlessGrid />
      <CharacterStage {...props} />
    </Canvas>
  );
}

interface CharacterStageProps extends CharacterEditorCanvasProps {}

function CharacterStage(props: CharacterStageProps) {
  const { camera, gl } = useThree();
  const persp = camera as THREE.PerspectiveCamera;

  // The character's transform. In preview mode it stays at origin;
  // in control mode WASD moves it.
  const charPos = useRef(new THREE.Vector3(0, 0, 0));
  const charYaw = useRef(0);
  const motion = useRef<'idle' | 'walking' | 'running'>('idle');
  const [renderedMotion, setRenderedMotion] = useState<
    'idle' | 'walking' | 'running'
  >('idle');

  // Camera orbit state (preview mode).
  const orbit = useRef({
    azimuth: 0,
    elevation: 0.45,
    distance: 5,
  });
  const orbitDrag = useRef({ active: false, lastX: 0, lastY: 0 });

  // Keyboard state (control mode).
  const keys = useRef(new Set<string>());

  useEffect(() => {
    const canvas = gl.domElement;

    const onKeyDown = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      keys.current.add(e.code.toLowerCase());
    };
    const onKeyUp = (e: KeyboardEvent) => {
      keys.current.delete(e.code.toLowerCase());
    };
    const onPointerDown = (e: PointerEvent) => {
      // Right-click drag = orbit camera. Left-click is reserved for
      // selecting things in the scene (no current actions in the
      // character editor, but keeping the convention symmetric with
      // the Scenes editor).
      if (e.button !== 2) return;
      orbitDrag.current = {
        active: true,
        lastX: e.clientX,
        lastY: e.clientY,
      };
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!orbitDrag.current.active) return;
      const dx = e.clientX - orbitDrag.current.lastX;
      const dy = e.clientY - orbitDrag.current.lastY;
      orbitDrag.current.lastX = e.clientX;
      orbitDrag.current.lastY = e.clientY;
      const sens = 0.005;
      orbit.current.azimuth -= dx * sens;
      orbit.current.elevation = THREE.MathUtils.clamp(
        orbit.current.elevation - dy * sens,
        -0.4,
        Math.PI / 2 - 0.05,
      );
    };
    const onPointerUp = (e: PointerEvent) => {
      if (e.button !== 2) return;
      orbitDrag.current.active = false;
    };
    const onContextMenu = (e: MouseEvent) => e.preventDefault();
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = Math.exp(e.deltaY * 0.001);
      orbit.current.distance = THREE.MathUtils.clamp(
        orbit.current.distance * factor,
        1.5,
        40,
      );
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    canvas.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', onContextMenu);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      canvas.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('contextmenu', onContextMenu);
      keys.current.clear();
      orbitDrag.current.active = false;
    };
  }, [gl]);

  // Reset character + orbit when control toggles so the user sees a
  // sensible state on every flip.
  useEffect(() => {
    charPos.current.set(0, 0, 0);
    charYaw.current = 0;
    motion.current = 'idle';
    setRenderedMotion('idle');
    keys.current.clear();
  }, [props.inControl, props.character]);

  const charGroupRef = useRef<THREE.Group>(null);

  // --- Part-name hover (debug tooltip) ----------------------------
  // Track cursor in NDC + page-space so each frame we can raycast
  // against the character to find the hit mesh and its closest bone.
  // `null` means "cursor is outside the canvas, hide tooltip".
  const hoverPosRef = useRef<{
    ndcX: number;
    ndcY: number;
    clientX: number;
    clientY: number;
  } | null>(null);
  // Mirror the onPartHover callback into a ref so the pointer
  // listeners don't have to rebind whenever the parent passes a new
  // function identity. The useFrame loop below also reads from this
  // ref so the latest callback always wins.
  const partHoverRef = useRef(props.onPartHover);
  useEffect(() => {
    partHoverRef.current = props.onPartHover;
  }, [props.onPartHover]);
  useEffect(() => {
    const canvas = gl.domElement;
    const onMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      hoverPosRef.current = {
        ndcX: (x / rect.width) * 2 - 1,
        ndcY: -(y / rect.height) * 2 + 1,
        clientX: e.clientX,
        clientY: e.clientY,
      };
    };
    const onLeave = () => {
      hoverPosRef.current = null;
      partHoverRef.current?.(null);
    };
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerleave', onLeave);
    return () => {
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerleave', onLeave);
    };
  }, [gl]);
  const raycasterRef = useRef(new THREE.Raycaster());
  const lastHoverKey = useRef<string>('');

  useFrame((_, dtSec) => {
    if (props.inControl) {
      // Move character by WASD (camera-relative). Camera trails.
      const k = keys.current;
      const fwd = (k.has('keyw') ? 1 : 0) - (k.has('keys') ? 1 : 0);
      const strafe = (k.has('keyd') ? 1 : 0) - (k.has('keya') ? 1 : 0);
      const isRunning = k.has('shiftleft') || k.has('shiftright');
      const baseSpeed = 3;
      const speed = isRunning ? baseSpeed * 2 : baseSpeed;
      let nextMotion: 'idle' | 'walking' | 'running' = 'idle';
      if (fwd !== 0 || strafe !== 0) {
        // Camera-relative direction in XZ.
        const camYaw = orbit.current.azimuth;
        const fwdX = -Math.sin(camYaw);
        const fwdZ = -Math.cos(camYaw);
        const rightX = Math.cos(camYaw);
        const rightZ = -Math.sin(camYaw);
        let dx = fwdX * fwd + rightX * strafe;
        let dz = fwdZ * fwd + rightZ * strafe;
        const len = Math.hypot(dx, dz);
        if (len > 0) {
          dx /= len;
          dz /= len;
          const step = speed * dtSec;
          charPos.current.x += dx * step;
          charPos.current.z += dz * step;
          charYaw.current = Math.atan2(-dx, -dz);
          nextMotion = isRunning ? 'running' : 'walking';
        }
      }
      if (nextMotion !== motion.current) {
        motion.current = nextMotion;
        setRenderedMotion(nextMotion);
      }
    }
    // Camera orbits / follows the character either way.
    const o = orbit.current;
    const cx = charPos.current.x + Math.sin(o.azimuth) * Math.cos(o.elevation) * o.distance;
    const cy = charPos.current.y + Math.sin(o.elevation) * o.distance + 1;
    const cz = charPos.current.z + Math.cos(o.azimuth) * Math.cos(o.elevation) * o.distance;
    persp.position.set(cx, cy, cz);
    persp.lookAt(charPos.current.x, charPos.current.y + 1, charPos.current.z);

    // Sync the character group transform.
    const grp = charGroupRef.current;
    if (grp) {
      grp.position.copy(charPos.current);
      grp.rotation.y = charYaw.current + Math.PI; // Adventurer faces +Z by default
    }

    // Raycast for the part-hover tooltip. Only against the
    // character group — the EndlessGrid is a shader plane we don't
    // want to pick up.
    const onPartHover = partHoverRef.current;
    if (onPartHover && hoverPosRef.current && grp) {
      const ray = raycasterRef.current;
      ray.setFromCamera(
        new THREE.Vector2(hoverPosRef.current.ndcX, hoverPosRef.current.ndcY),
        persp,
      );
      const hits = ray.intersectObject(grp, true);
      const hit = hits[0];
      if (hit && hit.object) {
        const meshName = hit.object.name || hit.object.type;
        let boneName: string | null = null;
        // For SkinnedMeshes, the leaf mesh's name is usually a
        // generic "Body" — find the closest bone in its skeleton
        // to the hit point and surface that, since bones carry the
        // meaningful joint names.
        const skin = hit.object as THREE.SkinnedMesh;
        if (skin.isSkinnedMesh && skin.skeleton) {
          let best: { name: string; d: number } | null = null;
          const tmp = new THREE.Vector3();
          for (const b of skin.skeleton.bones) {
            b.getWorldPosition(tmp);
            const d = tmp.distanceToSquared(hit.point);
            if (!best || d < best.d) best = { name: b.name, d };
          }
          boneName = best?.name ?? null;
        }
        const key = `${meshName}|${boneName ?? ''}|${hoverPosRef.current.clientX}|${hoverPosRef.current.clientY}`;
        if (key !== lastHoverKey.current) {
          lastHoverKey.current = key;
          onPartHover({
            meshName,
            boneName,
            clientX: hoverPosRef.current.clientX,
            clientY: hoverPosRef.current.clientY,
          });
        }
      } else if (lastHoverKey.current !== '__none__') {
        lastHoverKey.current = '__none__';
        onPartHover(null);
      }
    }
  });

  // In preview mode the Adventurer plays whatever previewState the
  // panel has selected; in control mode the velocity-derived motion
  // takes over and previewState is undefined.
  const adventurerPreview: AnimationState | undefined = props.inControl
    ? undefined
    : props.previewState;

  return (
    <group ref={charGroupRef}>
      {/*
        `key={props.character}` forces a fresh Adventurer mount when
        the model changes. Without it, useAnimations' mixer stays
        bound to the previous cloned scene's bones — the new GLB
        renders but its bones never get driven so it stands frozen.
        Remounting also resets the mixer, action, and clip state
        cleanly so cross-fades behave the same on every model swap.
      */}
      <Adventurer
        key={props.character}
        character={props.character}
        motion={renderedMotion}
        previewState={adventurerPreview}
        idleSpeed={props.idleSpeed}
        walkSpeed={props.walkSpeed}
        runSpeed={props.runSpeed}
      />
    </group>
  );
}
