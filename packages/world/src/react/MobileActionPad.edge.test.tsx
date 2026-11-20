// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ActionInput } from '../input/action-input.ts';
import { ActionContextStore, interactKind } from '../input/action-context.ts';
import { MobileActionPad } from './MobileActionPad.tsx';
import { MobileActionRegistry } from './mobile-actions.ts';
import { WORLD_MOBILE_ACTIONS } from './worldMobileActions.tsx';

class TestPointerEvent extends MouseEvent {
  readonly pointerId: number;
  readonly pointerType: string;
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 0;
    this.pointerType = init.pointerType ?? '';
  }
}
beforeAll(() => {
  window.PointerEvent ??= TestPointerEvent as unknown as typeof PointerEvent;
  HTMLElement.prototype.setPointerCapture = () => {};
});
afterEach(cleanup);

function setup() {
  const input = new ActionInput();
  const context = new ActionContextStore();
  const registry = new MobileActionRegistry();
  registry.register(WORLD_MOBILE_ACTIONS);
  render(<MobileActionPad registry={registry} input={input} context={context} />);
  return { input, context };
}
const down = (el: Element, pointerId: number) => fireEvent.pointerDown(el, { pointerId, pointerType: 'touch' });
const up = (el: Element, pointerId: number) => fireEvent.pointerUp(el, { pointerId, pointerType: 'touch' });

/** Mirrors SceneFrame's edge trigger for one key: counts frames on which it goes up -> down. */
function edgeCounter(input: ActionInput, key: string, keyboard: Set<string> = new Set()) {
  let was = false;
  let edges = 0;
  return {
    frame() {
      const isDown = input.mergeInto(keyboard).has(key);
      if (isDown && !was) edges++;
      was = isDown;
      return isDown;
    },
    get edges() {
      return edges;
    },
  };
}

describe('action pad edge cases', () => {
  it('A: a tap shorter than a frame counts exactly one frame', () => {
    const { input } = setup();
    const jump = screen.getByLabelText('Jump');
    const c = edgeCounter(input, ' ');
    down(jump, 1);
    up(jump, 1);
    expect([c.frame(), c.frame()]).toEqual([true, false]);
    expect(c.edges).toBe(1);
  });

  it('B: release then re-press before the next-but-one frame (low fps double jump) gives two presses', () => {
    const { input } = setup();
    const jump = screen.getByLabelText('Jump');
    const c = edgeCounter(input, ' ');
    down(jump, 1);
    c.frame(); // frame 1: held
    c.frame(); // frame 2: held
    up(jump, 1); // finger lifts between frame 2 and 3
    const f3 = c.frame(); // the keyboard path would read "up" here
    down(jump, 2); // second tap lands before frame 4
    c.frame();
    up(jump, 2);
    c.frame();
    expect(f3).toBe(false);
    expect(c.edges).toBe(2);
  });

  it('C: button release does not cancel a keyboard key held for the same action', () => {
    const { input } = setup();
    const sprint = screen.getByLabelText('Sprint');
    const kb = new Set(['shift']);
    const c = edgeCounter(input, 'shift', kb);
    down(sprint, 1);
    c.frame();
    up(sprint, 1);
    c.frame();
    expect(c.frame()).toBe(true);
  });

  it('D: pointercancel releases a held Sprint', () => {
    const { input } = setup();
    const sprint = screen.getByLabelText('Sprint');
    down(sprint, 1);
    fireEvent.pointerCancel(sprint, { pointerId: 1 });
    expect(input.isDown('sprint')).toBe(false);
  });

  it('E: tab hidden / window blur while Sprint is held releases it', () => {
    const { input } = setup();
    const sprint = screen.getByLabelText('Sprint');
    down(sprint, 1);
    act(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('blur'));
    });
    const held = input.isDown('sprint');
    Reflect.deleteProperty(document, 'visibilityState');
    expect(held).toBe(false);
  });

  it('F: dialog opening while Interact (sit) is held leaves no ghost key for the next frame', async () => {
    const { input, context } = setup();
    act(() => context.set({ interact: 'sit' }));
    down(screen.getByLabelText('Sit'), 1);
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    document.body.appendChild(dialog);
    await act(async () => {
      await Promise.resolve();
    });
    const merged = [...input.mergeInto(new Set())];
    dialog.remove();
    expect(merged).toEqual([]);
  });

  it('G: lostpointercapture for another pointer does not release', () => {
    const { input } = setup();
    const sprint = screen.getByLabelText('Sprint');
    down(sprint, 1);
    fireEvent.lostPointerCapture(sprint, { pointerId: 2 });
    expect(input.isDown('sprint')).toBe(true);
  });

  it('H: a focused checkbox (not a text field) does not hide the pad', () => {
    setup();
    const box = document.createElement('input');
    box.type = 'checkbox';
    document.body.appendChild(box);
    act(() => box.focus());
    const shown = screen.queryByLabelText('Jump') !== null;
    box.remove();
    expect(shown).toBe(true);
  });

  it('I: Interact never offers Ride/Sit while seated, and never Ride while swimming', () => {
    const world = { rideNear: () => ({ vehicle: 'scooter', rackId: 'r' }) as never };
    const feet = { x: 0, y: 0, z: 0 };
    expect(interactKind({ pose: null, seated: true, nearbySeat: true, feet }, world)).toBeNull();
    expect(interactKind({ pose: 'swim', seated: false, nearbySeat: false, feet }, world)).toBeNull();
  });

  it('J: two taps inside one frame interval', () => {
    const { input } = setup();
    const jump = screen.getByLabelText('Jump');
    const c = edgeCounter(input, ' ');
    down(jump, 1);
    up(jump, 1);
    down(jump, 2);
    up(jump, 2);
    c.frame();
    c.frame();
    c.frame();
    expect(c.edges).toBe(1);
  });
});
