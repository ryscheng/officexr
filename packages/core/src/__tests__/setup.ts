import { vi } from 'vitest';
import '@testing-library/jest-dom';

// ── Inline mock factories for vi.mock (hoisted context) ─────────────────────
// vi.mock factories run before imports, so we can't reference external helpers.
// Keep these minimal — the full helpers are in helpers.ts for test-level use.

function inlineMockChannel() {
  return {
    on: vi.fn().mockReturnThis(),
    send: vi.fn().mockResolvedValue('ok'),
    track: vi.fn().mockResolvedValue('ok'),
    untrack: vi.fn().mockResolvedValue('ok'),
    subscribe: vi.fn().mockReturnThis(),
    presenceState: vi.fn(() => ({})),
  };
}

function inlineMockQueryBuilder() {
  const result = { data: null, error: null };
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(result),
    maybeSingle: vi.fn().mockResolvedValue(result),
    upsert: vi.fn().mockResolvedValue(result),
    then: vi.fn((cb: Function) => Promise.resolve(result).then(cb)),
  };
}

function inlineMockVector3(x = 0, y = 0, z = 0) {
  const v: any = { x, y, z };
  v.set = vi.fn((nx: number, ny: number, nz: number) => { v.x = nx; v.y = ny; v.z = nz; return v; });
  v.setY = vi.fn((ny: number) => { v.y = ny; return v; });
  v.copy = vi.fn((o: any) => { v.x = o.x; v.y = o.y; v.z = o.z; return v; });
  v.clone = vi.fn(() => inlineMockVector3(v.x, v.y, v.z));
  v.add = vi.fn((o: any) => { v.x += o.x; v.y += o.y; v.z += o.z; return v; });
  v.addScaledVector = vi.fn((o: any, s: number) => { v.x += o.x * s; v.y += o.y * s; v.z += o.z * s; return v; });
  v.subVectors = vi.fn((a: any, b: any) => { v.x = a.x - b.x; v.y = a.y - b.y; v.z = a.z - b.z; return v; });
  v.multiplyScalar = vi.fn((s: number) => { v.x *= s; v.y *= s; v.z *= s; return v; });
  v.normalize = vi.fn(() => { const l = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z); if (l > 0) { v.x /= l; v.y /= l; v.z /= l; } return v; });
  v.length = vi.fn(() => Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z));
  v.lengthSq = vi.fn(() => v.x * v.x + v.y * v.y + v.z * v.z);
  v.distanceTo = vi.fn((o: any) => Math.sqrt((v.x - o.x) ** 2 + (v.y - o.y) ** 2 + (v.z - o.z) ** 2));
  v.distanceToSquared = vi.fn((o: any) => (v.x - o.x) ** 2 + (v.y - o.y) ** 2 + (v.z - o.z) ** 2);
  v.lerp = vi.fn((o: any, a: number) => { v.x += (o.x - v.x) * a; v.y += (o.y - v.y) * a; v.z += (o.z - v.z) * a; return v; });
  v.applyAxisAngle = vi.fn(() => v);
  return v;
}

function inlineMockGroup(userData: any = {}) {
  const s: any = { x: 1, y: 1, z: 1 };
  s.set = vi.fn((nx: number, ny: number, nz: number) => { s.x = nx; s.y = ny; s.z = nz; return s; });
  return {
    position: inlineMockVector3(),
    rotation: { x: 0, y: 0, z: 0, order: 'XYZ' },
    scale: s,
    visible: true,
    userData,
    children: [],
    add: vi.fn(),
    remove: vi.fn(),
    traverse: vi.fn((cb: Function) => cb({ isMesh: false })),
    lookAt: vi.fn(),
  };
}

// ── Mock @/lib/supabase ─────────────────────────────────────────────────────
vi.mock('@/lib/supabase', () => ({
  supabase: {
    channel: vi.fn(() => inlineMockChannel()),
    removeChannel: vi.fn(),
    from: vi.fn(() => inlineMockQueryBuilder()),
  },
}));

