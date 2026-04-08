import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js';
import liliensteinHdriUrl from '../assets/hdri/lilienstein_4k.exr?url';
import { createAvatar, AvatarData, AvatarAnimationState } from '../components/Avatar';
import { createBubbleSphere, hexStringToInt } from './usePresence';
import { AvatarCustomization, BubblePreferences } from '@/types/avatar';
import { EnvironmentType } from '@/types/room';

export interface SceneSetupHandle {
  orthoCameraRef: React.MutableRefObject<THREE.OrthographicCamera | null>;
  orthoViewSizeRef: React.MutableRefObject<number>;
}

interface UseSceneSetupOptions {
  containerRef: React.MutableRefObject<HTMLDivElement | null>;
  officeId: string;
  environment: EnvironmentType;
  currentUser: { id: string; name: string | null } | null;
  // Refs to populate
  sceneRef: React.MutableRefObject<THREE.Scene | null>;
  rendererRef: React.MutableRefObject<THREE.WebGLRenderer | null>;
  cameraRef: React.MutableRefObject<THREE.PerspectiveCamera | null>;
  localAvatarRef: React.MutableRefObject<THREE.Group | null>;
  localAvatarAnimationRef: React.MutableRefObject<AvatarAnimationState | null>;
  localBubbleSphereRef: React.MutableRefObject<THREE.Mesh | null>;
  selfMarkerRef: React.MutableRefObject<THREE.Group | null>;
  // Refs to read
  avatarCustomizationRef: React.MutableRefObject<AvatarCustomization>;
  bubblePrefsRef: React.MutableRefObject<BubblePreferences>;
  playerPositionRef: React.MutableRefObject<THREE.Vector3>;
}

export function useSceneSetup({
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
}: UseSceneSetupOptions): SceneSetupHandle {
  const orthoCameraRef = useRef<THREE.OrthographicCamera | null>(null);
  const orthoViewSizeRef = useRef(15);

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
    const orthoViewSize = orthoViewSizeRef.current;
    const orthoAspect = window.innerWidth / window.innerHeight;
    const orthoCamera = new THREE.OrthographicCamera(
      -orthoViewSize * orthoAspect, orthoViewSize * orthoAspect,
      orthoViewSize, -orthoViewSize,
      0.1, 200,
    );
    orthoCamera.position.set(camera.position.x, 80, camera.position.z);
    orthoCamera.up.set(0, 0, -1); // north (-Z) is up on screen
    orthoCamera.lookAt(camera.position.x, 0, camera.position.z);
    orthoCameraRef.current = orthoCamera;

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
      buildEnvironment(scene, environment);
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

    // Resize handler
    const handleResize = () => {
      const container = containerRef.current;
      const w = container ? container.clientWidth : window.innerWidth;
      const h = container ? container.clientHeight : window.innerHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      const newAspect = w / h;
      orthoCamera.left = -orthoViewSizeRef.current * newAspect;
      orthoCamera.right = orthoViewSizeRef.current * newAspect;
      orthoCamera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

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
      window.removeEventListener('resize', handleResize);

      // Clean up local avatar, bubble sphere, and self marker
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
      if (localAvatarAnimationRef.current) {
        localAvatarAnimationRef.current.mixer.stopAllAction();
        localAvatarAnimationRef.current = null;
      }

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

      sceneRef.current = null;
      rendererRef.current = null;
      cameraRef.current = null;
      orthoCameraRef.current = null;
    };
  }, [officeId, currentUser?.id, environment]);

  return { orthoCameraRef, orthoViewSizeRef };
}

