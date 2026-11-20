export type ShortcutGroup = 'Movement' | 'Camera' | 'Voice' | 'Chat' | 'Menu';

export interface Shortcut {
  group: ShortcutGroup;
  keys: string;
  description: string;
}

export const SHORTCUTS: readonly Shortcut[] = [
  { group: 'Movement', keys: 'W A S D / Arrow keys', description: 'Move' },
  { group: 'Movement', keys: 'Shift', description: 'Run' },
  { group: 'Movement', keys: 'Space', description: 'Jump' },
  { group: 'Movement', keys: 'E', description: 'Sit on the chair you are touching (move to stand up)' },
  { group: 'Movement', keys: 'Alt/⌥ + D', description: 'Return to your desk and sit' },
  { group: 'Camera', keys: 'Alt/⌥ + P', description: 'Cycle camera mode' },
  { group: 'Camera', keys: 'Click world', description: 'Look around (first and third person)' },
  { group: 'Camera', keys: 'Esc', description: 'Release the mouse' },
  { group: 'Voice', keys: 'Alt/⌥ + M', description: 'Mute or unmute your microphone (zone calls start muted)' },
  { group: 'Chat', keys: 'Enter', description: 'Open chat, send a message, or close an empty chat' },
  { group: 'Chat', keys: 'Esc', description: 'Close chat' },
  { group: 'Menu', keys: 'Esc', description: 'Open settings (when the mouse is free)' },
  { group: 'Menu', keys: 'Esc', description: 'Back, then close settings' },
  { group: 'Menu', keys: '?', description: 'Open keybinds' },
];

export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = [...new Set(SHORTCUTS.map((s) => s.group))];