// ── Mock three ──────────────────────────────────────────────────────────────
// All constructors use regular `function` expressions so they work with `new`.
vi.mock('three', () => {
  function MockScene() {
    return { add: vi.fn(), remove: vi.fn(), background: null, children: [], traverse: vi.fn() };
  }
  function MockPerspectiveCamera() {
    const rot: any = { x: 0, y: 0, z: 0, order: 'XYZ' };
    rot.set = vi.fn(function(x: number, y: number, z: number) { rot.x = x; rot.y = y; rot.z = z; });
    return {
      position: inlineMockVector3(0, 1.6, 5),
      rotation: rot, aspect: 1, fov: 75, near: 0.1, far: 1000,
      updateProjectionMatrix: vi.fn(), lookAt: vi.fn(),
    };
  }
  function MockOrthographicCamera() {
    return {
      position: inlineMockVector3(0, 50, 0), up: inlineMockVector3(0, 0, -1),
      left: -10, right: 10, top: 10, bottom: -10, near: 0.1, far: 200, zoom: 1,
      updateProjectionMatrix: vi.fn(), lookAt: vi.fn(),
    };
  }
  function MockWebGLRenderer() {
    return {
      setSize: vi.fn(), setPixelRatio: vi.fn(), render: vi.fn(), dispose: vi.fn(),
      toneMapping: 0, toneMappingExposure: 1, outputColorSpace: '',
      shadowMap: { enabled: false, type: 0 },
      domElement: document.createElement('canvas'),
      xr: { enabled: false, setReferenceSpaceType: vi.fn() },
    };
  }
  function MockVector3(x?: number, y?: number, z?: number) {
    return inlineMockVector3(x ?? 0, y ?? 0, z ?? 0);
  }
  function MockColor() {
    return { r: 0, g: 0, b: 0, setHex: vi.fn().mockReturnThis(), set: vi.fn().mockReturnThis(), getHex: vi.fn().mockReturnValue(0) };
  }
  function MockGroup() { return inlineMockGroup(); }
  function MockMesh() {
    return {
      position: inlineMockVector3(), rotation: { x: 0, y: 0, z: 0 },
      visible: true, isMesh: true, userData: {},
      geometry: { dispose: vi.fn() },
      material: { color: { setHex: vi.fn(), getHex: vi.fn().mockReturnValue(0), set: vi.fn() }, transparent: false, opacity: 1, dispose: vi.fn() },
    };
  }
  function MockGeo() { return { dispose: vi.fn() }; }
  function MockMaterial() { return { color: { setHex: vi.fn(), getHex: vi.fn().mockReturnValue(0), set: vi.fn() }, transparent: false, opacity: 1, side: 0, dispose: vi.fn() }; }
  function MockBasicMaterial() { return { color: { setHex: vi.fn(), set: vi.fn() }, dispose: vi.fn() }; }
  function MockLight() { return inlineMockGroup(); }
  function MockDirectionalLight() {
    return {
      ...inlineMockGroup(), castShadow: false,
      shadow: { mapSize: { width: 0, height: 0 }, camera: { near: 0, far: 0, left: 0, right: 0, top: 0, bottom: 0 } },
      target: { position: inlineMockVector3() },
    };
  }
  function MockSpotLight() { return { ...inlineMockGroup(), target: { position: inlineMockVector3() } }; }
  function MockSprite() { return inlineMockGroup(); }
  function MockSpriteMaterial() { return { map: null, dispose: vi.fn() }; }

  return {
    Scene: vi.fn().mockImplementation(MockScene),
    PerspectiveCamera: vi.fn().mockImplementation(MockPerspectiveCamera),
    OrthographicCamera: vi.fn().mockImplementation(MockOrthographicCamera),
    WebGLRenderer: vi.fn().mockImplementation(MockWebGLRenderer),
    Vector3: vi.fn().mockImplementation(MockVector3),
    Color: vi.fn().mockImplementation(MockColor),
    Group: vi.fn().mockImplementation(MockGroup),
    Mesh: vi.fn().mockImplementation(MockMesh),
    SphereGeometry: vi.fn().mockImplementation(MockGeo),
    MeshStandardMaterial: vi.fn().mockImplementation(MockMaterial),
    MeshBasicMaterial: vi.fn().mockImplementation(MockBasicMaterial),
    BoxGeometry: vi.fn().mockImplementation(MockGeo),
    PlaneGeometry: vi.fn().mockImplementation(MockGeo),
    CylinderGeometry: vi.fn().mockImplementation(MockGeo),
    CircleGeometry: vi.fn().mockImplementation(MockGeo),
    RingGeometry: vi.fn().mockImplementation(MockGeo),
    AmbientLight: vi.fn().mockImplementation(MockLight),
    DirectionalLight: vi.fn().mockImplementation(MockDirectionalLight),
    HemisphereLight: vi.fn().mockImplementation(MockLight),
    PointLight: vi.fn().mockImplementation(MockLight),
    SpotLight: vi.fn().mockImplementation(MockSpotLight),
    ConeGeometry: vi.fn().mockImplementation(MockGeo),
    FogExp2: vi.fn(),
    DoubleSide: 2, FrontSide: 0, BackSide: 1,
    ACESFilmicToneMapping: 6,
    SRGBColorSpace: 'srgb', LinearSRGBColorSpace: 'srgb-linear',
    EquirectangularReflectionMapping: 303,
    RepeatWrapping: 1000,
    LinearFilter: 1006,
    DataTexture: vi.fn().mockImplementation(function() { return { dispose: vi.fn() }; }),
    TextureLoader: vi.fn().mockImplementation(function() { return { load: vi.fn() }; }),
    CanvasTexture: vi.fn().mockImplementation(function() {
      return { dispose: vi.fn(), wrapS: 0, wrapT: 0, repeat: { set: vi.fn() } };
    }),
    Sprite: vi.fn().mockImplementation(MockSprite),
    SpriteMaterial: vi.fn().mockImplementation(MockSpriteMaterial),
    Raycaster: vi.fn().mockImplementation(function() { return { setFromCamera: vi.fn(), intersectObjects: vi.fn().mockReturnValue([]) }; }),
    Vector2: vi.fn().mockImplementation(function(x: number, y: number) { return { x: x ?? 0, y: y ?? 0 }; }),
  };
});

