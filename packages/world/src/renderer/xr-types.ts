// A tsconfig root listed ahead of `include` in world, web and studio.
// @pmndrs/pointer-events (pulled in by @react-three/xr) augments 'three' with
// pointer-capture methods on Object3D. tsc merges augmentations in program
// order: if drei's augmentation of '@react-three/fiber' is processed first,
// that 'three' augmentation lands on a second Object3D symbol instead of the
// class, and every `Group` stops being assignable to `Object3D`. Loading xr's
// types from the first root file fixes the order regardless of import order.
import type {} from '@react-three/xr';
