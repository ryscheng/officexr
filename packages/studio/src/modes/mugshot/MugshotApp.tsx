import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import JSZip from 'jszip';
import { Scene } from '@officexr/world/renderer';
import { CHARACTERS } from '@officexr/world';
import type { CharacterName } from '@officexr/world';
import type {
  BackgroundViewConfig,
  LightingViewConfig,
} from '@officexr/world/renderer';
import {
  buildInMemoryStack,
  createPersistentLocalState,
  type ChannelStack,
  type PersistentLocalState,
} from '../../realtime/services.ts';
import { DEFAULT_VIEW_CONFIG, type ViewConfig } from '../../panels/world/types.ts';

const SELF_ID = 'mugshot-player';
const OFFICE_ID = 'mugshot';
const DEFAULT_CHARACTER: CharacterName = 'Barbarian';

/** Default settled-on-cube body root y. With the 2×2 cube cluster
 * centered on world origin (cube tops at y=1, bottoms at y=-1),
 * and the ball collider at local y=BODY_Y=0.9, radius=0.4 → ball
 * bottom at root+0.5, controller skin 0.01 → root.y = 1 - 0.5 +
 * 0.01 = 0.51. The character's feet (visible bottom of the mesh)
 * end up at wrapper.world.y = root + 0.5 = 1.01, sitting 1 cm
 * above the cube top y=1. */
const DEFAULT_Y_OFFSET = 0.51;

const DEFAULT_DISTANCE_M = 6;
const DEFAULT_CAMERA_HEIGHT = 1.7;
const DEFAULT_VIEWPORT_W = 512;
const DEFAULT_VIEWPORT_H = 512;
const DEFAULT_AZIMUTH: AzimuthDeg = 180;

type AzimuthDeg = 0 | 90 | 180 | 270;

const ANGLE_NAMES: Record<AzimuthDeg, 'north' | 'east' | 'south' | 'west'> = {
  0: 'north',
  90: 'east',
  180: 'south',
  270: 'west',
};

/**
 * Parse the active character from the URL hash. Supports both
 * `#mugshot` (default character) and `#mugshot/<CharacterName>`.
 */
