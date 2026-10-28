import { useEffect, useRef } from 'react';
import type { CameraMode } from './config.ts';
import { applyLookDelta, type LookRefs } from './lookControls.ts';
import { lookDelta, toPose, type MotionLookState, type MotionPose } from './motionLook.ts';

interface ViewSnapshot {
  yaw: number;
  pitch: number;
  azimuthOffset: number;
  pitchOffset: number;
}

/**
 * While `motionLook.enabled`, turns the view by the device's orientation
 * changes since its previous reading, on top of any drag. Enabling snapshots
 * the view, and a new `recenterKey` restores that snapshot and makes the
 * device's next pose the neutral one.
 */
export function useMotionLook(motionLook: MotionLookState | undefined, mode: CameraMode, refs: LookRefs): void {
  const enabled = motionLook?.enabled ?? false;
  const snapshot = useRef<ViewSnapshot | null>(null);
  const lastPose = useRef<MotionPose | null>(null);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const offsets = refs.viewOffsetsRef.current;
    snapshot.current = {
      yaw: refs.yawRef.current,
      pitch: refs.pitchRef.current,
      azimuthOffset: offsets.fixedAzimuthOffsetRad,
      pitchOffset: offsets.fixedPitchOffsetRad,
    };
    return () => {
      snapshot.current = null;
      lastPose.current = null;
    };
  }, [enabled, refs]);

  const recenterKey = motionLook?.recenterKey;
  useEffect(() => {
    const saved = snapshot.current;
    if (saved) {
      const offsets = refs.viewOffsetsRef.current;
      refs.yawRef.current = saved.yaw;
      refs.pitchRef.current = saved.pitch;
      offsets.fixedAzimuthOffsetRad = saved.azimuthOffset;
      offsets.fixedPitchOffsetRad = saved.pitchOffset;
    }
    lastPose.current = null;
  }, [recenterKey, refs]);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const onOrientation = (e: DeviceOrientationEvent) => {
      const pose = toPose(e);
      if (!pose) {
        return;
      }
      const prev = lastPose.current;
      lastPose.current = pose;
      if (prev) {
        const { dYaw, dPitch } = lookDelta(prev, pose);
        applyLookDelta(mode, dYaw, dPitch, refs);
      }
    };
    window.addEventListener('deviceorientation', onOrientation);
    return () => window.removeEventListener('deviceorientation', onOrientation);
  }, [enabled, mode, refs]);
}
