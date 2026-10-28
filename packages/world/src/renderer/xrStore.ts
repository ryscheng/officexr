import { createXRStore, type XRStore } from '@react-three/xr';

/**
 * An XR store for immersive-vr from the self avatar's eyes. The library's
 * defaults would inject a device emulator on localhost and offer AR on
 * Quest, and we render no controllers or hands. Call `destroy()` when done:
 * the store appends a DOM overlay to `body`.
 */
export function createWorldXRStore(): XRStore {
  return createXRStore({ emulate: false, offerSession: false, controller: false, hand: false });
}