function readCharacterFromHash(): CharacterName {
  if (typeof window === 'undefined') return DEFAULT_CHARACTER;
  const parts = window.location.hash.replace(/^#/, '').split('/');
  const candidate = parts[1];
  if (candidate && (CHARACTERS as readonly string[]).includes(candidate)) {
    return candidate as CharacterName;
  }
  return DEFAULT_CHARACTER;
}

type CubeMode = 'gltf' | 'primitive';

/** The mugshot scene: a 2×2 cube square whose CLUSTER is centered
 * on world origin (0, 0, 0). With voxelSize=2, voxel positions
 * (±0.5, -0.5, ±0.5) translate to world cube centers (±1, 0, ±1)
 * — cluster bbox x∈[-2,2], y∈[-1,1], z∈[-2,2]. Cube tops at
 * world y=1, bottoms at y=-1.
 *
 * Why origin-centered: the fixed camera is set to `lookAt:
 * [0, 0, 0]` so framing is purely a function of azimuth + distance
 * + height + fov — never the character's body root position. Two
 * characters at different body.y heights frame identically.
 *
 * The two layouts share INSTANCE IDs deliberately — when the user
 * flips cubeMode, the SDK store swap to `setWorldObjects` produces
 * the same set of inst.id values, so React-keyed reconciliation
 * in <MapColliders> reuses the same <CuboidCollider> nodes. The
 * colliders are literally identical between modes; only the
 * visible mesh path differs. That's the whole point of the A/B
 * diagnostic. */
const GLTF_CUBES: ReadonlyArray<{
  id: string;
  sourceCommandId: string;
  kindId: string;
  position: [number, number, number];
}> = [
  { id: 'm-0-0', sourceCommandId: 'mugshot', kindId: 'colored_block_blue', position: [-0.5, -0.5, -0.5] },
  { id: 'm-1-0', sourceCommandId: 'mugshot', kindId: 'stone', position: [0.5, -0.5, -0.5] },
  { id: 'm-0-1', sourceCommandId: 'mugshot', kindId: 'stone', position: [-0.5, -0.5, 0.5] },
  { id: 'm-1-1', sourceCommandId: 'mugshot', kindId: 'colored_block_blue', position: [0.5, -0.5, 0.5] },
];

const PRIMITIVE_CUBES: ReadonlyArray<{
  id: string;
  sourceCommandId: string;
  kindId: string;
  position: [number, number, number];
}> = [
  { id: 'm-0-0', sourceCommandId: 'mugshot', kindId: '__primitive_blue', position: [-0.5, -0.5, -0.5] },
  { id: 'm-1-0', sourceCommandId: 'mugshot', kindId: '__primitive_stone', position: [0.5, -0.5, -0.5] },
  { id: 'm-0-1', sourceCommandId: 'mugshot', kindId: '__primitive_stone', position: [-0.5, -0.5, 0.5] },
  { id: 'm-1-1', sourceCommandId: 'mugshot', kindId: '__primitive_blue', position: [0.5, -0.5, 0.5] },
];

function cubesForMode(mode: CubeMode) {
  return mode === 'gltf' ? GLTF_CUBES : PRIMITIVE_CUBES;
}

/** v2 of the mugshot export manifest. Captures rendering inputs but
 * deliberately OMITS `yOffset` — the export always captures at the
 * system's default Y, never a tuned value. If we recorded `yOffset`,
 * the manifest-load round-trip would re-apply the same lift the
 * human used to "fix" the rendering visually, masking the underlying
 * placement bug. The whole point of the mugshot is that baselines
 * show what the system NATURALLY produces; the Y slider in the UI
 * exists only for live diagnostic exploration. */
export interface MugshotManifest {
  schemaVersion: 2;
  character: CharacterName;
  viewportWidth: number;
  viewportHeight: number;
  exportedAt: string;
  fixedCamera: {
    azimuthDeg: number;
    pitchDeg: number;
    height: number;
    fov: number;
    distanceM: number;
  };
  lighting: LightingViewConfig;
  background: BackgroundViewConfig;
}

/** Default lighting bag for the mugshot. Same as the studio's
 * default lighting but with the visible sun disc hidden — a bright
 * disc in the sky would dominate any pixel diff. */
const DEFAULT_MUGSHOT_LIGHTING: LightingViewConfig = {
  ...DEFAULT_VIEW_CONFIG.lighting,
  showSunDisc: false,
};

const DEFAULT_MUGSHOT_BACKGROUND: BackgroundViewConfig =
  DEFAULT_VIEW_CONFIG.background;

/**
 * Mugshot mode: a deterministic 2×2 cube scene with a paused
 * character (no animation), tunable Y / camera angle / distance /
 * viewport. Drives the export-for-test workflow (downloads a ZIP
 * of 4 PNGs + manifest.json) and is the live target for the
 * manifest-driven comparison test.
 *
 * Gravity is disabled on mount so the Y slider works at fine
 * granularity (SceneFrame's auto-warp drops its 0.5 m threshold to
 * zero when gravity is off — see SceneFrame.tsx).
 */
export function MugshotApp() {
  const [local, setLocal] = useState<PersistentLocalState | null>(null);
  const [stack, setStack] = useState<ChannelStack | null>(null);
  const [character, setCharacter] = useState<CharacterName>(() =>
    readCharacterFromHash(),
  );

  // Tunable rendering inputs.
  const [yOffset, setYOffset] = useState(DEFAULT_Y_OFFSET);
  const [azimuthDeg, setAzimuthDeg] = useState<AzimuthDeg>(DEFAULT_AZIMUTH);
  const [distanceM, setDistanceM] = useState(DEFAULT_DISTANCE_M);
  const [cameraHeight, setCameraHeight] = useState(DEFAULT_CAMERA_HEIGHT);
  const [cubeMode, setCubeMode] = useState<CubeMode>('gltf');
  const [viewportWidth, setViewportWidth] = useState(DEFAULT_VIEWPORT_W);
  const [viewportHeight, setViewportHeight] = useState(DEFAULT_VIEWPORT_H);
  const [lighting, setLighting] = useState<LightingViewConfig>(
    DEFAULT_MUGSHOT_LIGHTING,
  );
  const [background, setBackground] = useState<BackgroundViewConfig>(
    DEFAULT_MUGSHOT_BACKGROUND,
  );
  const [exporting, setExporting] = useState(false);

  // Listen for hash changes so `#mugshot/Knight` etc. live-switches.
  useEffect(() => {
    const onHashChange = () => setCharacter(readCharacterFromHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  // Bootstrap: build the local-player + in-memory stack once.
  useEffect(() => {
    const audio = new Audio();
    audio.volume = 0;

    const lp = createPersistentLocalState({
      selfId: SELF_ID,
      officeId: OFFICE_ID,
      // Cluster of cubes is centered on world origin; character
      // stands at origin XZ at the default body-y above the cube
      // tops at y=1.
      startPos: { x: 0, y: DEFAULT_Y_OFFSET, z: 0 },
    });
    setLocal(lp);
    (window as unknown as { __OFFICE_STORE__: typeof lp.store }).__OFFICE_STORE__ =
      lp.store;

    let built: ChannelStack | null = null;
    let cancelled = false;
    buildInMemoryStack({ local: lp, audio })
      .then((s) => {
        if (cancelled) {
          void s.teardown();
          return;
        }
        built = s;
        s.bots.setCount(0).catch(() => {});
        setStack(s);
      })
      .catch((err) => {
        console.warn('[mugshot] stack build failed:', err);
      });

    return () => {
      cancelled = true;
      if (built) void built.teardown();
    };
  }, []);

  // Disable gravity while the Mugshot mode is mounted so the Y
  // slider works with fine granularity. Re-enable on unmount so
  // navigating back to Debug behaves normally. The `__OFFICE_GRAVITY__`
  // hook is published by SceneFrame as soon as Scene mounts; we
  // retry until it appears since Scene mounts after `stack` resolves.
  useEffect(() => {
    if (!stack) return;
    let cancelled = false;
    const tryDisable = () => {
      const g = (
        window as unknown as {
          __OFFICE_GRAVITY__?: { setEnabled: (v: boolean) => void };
        }
      ).__OFFICE_GRAVITY__;
      if (g) {
        g.setEnabled(false);
        return true;
      }
      return false;
    };
    if (!tryDisable()) {
      const id = setInterval(() => {
        if (cancelled || tryDisable()) clearInterval(id);
      }, 50);
      return () => {
        cancelled = true;
        clearInterval(id);
      };
    }
    return () => {
      const g = (
        window as unknown as {
          __OFFICE_GRAVITY__?: { setEnabled: (v: boolean) => void };
        }
      ).__OFFICE_GRAVITY__;
      g?.setEnabled(true);
    };
  }, [stack]);

  // Push the cube field. Re-runs on cubeMode change to swap the
  // kindIds (instance IDs stay the same, so MapColliders' React-
  // keyed reconciliation produces the identical collider tree).
  useEffect(() => {
    if (!local) return;
    local.actions.setWorldObjects({
      cubeSize: 2,
      instances: cubesForMode(cubeMode).map((c) => ({ ...c })),
    });
  }, [local, cubeMode]);

  // Force the rendered character via `avatar.model`.
  useEffect(() => {
    if (!local) return;
    local.actions.upsertPlayer({
      id: SELF_ID,
      avatar: { model: character },
    });
  }, [local, character]);

  // Push the Y offset into the SDK store every time the slider
  // changes. SceneFrame's auto-warp (with gravity off) moves the
  // body to match on the next frame. Character XZ is locked at
  // world origin so the cluster-of-cubes-at-origin scene stays
  // symmetric around the standing position.
  useEffect(() => {
    if (!local) return;
    local.actions.setSelfPosition(
      { x: 0, y: yOffset, z: 0 },
      { x: 0, y: 0, z: 0 },
      0,
    );
  }, [local, yOffset]);

  // Build the live viewConfig from current state. Memoized so Scene
  // doesn't re-mount on every render — only when the tunables
  // actually change.
  const viewConfig: ViewConfig = useMemo(
    () => ({
      ...DEFAULT_VIEW_CONFIG,
      lighting,
      background,
      fixedCamera: {
        ...DEFAULT_VIEW_CONFIG.fixedCamera,
        azimuthDeg,
        pitchDeg: -8,
        height: cameraHeight,
        fov: 40,
        maxOnScreenFrac: 0.45,
        minOnScreenFrac: 0.4,
        lateralFrac: 0,
        distanceM,
        // Camera anchors on world origin — cubes are centered
        // here, so the frame is character-independent.
        lookAt: [0, 0, 0],
      },
    }),
    [lighting, background, azimuthDeg, distanceM, cameraHeight],
  );

  // Expose test hooks for the manifest-load / per-angle capture
  // comparison spec. Production code never reads these.
  const onExportRef = useRef<typeof onExport | null>(null);
  useEffect(() => {
    const win = window as unknown as {
      __OFFICE_MUGSHOT_APPLY_MANIFEST__?: (m: MugshotManifest) => void;
      __OFFICE_MUGSHOT_SET_AZIMUTH__?: (deg: AzimuthDeg) => void;
      __OFFICE_MUGSHOT_SET_Y_OFFSET__?: (y: number) => void;
      __OFFICE_MUGSHOT_SET_CUBE_MODE__?: (mode: CubeMode) => void;
      __OFFICE_MUGSHOT_SET_CAMERA_HEIGHT__?: (h: number) => void;
      __OFFICE_MUGSHOT_TRIGGER_EXPORT__?: (opts?: {
        download?: boolean;
      }) => Promise<void>;
    };
    win.__OFFICE_MUGSHOT_APPLY_MANIFEST__ = (m: MugshotManifest) => {
      setCharacter(m.character);
      // Force Y back to the system default — manifests don't carry
      // yOffset (by design, see the schema comment above). If the
      // human had tuned Y in the live preview before the test ran,
      // this snap ensures the test reproduces exactly what the
      // export captured: the default-Y rendering.
      setYOffset(DEFAULT_Y_OFFSET);
      setDistanceM(m.fixedCamera.distanceM);
      setCameraHeight(m.fixedCamera.height);
      setViewportWidth(m.viewportWidth);
      setViewportHeight(m.viewportHeight);
      setLighting(m.lighting);
      setBackground(m.background);
      // Don't restore azimuthDeg from the manifest — the test driver
      // sets it per-angle via __OFFICE_MUGSHOT_SET_AZIMUTH__.
    };
    win.__OFFICE_MUGSHOT_SET_AZIMUTH__ = (deg) => setAzimuthDeg(deg);
    win.__OFFICE_MUGSHOT_SET_Y_OFFSET__ = (y) => setYOffset(y);
    win.__OFFICE_MUGSHOT_SET_CUBE_MODE__ = (mode) => setCubeMode(mode);
    win.__OFFICE_MUGSHOT_SET_CAMERA_HEIGHT__ = (h) => setCameraHeight(h);
    // Forwards through `onExportRef` so the latest onExport closure
    // is invoked even though this useEffect captured the original.
    win.__OFFICE_MUGSHOT_TRIGGER_EXPORT__ = (opts) =>
      onExportRef.current?.(opts) ?? Promise.resolve();
    return () => {
      delete win.__OFFICE_MUGSHOT_APPLY_MANIFEST__;
      delete win.__OFFICE_MUGSHOT_SET_AZIMUTH__;
      delete win.__OFFICE_MUGSHOT_SET_Y_OFFSET__;
      delete win.__OFFICE_MUGSHOT_SET_CUBE_MODE__;
      delete win.__OFFICE_MUGSHOT_SET_CAMERA_HEIGHT__;
      delete win.__OFFICE_MUGSHOT_TRIGGER_EXPORT__;
    };
  }, []);

  const azimuthBeforeExportRef = useRef<AzimuthDeg>(DEFAULT_AZIMUTH);
  const cubeModeBeforeExportRef = useRef<CubeMode>('gltf');

  const onExport = useCallback(async (opts?: { download?: boolean }) => {
    if (exporting) return;
    setExporting(true);
    azimuthBeforeExportRef.current = azimuthDeg;
    cubeModeBeforeExportRef.current = cubeMode;
    // Diagnostic side-channel for the export-y-offset regression
    // test: records the body's actual pos.y at the moment of each
    // capture. If the export ever silently snaps Y away from the
    // user's tuned value, the test sees the captured Ys are not
    // what the user set and fails loudly.
    const capturedYs: Array<{ mode: string; angle: number; y: number }> = [];
    try {
      // CRITICAL: do NOT snap Y to a default here. The captured
      // PNGs MUST reflect what the user tuned in the live preview —
      // that's the whole point of an ideal-baseline workflow.
      // Y is decoupled from the test's assertion target by being
      // omitted from the MANIFEST (so test-time apply uses default
      // Y and the renderer's natural placement is the diff target),
      // not by being scrubbed out of the captured pixels.

      const zip = new JSZip();
      const angles: AzimuthDeg[] = [0, 90, 180, 270];
      // Capture both cube modes (GLB + primitive) so the ZIP carries
      // the full A/B diagnostic pair. The ZIP nests under `ideal/`
      // so unzipping over `tests/playwright/mugshot-baselines/
      // <Character>/` lands the curated subset in the right place.
      for (const mode of ['gltf', 'primitive'] as const) {
        setCubeMode(mode);
        // Two RAFs for setWorldObjects → ObjectInstances rebuild.
        await waitFrames(2);
        for (const angle of angles) {
          setAzimuthDeg(angle);
          // Two RAFs: React commits the new viewConfig down to
          // Scene → CameraRig; R3F renders the new frame at the
          // new camera. Without this the captured PNG is the
          // previous angle's frame.
          await waitFrames(2);
          const canvas = document.querySelector('canvas') as HTMLCanvasElement | null;
          if (!canvas) throw new Error('[mugshot] no canvas to capture');
          // Record actual body y at capture time (for the
          // regression test; production never reads this).
          const localStore = local?.store;
          if (localStore) {
            const p = localStore.getState().players[SELF_ID];
            if (p) capturedYs.push({ mode, angle, y: p.pos.y });
          }
          const dataUrl = canvas.toDataURL('image/png');
          const base64 = dataUrl.split(',')[1] ?? '';
          const fileName =
            mode === 'gltf'
              ? `${ANGLE_NAMES[angle]}.png`
              : `primitive-${ANGLE_NAMES[angle]}.png`;
          zip.file(`ideal/${fileName}`, base64, { base64: true });
        }
      }
      const manifest: MugshotManifest = {
        schemaVersion: 2,
        character: 'Barbarian', // export is Barbarian-only per spec
        viewportWidth,
        viewportHeight,
        exportedAt: new Date().toISOString(),
        fixedCamera: {
          azimuthDeg,
          pitchDeg: -8,
          height: cameraHeight,
          fov: 40,
          distanceM,
        },
        lighting,
        background,
      };
      zip.file('manifest.json', JSON.stringify(manifest, null, 2));
      const blob = await zip.generateAsync({ type: 'blob' });
      const download = opts?.download !== false;
      if (download) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        a.href = url;
        a.download = `mugshot-Barbarian-${stamp}.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
      (
        window as unknown as {
          __OFFICE_MUGSHOT_LAST_EXPORT__?: {
            capturedYs: Array<{ mode: string; angle: number; y: number }>;
            blobSize: number;
            downloaded: boolean;
          };
        }
      ).__OFFICE_MUGSHOT_LAST_EXPORT__ = {
        capturedYs,
        blobSize: blob.size,
        downloaded: download,
      };
    } catch (err) {
      console.warn('[mugshot] export failed:', err);
    } finally {
      // Restore azimuth + cubeMode. Y is intentionally NOT
      // restored from a saved ref — we never changed it during
      // the export, so there's nothing to restore.
      setAzimuthDeg(azimuthBeforeExportRef.current);
      setCubeMode(cubeModeBeforeExportRef.current);
      setExporting(false);
    }
  }, [
    azimuthDeg,
    distanceM,
    cameraHeight,
    yOffset,
    cubeMode,
    viewportWidth,
    viewportHeight,
    local,
    lighting,
    background,
    exporting,
  ]);

  // Keep the test trigger hook pointed at the latest onExport
  // closure — the window-hook useEffect captured the version from
  // mount time.
  useEffect(() => {
    onExportRef.current = onExport;
  }, [onExport]);

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        minWidth: 0,
        minHeight: 0,
        background: '#0a0a0a',
      }}
    >
      <main
        style={{
          flex: 1,
          minWidth: 0,
          minHeight: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 16,
          overflow: 'auto',
        }}
      >
        <div
          // Fixed-pixel canvas container. R3F sizes the WebGL backing
          // store off this element; with `dpr={1}` the pixel buffer
          // matches exactly so canvas.toDataURL() returns the
          // configured viewport size.
          style={{
            width: viewportWidth,
            height: viewportHeight,
            position: 'relative',
            border: '1px solid #262626',
            background: '#000',
            flexShrink: 0,
          }}
        >
          {stack && local && (
            <Scene
              key={character}
              store={local.store}
              actions={local.actions}
              rules={local.rules}
              bus={local.bus}
              sync={stack.sync}
              handshake={stack.handshake}
              bots={stack.bots}
              selfId={SELF_ID}
              cameraMode="fixed"
              viewConfig={viewConfig}
              worldFocused={false}
              paused={true}
              spawnPoints={[]}
              dpr={1}
            />
          )}
        </div>
      </main>
      <ControlPanel
        character={character}
        onCharacterChange={(c) => {
          window.location.hash = `mugshot/${c}`;
        }}
        yOffset={yOffset}
        onYOffsetChange={setYOffset}
        azimuthDeg={azimuthDeg}
        onAzimuthChange={setAzimuthDeg}
        distanceM={distanceM}
        onDistanceChange={setDistanceM}
        cameraHeight={cameraHeight}
        onCameraHeightChange={setCameraHeight}
        viewportWidth={viewportWidth}
        onViewportWidthChange={setViewportWidth}
        viewportHeight={viewportHeight}
        onViewportHeightChange={setViewportHeight}
        ambientFillIntensity={lighting.ambientFillIntensity ?? 0}
        onAmbientFillChange={(v) =>
          setLighting((prev) => ({ ...prev, ambientFillIntensity: v }))
        }
        cubeMode={cubeMode}
        onCubeModeChange={setCubeMode}
        onExport={onExport}
        exporting={exporting}
      />
    </div>
  );
}

function waitFrames(n: number): Promise<void> {
  return new Promise((resolve) => {
    let i = 0;
    const tick = () => {
      i += 1;
      if (i >= n) resolve();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

interface ControlPanelProps {
  character: CharacterName;
  onCharacterChange: (c: CharacterName) => void;
  yOffset: number;
  onYOffsetChange: (v: number) => void;
  azimuthDeg: AzimuthDeg;
  onAzimuthChange: (v: AzimuthDeg) => void;
  distanceM: number;
  onDistanceChange: (v: number) => void;
  cameraHeight: number;
  onCameraHeightChange: (v: number) => void;
  viewportWidth: number;
  onViewportWidthChange: (v: number) => void;
  viewportHeight: number;
  onViewportHeightChange: (v: number) => void;
  ambientFillIntensity: number;
  onAmbientFillChange: (v: number) => void;
  cubeMode: CubeMode;
  onCubeModeChange: (m: CubeMode) => void;
  onExport: () => void;
  exporting: boolean;
}

function ControlPanel(props: ControlPanelProps) {
  return (
    <aside
      data-studio-panel
      style={{
        width: 280,
        flexShrink: 0,
        background: '#111',
        borderLeft: '1px solid #262626',
        color: '#fafafa',
        font: '12px system-ui, sans-serif',
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        overflowY: 'auto',
      }}
    >
      <Section title="Character">
        <select
          value={props.character}
          onChange={(e) => props.onCharacterChange(e.target.value as CharacterName)}
          style={selectStyle}
        >
          {CHARACTERS.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </Section>

      <Section title={`Y offset · ${props.yOffset.toFixed(2)} m`}>
        <input
          type="range"
          min={1.0}
          max={5.0}
          step={0.01}
          value={props.yOffset}
          onChange={(e) => props.onYOffsetChange(Number(e.target.value))}
          style={rangeStyle}
        />
      </Section>

      <Section title={`Camera distance · ${props.distanceM.toFixed(1)} m`}>
        <input
          type="range"
          min={2}
          max={20}
          step={0.1}
          value={props.distanceM}
          onChange={(e) => props.onDistanceChange(Number(e.target.value))}
          style={rangeStyle}
        />
      </Section>

      <Section title={`Camera height · ${props.cameraHeight.toFixed(2)} m`}>
        <input
          type="range"
          min={0.5}
          max={5}
          step={0.05}
          value={props.cameraHeight}
          onChange={(e) => props.onCameraHeightChange(Number(e.target.value))}
          style={rangeStyle}
        />
      </Section>

      <Section title={`Ambient fill · ${props.ambientFillIntensity.toFixed(2)}`}>
        <input
          type="range"
          min={0}
          max={2}
          step={0.05}
          value={props.ambientFillIntensity}
          onChange={(e) => props.onAmbientFillChange(Number(e.target.value))}
          style={rangeStyle}
        />
      </Section>

      <Section title="Camera angle">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4 }}>
          {([0, 90, 180, 270] as AzimuthDeg[]).map((deg) => (
            <button
              key={deg}
              type="button"
              onClick={() => props.onAzimuthChange(deg)}
              style={{
                padding: '6px 0',
                border: 0,
                borderRadius: 3,
                cursor: 'pointer',
                background: props.azimuthDeg === deg ? '#3b82f6' : '#1f2937',
                color: props.azimuthDeg === deg ? '#fff' : '#cbd5e1',
                fontSize: 11,
                fontWeight: props.azimuthDeg === deg ? 600 : 400,
                textTransform: 'uppercase',
              }}
            >
              {ANGLE_NAMES[deg][0]}
            </button>
          ))}
        </div>
      </Section>

      <Section title="Cubes">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 4 }}>
          {(['gltf', 'primitive'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => props.onCubeModeChange(mode)}
              style={{
                padding: '6px 0',
                border: 0,
                borderRadius: 3,
                cursor: 'pointer',
                background: props.cubeMode === mode ? '#3b82f6' : '#1f2937',
                color: props.cubeMode === mode ? '#fff' : '#cbd5e1',
                fontSize: 11,
                fontWeight: props.cubeMode === mode ? 600 : 400,
                textTransform: 'uppercase',
              }}
            >
              {mode === 'gltf' ? 'GLB' : 'Primitive'}
            </button>
          ))}
        </div>
      </Section>

      <Section title="Viewport (px)">
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input
            type="number"
            min={64}
            max={2048}
            step={1}
            value={props.viewportWidth}
            onChange={(e) => props.onViewportWidthChange(Number(e.target.value) || 1)}
            style={numberStyle}
          />
          <span style={{ opacity: 0.6 }}>×</span>
          <input
            type="number"
            min={64}
            max={2048}
            step={1}
            value={props.viewportHeight}
            onChange={(e) => props.onViewportHeightChange(Number(e.target.value) || 1)}
            style={numberStyle}
          />
        </div>
      </Section>

      <div style={{ flex: 1 }} />

      <button
        type="button"
        onClick={props.onExport}
        disabled={props.exporting}
        style={{
          padding: '10px 16px',
          border: 0,
          borderRadius: 4,
          background: props.exporting ? '#1f2937' : '#16a34a',
          color: '#fff',
          fontWeight: 600,
          fontSize: 13,
          cursor: props.exporting ? 'wait' : 'pointer',
        }}
      >
        {props.exporting ? 'Exporting…' : 'Export for test (Barbarian)'}
      </button>
    </aside>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div
        style={{
          fontSize: 11,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          opacity: 0.7,
          marginBottom: 6,
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

const selectStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 8px',
  background: '#1f2937',
  color: '#fafafa',
  border: '1px solid #374151',
  borderRadius: 3,
  fontSize: 12,
};

const rangeStyle: React.CSSProperties = {
  width: '100%',
};

const numberStyle: React.CSSProperties = {
  flex: 1,
  padding: '4px 6px',
  background: '#1f2937',
  color: '#fafafa',
  border: '1px solid #374151',
  borderRadius: 3,
  fontSize: 12,
  width: 0, // let flex grow
};
