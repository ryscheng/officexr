// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { attachDesktopLook, LOOK_DRAG_THRESHOLD_PX } from './desktopLook.ts';

let canvas: HTMLCanvasElement;
let locked: Element | null;
let requestLock: Mock<() => unknown>;
let exitLock: Mock<() => void>;
let onLook: Mock<(movementX: number, movementY: number) => void>;
let detach: () => void;

beforeEach(() => {
  canvas = document.createElement('canvas');
  document.body.append(canvas);
  locked = null;
  requestLock = vi.fn<() => unknown>(() => {
    locked = canvas;
  });
  exitLock = vi.fn<() => void>(() => {
    locked = null;
  });
  canvas.requestPointerLock = requestLock as unknown as HTMLCanvasElement['requestPointerLock'];
  document.exitPointerLock = exitLock as unknown as Document['exitPointerLock'];
  Object.defineProperty(document, 'pointerLockElement', { configurable: true, get: () => locked });
  onLook = vi.fn<(movementX: number, movementY: number) => void>();
  detach = attachDesktopLook({ canvas, onLook });
});

afterEach(() => {
  detach();
  canvas.remove();
});

const down = (button: number, x = 100, y = 100) =>
  canvas.dispatchEvent(new MouseEvent('mousedown', { button, clientX: x, clientY: y, bubbles: true }));
const move = (x: number, y: number, movementX: number, movementY: number) => {
  const e = new MouseEvent('mousemove', { clientX: x, clientY: y, bubbles: true });
  Object.defineProperty(e, 'movementX', { value: movementX });
  Object.defineProperty(e, 'movementY', { value: movementY });
  document.dispatchEvent(e);
};
const up = (button: number) => window.dispatchEvent(new MouseEvent('mouseup', { button, bubbles: true }));
const click = () => {
  const e = new MouseEvent('click', { button: 0, bubbles: true, cancelable: true });
  const seen = vi.fn();
  document.body.addEventListener('click', seen, { once: true });
  canvas.dispatchEvent(e);
  return seen.mock.calls.length > 0;
};

describe('attachDesktopLook', () => {
  it('leaves the pointer free on mouse down and on a plain click', () => {
    down(0);
    move(101, 101, 1, 1);
    up(0);
    expect(requestLock).not.toHaveBeenCalled();
    expect(onLook).not.toHaveBeenCalled();
    expect(click()).toBe(true);
  });

  it('keeps a left press under the threshold a click even when it wobbles', () => {
    down(0);
    move(100 + LOOK_DRAG_THRESHOLD_PX - 1, 100, LOOK_DRAG_THRESHOLD_PX - 1, 0);
    up(0);
    expect(onLook).not.toHaveBeenCalled();
    expect(click()).toBe(true);
  });

  it('turns after a left drag past the threshold, locks once, and releases on mouse up', () => {
    down(0);
    move(100 + LOOK_DRAG_THRESHOLD_PX, 100, LOOK_DRAG_THRESHOLD_PX, 0);
    move(110, 103, 6, 3);
    expect(requestLock).toHaveBeenCalledTimes(1);
    expect(onLook).toHaveBeenNthCalledWith(1, LOOK_DRAG_THRESHOLD_PX, 0);
    expect(onLook).toHaveBeenNthCalledWith(2, 6, 3);
    up(0);
    expect(exitLock).toHaveBeenCalledTimes(1);
    expect(locked).toBeNull();
    expect(click()).toBe(false);
    expect(click()).toBe(true);
  });

  it('turns from the first move with the right button and locks on mouse down', () => {
    down(2);
    expect(requestLock).toHaveBeenCalledTimes(1);
    move(101, 100, 1, 0);
    expect(onLook).toHaveBeenCalledWith(1, 0);
    up(2);
    expect(exitLock).toHaveBeenCalledTimes(1);
  });

  it('stops turning after release', () => {
    down(2);
    up(2);
    move(120, 100, 20, 0);
    expect(onLook).not.toHaveBeenCalled();
  });

  it('keeps turning with deltas when the browser refuses the lock', () => {
    requestLock.mockImplementation(() => {
      throw new Error('cooldown');
    });
    down(2);
    move(105, 100, 5, 0);
    expect(onLook).toHaveBeenCalledWith(5, 0);
    up(2);
    expect(exitLock).not.toHaveBeenCalled();
  });

  it('keeps turning when the lock request rejects', async () => {
    requestLock.mockImplementation(() => Promise.reject(new Error('cooldown')));
    down(2);
    await Promise.resolve();
    move(105, 100, 5, 0);
    expect(onLook).toHaveBeenCalledWith(5, 0);
  });

  it('suppresses the context menu on the canvas only', () => {
    const onCanvas = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    canvas.dispatchEvent(onCanvas);
    expect(onCanvas.defaultPrevented).toBe(true);
    const other = document.createElement('div');
    document.body.append(other);
    const onOther = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    other.dispatchEvent(onOther);
    expect(onOther.defaultPrevented).toBe(false);
    other.remove();
  });

  it('ignores the middle button', () => {
    down(1);
    move(120, 100, 20, 0);
    expect(requestLock).not.toHaveBeenCalled();
    expect(onLook).not.toHaveBeenCalled();
  });

  it('releases the lock on blur and on detach', () => {
    down(2);
    window.dispatchEvent(new Event('blur'));
    expect(exitLock).toHaveBeenCalledTimes(1);
    down(2);
    detach();
    expect(exitLock).toHaveBeenCalledTimes(2);
  });
});
