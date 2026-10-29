import { focusWorld } from '@officexr/world/react';

/** Wraps a room dialog's `onClose` so closing hands the keyboard back to the world; a dialog's focus-in releases it. */
export const closeToWorld = (onClose: () => void) => () => {
  onClose();
  focusWorld();
};
