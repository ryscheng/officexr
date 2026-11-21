import type { CameraMode } from '@officexr/world/renderer';

export type GameView = 'map' | 'birds-eye' | 'angled' | 'free-look' | 'first-person';
export type OpenView = Exclude<GameView, 'map'>;

export const DEFAULT_OPEN_VIEW: OpenView = 'angled';

export interface GameViewOption {
  value: GameView;
  label: string;
  hint: string;
}

export const VIEW_GROUPS: readonly { heading: string; options: readonly GameViewOption[] }[] = [
  {
    heading: '2D',
    options: [{ value: 'map', label: 'Map (2D)', hint: 'Floor plan from above. Reloads the office.' }],
  },
  {
    heading: '3D',
    options: [
      { value: 'birds-eye', label: "Bird's-eye", hint: 'Straight down from above, follows you.' },
      { value: 'angled', label: 'Angled', hint: 'Tilted overhead view that follows you.' },
      { value: 'free-look', label: 'Free look', hint: 'Camera behind you. Drag to turn it.' },
      { value: 'first-person', label: 'First person', hint: 'Through your eyes. Drag to turn.' },
    ],
  },
];

const CAMERA_OF: Record<OpenView, CameraMode> = {
  'birds-eye': 'fixed',
  angled: 'fixed',
  'free-look': 'third-person',
  'first-person': 'first-person',
};

export const cameraModeOf = (view: GameView): CameraMode => (view === 'map' ? 'fixed' : CAMERA_OF[view]);

export function viewOfCameraMode(mode: CameraMode, current: OpenView): OpenView {
  if (mode === 'fixed') {
    return current === 'birds-eye' ? current : 'angled';
  }
  return mode === 'third-person' ? 'free-look' : mode === 'first-person' ? 'first-person' : current;
}

/** In these views a touch drag does not turn the camera, so the joystick may start anywhere. */
const ANGLE_HELD: ReadonlySet<GameView> = new Set<GameView>(['map', 'birds-eye', 'angled']);

export const angleHeld = (view: GameView, motionLook: boolean): boolean => motionLook || ANGLE_HELD.has(view);

const OPEN_VIEWS: readonly string[] = ['birds-eye', 'angled', 'free-look', 'first-person'];
const KEY = 'officexr:gameView';
const LEGACY_JOYSTICK_KEY = 'officexr:hud:joystick';

export function storedOpenView(storage: Pick<Storage, 'getItem'> = localStorage): OpenView {
  try {
    const value = storage.getItem(KEY);
    return value !== null && OPEN_VIEWS.includes(value) ? (value as OpenView) : DEFAULT_OPEN_VIEW;
  } catch {
    return DEFAULT_OPEN_VIEW;
  }
}

export function storeOpenView(view: OpenView, storage: Pick<Storage, 'setItem'> = localStorage): void {
  try {
    storage.setItem(KEY, view);
  } catch {
    // The choice then lasts until the page reloads.
  }
}

export function forgetLegacyJoystickChoice(storage: Pick<Storage, 'removeItem'> = localStorage): void {
  try {
    storage.removeItem(LEGACY_JOYSTICK_KEY);
  } catch {
    // Nothing to clean up where storage is blocked.
  }
}
