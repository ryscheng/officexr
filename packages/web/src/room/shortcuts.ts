export type ShortcutGroup = 'Movement' | 'Camera' | 'Chat' | 'Help';

export interface Shortcut {
  group: ShortcutGroup;
  keys: string;
  description: string;
}

export const SHORTCUTS: readonly Shortcut[] = [
  { group: 'Movement', keys: 'W A S D / Arrow keys', description: 'Move' },
  { group: 'Movement', keys: 'Shift', description: 'Run' },
  { group: 'Movement', keys: 'Space', description: 'Jump' },
  { group: 'Camera', keys: 'Alt/⌥ + P', description: 'Cycle camera mode' },
  { group: 'Camera', keys: 'Click world', description: 'Look around (first and third person)' },
  { group: 'Camera', keys: 'Esc', description: 'Release the mouse' },
  { group: 'Chat', keys: 'Enter', description: 'Open chat, send a message, or close an empty chat' },
  { group: 'Chat', keys: 'Esc', description: 'Close chat' },
  { group: 'Help', keys: '?', description: 'Show keyboard shortcuts' },
  { group: 'Help', keys: 'Esc', description: 'Close menus and dialogs' },
];

export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = [...new Set(SHORTCUTS.map((s) => s.group))];
