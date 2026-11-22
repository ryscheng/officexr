import type { HintName } from '../hintFlags';

export function hintCopy(name: HintName, coarse: boolean, joystickFloats = false): string {
  const tap = coarse ? 'Tap' : 'Click';
  switch (name) {
    case 'move':
      if (!coarse) {
        return 'Use W A S D to walk';
      }
      return joystickFloats ? 'Drag anywhere to walk' : 'Drag here to walk';
    case 'people':
      return `${tap} People to find someone`;
    case 'alone':
      return 'No one here? Open the map';
    case 'build':
      return 'Press B to build';
  }
}