/** Build the 3D environment geometry for a given scene type. */
function buildEnvironment(scene: THREE.Scene, environment: EnvironmentType): void {
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
    const bldMatA = new THREE.MeshStandardMaterial({ color: 0x8898aa, metalness: 0.5, roughness: 0.6 });
    const bldMatB = new THREE.MeshStandardMaterial({ color: 0xa0aabb, metalness: 0.4, roughness: 0.5 });
    const bldMatC = new THREE.MeshStandardMaterial({ color: 0x778899, metalness: 0.6, roughness: 0.4 });
    const bldMats = [bldMatA, bldMatB, bldMatC];

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
      const top = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.05, 0.8), deskTopMat);
      top.position.set(cx, dH, cz); scene.add(top);
      [[-0.7, -0.35], [0.7, -0.35], [-0.7, 0.35], [0.7, 0.35]].forEach(([dx, dz]) => {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, dH, 0.05), deskLegMat);
        leg.position.set(cx + dx, dH / 2, cz + dz); scene.add(leg);
      });
      const mon = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.44, 0.04), monMat);
      mon.position.set(cx, dH + 0.27, cz - 0.28); scene.add(mon);
      const seat = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.07, 0.55), chairMat);
      seat.position.set(cx, 0.48, cz + 0.72); scene.add(seat);
      const back = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.55, 0.06), chairMat);
      back.position.set(cx, 0.79, cz + 0.98); scene.add(back);
    };

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

    addSofa(10, -12.2, true);
    addSofa(10, -7.8, false);
    const ctTop = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.06, 0.8), ctMat);
    ctTop.position.set(10, 0.44, -10); scene.add(ctTop);
    [[-0.5, -0.32], [0.5, -0.32], [-0.5, 0.32], [0.5, 0.32]].forEach(([dx, dz]) => {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.44, 0.06), ctMat);
      leg.position.set(10 + dx, 0.22, -10 + dz); scene.add(leg);
    });

    // ── CORNER C: WATER COOLER + PING PONG TABLE (near-right, x>0, z>0) ──
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

    const ppX = 9.5, ppZ = 11;
    const ppTop = new THREE.Mesh(
      new THREE.BoxGeometry(2.74, 0.05, 1.525),
      new THREE.MeshStandardMaterial({ color: 0x1a6e1a, roughness: 0.6 })
    );
    ppTop.position.set(ppX, 0.76, ppZ); scene.add(ppTop);
    const ppLine = new THREE.Mesh(
      new THREE.BoxGeometry(0.02, 0.002, 1.525),
      new THREE.MeshStandardMaterial({ color: 0xffffff })
    );
    ppLine.position.set(ppX, 0.786, ppZ); scene.add(ppLine);
    const ppNet = new THREE.Mesh(
      new THREE.BoxGeometry(2.74, 0.15, 0.015),
      new THREE.MeshStandardMaterial({ color: 0xf8f8f8, transparent: true, opacity: 0.85 })
    );
    ppNet.position.set(ppX, 0.835, ppZ); scene.add(ppNet);
    const ppLegM = new THREE.MeshStandardMaterial({ color: 0x444444, metalness: 0.5 });
    [[-1.3, -0.71], [1.3, -0.71], [-1.3, 0.71], [1.3, 0.71]].forEach(([dx, dz]) => {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.76, 0.05), ppLegM);
      leg.position.set(ppX + dx, 0.38, ppZ + dz); scene.add(leg);
    });

    // ── CORNER D: CONFERENCE TABLE + 8 CHAIRS (near-left, x<0, z>0) ──
    const confTMat = new THREE.MeshStandardMaterial({ color: 0x2c1f0e, roughness: 0.15 });
    const confCMat = new THREE.MeshStandardMaterial({ color: 0x1a1f2e, roughness: 0.7 });
    const cfX = -9, cfZ = 10;

    const confTTop = new THREE.Mesh(new THREE.BoxGeometry(5, 0.07, 2.5), confTMat);
    confTTop.position.set(cfX, 0.75, cfZ); scene.add(confTTop);
    [[-1.8, -0.9], [1.8, -0.9], [-1.8, 0.9], [1.8, 0.9]].forEach(([dx, dz]) => {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.75, 0.1), confTMat);
      leg.position.set(cfX + dx, 0.375, cfZ + dz); scene.add(leg);
    });

    const addConfChair = (cx: number, cz: number, bdx: number, bdz: number, sideways = false) => {
      const seat = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.07, 0.55), confCMat);
      seat.position.set(cx, 0.5, cz); scene.add(seat);
      const back = new THREE.Mesh(
        sideways ? new THREE.BoxGeometry(0.07, 0.55, 0.5) : new THREE.BoxGeometry(0.5, 0.55, 0.07),
        confCMat
      );
      back.position.set(cx + bdx, 0.79, cz + bdz); scene.add(back);
    };

    [cfX - 1.5, cfX, cfX + 1.5].forEach((x) => addConfChair(x, cfZ + 1.7, 0, 0.3));
    [cfX - 1.5, cfX, cfX + 1.5].forEach((x) => addConfChair(x, cfZ - 1.7, 0, -0.3));
    addConfChair(cfX - 2.8, cfZ, -0.3, 0, true);
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
}
