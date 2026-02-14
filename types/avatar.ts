export interface AvatarCustomization {
  bodyColor: string;
  skinColor: string;
  style: 'default' | 'athletic' | 'casual' | 'formal';
  accessories: string[];
}

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