// ── Mock EXRLoader ──────────────────────────────────────────────────────────
vi.mock('three/examples/jsm/loaders/EXRLoader.js', () => ({
  EXRLoader: vi.fn().mockImplementation(function() { return { load: vi.fn() }; }),
}));

// ── Mock .exr asset import ──────────────────────────────────────────────────
vi.mock('../assets/hdri/lilienstein_4k.exr?url', () => ({ default: 'mock-hdri-url' }));

// ── Mock @/components/Avatar ────────────────────────────────────────────────
vi.mock('@/components/Avatar', () => ({
  createAvatar: vi.fn((_scene: any, data: any, cb?: Function) => {
    const group = inlineMockGroup(data);
    if (cb) cb({
      mixer: { update: vi.fn(), stopAllAction: vi.fn() },
      actions: new Map([
        ['idle', { play: vi.fn(), stop: vi.fn(), fadeIn: vi.fn().mockReturnThis(), reset: vi.fn().mockReturnThis() }],
        ['walk', { play: vi.fn(), stop: vi.fn(), fadeIn: vi.fn().mockReturnThis(), reset: vi.fn().mockReturnThis() }],
      ]),
      activeAction: 'idle',
    });
    return group;
  }),
  switchAnimation: vi.fn(),
  updateAvatar: vi.fn(),
}));

// ── Mock @/components/EmojiConfetti ─────────────────────────────────────────
vi.mock('@/components/EmojiConfetti', () => ({
  EMOJI_MAP: { '1': '👋', '2': '👍', '3': '❤️', '4': '😂', '5': '🎉' },
  spawnConfetti: vi.fn(),
  updateParticles: vi.fn(),
}));

