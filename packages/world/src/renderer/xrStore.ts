import { createXRStore, type XRStore } from '@react-three/xr';

/**
 * An XR store for immersive-vr from the self avatar's eyes. The library's
 * defaults would inject a device emulator on localhost, offer or auto-enter
 * AR on Quest, and request spatial features (anchors, planes, meshes,
 * hit-test) that prompt for spatial-data permission; we render no
 * controllers or hands. Call `destroy()` when done: the store appends a DOM
 * overlay to `body`.
 */
export function createWorldXRStore(): XRStore {
  return createXRStore({
    emulate: false,
    offerSession: false,
    enterGrantedSession: false,
    controller: false,
    hand: false,
    anchors: false,
    planeDetection: false,
    meshDetection: false,
    hitTest: false,
  });
}
