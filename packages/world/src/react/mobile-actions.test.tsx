import { describe, expect, it, vi } from 'vitest';
import { ActionInput } from '../input/action-input.ts';
import {
  MobileActionRegistry,
  PAD_SLOTS,
  visibleActions,
  type MobileAction,
  type MobileActionContext,
} from './mobile-actions.ts';
import { WORLD_MOBILE_ACTIONS } from './worldMobileActions.tsx';

const ctxOf = (interact: MobileActionContext['interact'] = null): MobileActionContext => ({
  interact,
  input: new ActionInput(),
});
const action = (id: string, slot: number, extra: Partial<MobileAction> = {}): MobileAction => ({
  id,
  slot,
  icon: null,
  label: id,
  onPress: () => {},
  ...extra,
});
const ids = (actions: MobileAction[]) => actions.map((a) => a.id);

describe('visibleActions', () => {
  it('hides actions whose visible() is false and keeps slot order', () => {
    const list = [action('b', 3), action('a', 1), action('hidden', 2, { visible: () => false })];
    expect(ids(visibleActions(list, ctxOf()))).toEqual(['a', 'b']);
  });

  it('drops actions in an unknown slot', () => {
    expect(visibleActions([action('x', PAD_SLOTS.length)], ctxOf())).toEqual([]);
  });

  it('keeps the later action when two share a slot', () => {
    expect(ids(visibleActions([action('first', 1), action('second', 1)], ctxOf()))).toEqual(['second']);
  });

  it('shows Interact only when something is near', () => {
    expect(ids(visibleActions(WORLD_MOBILE_ACTIONS, ctxOf()))).toEqual(['jump', 'sprint', 'poke']);
    expect(ids(visibleActions(WORLD_MOBILE_ACTIONS, ctxOf('ride')))).toEqual(['jump', 'sprint', 'interact', 'poke']);
  });
});

describe('world actions', () => {
  const find = (id: string) => WORLD_MOBILE_ACTIONS.find((a) => a.id === id)!;

  it('presses and releases the action behind each key', () => {
    for (const id of ['jump', 'sprint', 'poke']) {
      const ctx = ctxOf();
      find(id).onPress(ctx);
      expect(ctx.input.isDown(id)).toBe(true);
      find(id).onRelease?.(ctx);
      expect(ctx.input.isDown(id)).toBe(false);
    }
  });

  it('presses mount for Ride and Get off, and sit for Sit', () => {
    for (const [kind, held] of [
      ['ride', 'mount'],
      ['dismount', 'mount'],
      ['sit', 'sit'],
    ] as const) {
      const ctx = ctxOf(kind);
      find('interact').onPress(ctx);
      expect(ctx.input.isDown(held)).toBe(true);
      find('interact').onRelease?.(ctx);
      expect(ctx.input.isDown(held)).toBe(false);
    }
  });

  it('labels Interact by context', () => {
    const label = find('interact').label as (c: MobileActionContext) => string;
    expect(label(ctxOf('ride'))).toBe('Ride');
    expect(label(ctxOf('dismount'))).toBe('Get off');
  });
});

describe('MobileActionRegistry', () => {
  it('lists registered groups, replaces by id, and unregisters', () => {
    const registry = new MobileActionRegistry();
    const listener = vi.fn();
    registry.subscribe(listener);
    const off = registry.register([action('a', 1)]);
    const offB = registry.register([action('a', 2), action('b', 3)]);
    expect(registry.list().map((a) => `${a.id}${a.slot}`)).toEqual(['a2', 'b3']);
    offB();
    expect(registry.list().map((a) => `${a.id}${a.slot}`)).toEqual(['a1']);
    off();
    expect(registry.list()).toEqual([]);
    expect(listener).toHaveBeenCalledTimes(4);
  });
});