// ── Mock @/lib/jaasJwt ──────────────────────────────────────────────────────
vi.mock('@/lib/jaasJwt', () => ({
  generateJaaSJwt: vi.fn().mockResolvedValue('mock-jwt-token'),
}));

// ── Browser API stubs ───────────────────────────────────────────────────────

// RTCPeerConnection
globalThis.RTCPeerConnection = vi.fn(() => ({
  onicecandidate: null, ontrack: null, remoteDescription: null, localDescription: null,
  createOffer: vi.fn().mockResolvedValue({ type: 'offer', sdp: 'mock-offer-sdp' }),
  createAnswer: vi.fn().mockResolvedValue({ type: 'answer', sdp: 'mock-answer-sdp' }),
  setLocalDescription: vi.fn().mockResolvedValue(undefined),
  setRemoteDescription: vi.fn().mockResolvedValue(undefined),
  addTrack: vi.fn(), addIceCandidate: vi.fn().mockResolvedValue(undefined), close: vi.fn(),
})) as any;
globalThis.RTCIceCandidate = vi.fn((init: any) => init) as any;
globalThis.RTCSessionDescription = vi.fn((init: any) => init) as any;

// MediaDevices
if (!navigator.mediaDevices) {
  Object.defineProperty(navigator, 'mediaDevices', {
    value: { getDisplayMedia: vi.fn(), getUserMedia: vi.fn() },
    configurable: true, writable: true,
  });
} else {
  navigator.mediaDevices.getDisplayMedia = vi.fn() as any;
  navigator.mediaDevices.getUserMedia = vi.fn() as any;
}

// Pointer lock
if (!document.exitPointerLock) {
  document.exitPointerLock = vi.fn();
}

// AudioContext
globalThis.AudioContext = vi.fn().mockImplementation(function MockAudioContext() {
  return {
    state: 'running',
    resume: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    createAnalyser: vi.fn(() => ({
      fftSize: 512, frequencyBinCount: 256, getByteFrequencyData: vi.fn(),
    })),
    createMediaStreamSource: vi.fn(() => ({ connect: vi.fn() })),
  };
}) as any;

// Permissions API
if (!navigator.permissions) {
  Object.defineProperty(navigator, 'permissions', {
    value: { query: vi.fn().mockResolvedValue({ state: 'prompt' }) },
    configurable: true,
  });
}

// Canvas 2D context (jsdom doesn't have canvas support)
const originalCreateElement = document.createElement.bind(document);
vi.spyOn(document, 'createElement').mockImplementation((tag: string, options?: any) => {
  const el = originalCreateElement(tag, options);
  if (tag === 'canvas') {
    (el as any).getContext = vi.fn(() => ({
      fillStyle: '', strokeStyle: '', font: '', textAlign: '', textBaseline: '',
      fillRect: vi.fn(), strokeRect: vi.fn(), clearRect: vi.fn(),
      fillText: vi.fn(), strokeText: vi.fn(), measureText: vi.fn(() => ({ width: 10 })),
      beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), arc: vi.fn(), closePath: vi.fn(),
      fill: vi.fn(), stroke: vi.fn(), save: vi.fn(), restore: vi.fn(),
      translate: vi.fn(), rotate: vi.fn(), scale: vi.fn(),
      drawImage: vi.fn(), createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
      canvas: { width: 256, height: 256 },
    }));
    (el as any).width = 256;
    (el as any).height = 256;
  }
  return el;
});

// isSecureContext
Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true });

// navigator.xr
Object.defineProperty(navigator, 'xr', { value: undefined, configurable: true, writable: true });

// requestAnimationFrame / cancelAnimationFrame
if (typeof globalThis.requestAnimationFrame === 'undefined') {
  globalThis.requestAnimationFrame = vi.fn((cb: Function) => setTimeout(cb, 16) as unknown as number);
  globalThis.cancelAnimationFrame = vi.fn((id: number) => clearTimeout(id));
}
