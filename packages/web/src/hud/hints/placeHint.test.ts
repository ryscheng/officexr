import { describe, expect, it } from 'vitest';
import { HINT_GAP, middleThird, placeHint } from './placeHint';

const viewport = { width: 390, height: 844 };
const bounds = { left: 16, top: 55, width: 358, height: 739 };
const keepClear = [middleThird(viewport)];
const size = { width: 200, height: 42 };
const base = { size, bounds, keepClear };

describe('placeHint', () => {
  it('sits above the control with a gap and an arrow that points at its centre', () => {
    const anchor = { left: 100, top: 600, width: 100, height: 100 };
    const placed = placeHint({ ...base, anchor, side: 'above' });
    expect(placed.top).toBe(600 - HINT_GAP - 42);
    expect(placed.left + placed.arrow!.offset).toBe(150);
    expect(placed.arrow!.side).toBe('down');
  });

  it('keeps a start-aligned plate inside the HUD bounds and moves the arrow instead', () => {
    const edge = placeHint({ ...base, anchor: { left: 0, top: 600, width: 20, height: 20 }, side: 'above' });
    expect(edge.left).toBe(bounds.left);
    expect(edge.arrow!.offset).toBe(16);
  });

  it('puts an end-aligned plate flush with the right bound, with the arrow on the control', () => {
    const anchor = { left: 270, top: 700, width: 48, height: 48 };
    const placed = placeHint({ ...base, anchor, side: 'above', align: 'end' });
    expect(placed.left + size.width).toBe(bounds.left + bounds.width);
    expect(placed.left + placed.arrow!.offset).toBe(294);
  });

  it('goes below a control but not above the clear line', () => {
    const anchor = { left: 300, top: 55, width: 48, height: 48 };
    expect(placeHint({ ...base, anchor, side: 'below', align: 'end' }).top).toBe(55 + 48 + HINT_GAP);
    expect(placeHint({ ...base, anchor, side: 'below', align: 'end', clearBelow: 167 }).top).toBe(167);
  });

  it('points at a given x when the anchor is wider than the target', () => {
    const anchor = { left: 200, top: 600, width: 144, height: 100 };
    const placed = placeHint({ ...base, anchor, side: 'above', align: 'end', pointAt: 308 });
    expect(placed.left + placed.arrow!.offset).toBe(308);
  });

  it('narrows a flush-right plate that would reach into the middle third', () => {
    const landscape = { width: 844, height: 390 };
    const hud = { left: 55, top: 12, width: 734, height: 341 };
    const anchor = { left: 741, top: 12, width: 48, height: 48 };
    const placed = placeHint({ size: { width: 240, height: 64 }, bounds: hud, keepClear: [middleThird(landscape)], anchor, side: 'below', align: 'end' });
    expect(placed.maxWidth).toBeCloseTo(789 - (844 * 2) / 3);
    expect(placed.left + Math.min(240, placed.maxWidth)).toBeCloseTo(789);
    expect(placed.left).toBeGreaterThanOrEqual(middleThird(landscape).left + middleThird(landscape).width);
  });

  it('narrows a flush-right plate that would cover the joystick', () => {
    const small = { left: 16, top: 20, width: 288, height: 528 };
    const joystick = { left: 17, top: 442, width: 118, height: 110 };
    const anchor = { left: 200, top: 500, width: 48, height: 48 };
    const placed = placeHint({ size: { width: 240, height: 64 }, bounds: small, keepClear: [joystick], anchor, side: 'above', align: 'end' });
    expect(placed.left).toBeGreaterThanOrEqual(135);
    expect(placed.left + Math.min(240, placed.maxWidth)).toBe(304);
  });

  it('puts the plate left of the control and narrows it to the room there', () => {
    const anchor = { left: 150, top: 610, width: 144, height: 128 };
    const placed = placeHint({ ...base, anchor, side: 'left-top' });
    expect(placed.top).toBe(610);
    expect(placed.maxWidth).toBe(150 - HINT_GAP - bounds.left);
    expect(placed.left + Math.min(size.width, placed.maxWidth)).toBe(150 - HINT_GAP);
    expect(placed.arrow!.side).toBe('right');
  });
});
