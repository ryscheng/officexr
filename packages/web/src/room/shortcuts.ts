export type ShortcutGroup = 'Movement' | 'Camera' | 'Voice' | 'Chat' | 'Missions' | 'Menu';

export interface Shortcut {
  group: ShortcutGroup;
  keys: string;
  description: string;
}

export const SHORTCUTS: readonly Shortcut[] = [
  { group: 'Movement', keys: 'W A S D / Arrow keys', description: 'Move' },
  { group: 'Movement', keys: 'Shift', description: 'Run' },
  { group: 'Movement', keys: 'Space', description: 'Jump' },
  { group: 'Movement', keys: 'E', description: 'Sit on the chair you are touching, or stand up (moving also stands you up)' },
  { group: 'Movement', keys: 'F', description: 'Ride a scooter or tricycle, get off, take the wand or put it back' },
  { group: 'Movement', keys: 'Alt/⌥ + D', description: 'Return to your desk and sit' },
  { group: 'Camera', keys: 'Alt/⌥ + P', description: 'Cycle camera mode' },
  { group: 'Camera', keys: 'Click world', description: 'Look around (first and third person)' },
  { group: 'Camera', keys: 'Esc', description: 'Release the mouse' },
  { group: 'Voice', keys: 'Alt/⌥ + M', description: 'Mute or unmute your microphone (zone calls start muted)' },
  { group: 'Chat', keys: 'Enter', description: 'Open chat, send a message, or close an empty chat' },
  { group: 'Chat', keys: '/', description: 'Open chat with a slash typed, for a command' },
  { group: 'Chat', keys: 'Esc', description: 'Leave the chat box and keep your draft' },
  { group: 'Chat', keys: 'Up / Down', description: 'In the chat box, recall messages you sent' },
  { group: 'Missions', keys: 'T', description: 'Add a mission' },
  { group: 'Missions', keys: 'M', description: 'Open the full map (Esc closes it)' },
  { group: 'Menu', keys: 'Esc', description: 'Open the menu (when the mouse is free)' },
  { group: 'Menu', keys: 'Esc', description: 'Back, then close the menu' },
  { group: 'Menu', keys: '?', description: 'Open help and shortcuts' },
];

export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = [...new Set(SHORTCUTS.map((s) => s.group))];
