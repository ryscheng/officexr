// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ActionInput } from '../input/action-input.ts';
import { ActionContextStore } from '../input/action-context.ts';
import { NO_MOVE, type MoveInput } from '../renderer/moveIntent.ts';
import { MobileActionPad } from './MobileActionPad.tsx';
import { MobileActionRegistry } from './mobile-actions.ts';
import { VirtualJoystick } from './VirtualJoystick.tsx';
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
  const moveInputRef: React.MutableRefObject<MoveInput> = { current: NO_MOVE };
  const view = render(
    <>
      <div data-testid="stick">
        <VirtualJoystick inputRef={moveInputRef} />
      </div>
      <MobileActionPad registry={registry} input={input} context={context} />
    </>,
  );
  const stick = view.container.querySelector('[data-testid="stick"] > div') as HTMLElement;
  return { input, context, registry, moveInputRef, stick };
}

const down = (el: Element, pointerId: number, clientX = 0, clientY = 0) =>
  fireEvent.pointerDown(el, { pointerId, clientX, clientY, pointerType: 'touch' });
const up = (el: Element, pointerId: number) => fireEvent.pointerUp(el, { pointerId, pointerType: 'touch' });

describe('MobileActionPad', () => {
  it('draws the world actions, and Interact only when the context offers one', () => {
    const { context } = setup();
    expect(screen.getByLabelText('Jump')).toBeTruthy();
    expect(screen.getByLabelText('Sprint')).toBeTruthy();
    expect(screen.getByLabelText('Poke')).toBeTruthy();
    expect(screen.queryByLabelText('Ride')).toBeNull();
    act(() => context.set({ interact: 'ride' }));
    expect(screen.getByLabelText('Ride')).toBeTruthy();
    act(() => context.set({ interact: 'dismount' }));
    expect(screen.getByLabelText('Get off')).toBeTruthy();
    act(() => context.set({ interact: null }));
    expect(screen.queryByLabelText('Get off')).toBeNull();
  });

  it('holds an action from pointer down to pointer up', () => {
    const { input } = setup();
    const jump = screen.getByLabelText('Jump');
    down(jump, 7);
    expect(input.isDown('jump')).toBe(true);
    up(jump, 7);
    expect(input.isDown('jump')).toBe(false);
  });

  it('works while the joystick is held, each on its own pointer', () => {
    const { input, moveInputRef, stick } = setup();
    down(stick, 1, 30, 0);
    expect(moveInputRef.current.x).toBeGreaterThan(0.5);

    const jump = screen.getByLabelText('Jump');
    const sprint = screen.getByLabelText('Sprint');
    down(jump, 2);
    down(sprint, 3);
    expect(input.isDown('jump')).toBe(true);
    expect(input.isDown('sprint')).toBe(true);
    expect(moveInputRef.current.x).toBeGreaterThan(0.5);

    up(jump, 2);
    expect(input.isDown('jump')).toBe(false);
    expect(input.isDown('sprint')).toBe(true);
    expect(moveInputRef.current.x).toBeGreaterThan(0.5);

    fireEvent.lostPointerCapture(stick, { pointerId: 1 });
    expect(moveInputRef.current).toEqual(NO_MOVE);
    expect(input.isDown('sprint')).toBe(true);
  });

  it('ignores a second finger on a button that is already held, and the wrong pointer on release', () => {
    const { input } = setup();
    const sprint = screen.getByLabelText('Sprint');
    down(sprint, 4);
    down(sprint, 5);
    up(sprint, 5);
    expect(input.isDown('sprint')).toBe(true);
    up(sprint, 4);
    expect(input.isDown('sprint')).toBe(false);
  });

  it('releases a held action when its button disappears', () => {
    const { input, context } = setup();
    act(() => context.set({ interact: 'ride' }));
    down(screen.getByLabelText('Ride'), 6);
    expect(input.isDown('mount')).toBe(true);
    act(() => context.set({ interact: null }));
    expect(input.isDown('mount')).toBe(false);
  });

  it('presses sit for Interact next to a seat', () => {
    const { input, context } = setup();
    act(() => context.set({ interact: 'sit' }));
    down(screen.getByLabelText('Sit'), 8);
    expect(input.isDown('sit')).toBe(true);
  });

  it('keeps the touch from reaching the canvas, the menu or text selection', () => {
    setup();
    const jump = screen.getByLabelText('Jump');
    const downEvent = new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 9, pointerType: 'touch' });
    jump.dispatchEvent(downEvent);
    expect(downEvent.defaultPrevented).toBe(true);
    const menu = new Event('contextmenu', { bubbles: true, cancelable: true });
    jump.dispatchEvent(menu);
    expect(menu.defaultPrevented).toBe(true);
    expect(jump.style.touchAction).toBe('none');
    expect(jump.style.userSelect).toBe('none');
    expect(jump.getAttribute('tabindex')).toBe('-1');
  });

  it('vibrates on press where supported', () => {
    const vibrate = vi.fn();
    Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true });
    setup();
    down(screen.getByLabelText('Jump'), 10);
    expect(vibrate).toHaveBeenCalledWith(10);
    Reflect.deleteProperty(navigator, 'vibrate');
  });

  it('hides and releases everything while a dialog is open or a text field has focus', async () => {
    const { input } = setup();
    down(screen.getByLabelText('Sprint'), 11);
    expect(input.isDown('sprint')).toBe(true);

    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    document.body.appendChild(dialog);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByLabelText('Jump')).toBeNull();
    expect(input.isDown('sprint')).toBe(false);
    dialog.remove();
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByLabelText('Jump')).toBeTruthy();

    const field = document.createElement('input');
    document.body.appendChild(field);
    act(() => field.focus());
    expect(screen.queryByLabelText('Jump')).toBeNull();
    field.remove();
  });
});
