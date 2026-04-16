import { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { CameraMode } from '@/types/room';
import { EMOJI_MAP } from '@/components/EmojiConfetti';
import { AvatarAnimationState, switchAnimation } from '@/components/Avatar';

export interface KeyboardControlsHandle {
  cameraMode: CameraMode;
  setCameraMode: React.Dispatch<React.SetStateAction<CameraMode>>;
  cameraModeRef: React.MutableRefObject<CameraMode>;
  is2DMode: boolean;
  setIs2DMode: React.Dispatch<React.SetStateAction<boolean>>;
  is2DModeRef: React.MutableRefObject<boolean>;
  showControls: boolean;
  setShowControls: React.Dispatch<React.SetStateAction<boolean>>;
  mouseLockActive: boolean;
  joystickKnob: { x: number; y: number };
  setJoystickKnob: React.Dispatch<React.SetStateAction<{ x: number; y: number }>>;
  joystickActive: boolean;
  setJoystickActive: React.Dispatch<React.SetStateAction<boolean>>;
  joystickInputRef: React.MutableRefObject<{ x: number; y: number }>;
  playerPositionRef: React.MutableRefObject<THREE.Vector3>;
  playerYawRef: React.MutableRefObject<number>;
  keysRef: React.MutableRefObject<{ [key: string]: boolean }>;
  cameraPitchRef: React.MutableRefObject<number>;
  cameraYawRef: React.MutableRefObject<number>;
  /**
   * Register DOM event listeners for keyboard, mouse, and touch input.
   * Call from the scene setup useEffect after renderer/camera creation.
   * Returns a cleanup function to remove all listeners.
   */
  registerInputListeners: (
    renderer: THREE.WebGLRenderer,
    camera: THREE.PerspectiveCamera,
    scene: THREE.Scene,
    orthoCamera: THREE.OrthographicCamera,
    orthoViewSizeRef: { current: number },
    onEmojiKey: (key: string) => void,
    onZoomChange?: (zoomLevel: number) => void,
  ) => () => void;
  /**
   * Compute player movement for this frame. Call from the animation loop.
   * Updates player position, yaw, camera (third-person), and local avatar animation.
   * Returns movement state for position broadcasting.
   */
  computeMovement: (
    camera: THREE.PerspectiveCamera,
    localAvatar: THREE.Group | null,
    localAvatarAnimation: AvatarAnimationState | null,
    followTarget: { position: THREE.Vector3 } | undefined,
    bubbleRadius: number,
    moveSpeed: number,
  ) => {
    moved: boolean;
    broadcastPos: { x: number; y: number; z: number };
    broadcastRot: { x: number; y: number; z: number };
  };
}

interface UseKeyboardControlsOptions {
  keysRef: React.MutableRefObject<{ [key: string]: boolean }>;
  cameraModeRef: React.MutableRefObject<CameraMode>;
  chatVisibleRef: React.MutableRefObject<boolean>;
  motionActiveRef: React.MutableRefObject<boolean>;
  followingUserIdRef: React.MutableRefObject<string | null>;
  setFollowingUserId: (id: string | null) => void;
  onWhiteboardToggle?: React.MutableRefObject<(() => void) | null>;
  onWhiteboardUndo?: React.MutableRefObject<(() => void) | null>;
}

export function useKeyboardControls({
  keysRef,
  cameraModeRef,
  chatVisibleRef,
  motionActiveRef,
  followingUserIdRef,
  setFollowingUserId,
  onWhiteboardToggle,
  onWhiteboardUndo,
}: UseKeyboardControlsOptions): KeyboardControlsHandle {
  // UI state
  const [cameraMode, setCameraMode] = useState<CameraMode>('first-person');
  const [is2DMode, setIs2DMode] = useState(false);
  const is2DModeRef = useRef(false);
  const [showControls, setShowControls] = useState(false);
  const [mouseLockActive, setMouseLockActive] = useState(false);
  const [joystickKnob, setJoystickKnob] = useState({ x: 0, y: 0 });
  const [joystickActive, setJoystickActive] = useState(false);

  // Input refs
  const joystickInputRef = useRef({ x: 0, y: 0 });
  const cameraPitchRef = useRef(0);
  const cameraYawRef = useRef(0);
  const playerPositionRef = useRef(new THREE.Vector3(0, 0, 5));
  const playerYawRef = useRef(0);
  const clickMoveTargetRef = useRef<THREE.Vector3 | null>(null);
  const clickIndicatorRef = useRef<THREE.Mesh | null>(null);

  // Keep refs in sync with state
  useEffect(() => { cameraModeRef.current = cameraMode; }, [cameraMode]);
  // Sync is2DModeRef synchronously in render body so rAF always sees current value
  is2DModeRef.current = is2DMode;

  // Exit pointer lock when switching to 2D mode
  useEffect(() => {
    if (is2DMode && document.pointerLockElement) {
      document.exitPointerLock();
    }
  }, [is2DMode]);

  const registerInputListeners = useCallback((
    renderer: THREE.WebGLRenderer,
    camera: THREE.PerspectiveCamera,
    _scene: THREE.Scene,
    orthoCamera: THREE.OrthographicCamera,
    orthoViewSizeRef: { current: number },
    onEmojiKey: (key: string) => void,
    onZoomChange?: (zoomLevel: number) => void,
  ): (() => void) => {
    const keys = keysRef.current;

    // Track pitch and yaw independently — standard FPS camera technique
    camera.rotation.order = 'YXZ';

    const handleKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (chatVisibleRef.current) {
        const navigationKeys = ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'v', '?'];
        if (navigationKeys.includes(key)) return;
      }
      // Prevent default browser scroll/navigation for movement keys so they don't
      // inadvertently scroll the page and release pointer lock.
      const movementKeys = ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'];
      if (movementKeys.includes(key) && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
      }
      // Emoji confetti (keys 1-5) — skip when typing in chat
      if (!chatVisibleRef.current && event.key in EMOJI_MAP) {
        onEmojiKey(event.key);
      }
      if (key === 'c' && !chatVisibleRef.current) {
        setCameraMode(prev => {
          const modes: CameraMode[] = ['first-person', 'third-person-behind', 'third-person-front'];
          const next = modes[(modes.indexOf(prev) + 1) % modes.length];
          cameraModeRef.current = next;
          if (next === 'first-person' && camera) {
            const pp = playerPositionRef.current;
            camera.position.set(pp.x, 1.6, pp.z);
            camera.rotation.set(cameraPitchRef.current, cameraYawRef.current, 0, 'YXZ');
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
      if (key === 'b' && !chatVisibleRef.current) {
        onWhiteboardToggle?.current?.();
        return;
      }
      if (key === 'z' && (event.ctrlKey || event.metaKey) && !chatVisibleRef.current) {
        onWhiteboardUndo?.current?.();
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

    // Mouse control mode (desktop) — click to lock pointer, Escape to release.
    // In 2D mode, click-to-move: raycast to ground plane.
    const raycaster = new THREE.Raycaster();
    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    const handleCanvasClick = (event: MouseEvent) => {
      if (is2DModeRef.current) {
        // Click-to-move in 2D mode
        const rect = renderer.domElement.getBoundingClientRect();
        const ndcX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        const ndcY = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), orthoCamera);
        const intersection = new THREE.Vector3();
        if (raycaster.ray.intersectPlane(groundPlane, intersection)) {
          // Clamp to bounds
          intersection.x = Math.max(-14.5, Math.min(14.5, intersection.x));
          intersection.z = Math.max(-14.5, Math.min(14.5, intersection.z));
          clickMoveTargetRef.current = intersection;
          // Show click indicator
          if (!clickIndicatorRef.current) {
            const ring = new THREE.Mesh(
              new THREE.RingGeometry(0.2, 0.35, 24),
              new THREE.MeshBasicMaterial({ color: 0x60a5fa, transparent: true, opacity: 0.8, side: THREE.DoubleSide }),
            );
            ring.rotation.x = -Math.PI / 2;
            ring.position.y = 0.05;
            _scene.add(ring);
            clickIndicatorRef.current = ring;
          }
          clickIndicatorRef.current.position.set(intersection.x, 0.05, intersection.z);
          clickIndicatorRef.current.visible = true;
          (clickIndicatorRef.current.material as THREE.MeshBasicMaterial).opacity = 0.8;
          clickIndicatorRef.current.scale.set(1, 1, 1);
        }
        return;
      }
      if (!renderer.xr.isPresenting && !motionActiveRef.current) {
        renderer.domElement.requestPointerLock();
      }
    };

    const handleMouseMove = (event: MouseEvent) => {
      if (is2DModeRef.current) return;
      if (document.pointerLockElement === renderer.domElement && !renderer.xr.isPresenting) {
        cameraYawRef.current   -= (event.movementX || 0) * 0.002;
        cameraPitchRef.current -= (event.movementY || 0) * 0.002;
        cameraPitchRef.current = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, cameraPitchRef.current));
        camera.rotation.set(cameraPitchRef.current, cameraYawRef.current, 0, 'YXZ');
      }
    };

    const handlePointerLockChange = () => {
      setMouseLockActive(document.pointerLockElement === renderer.domElement);
    };

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

    // Scroll wheel zoom for 2D mode only
    const applyZoom = (newSize: number) => {
      orthoViewSizeRef.current = Math.max(3, Math.min(40, newSize));
      const aspect = window.innerWidth / window.innerHeight;
      orthoCamera.left = -orthoViewSizeRef.current * aspect;
      orthoCamera.right = orthoViewSizeRef.current * aspect;
      orthoCamera.top = orthoViewSizeRef.current;
      orthoCamera.bottom = -orthoViewSizeRef.current;
      orthoCamera.updateProjectionMatrix();
      onZoomChange?.(orthoViewSizeRef.current);
    };
    // Expose zoom function for external buttons
    (window as any).__officexr_applyZoom = applyZoom;

    const handleWheel = (event: WheelEvent) => {
      if (!is2DModeRef.current) return;
      event.preventDefault();
      const zoomFactor = 1 + event.deltaY * 0.001;
      applyZoom(orthoViewSizeRef.current * zoomFactor);
    };

    // Register all listeners
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    renderer.domElement.addEventListener('click', handleCanvasClick);
    // Use document-level mousemove so pointer-lock events are caught regardless of
    // which element the browser dispatches them to (behaviour varies across browsers).
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('pointerlockchange', handlePointerLockChange);
    renderer.domElement.addEventListener('touchstart', handleTouchStart, { passive: true });
    renderer.domElement.addEventListener('touchmove', handleTouchMove, { passive: true });
    renderer.domElement.addEventListener('touchend', handleTouchEnd);
    renderer.domElement.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      renderer.domElement.removeEventListener('click', handleCanvasClick);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('pointerlockchange', handlePointerLockChange);
      if (document.pointerLockElement === renderer.domElement) {
        document.exitPointerLock();
      }
      renderer.domElement.removeEventListener('touchstart', handleTouchStart);
      renderer.domElement.removeEventListener('touchmove', handleTouchMove);
      renderer.domElement.removeEventListener('touchend', handleTouchEnd);
      renderer.domElement.removeEventListener('wheel', handleWheel);
    };
  }, []);

  const computeMovement = useCallback((
    camera: THREE.PerspectiveCamera,
    localAvatar: THREE.Group | null,
    localAvatarAnimation: AvatarAnimationState | null,
    followTarget: { position: THREE.Vector3 } | undefined,
    bubbleRadius: number,
    moveSpeed: number,
  ) => {
    const keys = keysRef.current;
    const direction = new THREE.Vector3();
    let moved = false;

    if (is2DModeRef.current) {
      // 2D top-down mode: WASD/arrows map to compass directions
      let manualInput = false;
      if (keys['w'] || keys['arrowup'])    { direction.z -= 1; moved = true; manualInput = true; }
      if (keys['s'] || keys['arrowdown'])  { direction.z += 1; moved = true; manualInput = true; }
      if (keys['a'] || keys['arrowleft'])  { direction.x -= 1; moved = true; manualInput = true; }
      if (keys['d'] || keys['arrowright']) { direction.x += 1; moved = true; manualInput = true; }
      const { x: jx, y: jy } = joystickInputRef.current;
      if (Math.abs(jx) > 0.05 || Math.abs(jy) > 0.05) {
        direction.x += jx;
        direction.z -= jy; // joystick up = north
        moved = true;
        manualInput = true;
      }
      // Cancel click-to-move on manual input
      if (manualInput) clickMoveTargetRef.current = null;
      // Click-to-move: smoothly navigate toward the clicked target
      if (!manualInput && clickMoveTargetRef.current) {
        const playerPos = cameraModeRef.current === 'first-person'
          ? camera.position : playerPositionRef.current;
        const dx = clickMoveTargetRef.current.x - playerPos.x;
        const dz = clickMoveTargetRef.current.z - playerPos.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist < 0.15) {
          // Arrived at destination
          clickMoveTargetRef.current = null;
        } else {
          direction.x = dx / dist;
          direction.z = dz / dist;
          moved = true;
        }
      }
      // Animate click indicator (fade out + expand)
      if (clickIndicatorRef.current) {
        if (!clickMoveTargetRef.current) {
          const mat = clickIndicatorRef.current.material as THREE.MeshBasicMaterial;
          mat.opacity -= 0.03;
          clickIndicatorRef.current.scale.multiplyScalar(1.02);
          if (mat.opacity <= 0) clickIndicatorRef.current.visible = false;
        }
      }
    } else {
      // 3D mode: movement relative to player facing direction (yaw)
      const isThirdPerson = cameraModeRef.current !== 'first-person';
      // In front view the camera faces the player, so movement directions are flipped
      const isFrontView = cameraModeRef.current === 'third-person-front';
      const yaw = isThirdPerson
        ? (isFrontView ? playerYawRef.current + Math.PI : playerYawRef.current)
        : cameraYawRef.current;
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
    if (followingUserIdRef.current && followTarget) {
      const playerPos = cameraModeRef.current === 'first-person'
        ? camera.position : playerPositionRef.current;
      const dir = new THREE.Vector3()
        .subVectors(playerPos, followTarget.position)
        .setY(0)
        .normalize();
      if (dir.lengthSq() < 0.0001) dir.set(1, 0, 0);
      const dest = followTarget.position.clone()
        .addScaledVector(dir, bubbleRadius * 0.8);
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

    // Switch local avatar animation based on movement
    if (localAvatarAnimation) {
      switchAnimation(localAvatarAnimation, moved ? 'walk' : 'idle');
    }

    // Third-person camera: position camera relative to the player avatar
    const isThirdPerson = cameraModeRef.current !== 'first-person';
    if (isThirdPerson && localAvatar) {
      playerYawRef.current = cameraYawRef.current;
      const pPos = playerPositionRef.current;
      localAvatar.visible = true;
      localAvatar.position.set(pPos.x, 0, pPos.z);
      localAvatar.rotation.y = playerYawRef.current + Math.PI;

      const camDist = 3.5;
      const yaw = playerYawRef.current;
      const pitch = cameraPitchRef.current;
      const centerY = 1.4;
      // side=1 puts the camera behind the avatar; side=-1 puts it in front
      const side = cameraModeRef.current === 'third-person-behind' ? 1 : -1;

      // Spherical orbit: camera position derived from (yaw, pitch) so that pitch
      // is encoded geometrically rather than discarded by lookAt.
      const cosP = Math.cos(pitch);
      const sinP = Math.sin(pitch);
      camera.position.set(
        pPos.x + side * Math.sin(yaw) * camDist * cosP,
        centerY - sinP * camDist,
        pPos.z + side * Math.cos(yaw) * camDist * cosP,
      );
      // lookAt is safe here: pitch is preserved in camera.position, not rotation.x
      camera.lookAt(pPos.x, centerY, pPos.z);
    } else if (localAvatar) {
      localAvatar.visible = false;
      playerPositionRef.current.set(camera.position.x, 0, camera.position.z);
    }

    // Compute broadcast position: always send player position, not camera offset
    const broadcastPos = isThirdPerson
      ? { x: playerPositionRef.current.x, y: 1.6, z: playerPositionRef.current.z }
      : { x: camera.position.x, y: camera.position.y, z: camera.position.z };
    const broadcastRot = isThirdPerson
      ? { x: 0, y: playerYawRef.current, z: 0 }
      : { x: camera.rotation.x, y: camera.rotation.y, z: camera.rotation.z };

    return { moved, broadcastPos, broadcastRot };
  }, []);

  return {
    cameraMode,
    setCameraMode,
    cameraModeRef,
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
    keysRef,
    cameraPitchRef,
    cameraYawRef,
    registerInputListeners,
    computeMovement,
  };
}
