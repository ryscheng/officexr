import { describe, expect, it } from 'vitest';
import { viewportBox } from './useVisualViewport';

describe('viewportBox', () => {
  it('has no keyboard when the visual viewport fills the window or is unsupported', () => {
    expect(viewportBox(800, { height: 800, offsetTop: 0 })).toEqual({ height: 800, keyboard: 0 });
    expect(viewportBox(800, null)).toEqual({ height: 800, keyboard: 0 });
  });

  it('measures the strip a keyboard covers when only the visual viewport shrinks', () => {
    expect(viewportBox(800, { height: 480, offsetTop: 0 })).toEqual({ height: 480, keyboard: 320 });
  });

  it('subtracts the pan the browser applies to reveal the field', () => {
    expect(viewportBox(800, { height: 480, offsetTop: 100 })).toEqual({ height: 480, keyboard: 220 });
  });

  it('has none when the window itself resizes with the keyboard', () => {
    expect(viewportBox(480, { height: 480, offsetTop: 0 })).toEqual({ height: 480, keyboard: 0 });
  });
});
