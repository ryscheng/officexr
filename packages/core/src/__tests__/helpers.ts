import { vi } from 'vitest';

// ─── Lightweight Vector3 ────────────────────────────────────────────────────
// Implements the subset of THREE.Vector3 actually used by the hooks.

export class MockVector3 {
  x: number;
  y: number;
  z: number;

  constructor(x = 0, y = 0, z = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
  }

  set(x: number, y: number, z: number) {
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }

  setY(y: number) {
    this.y = y;
    return this;
  }

  copy(v: MockVector3) {
    this.x = v.x;
    this.y = v.y;
    this.z = v.z;
    return this;
  }

  clone() {
    return new MockVector3(this.x, this.y, this.z);
  }

  add(v: MockVector3) {
    this.x += v.x;
    this.y += v.y;
    this.z += v.z;
    return this;
  }

  addScaledVector(v: MockVector3, s: number) {
    this.x += v.x * s;
    this.y += v.y * s;
    this.z += v.z * s;
    return this;
  }

  subVectors(a: MockVector3, b: MockVector3) {
    this.x = a.x - b.x;
    this.y = a.y - b.y;
    this.z = a.z - b.z;
    return this;
  }

  multiplyScalar(s: number) {
    this.x *= s;
    this.y *= s;
    this.z *= s;
    return this;
  }

  normalize() {
    const len = this.length();
    if (len > 0) this.multiplyScalar(1 / len);
    return this;
  }

  length() {
    return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
  }

  lengthSq() {
    return this.x * this.x + this.y * this.y + this.z * this.z;
  }

  distanceTo(v: MockVector3) {
    return Math.sqrt(this.distanceToSquared(v));
  }

  distanceToSquared(v: MockVector3) {
    const dx = this.x - v.x;
    const dy = this.y - v.y;
    const dz = this.z - v.z;
    return dx * dx + dy * dy + dz * dz;
  }

  lerp(v: MockVector3, alpha: number) {
    this.x += (v.x - this.x) * alpha;
    this.y += (v.y - this.y) * alpha;
    this.z += (v.z - this.z) * alpha;
    return this;
  }

  applyAxisAngle() {
    return this;
  }
}

// ─── Mock Three.js module ───────────────────────────────────────────────────

