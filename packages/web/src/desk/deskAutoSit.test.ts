import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DESK_AUTO_SIT_MS, startDeskAutoSit } from './deskAutoSit';
import { deskWorld, ME } from './fixtures';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const setup = (canSitAt = () => true) => {
  const world = deskWorld({ x: 10, y: 0, z: 10 });
  world.actions.setDeskClaims({ d1: ME });
  const returnToDesk = vi.fn();
  const stop = startDeskAutoSit({ store: world.store, selfId: ME, returnToDesk, canSitAt });
  return { ...world, returnToDesk, stop };
};

describe('startDeskAutoSit', () => {
  it('returns to the desk once the player stands still in their own area', () => {
    const { move, returnToDesk } = setup();
    move({ x: 2, z: 2 });
    vi.advanceTimersByTime(DESK_AUTO_SIT_MS - 1);
    expect(returnToDesk).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(returnToDesk).toHaveBeenCalledOnce();
  });

  it('restarts the wait on movement, so walking through never sits', () => {
    const { move, returnToDesk } = setup();
    move({ x: 1, z: 1 });
    vi.advanceTimersByTime(DESK_AUTO_SIT_MS - 100);
    move({ x: 1.5, z: 1 });
    vi.advanceTimersByTime(DESK_AUTO_SIT_MS - 100);
    move({ x: 10, z: 10 });
    vi.advanceTimersByTime(DESK_AUTO_SIT_MS * 2);
    expect(returnToDesk).not.toHaveBeenCalled();
  });

  it('does not retrigger after standing up until the player leaves and re-enters', () => {
    const { move, actions, returnToDesk } = setup();
    move({ x: 2, z: 2 });
    vi.advanceTimersByTime(DESK_AUTO_SIT_MS);
    actions.setSelfSeat('chair');
    actions.setSelfSeat(null);
    move({ x: 2.5, z: 2 });
    vi.advanceTimersByTime(DESK_AUTO_SIT_MS * 2);
    expect(returnToDesk).toHaveBeenCalledOnce();

    move({ x: 10, z: 10 });
    move({ x: 2, z: 2 });
    vi.advanceTimersByTime(DESK_AUTO_SIT_MS);
    expect(returnToDesk).toHaveBeenCalledTimes(2);
  });

  it('ignores other desks, unsittable chairs and unrelated store changes', () => {
    const { move, actions, returnToDesk, stop } = setup(() => false);
    move({ x: 2, z: 2 });
    vi.advanceTimersByTime(DESK_AUTO_SIT_MS * 2);
    expect(returnToDesk).not.toHaveBeenCalled();
    stop();
    actions.setDeskClaims({ d1: 'other@example.com' });
    vi.advanceTimersByTime(DESK_AUTO_SIT_MS * 2);
    expect(returnToDesk).not.toHaveBeenCalled();
  });

  it('keeps counting through store changes that are not movement', () => {
    const { move, actions, returnToDesk } = setup();
    move({ x: 2, z: 2 });
    vi.advanceTimersByTime(DESK_AUTO_SIT_MS - 500);
    actions.setDeskClaims({ d1: ME });
    vi.advanceTimersByTime(500);
    expect(returnToDesk).toHaveBeenCalledOnce();
  });
});
