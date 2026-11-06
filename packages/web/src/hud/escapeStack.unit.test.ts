// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EscapeStack } from './escapeStack';

const esc = (target: EventTarget = window, init: KeyboardEventInit = {}) =>
  target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, ...init }));

const stacks: (() => void)[] = [];
afterEach(() => {
  stacks.splice(0).forEach((d) => d());
});
function setup() {
  const stack = new EscapeStack(document);
  const calls: string[] = [];
  const layer = (name: string, owns?: () => Element | null) => {
    const dispose = stack.push({ onEscape: () => calls.push(name), owns });
    stacks.push(dispose);
    return dispose;
  };
  return { stack, calls, layer };
}

describe('EscapeStack', () => {
  it('runs only the topmost layer, ordered by activation', () => {
    const { calls, layer } = setup();
    layer('a');
    const disposeB = layer('b');
    esc();
    disposeB();
    layer('b-again');
    esc();
    expect(calls).toEqual(['b', 'b-again']);
  });

  it('falls to the layer below once a middle layer is removed', () => {
    const { calls, layer } = setup();
    layer('a');
    const disposeB = layer('b');
    layer('c');
    disposeB();
    esc();
    expect(calls).toEqual(['c']);
  });

  it('ignores Esc from an input outside the layer, handles it inside', () => {
    const { calls, layer } = setup();
    const panel = document.body.appendChild(document.createElement('div'));
    const inside = panel.appendChild(document.createElement('input'));
    const outside = document.body.appendChild(document.createElement('input'));
    layer('plain');
    esc(inside);
    layer('owner', () => panel);
    esc(outside);
    esc(inside);
    expect(calls).toEqual(['owner']);
    panel.remove();
    outside.remove();
  });

  it('removes its listener once empty and without a fallback', () => {
    const { stack, layer } = setup();
    const removed = vi.spyOn(window, 'removeEventListener');
    const dispose = layer('a');
    const disposeFallback = stack.setFallback(() => {});
    dispose();
    expect(removed).not.toHaveBeenCalled();
    disposeFallback();
    expect(removed).toHaveBeenCalledWith('keydown', expect.any(Function));
    removed.mockRestore();
  });

  it('keeps the fallback quiet while a layer is open', () => {
    const { stack, calls, layer } = setup();
    stacks.push(stack.setFallback(() => calls.push('fallback')));
    layer('a');
    esc();
    expect(calls).toEqual(['a']);
  });

  it('ignores held-down and composing Esc', () => {
    const { stack, calls } = setup();
    stacks.push(stack.setFallback(() => calls.push('fallback')));
    esc(window, { repeat: true });
    esc(window, { isComposing: true });
    esc(window, { keyCode: 229 });
    expect(calls).toEqual([]);
  });

  it('only clears its own fallback on dispose', () => {
    const { stack, calls } = setup();
    const disposeOld = stack.setFallback(() => calls.push('old'));
    stacks.push(stack.setFallback(() => calls.push('new')));
    disposeOld();
    esc();
    expect(calls).toEqual(['new']);
  });
});
