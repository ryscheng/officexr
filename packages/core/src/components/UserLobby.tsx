import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as THREE from 'three';
import { supabase } from '@/lib/supabase';
import { useAuth, signOut } from '@/hooks/useAuth';
import { useMotionControls } from '@/hooks/useMotionControls';
import ControlsOverlay from '@/components/ControlsOverlay';

interface Room {
  id: string;
  name: string;
  role: string;
  linkAccess: boolean;
}

interface UserLobbyProps {
  onEnterRoom: (roomId: string) => void;
}

const PORTAL_COLORS = [
  0x3b82f6, 0xef4444, 0x22c55e, 0xa855f7,
  0xf59e0b, 0x14b8a6, 0xf97316, 0x6366f1,
];

// Build a canvas-texture sprite showing room name on a colored pill background.
function makeTextSprite(text: string, color: number): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  ctx.fillStyle = `rgba(${r},${g},${b},0.88)`;
  ctx.fillRect(0, 0, 512, 128);
  ctx.fillStyle = 'white';
  ctx.font = 'bold 56px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const label = text.length > 18 ? text.slice(0, 17) + '…' : text;
  ctx.fillText(label, 256, 64);
  const texture = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(4.5, 1.125, 1);
  return sprite;
}

export default function UserLobby({ onEnterRoom }: UserLobbyProps) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);

  // Promoted to component-level refs so useMotionControls can access them
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);

  // Shared motion / gyroscope controls (same behaviour as RoomScene)
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

  // Virtual joystick (touch devices)
  const joystickInputRef = useRef({ x: 0, y: 0 });
  const [joystickKnob, setJoystickKnob] = useState({ x: 0, y: 0 });
  const [joystickActive, setJoystickActive] = useState(false);
  const isTouchDevice = typeof window !== 'undefined' &&
    ('ontouchstart' in window || navigator.maxTouchPoints > 0);

  // Proximity hint synced from animation loop to React via ref+state
  const proximityNameRef = useRef<string | null>(null);
  const enteringRef = useRef(false);

  // Portals list for animation loop (populated after Three.js setup)
  const portalsRef = useRef<Array<{ position: THREE.Vector3; roomId: string; roomName: string }>>([]);

  const [rooms, setRooms] = useState<Room[]>([]);
  const [proximityName, setProximityName] = useState<string | null>(null);
  const [mouseLockActive, setMouseLockActive] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newRoomName, setNewRoomName] = useState('');
  const [newRoomLinkAccess, setNewRoomLinkAccess] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Data fetching ────────────────────────────────────────────────────────────

  const fetchRooms = async () => {
    if (!user) return;
    const { data } = await supabase
      .from('office_members')
      .select('role, created_at, offices(id, name, link_access)')
      .eq('user_id', user.id)
      .order('created_at', { ascending: true });

    if (data) {
      setRooms(
        (data as any[])
          .filter(r => r.offices)
          .map(r => ({
            id: r.offices.id,
            name: r.offices.name,
            role: r.role,
            linkAccess: r.offices.link_access ?? false,
          }))
      );
    }
  };

  useEffect(() => { fetchRooms(); }, [user]);

  // ── Room management ──────────────────────────────────────────────────────────

  const handleCreateRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const officeId = crypto.randomUUID();
      const { error: officeError } = await supabase
        .from('offices')
        .insert({ id: officeId, name: newRoomName.trim(), link_access: newRoomLinkAccess });
      if (officeError) throw officeError;

      const { error: memberError } = await supabase.from('office_members').insert({
        office_id: officeId,
        user_id: user.id,
        role: 'owner',
      });
      if (memberError) throw memberError;

      setNewRoomName('');
      setNewRoomLinkAccess(true);
      setShowCreateForm(false);
      await fetchRooms();
    } catch {
      setError('Failed to create room.');
    } finally {
      setLoading(false);
    }
  };

  const handleToggleLinkAccess = async (roomId: string, current: boolean) => {
    await supabase.from('offices').update({ link_access: !current }).eq('id', roomId);
    setRooms(prev => prev.map(r => r.id === roomId ? { ...r, linkAccess: !current } : r));
  };

  const copyRoomLink = (roomId: string) => {
    navigator.clipboard.writeText(`${window.location.origin}/room/${roomId}`);
  };

  // ── Three.js scene ───────────────────────────────────────────────────────────

  useEffect(() => {
    if (!containerRef.current) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0d0d1a);
    scene.fog = new THREE.Fog(0x0d0d1a, 18, 40);

    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 100);
    camera.position.set(0, 1.6, 5);
    camera.rotation.order = 'YXZ';
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    rendererRef.current = renderer;
    containerRef.current.appendChild(renderer.domElement);

    // Lighting
    scene.add(new THREE.AmbientLight(0xffffff, 0.35));
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.5);
    dirLight.position.set(5, 10, 5);
    scene.add(dirLight);

    // Floor
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(80, 80),
      new THREE.MeshStandardMaterial({ color: 0x0a0a1e, roughness: 0.9 })
    );
    floor.rotation.x = -Math.PI / 2;
    scene.add(floor);
    scene.add(new THREE.GridHelper(80, 40, 0x1a2050, 0x141430));

    // ── Wormhole portal shaders ────────────────────────────────────────────────
    const wormholeVertexShader = `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `;

    const wormholeFragmentShader = `
      uniform float uTime;
      uniform vec3 uColor;
      varying vec2 vUv;

      // Simplex-style noise
      vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
      vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
      vec3 permute(vec3 x) { return mod289(((x*34.0)+1.0)*x); }
      float snoise(vec2 v) {
        const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                           -0.577350269189626, 0.024390243902439);
        vec2 i = floor(v + dot(v, C.yy));
        vec2 x0 = v - i + dot(i, C.xx);
        vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
        vec4 x12 = x0.xyxy + C.xxzz;
        x12.xy -= i1;
        i = mod289(i);
        vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
        vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
        m = m*m; m = m*m;
        vec3 x_ = 2.0 * fract(p * C.www) - 1.0;
        vec3 h = abs(x_) - 0.5;
        vec3 ox = floor(x_ + 0.5);
        vec3 a0 = x_ - ox;
        m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
        vec3 g;
        g.x = a0.x * x0.x + h.x * x0.y;
        g.yz = a0.yz * x12.xz + h.yz * x12.yw;
        return 130.0 * dot(m, g);
      }

      void main() {
        vec2 center = vUv - 0.5;
        float dist = length(center);
        float angle = atan(center.y, center.x);

        // Swirling vortex
        float spiral = angle + dist * 8.0 - uTime * 1.5;
        float swirl = sin(spiral * 3.0) * 0.5 + 0.5;

        // Layered noise for nebula texture
        float n1 = snoise(vec2(angle * 2.0 + uTime * 0.3, dist * 4.0 - uTime * 0.5)) * 0.5 + 0.5;
        float n2 = snoise(vec2(angle * 4.0 - uTime * 0.7, dist * 8.0 + uTime * 0.2)) * 0.5 + 0.5;

        // Radial intensity — bright center fading outward
        float radialGlow = smoothstep(0.5, 0.0, dist);
        float edgeFade = smoothstep(0.5, 0.42, dist);

        // Event horizon ring
        float ringDist = abs(dist - 0.42);
        float ring = exp(-ringDist * 30.0);

        // Combine effects
        float vortex = swirl * n1 * radialGlow;
        float nebula = n2 * radialGlow * 0.6;

        // Core white-hot center
        float core = smoothstep(0.15, 0.0, dist);

        // Color mixing: deep space tones blended with portal color
        vec3 deepSpace = vec3(0.02, 0.0, 0.08);
        vec3 vortexColor = mix(uColor * 0.7, vec3(0.6, 0.4, 1.0), 0.3);
        vec3 nebulaColor = mix(uColor, vec3(0.3, 0.6, 1.0), 0.5);
        vec3 ringColor = uColor + vec3(0.3, 0.3, 0.5);
        vec3 coreColor = vec3(1.0, 0.95, 0.98);

        vec3 col = deepSpace;
        col += vortexColor * vortex * 1.2;
        col += nebulaColor * nebula;
        col += ringColor * ring * 1.5;
        col += coreColor * core * 2.0;

        float alpha = edgeFade * max(max(vortex, nebula * 0.8), max(ring, core));
        alpha = clamp(alpha + core * 0.9 + ring * 0.6, 0.0, 1.0) * edgeFade;

        gl_FragColor = vec4(col, alpha);
      }
    `;

    const rimVertexShader = `
      varying vec3 vNormal;
      varying vec3 vWorldPosition;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPosition = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `;

    const rimFragmentShader = `
      uniform float uTime;
      uniform vec3 uColor;
      varying vec3 vNormal;
      varying vec3 vWorldPosition;

      void main() {
        float pulse = sin(uTime * 2.0) * 0.15 + 0.85;
        float flicker = sin(uTime * 7.0 + vWorldPosition.y * 5.0) * 0.08;
        vec3 col = uColor * (1.2 + flicker) * pulse;
        col += vec3(0.2, 0.15, 0.35) * pulse;
        gl_FragColor = vec4(col, 1.0);
      }
    `;

    // ── Portals ─────────────────────────────────────────────────────────────────
    const portals: Array<{ position: THREE.Vector3; roomId: string; roomName: string }> = [];
    const portalMaterials: THREE.ShaderMaterial[] = [];
    const rimMaterials: THREE.ShaderMaterial[] = [];
    const portalGroups: THREE.Group[] = [];
    const count = rooms.length;

    rooms.forEach((room, i) => {
      const color = PORTAL_COLORS[i % PORTAL_COLORS.length];
      const x = count <= 1 ? 0 : (i - (count - 1) / 2) * 5.5;
      const portalZ = -8;
      const portalY = 2.5;

      const colorVec = new THREE.Color(color);
      const group = new THREE.Group();
      group.position.set(x, portalY, portalZ);
      scene.add(group);

      // Swirling vortex disc
      const vortexMat = new THREE.ShaderMaterial({
        vertexShader: wormholeVertexShader,
        fragmentShader: wormholeFragmentShader,
        uniforms: {
          uTime: { value: 0 },
          uColor: { value: colorVec },
        },
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      portalMaterials.push(vortexMat);

      const vortexDisc = new THREE.Mesh(
        new THREE.PlaneGeometry(4.2, 4.2),
        vortexMat,
      );
      group.add(vortexDisc);

      // Outer rim ring — glowing torus with animated shader
      const outerRimMat = new THREE.ShaderMaterial({
        vertexShader: rimVertexShader,
        fragmentShader: rimFragmentShader,
        uniforms: {
          uTime: { value: 0 },
          uColor: { value: colorVec },
        },
      });
      rimMaterials.push(outerRimMat);

      const outerRim = new THREE.Mesh(
        new THREE.TorusGeometry(2.1, 0.1, 16, 64),
        outerRimMat,
      );
      group.add(outerRim);

      // Inner energy ring
      const innerRim = new THREE.Mesh(
        new THREE.TorusGeometry(1.85, 0.04, 12, 64),
        new THREE.MeshStandardMaterial({
          color: 0xffffff,
          emissive: color,
          emissiveIntensity: 1.5,
          transparent: true,
          opacity: 0.5,
        })
      );
      group.add(innerRim);

      // Accretion ring particles (orbiting dots)
      const particleCount = 80;
      const particleGeo = new THREE.BufferGeometry();
      const positions = new Float32Array(particleCount * 3);
      for (let p = 0; p < particleCount; p++) {
        const a = (p / particleCount) * Math.PI * 2;
        const r = 2.0 + (Math.random() - 0.5) * 0.4;
        positions[p * 3]     = Math.cos(a) * r;
        positions[p * 3 + 1] = Math.sin(a) * r;
        positions[p * 3 + 2] = (Math.random() - 0.5) * 0.3;
      }
      particleGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

      const particleMat = new THREE.PointsMaterial({
        color: color,
        size: 0.06,
        transparent: true,
        opacity: 0.8,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const particles = new THREE.Points(particleGeo, particleMat);
      group.add(particles);

      // Gravitational glow light
      const light = new THREE.PointLight(color, 2.5, 12);
      group.add(light);

      // Subtle secondary ambient glow
      const glowLight = new THREE.PointLight(0x6040a0, 0.8, 6);
      glowLight.position.set(0, 0, 1);
      group.add(glowLight);

      // Text label above the wormhole
      const sprite = makeTextSprite(room.name, color);
      sprite.position.set(0, 3.3, 0);
      group.add(sprite);

      portalGroups.push(group);
      portals.push({ position: new THREE.Vector3(x, 1.6, portalZ), roomId: room.id, roomName: room.name });
    });

    portalsRef.current = portals;
    enteringRef.current = false;

    // ── Mouse look (pointer lock) ────────────────────────────────────────────
    let cameraPitch = 0;
    let cameraYaw = 0;

    const handleCanvasClick = () => {
      // Don't conflict with device orientation on touch/mobile devices
      if (!motionActiveRef.current) {
        renderer.domElement.requestPointerLock();
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (document.pointerLockElement !== renderer.domElement) return;
      cameraYaw   -= (e.movementX || 0) * 0.002;
      cameraPitch -= (e.movementY || 0) * 0.002;
      cameraPitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, cameraPitch));
      camera.rotation.set(cameraPitch, cameraYaw, 0, 'YXZ');
    };

    const handlePointerLockChange = () =>
      setMouseLockActive(document.pointerLockElement === renderer.domElement);

    renderer.domElement.addEventListener('click', handleCanvasClick);
    renderer.domElement.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('pointerlockchange', handlePointerLockChange);

    // ── Touch look (drag to rotate when no gyroscope) ────────────────────────
    let touchStartX = 0;
    let touchStartY = 0;
    let isTouching = false;

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        isTouching = true;
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      // Device orientation handles look direction on mobile — skip touch drag
      if (motionActiveRef.current) return;
      if (isTouching && e.touches.length === 1) {
        const dx = e.touches[0].clientX - touchStartX;
        const dy = e.touches[0].clientY - touchStartY;
        camera.rotation.y -= dx * 0.002;
        camera.rotation.x -= dy * 0.002;
        camera.rotation.x = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, camera.rotation.x));
        touchStartX = e.touches[0].clientX;
        touchStartY = e.touches[0].clientY;
      }
    };

    const handleTouchEnd = () => { isTouching = false; };

    renderer.domElement.addEventListener('touchstart', handleTouchStart, { passive: true });
    renderer.domElement.addEventListener('touchmove', handleTouchMove, { passive: true });
    renderer.domElement.addEventListener('touchend', handleTouchEnd);

    // ── WASD keyboard movement ────────────────────────────────────────────────
    const keys: Record<string, boolean> = {};
    const onKeyDown = (e: KeyboardEvent) => { keys[e.key.toLowerCase()] = true; };
    const onKeyUp   = (e: KeyboardEvent) => { keys[e.key.toLowerCase()] = false; };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    const onResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', onResize);

    // ── Animation loop ────────────────────────────────────────────────────────
    const moveSpeed = 0.05;
    const clock = new THREE.Clock();
    let rafId: number;

    const animate = () => {
      rafId = requestAnimationFrame(animate);

      // Update wormhole shader uniforms and animate particles
      const elapsed = clock.getElapsedTime();
      portalMaterials.forEach(mat => { mat.uniforms.uTime.value = elapsed; });
      rimMaterials.forEach(mat => { mat.uniforms.uTime.value = elapsed; });
      portalGroups.forEach(group => {
        group.children.forEach(child => {
          if (child instanceof THREE.Points) {
            child.rotation.z = elapsed * 0.4;
          }
        });
      });

      const forward = new THREE.Vector3();
      const right   = new THREE.Vector3();
      camera.getWorldDirection(forward);
      forward.y = 0;
      forward.normalize();
      right.crossVectors(forward, new THREE.Vector3(0, 1, 0));

      const direction = new THREE.Vector3();

      if (keys['w'] || keys['arrowup'])    direction.add(forward);
      if (keys['s'] || keys['arrowdown'])  direction.sub(forward);
      if (keys['a'] || keys['arrowleft'])  direction.sub(right);
      if (keys['d'] || keys['arrowright']) direction.add(right);

      // Virtual joystick input (touch devices)
      const { x: jx, y: jy } = joystickInputRef.current;
      if (Math.abs(jx) > 0.05 || Math.abs(jy) > 0.05) {
        direction.addScaledVector(forward, -jy);
        direction.addScaledVector(right, jx);
      }

      if (direction.length() > 0) {
        direction.normalize();
        camera.position.addScaledVector(direction, moveSpeed);
      }

      camera.position.y = 1.6;

      // Portal proximity
      if (!enteringRef.current) {
        let nearest = Infinity;
        let nearestName: string | null = null;
        let enterId: string | null = null;

        portalsRef.current.forEach(({ position, roomId, roomName }) => {
          const d = camera.position.distanceTo(position);
          if (d < nearest) { nearest = d; nearestName = roomName; }
          if (d < 1.8) enterId = roomId;
        });

        const hint = nearest < 5.0 ? nearestName : null;
        if (hint !== proximityNameRef.current) {
          proximityNameRef.current = hint;
          setProximityName(hint);
        }

        if (enterId) {
          enteringRef.current = true;
          const id = enterId;
          setTimeout(() => onEnterRoom(id), 300);
        }
      }

      renderer.render(scene, camera);
    };

    animate();

    return () => {
      cancelAnimationFrame(rafId);
      renderer.domElement.removeEventListener('click', handleCanvasClick);
      renderer.domElement.removeEventListener('mousemove', handleMouseMove);
      renderer.domElement.removeEventListener('touchstart', handleTouchStart);
      renderer.domElement.removeEventListener('touchmove', handleTouchMove);
      renderer.domElement.removeEventListener('touchend', handleTouchEnd);
      document.removeEventListener('pointerlockchange', handlePointerLockChange);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('resize', onResize);
      if (document.pointerLockElement === renderer.domElement) document.exitPointerLock();
      if (containerRef.current?.contains(renderer.domElement)) {
        containerRef.current.removeChild(renderer.domElement);
      }
      renderer.dispose();
      cameraRef.current = null;
      rendererRef.current = null;
    };
  }, [rooms]); // Recreate portals whenever room list changes

  // ── JSX ─────────────────────────────────────────────────────────────────────

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100vh', position: 'relative' }}>

      {/* Mouse-look active indicator */}
      {mouseLockActive && (
        <div style={{
          position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 50,
          boxShadow: 'inset 0 0 0 4px #00ff00',
        }} />
      )}

      {/* Portal proximity hint (center screen) */}
      {proximityName && (
        <div style={{
          position: 'absolute', top: '50%', left: '50%',
          transform: 'translate(-50%, -50%)',
          background: 'rgba(0,0,0,0.82)', color: 'white',
          padding: '12px 28px', borderRadius: '8px',
          fontFamily: 'monospace', fontSize: '17px',
          border: '1px solid rgba(255,255,255,0.25)',
          pointerEvents: 'none', zIndex: 100,
        }}>
          Entering <strong>{proximityName}</strong>…
        </div>
      )}

      {/* Controls panel (top-left) — shared with RoomScene */}
      <ControlsOverlay
        title="Your Lobby"
        motionPermission={motionPermission}
        motionCapable={motionCapable}
        onRecalibrate={() => recalibrateMotionRef.current?.()}
        onEnableMotion={enableMotion}
        onDisableMotion={disableMotion}
        motionDebugRef={motionDebugRef}
        proximityHint="Walk into a wormhole portal to enter a room"
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

      {/* Room management panel (top-right) */}
      <div style={{
        position: 'absolute', top: '20px', right: '20px',
        color: 'white', background: 'rgba(0,0,0,0.72)',
        padding: '14px', borderRadius: '8px', fontFamily: 'monospace',
        zIndex: 100, width: '240px',
      }}>
        <p style={{ margin: '0 0 10px 0', fontWeight: 'bold', fontSize: '14px' }}>
          {user?.name}
        </p>

        {/* Room list */}
        {rooms.length > 0 && (
          <div style={{ maxHeight: '320px', overflowY: 'auto', marginBottom: '10px' }}>
            {rooms.map(room => (
              <div key={room.id} style={{
                marginBottom: '8px', padding: '8px 10px',
                background: 'rgba(255,255,255,0.07)', borderRadius: '6px',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                  <p style={{ margin: 0, fontSize: '13px', fontWeight: 'bold', wordBreak: 'break-word', flex: 1, minWidth: 0 }}>
                    {room.name}
                    <span style={{ marginLeft: '6px', fontSize: '10px', color: '#9ca3af', fontWeight: 'normal' }}>
                      {room.role}
                    </span>
                  </p>
                  <button
                    onClick={() => onEnterRoom(room.id)}
                    title={`Teleport to ${room.name}`}
                    style={{
                      flexShrink: 0, marginLeft: '6px',
                      background: 'rgba(99,102,241,0.8)', color: 'white',
                      border: 'none', borderRadius: '4px',
                      padding: '2px 7px', fontSize: '14px', cursor: 'pointer', lineHeight: 1.4,
                    }}
                    onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(99,102,241,1)'; }}
                    onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(99,102,241,0.8)'; }}
                  >
                    →
                  </button>
                </div>
                <div style={{ display: 'flex', gap: '5px' }}>
                  <button
                    onClick={() => handleToggleLinkAccess(room.id, room.linkAccess)}
                    title={room.linkAccess ? 'Anyone with link can join — click to restrict' : 'Invite only — click to open link access'}
                    style={{
                      flex: 1, padding: '3px 6px', fontSize: '11px', borderRadius: '4px',
                      border: 'none', cursor: 'pointer',
                      background: room.linkAccess ? '#16a34a' : '#4b5563', color: 'white',
                    }}
                  >
                    {room.linkAccess ? '🔗 Link open' : '🔒 Invite only'}
                  </button>
                  <button
                    onClick={() => copyRoomLink(room.id)}
                    style={{
                      padding: '3px 8px', fontSize: '11px', borderRadius: '4px',
                      border: 'none', cursor: 'pointer',
                      background: '#2563eb', color: 'white',
                    }}
                  >
                    Copy link
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Create room */}
        {!showCreateForm ? (
          <button
            onClick={() => setShowCreateForm(true)}
            style={{
              width: '100%', padding: '8px', fontSize: '13px',
              background: '#7c3aed', color: 'white',
              border: 'none', borderRadius: '6px', cursor: 'pointer', marginBottom: '8px',
            }}
          >
            + Create Room
          </button>
        ) : (
          <form onSubmit={handleCreateRoom} style={{ marginBottom: '8px' }}>
            {error && (
              <p style={{ margin: '0 0 6px 0', fontSize: '12px', color: '#f87171' }}>{error}</p>
            )}
            <input
              value={newRoomName}
              onChange={e => setNewRoomName(e.target.value)}
              placeholder="Room name"
              required
              autoFocus
              style={{
                width: '100%', padding: '7px', marginBottom: '7px',
                background: 'rgba(255,255,255,0.1)',
                border: '1px solid rgba(255,255,255,0.3)',
                borderRadius: '4px', color: 'white', fontSize: '13px',
                boxSizing: 'border-box',
              }}
            />
            <label style={{
              display: 'flex', alignItems: 'center', gap: '7px',
              fontSize: '12px', marginBottom: '8px', cursor: 'pointer',
            }}>
              <input
                type="checkbox"
                checked={newRoomLinkAccess}
                onChange={e => setNewRoomLinkAccess(e.target.checked)}
              />
              Anyone with link can join
            </label>
            <div style={{ display: 'flex', gap: '6px' }}>
              <button
                type="submit"
                disabled={loading || !newRoomName.trim()}
                style={{
                  flex: 1, padding: '6px', fontSize: '12px',
                  background: loading ? '#6b7280' : '#7c3aed', color: 'white',
                  border: 'none', borderRadius: '4px', cursor: 'pointer',
                }}
              >
                {loading ? 'Creating…' : 'Create'}
              </button>
              <button
                type="button"
                onClick={() => { setShowCreateForm(false); setError(null); setNewRoomName(''); }}
                style={{
                  flex: 1, padding: '6px', fontSize: '12px',
                  background: '#374151', color: 'white',
                  border: 'none', borderRadius: '4px', cursor: 'pointer',
                }}
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        <button
          onClick={() => signOut().then(() => navigate('/login'))}
          style={{
            width: '100%', padding: '7px', fontSize: '13px',
            background: '#dc2626', color: 'white',
            border: 'none', borderRadius: '6px', cursor: 'pointer',
          }}
        >
          Sign Out
        </button>
      </div>

      {/* Empty state hint */}
      {rooms.length === 0 && (
        <div style={{
          position: 'absolute', bottom: '40px', left: '50%',
          transform: 'translateX(-50%)',
          color: 'white', background: 'rgba(0,0,0,0.72)',
          padding: '14px 24px', borderRadius: '8px',
          fontFamily: 'monospace', textAlign: 'center', zIndex: 100,
        }}>
          No rooms yet — create one using the panel on the right!
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
            position: 'absolute', bottom: '40px', left: '60px',
            width: '100px', height: '100px', borderRadius: '50%',
            background: 'rgba(255,255,255,0.1)',
            border: '2px solid rgba(255,255,255,0.3)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 200, touchAction: 'none',
            opacity: joystickActive ? 1 : 0.5,
          }}
        >
          <div style={{
            width: '40px', height: '40px', borderRadius: '50%',
            background: 'rgba(255,255,255,0.6)',
            transform: `translate(${joystickKnob.x}px, ${joystickKnob.y}px)`,
            transition: joystickActive ? 'none' : 'transform 0.1s',
          }} />
        </div>
      )}
    </div>
  );
}