export function createThreeMock() {
  const mockScene = () => ({
    add: vi.fn(),
    remove: vi.fn(),
    background: null,
    children: [],
    traverse: vi.fn(),
  });

  const mockPerspectiveCamera = () => {
    const cam: any = {
      position: new MockVector3(0, 1.6, 5),
      rotation: { x: 0, y: 0, z: 0, order: 'XYZ' },
      aspect: 1,
      fov: 75,
      near: 0.1,
      far: 1000,
      updateProjectionMatrix: vi.fn(),
      lookAt: vi.fn(),
    };
    return cam;
  };

  const mockOrthographicCamera = () => ({
    position: new MockVector3(0, 50, 0),
    up: new MockVector3(0, 0, -1),
    left: -10,
    right: 10,
    top: 10,
    bottom: -10,
    near: 0.1,
    far: 200,
    zoom: 1,
    updateProjectionMatrix: vi.fn(),
    lookAt: vi.fn(),
  });

  const mockRenderer = () => ({
    setSize: vi.fn(),
    setPixelRatio: vi.fn(),
    render: vi.fn(),
    dispose: vi.fn(),
    toneMapping: 0,
    toneMappingExposure: 1,
    outputColorSpace: '',
    shadowMap: { enabled: false, type: 0 },
    domElement: document.createElement('canvas'),
    xr: { enabled: false, setReferenceSpaceType: vi.fn() },
  });

  return {
    Scene: vi.fn().mockImplementation(mockScene),
    PerspectiveCamera: vi.fn().mockImplementation(mockPerspectiveCamera),
    OrthographicCamera: vi.fn().mockImplementation(mockOrthographicCamera),
    WebGLRenderer: vi.fn().mockImplementation(mockRenderer),
    Vector3: MockVector3,
    Color: vi.fn().mockImplementation((c?: any) => ({
      r: 0, g: 0, b: 0,
      setHex: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      getHex: vi.fn(() => typeof c === 'number' ? c : 0),
    })),
    Group: vi.fn().mockImplementation(() => createMockGroup()),
    Mesh: vi.fn().mockImplementation(() => createMockMesh()),
    SphereGeometry: vi.fn().mockImplementation(() => ({ dispose: vi.fn() })),
    MeshStandardMaterial: vi.fn().mockImplementation(() => ({
      color: { setHex: vi.fn(), getHex: vi.fn(() => 0), set: vi.fn() },
      transparent: false,
      opacity: 1,
      side: 0,
      dispose: vi.fn(),
    })),
    MeshBasicMaterial: vi.fn().mockImplementation(() => ({
      color: { setHex: vi.fn(), set: vi.fn() },
      dispose: vi.fn(),
    })),
    BoxGeometry: vi.fn().mockImplementation(() => ({ dispose: vi.fn() })),
    PlaneGeometry: vi.fn().mockImplementation(() => ({ dispose: vi.fn() })),
    CylinderGeometry: vi.fn().mockImplementation(() => ({ dispose: vi.fn() })),
    CircleGeometry: vi.fn().mockImplementation(() => ({ dispose: vi.fn() })),
    RingGeometry: vi.fn().mockImplementation(() => ({ dispose: vi.fn() })),
    AmbientLight: vi.fn().mockImplementation(() => createMockGroup()),
    DirectionalLight: vi.fn().mockImplementation(() => ({
      ...createMockGroup(),
      shadow: { mapSize: { width: 0, height: 0 }, camera: { near: 0, far: 0, left: 0, right: 0, top: 0, bottom: 0 } },
      castShadow: false,
      target: { position: new MockVector3() },
    })),
    HemisphereLight: vi.fn().mockImplementation(() => createMockGroup()),
    PointLight: vi.fn().mockImplementation(() => createMockGroup()),
    SpotLight: vi.fn().mockImplementation(() => ({ ...createMockGroup(), target: { position: new MockVector3() } })),
    FogExp2: vi.fn(),
    DoubleSide: 2,
    FrontSide: 0,
    BackSide: 1,
    ACESFilmicToneMapping: 6,
    SRGBColorSpace: 'srgb',
    LinearSRGBColorSpace: 'srgb-linear',
    EquirectangularReflectionMapping: 303,
    TextureLoader: vi.fn().mockImplementation(() => ({ load: vi.fn() })),
    CanvasTexture: vi.fn().mockImplementation(() => ({ dispose: vi.fn() })),
    Sprite: vi.fn().mockImplementation(() => createMockGroup()),
    SpriteMaterial: vi.fn().mockImplementation(() => ({ map: null, dispose: vi.fn() })),
    Raycaster: vi.fn().mockImplementation(() => ({
      setFromCamera: vi.fn(),
      intersectObjects: vi.fn(() => []),
    })),
    Vector2: vi.fn().mockImplementation((x = 0, y = 0) => ({ x, y })),
  };
}

// ─── Mock factories ─────────────────────────────────────────────────────────

export function createMockGroup(userData: any = {}): any {
  return {
    position: new MockVector3(),
    rotation: { x: 0, y: 0, z: 0, order: 'XYZ' },
    scale: { x: 1, y: 1, z: 1 },
    visible: true,
    userData,
    children: [],
    add: vi.fn(),
    remove: vi.fn(),
    traverse: vi.fn((cb: Function) => cb({ isMesh: false })),
    lookAt: vi.fn(),
  };
}

export function createMockMesh(userData: any = {}): any {
  return {
    position: new MockVector3(),
    rotation: { x: 0, y: 0, z: 0 },
    visible: true,
    isMesh: true,
    userData,
    geometry: { dispose: vi.fn() },
    material: {
      color: { setHex: vi.fn(), getHex: vi.fn(() => 0), set: vi.fn() },
      transparent: false,
      opacity: 1,
      dispose: vi.fn(),
    },
  };
}

