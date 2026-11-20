export type ShortcutGroup = 'Movement' | 'Camera' | 'Voice' | 'Status' | 'Chat' | 'Menu';

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
  { group: 'Movement', keys: 'F', description: 'Get on or off a scooter or tricycle next to you' },
  { group: 'Movement', keys: 'Q', description: 'Poke the player in front of you (with the wand: cast the spell)' },
  { group: 'Movement', keys: 'F at a wand stand', description: 'Pick up the wand; F again puts it back' },
  { group: 'Movement', keys: '1 2 3 4', description: 'Choose a spell while holding the wand (click also casts)' },
  { group: 'Movement', keys: 'B', description: 'Build: place, turn and remove pools, racks and wand stands' },
  { group: 'Movement', keys: 'Walk into a pool', description: 'Swim (Shift swims faster)' },
  { group: 'Movement', keys: 'Alt/⌥ + D', description: 'Return to your desk and sit' },
  { group: 'Camera', keys: 'Alt/⌥ + P', description: 'Cycle camera mode' },
  { group: 'Camera', keys: 'Click world', description: 'Look around (first and third person)' },
  { group: 'Camera', keys: 'Esc', description: 'Release the mouse' },
  { group: 'Voice', keys: 'Alt/⌥ + M', description: 'Mute or unmute your microphone (zone calls start muted)' },
  { group: 'Status', keys: 'H', description: 'Raise or lower your hand' },
  { group: 'Status', keys: 'R', description: 'Open the emote picker' },
  { group: 'Status', keys: 'Alt/⌥ + N', description: 'Turn focus mode on or off (silences pings and pokes)' },
  { group: 'Chat', keys: 'Enter', description: 'Open chat, send a message, or close an empty chat' },
  { group: 'Chat', keys: 'Esc', description: 'Close chat' },
  { group: 'Menu', keys: 'Esc', description: 'Open settings (when the mouse is free)' },
  { group: 'Menu', keys: 'Esc', description: 'Back, then close settings' },
  { group: 'Menu', keys: '?', description: 'Open keybinds' },
];

export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = [...new Set(SHORTCUTS.map((s) => s.group))];
