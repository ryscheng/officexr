import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as THREE from 'three';
import { supabase } from '@/lib/supabase';
import { useAuth, signOut } from '@/hooks/useAuth';

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
      const { data: office, error: officeError } = await supabase
        .from('offices')
        .insert({ name: newRoomName.trim(), link_access: newRoomLinkAccess })
        .select()
        .single();
      if (officeError) throw officeError;

      const { error: memberError } = await supabase.from('office_members').insert({
        office_id: office.id,
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

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
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

    // Portals
    const portals: Array<{ position: THREE.Vector3; roomId: string; roomName: string }> = [];
    const count = rooms.length;

    rooms.forEach((room, i) => {
      const color = PORTAL_COLORS[i % PORTAL_COLORS.length];
      const x = count <= 1 ? 0 : (i - (count - 1) / 2) * 5.5;
      const portalZ = -8;
      const portalY = 2.5;

      const group = new THREE.Group();
      group.position.set(x, portalY, portalZ);
      scene.add(group);

      // Glowing ring
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(2, 0.13, 16, 48),
        new THREE.MeshStandardMaterial({
          color,
          emissive: color,
          emissiveIntensity: 0.9,
          metalness: 0.4,
          roughness: 0.3,
        })
      );
      group.add(ring);

      // Translucent backdrop plane
      group.add(new THREE.Mesh(
        new THREE.PlaneGeometry(3.9, 5.5),
        new THREE.MeshStandardMaterial({
          color,
          emissive: color,
          emissiveIntensity: 0.08,
          transparent: true,
          opacity: 0.18,
          side: THREE.DoubleSide,
        })
      ));

      // Point light for halo glow
      const light = new THREE.PointLight(color, 1.8, 9);
      group.add(light);

      // Text label above the ring
      const sprite = makeTextSprite(room.name, color);
      sprite.position.set(0, 3.3, 0);
      group.add(sprite);

      // Proximity check uses eye-height position in front of portal
      portals.push({ position: new THREE.Vector3(x, 1.6, portalZ), roomId: room.id, roomName: room.name });
    });

    portalsRef.current = portals;
    enteringRef.current = false;

    // Mouse look (pointer lock)
    let cameraPitch = 0;
    let cameraYaw = 0;

    const handleCanvasClick = () => renderer.domElement.requestPointerLock();
    const handleMouseMove = (e: MouseEvent) => {
      if (document.pointerLockElement !== renderer.domElement) return;
      cameraYaw -= (e.movementX || 0) * 0.002;
      cameraPitch -= (e.movementY || 0) * 0.002;
      cameraPitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, cameraPitch));
      camera.rotation.set(cameraPitch, cameraYaw, 0, 'YXZ');
    };
    const handlePointerLockChange = () =>
      setMouseLockActive(document.pointerLockElement === renderer.domElement);

    renderer.domElement.addEventListener('click', handleCanvasClick);
    renderer.domElement.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('pointerlockchange', handlePointerLockChange);

    // WASD movement
    const keys: Record<string, boolean> = {};
    const onKeyDown = (e: KeyboardEvent) => { keys[e.key.toLowerCase()] = true; };
    const onKeyUp = (e: KeyboardEvent) => { keys[e.key.toLowerCase()] = false; };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    const onResize = () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    };
    window.addEventListener('resize', onResize);

    const moveSpeed = 0.05;
    let rafId: number;

    const animate = () => {
      rafId = requestAnimationFrame(animate);

      // WASD
      const forward = new THREE.Vector3();
      const right = new THREE.Vector3();
      camera.getWorldDirection(forward);
      forward.y = 0;
      forward.normalize();
      right.crossVectors(forward, new THREE.Vector3(0, 1, 0));

      if (keys['w'] || keys['arrowup'])    camera.position.addScaledVector(forward, moveSpeed);
      if (keys['s'] || keys['arrowdown'])  camera.position.addScaledVector(forward, -moveSpeed);
      if (keys['a'] || keys['arrowleft'])  camera.position.addScaledVector(right, -moveSpeed);
      if (keys['d'] || keys['arrowright']) camera.position.addScaledVector(right, moveSpeed);
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
      document.removeEventListener('pointerlockchange', handlePointerLockChange);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('resize', onResize);
      if (document.pointerLockElement === renderer.domElement) document.exitPointerLock();
      if (containerRef.current?.contains(renderer.domElement)) {
        containerRef.current.removeChild(renderer.domElement);
      }
      renderer.dispose();
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

      {/* Controls (top-left) */}
      <div style={{
        position: 'absolute', top: '20px', left: '20px',
        color: 'white', background: 'rgba(0,0,0,0.72)',
        padding: '14px 18px', borderRadius: '8px', fontFamily: 'monospace', zIndex: 100,
      }}>
        <p style={{ margin: '0 0 8px 0', fontWeight: 'bold', fontSize: '14px' }}>Your Lobby</p>
        <p style={{ margin: '3px 0', fontSize: '12px' }}>W/A/S/D — Move</p>
        <p style={{ margin: '3px 0', fontSize: '12px' }}>Click — Enable Mouse Look</p>
        <p style={{ margin: '3px 0', fontSize: '12px' }}>Esc — Exit Mouse Look</p>
        <p style={{ margin: '6px 0 0 0', fontSize: '12px', color: '#7dd3fc' }}>
          Walk into a glowing portal to enter a room
        </p>
      </div>

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
                <p style={{ margin: '0 0 6px 0', fontSize: '13px', fontWeight: 'bold', wordBreak: 'break-word' }}>
                  {room.name}
                  <span style={{ marginLeft: '6px', fontSize: '10px', color: '#9ca3af', fontWeight: 'normal' }}>
                    {room.role}
                  </span>
                </p>
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
    </div>
  );
}