export function createMockAnimationState(): any {
  return {
    mixer: {
      update: vi.fn(),
      stopAllAction: vi.fn(),
    },
    actions: new Map([
      ['idle', { play: vi.fn(), stop: vi.fn(), fadeIn: vi.fn().mockReturnThis(), reset: vi.fn().mockReturnThis() }],
      ['walk', { play: vi.fn(), stop: vi.fn(), fadeIn: vi.fn().mockReturnThis(), reset: vi.fn().mockReturnThis() }],
    ]),
    activeAction: 'idle',
  };
}

// ─── Supabase Channel Mock ──────────────────────────────────────────────────

export function createMockChannel(): any {
  // Type → event → handlers[]
  const listeners = new Map<string, Map<string, Function[]>>();

  const mockChannel: any = {
    on: vi.fn((type: string, filter: { event: string }, handler: Function) => {
      if (!listeners.has(type)) listeners.set(type, new Map());
      const typeMap = listeners.get(type)!;
      if (!typeMap.has(filter.event)) typeMap.set(filter.event, []);
      typeMap.get(filter.event)!.push(handler);
      return mockChannel;
    }),
    send: vi.fn().mockResolvedValue('ok'),
    track: vi.fn().mockResolvedValue('ok'),
    untrack: vi.fn().mockResolvedValue('ok'),
    subscribe: vi.fn((cb?: Function) => {
      if (cb) cb('SUBSCRIBED');
      return mockChannel;
    }),
    presenceState: vi.fn(() => ({})),
    // Test helper: fire a registered event
    __fire: (type: string, event: string, payload: any) => {
      listeners.get(type)?.get(event)?.forEach(h => h(payload));
    },
    // Test helper: get registered listeners
    __listeners: listeners,
  };

  return mockChannel;
}

// ─── Supabase Query Builder Mock ────────────────────────────────────────────

export function createMockQueryBuilder(resolveData: any = null, resolveError: any = null) {
  const result = { data: resolveData, error: resolveError };
  const chain: any = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(result),
    maybeSingle: vi.fn().mockResolvedValue(result),
    upsert: vi.fn().mockResolvedValue(result),
    then: vi.fn((cb: Function) => Promise.resolve(result).then(cb)),
  };
  return chain;
}

// ─── RTCPeerConnection Mock ─────────────────────────────────────────────────

export function createMockRTCPeerConnection(): any {
  const mock: any = {
    onicecandidate: null,
    ontrack: null,
    remoteDescription: null,
    localDescription: null,
    createOffer: vi.fn().mockResolvedValue({ type: 'offer', sdp: 'mock-offer-sdp' }),
    createAnswer: vi.fn().mockResolvedValue({ type: 'answer', sdp: 'mock-answer-sdp' }),
    setLocalDescription: vi.fn(async (desc: any) => { mock.localDescription = desc; }),
    setRemoteDescription: vi.fn(async (desc: any) => { mock.remoteDescription = desc; }),
    addTrack: vi.fn(),
    addIceCandidate: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(),
  };
  return mock;
}

// ─── MediaStream Mock ───────────────────────────────────────────────────────

export function createMockMediaStream(): any {
  const videoTrack: any = {
    kind: 'video',
    enabled: true,
    contentHint: '',
    stop: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  const audioTrack: any = {
    kind: 'audio',
    enabled: true,
    stop: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  return {
    getTracks: vi.fn(() => [videoTrack, audioTrack]),
    getVideoTracks: vi.fn(() => [videoTrack]),
    getAudioTracks: vi.fn(() => [audioTrack]),
  };
}

// ─── Ref Helper ─────────────────────────────────────────────────────────────

export function createMockRef<T>(value: T): { current: T } {
  return { current: value };
}
