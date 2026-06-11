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

/** Height (world y, in metres) the character body is spawned at so
 * gravity can drop it onto the cube cluster. The 2×2 cluster's tops
 * sit at world y=1; dropping from well above and letting Rapier's
 * kinematic controller settle the body is what places the character —
 * NOT a teleport to a tuned constant. (See the component doc comment
 * for why the old DEFAULT_Y_OFFSET teleport was retired.) */
const SPAWN_DROP_HEIGHT = 4;

/** Penetration skin for the Mugshot's character controller — the ONLY
 * sanctioned vertical compensation in the portrait. Gameplay uses
 * 0.01 m (an anti-tunnel gap) which rests the body ~1 cm above true
 * contact (settled root ≈ 0.51); that 1 cm float is noticeable in a
 * tight portrait. So the Mugshot threads this near-zero skin through
 * Scene → SceneFrame and the gravity-settle lands feet-flush at root
 * ≈ 0.50 (feet ≈ 1.00). Not exactly 0 — Rapier discourages a zero
 * offset (re-introduces tunneling/jitter) — but small enough to be
 * sub-pixel against the curated 0.50 ideals.
 *
 * Why this is honest, not a teleport cheat: a controller skin can only
 * float the body UP, never sink it below contact, so it physically
 * cannot mask a large gravity float — placement stays 100% gravity.
 * The `mugshot-gravity-invariant` spec guards this: if the character
 * ever settles >10 cm from the surface, that test fails and demands a
 * gravity bug-fix, NOT a bigger offset. Do not re-introduce a
 * position-offset teleport here (that was the cheat this work removed).
 */
const MUGSHOT_CONTROLLER_OFFSET = 0.0001;

/** Default value shown by the manual Y-offset slider. This is the
 * approximate gravity-settled root y; it is a DISPLAY/override seed
 * only — officexr never relies on it to place the character (gravity
 * does). See the slider's manual-override note below. */
const SLIDER_DEFAULT_Y = 0.5;

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
 * on world origin (0, 0, 0). With voxelSize=0.5 (the global
 * `VOXEL_SIZE`), voxel positions in [-4, 0] on X/Z translate to
 * world cube anchors in [-2, 0]; each 2 m kind extends +2 m so the
 * cluster bbox is x∈[-2,2], y∈[-1,1], z∈[-2,2]. Cube tops at world
 * y=1, bottoms at y=-1.
 *
 * Why voxelSize=0.5 (not 2): the geometry service in the renderer is
 * pinned to the global `VOXEL_SIZE` constant (see
 * `packages/world/src/app/create-default-api.ts`); a per-scene
 * `cubeSize` mismatch silently shifts every instance because
 * `geometry.meshOrigin` uses the global, not the snapshot's
 * `cubeSize`. Until the geometry service learns a per-call voxel
 * size, every scene MUST use `cubeSize = VOXEL_SIZE` to stay
 * consistent with both the visible mesh placement AND the collider
 * placement (which also flows through the geometry service).
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
  { id: 'm-0-0', sourceCommandId: 'mugshot', kindId: 'colored_block_blue', position: [-4, -2, -4] },
  { id: 'm-1-0', sourceCommandId: 'mugshot', kindId: 'stone', position: [0, -2, -4] },
  { id: 'm-0-1', sourceCommandId: 'mugshot', kindId: 'stone', position: [-4, -2, 0] },
  { id: 'm-1-1', sourceCommandId: 'mugshot', kindId: 'colored_block_blue', position: [0, -2, 0] },
];

const PRIMITIVE_CUBES: ReadonlyArray<{
  id: string;
  sourceCommandId: string;
  kindId: string;
  position: [number, number, number];
}> = [
  { id: 'm-0-0', sourceCommandId: 'mugshot', kindId: '__primitive_blue', position: [-4, -2, -4] },
  { id: 'm-1-0', sourceCommandId: 'mugshot', kindId: '__primitive_stone', position: [0, -2, -4] },
  { id: 'm-0-1', sourceCommandId: 'mugshot', kindId: '__primitive_stone', position: [-4, -2, 0] },
  { id: 'm-1-1', sourceCommandId: 'mugshot', kindId: '__primitive_blue', position: [0, -2, 0] },
];

