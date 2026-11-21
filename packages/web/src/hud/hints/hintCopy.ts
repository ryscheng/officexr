import type { HintName } from '../hintFlags';

export function hintCopy(name: HintName, coarse: boolean, nearName: string | null): string {
  const tap = coarse ? 'Tap' : 'Click';
  switch (name) {
    case 'move':
      return coarse ? 'Drag here to walk' : 'Use W A S D to walk';
    case 'people':
      return `${tap} People to find someone`;
    case 'wave':
      return `${tap} Speak to meet ${nearName ?? 'them'}`;
    case 'alone':
      return 'No one here? Open the map';
    case 'build':
      return 'Press B to build';
  }
}
