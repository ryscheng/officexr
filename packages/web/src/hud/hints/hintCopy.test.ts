import { describe, expect, it } from 'vitest';
import { hintCopy } from './hintCopy';

describe('hintCopy move', () => {
  it('says drag anywhere when the joystick floats', () => {
    expect(hintCopy('move', true, null, true)).toBe('Drag anywhere to walk');
  });

  it('says drag here when the joystick is fixed, or by default', () => {
    expect(hintCopy('move', true, null, false)).toBe('Drag here to walk');
    expect(hintCopy('move', true, null)).toBe('Drag here to walk');
  });

  it('keeps the keyboard copy on desktop whatever the joystick does', () => {
    expect(hintCopy('move', false, null, true)).toBe('Use W A S D to walk');
  });
});