function cubesForMode(mode: CubeMode) {
  return mode === 'gltf' ? GLTF_CUBES : PRIMITIVE_CUBES;
}

/** v2 of the mugshot export manifest. Captures rendering inputs but
 * deliberately OMITS `yOffset` — placement is gravity-driven, so the
 * manifest carries no Y at all. On manifest-load the body is dropped
 * back under gravity (manual override cleared), reproducing the
 * renderer's NATURAL settled placement. If we recorded a tuned Y, the
 * round-trip would re-apply the human's manual lift and mask any
 * underlying placement bug. The whole point of the mugshot is that
 * baselines show what the system NATURALLY produces; the Y slider in
 * the UI exists only for live diagnostic exploration. */
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
 * character (no animation), tunable camera angle / distance /
 * viewport. Drives the export-for-test workflow (downloads a ZIP
 * of 4 PNGs + manifest.json) and is the live target for the
 * manifest-driven comparison test.
 *
 * Placement is GRAVITY-DRIVEN. The character body is spawned above
 * the cubes (`SPAWN_DROP_HEIGHT`) and falls onto them under the same
 * kinematic controller + gravity integration Debug mode uses — the
 * rendered resting height is whatever physics produces, never a tuned
 * constant. This is deliberate: the whole point of the mugshot is to
 * surface the renderer's NATURAL placement so a human can catch
 * gravity/anchor regressions visually.
 *
 * The Y-offset slider is a MANUAL DIAGNOSTIC OVERRIDE for that human,
 * NOT a placement mechanism officexr relies on. While untouched
 * (`manualPlacement === false`) gravity owns the body. The moment the
 * human drags the slider (or a test calls `__OFFICE_MUGSHOT_SET_Y_OFFSET__`)
 * we flip into manual mode: gravity is suspended and the body is
 * pinned at the slider value, so a human can lift/lower the character
 * to inspect placement when gravity rendering looks wrong. The "Auto
 * (gravity)" button drops it back under gravity. See the mugshot test
 * README for why this knob exists.
 */
