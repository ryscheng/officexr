import React, { useMemo } from 'react';
import * as THREE from 'three';
import type { LightingViewConfig } from './viewConfig.ts';

/**
 * `LightingSettings` is an alias for `LightingViewConfig` to make
 * the prop name read naturally without coupling editor code to the
 * "view config" terminology — editors think in "lighting settings,"
 * the studio-side panel state happens to call this a view config.
 */
export type LightingSettings = LightingViewConfig;

/**
 * Editor-friendly lighting defaults. Mounts the shared LightingRig
 * with shadows off (editors set `shadows={false}` on their Canvas
 * anyway), no sun disc (editors draw no `SkyDome`), no aux light. Hemisphere is at 0 so the
 * `ambientFillIntensity` term acts as a flat ambient — matching the
 * look editors had before unification.
 *
 * Editors spread this and override the fields they care about
 * (sun position, intensities). The renderer's gameplay Scene gets
 * its lighting from the store's world constants — those defaults are
 * tuned for the lit world rather than an editor preview.
 */
export const DEFAULT_EDITOR_LIGHTING: LightingSettings = {
  sunPosition: [20, 40, 20],
  sunColor: '#ffffff',
  sunIntensity: 1.2,
  ambientIntensity: 0,
  castShadow: false,
  shadowRange: 40,
  shadowMapSize: 1024,
  shadowBias: -0.0005,
  shadowNormalBias: 0.02,
  auxLightType: 'none',
  auxIntensity: 1,
  auxDistance: 0,
  auxAngle: Math.PI / 6,
  auxPenumbra: 0.2,
  auxDecay: 2,
  showSunDisc: false,
  sunDiscRadius: 3,
  sunDiscIntensity: 2,
  ambientFillIntensity: 0.5,
};

interface LightingRigProps {
  lighting: LightingSettings;
  /** Optional ref to the sun's directional light. Forwarded so a
   * caller (e.g. gameplay Scene) can mutate position / target each
   * frame to follow the local player and keep the shadow camera
   * tight. Editors leave these undefined — the sun stays statically
   * at `lighting.sunPosition`. */
  sunLightRef?: React.MutableRefObject<THREE.DirectionalLight | null>;
  /** Optional ref to the sun's movable target object. Three.js reads
   * `light.target.matrixWorld` for the view direction; a caller that
   * supplies this ref can move the target each frame to keep the
   * shadow camera centered on whatever it cares about. */
  sunLightTargetRef?: React.MutableRefObject<THREE.Object3D | null>;
}

/**
 * The studio's canonical lighting setup. Mounts:
 *
 *   - one `<directionalLight>` (the sun, with shadow camera sized
 *     from `lighting.shadowRange` + `lighting.sunPosition`)
 *   - one `<hemisphereLight>` (sky/ground tinted fill)
 *   - one `<ambientLight>` (optional `ambientFillIntensity` term —
 *     used by Mugshot for high-key captures)
 *   - one `<spotLight>` or `<pointLight>` co-located with the sun
 *     when `auxLightType` is set
 *
 * Every editor and the gameplay Scene mounts this same rig — there's
 * exactly one place that knows how to translate `LightingViewConfig`
 * into Three.js lights. The visible sun disc (`showSunDisc` and its
 * radius / glow) is drawn by `SkyDome`, not here. The forwarded refs let the gameplay Scene
 * attach a SunFollower so shadow-map texels stay small over large
 * maps; editors omit them and the sun stays static.
 */
export function LightingRig({
  lighting,
  sunLightRef,
  sunLightTargetRef,
}: LightingRigProps) {
  // Orthographic shadow camera sized so its frustum spans from the
  // sun to `shadowRange` past whatever the target tracks. For a
  // static target (editor mounts) this is fixed; for a moving target
  // (gameplay) the follower mutates the light's position each frame
  // but keeps the offset constant, so this `far` stays valid.
  const shadowCam = useMemo(() => {
    const [sx, sy, sz] = lighting.sunPosition;
    const radius = lighting.shadowRange;
    const sunMag = Math.hypot(sx, sy, sz);
    const far = sunMag + radius + 20;
    return { radius, far };
  }, [lighting.sunPosition, lighting.shadowRange]);

  return (
    <>
      {/* Fill: hemisphere instead of flat ambient. A flat ambient
          washed every surface identically and made beveled cube tops
          read the same as their sides, painting a visible grid line
          between cubes. The hemisphere light fills sky-tinted from
          above and ground-tinted from below, which matches the
          directional sun naturally — cube tops dominate while bevel
          sides stay subtly darker. */}
      <hemisphereLight args={['#aedcff', '#3a2f24', lighting.ambientIntensity]} />
      {/* Optional pure ambient fill, additive on top of the
          hemisphere. Default-off (intensity 0 = no contribution).
          Mugshot mode cranks this up so shadowed faces stay visible
          in captures without skewing sky/ground tinting. */}
      <ambientLight intensity={lighting.ambientFillIntensity ?? 0} />
      {/* The sun: always emitted. Parallel rays + orthographic shadow
          camera. */}
      <directionalLight
        ref={sunLightRef}
        position={lighting.sunPosition}
        color={lighting.sunColor}
        intensity={lighting.sunIntensity}
        castShadow={lighting.castShadow}
        shadow-mapSize-width={lighting.shadowMapSize}
        shadow-mapSize-height={lighting.shadowMapSize}
        shadow-camera-near={1}
        shadow-camera-far={shadowCam.far}
        shadow-camera-left={-shadowCam.radius}
        shadow-camera-right={shadowCam.radius}
        shadow-camera-top={shadowCam.radius}
        shadow-camera-bottom={-shadowCam.radius}
        shadow-bias={lighting.shadowBias}
        shadow-normalBias={lighting.shadowNormalBias}
      />
      {/* Movable target the directionalLight points at. A caller that
          provides `sunLightTargetRef` typically also moves this each
          frame; Three.js needs `target.matrixWorld` up to date. */}
      <object3D ref={sunLightTargetRef} />
      {/* Optional secondary localised light co-located with the sun.
          Shadow casting is deliberately off — only the directional
          drives shadows, so the secondary doesn't double-up shadow
          passes (which would produce subtly offset doubled shadows). */}
      {lighting.auxLightType === 'spot' && (
        <spotLight
          position={lighting.sunPosition}
          color={lighting.sunColor}
          intensity={lighting.auxIntensity}
          distance={lighting.auxDistance}
          angle={lighting.auxAngle}
          penumbra={lighting.auxPenumbra}
          decay={lighting.auxDecay}
        />
      )}
      {lighting.auxLightType === 'point' && (
        <pointLight
          position={lighting.sunPosition}
          color={lighting.sunColor}
          intensity={lighting.auxIntensity}
          distance={lighting.auxDistance}
          decay={lighting.auxDecay}
        />
      )}
    </>
  );
}
