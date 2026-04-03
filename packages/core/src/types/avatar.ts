export interface AvatarCustomization {
  bodyColor: string;
  skinColor: string;
  style: 'default' | 'athletic' | 'casual' | 'formal';
  accessories: string[];
  presetId?: string | null;
  modelUrl?: string | null;
}

export interface AvatarPreset {
  id: string;
  name: string;
  emoji: string;
  customization: AvatarCustomization;
}

export const MARIO_PRESETS: AvatarPreset[] = [
  {
    id: 'mario',
    name: 'Mario',
    emoji: '🔴',
    customization: { bodyColor: '#e63232', skinColor: '#ffdbac', style: 'default', accessories: [], presetId: 'mario' },
  },
  {
    id: 'luigi',
    name: 'Luigi',
    emoji: '🟢',
    customization: { bodyColor: '#2e8b34', skinColor: '#ffdbac', style: 'default', accessories: [], presetId: 'luigi' },
  },
  {
    id: 'peach',
    name: 'Peach',
    emoji: '👑',
    customization: { bodyColor: '#f5a8c8', skinColor: '#f1c27d', style: 'casual', accessories: [], presetId: 'peach' },
  },
  {
    id: 'toad',
    name: 'Toad',
    emoji: '🍄',
    customization: { bodyColor: '#4a7cc7', skinColor: '#f1c27d', style: 'athletic', accessories: [], presetId: 'toad' },
  },
  {
    id: 'bowser',
    name: 'Bowser',
    emoji: '🐢',
    customization: { bodyColor: '#2e8b34', skinColor: '#f39c12', style: 'athletic', accessories: [], presetId: 'bowser' },
  },
  {
    id: 'wario',
    name: 'Wario',
    emoji: '💛',
    customization: { bodyColor: '#f5e642', skinColor: '#ffdbac', style: 'athletic', accessories: [], presetId: 'wario' },
  },
];

export const AVATAR_STYLES = ['default', 'athletic', 'casual', 'formal'] as const;

export const AVATAR_ACCESSORIES = [
  'hat',
  'glasses',
  'backpack',
  'headphones',
  'tie',
  'scarf',
] as const;

export const BODY_COLOR_PRESETS = [
  { name: 'Blue', value: '#3498db' },
  { name: 'Red', value: '#e74c3c' },
  { name: 'Green', value: '#2ecc71' },
  { name: 'Orange', value: '#f39c12' },
  { name: 'Purple', value: '#9b59b6' },
  { name: 'Turquoise', value: '#1abc9c' },
  { name: 'Yellow', value: '#f1c40f' },
  { name: 'Dark Orange', value: '#e67e22' },
  { name: 'Pink', value: '#e91e63' },
  { name: 'Teal', value: '#009688' },
];

export const SKIN_COLOR_PRESETS = [
  { name: 'Light', value: '#ffdbac' },
  { name: 'Fair', value: '#f1c27d' },
  { name: 'Medium', value: '#e0ac69' },
  { name: 'Olive', value: '#c68642' },
  { name: 'Tan', value: '#8d5524' },
  { name: 'Brown', value: '#6a3c2a' },
];