export function MugshotApp() {
  const [local, setLocal] = useState<PersistentLocalState | null>(null);
  const [stack, setStack] = useState<ChannelStack | null>(null);
  const [character, setCharacter] = useState<CharacterName>(() =>
    readCharacterFromHash(),
  );

  // Tunable rendering inputs.
  // `yOffset` is the manual Y-override slider value; `manualPlacement`
  // gates whether it actually drives the body. Default false → gravity
  // places the character and the slider is inert (display only).
  const [yOffset, setYOffset] = useState(SLIDER_DEFAULT_Y);
  const [manualPlacement, setManualPlacement] = useState(false);
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
      // Cluster of cubes is centered on world origin; spawn the
      // character at origin XZ but ABOVE the cube tops (y=1) so
      // gravity drops it onto the surface and settles it. The resting
      // height is produced by physics, not a hardcoded offset.
      startPos: { x: 0, y: SPAWN_DROP_HEIGHT, z: 0 },
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

  // Gravity placement vs. manual override. By DEFAULT gravity is ON
  // (manualPlacement === false): the character is dropped from
  // SPAWN_DROP_HEIGHT and settles onto the cubes under physics. When
  // the human grabs the Y slider (manualPlacement === true) we suspend
  // gravity so the body can be pinned at an arbitrary height for
  // inspection — the diagnostic the slider exists for. The
  // `__OFFICE_GRAVITY__` hook is published by SceneFrame as soon as
  // Scene mounts; we retry until it appears since Scene mounts after
  // `stack` resolves. Re-enable gravity on unmount so navigating back
  // to Debug behaves normally.
  useEffect(() => {
    if (!stack) return;
    let cancelled = false;
    const tryApply = () => {
      const g = (
        window as unknown as {
          __OFFICE_GRAVITY__?: { setEnabled: (v: boolean) => void };
        }
      ).__OFFICE_GRAVITY__;
      if (g) {
        g.setEnabled(!manualPlacement);
        return true;
      }
      return false;
    };
    if (!tryApply()) {
      const id = setInterval(() => {
        if (cancelled || tryApply()) clearInterval(id);
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
  }, [stack, manualPlacement]);

  // Push the cube field. Re-runs on cubeMode change to swap the
  // kindIds (instance IDs stay the same, so MapColliders' React-
  // keyed reconciliation produces the identical collider tree).
  useEffect(() => {
    if (!local) return;
    // cubeSize MUST equal the global VOXEL_SIZE (0.5) — see the
    // comment above the CUBES tables. The geometry service reads
    // VOXEL_SIZE, not this snapshot's cubeSize, so a mismatch
    // silently shifts every instance off-baseline.
    local.actions.setWorldObjects({
      cubeSize: 0.5,
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

  // Manual-override pin. ONLY runs in manual mode (the human is
  // diagnosing placement via the slider). With gravity suspended,
  // SceneFrame's auto-warp threshold is 0, so this setSelfPosition
  // teleports the body to the slider's Y on the next frame and holds
  // it there. In the default gravity mode this effect is inert — the
  // body's position is owned entirely by the physics settle, never by
  // `yOffset`. Character XZ is locked at world origin so the
  // cluster-of-cubes-at-origin scene stays symmetric around the
  // standing position.
  useEffect(() => {
    if (!local || !manualPlacement) return;
    local.actions.setSelfPosition(
      { x: 0, y: yOffset, z: 0 },
      { x: 0, y: 0, z: 0 },
      0,
      false,
    );
  }, [local, manualPlacement, yOffset]);

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
      // Drop any manual Y-override and return to gravity placement —
      // manifests don't carry yOffset (by design, see the schema
      // comment above). The compare test must reproduce the renderer's
      // NATURAL gravity-settled placement, not a tuned Y. If the human
      // had pinned the body via the slider before the test ran, this
      // re-enables gravity so the body re-settles onto the cubes.
      setManualPlacement(false);
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
    // Driving the Y override flips into manual placement (gravity
    // suspended, body pinned) — same as the human grabbing the slider.
    win.__OFFICE_MUGSHOT_SET_Y_OFFSET__ = (y) => {
      setManualPlacement(true);
      setYOffset(y);
    };
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
              // Feet-flush portrait: gameplay's 0.01 anti-tunnel skin
              // floats the body ~1 cm; the mugshot wants the gravity-
              // settle to land flush on the cube top. See
              // MUGSHOT_CONTROLLER_OFFSET.
              characterControllerOffset={MUGSHOT_CONTROLLER_OFFSET}
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
        // Grabbing the slider enters manual placement (gravity off,
        // body pinned) — the human's diagnostic override.
        onYOffsetChange={(v) => {
          setManualPlacement(true);
          setYOffset(v);
        }}
        manualPlacement={manualPlacement}
        onResetToGravity={() => setManualPlacement(false)}
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
  /** True when the slider has been grabbed → gravity is suspended and
   * the body is pinned at `yOffset`. False → gravity owns placement. */
  manualPlacement: boolean;
  /** Re-engage gravity placement (drop the manual pin). */
  onResetToGravity: () => void;
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

      <Section
        title={
          props.manualPlacement
            ? `Y offset · ${props.yOffset.toFixed(2)} m · MANUAL`
            : `Y offset · gravity-placed (drag to override)`
        }
      >
        <input
          type="range"
          min={0}
          max={5.0}
          step={0.01}
          value={props.yOffset}
          onChange={(e) => props.onYOffsetChange(Number(e.target.value))}
          style={rangeStyle}
        />
        {/* Manual override is a human DIAGNOSTIC only. officexr never
            relies on this offset — gravity places the character. The
            slider lets a human pin the body to inspect placement when
            the gravity render looks wrong; this button drops the pin
            and lets the body re-settle under gravity. */}
        <button
          type="button"
          onClick={props.onResetToGravity}
          disabled={!props.manualPlacement}
          style={{
            marginTop: 6,
            width: '100%',
            padding: '6px 0',
            border: 0,
            borderRadius: 3,
            cursor: props.manualPlacement ? 'pointer' : 'default',
            background: props.manualPlacement ? '#1f2937' : '#141a23',
            color: props.manualPlacement ? '#cbd5e1' : '#4b5563',
            fontSize: 11,
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
          }}
        >
          ↺ Auto (gravity)
        </button>
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
