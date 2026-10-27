import { describe, expect, it } from 'vitest';
import {
  INITIAL_WORLD_READINESS,
  worldReadiness,
  type WorldReadiness,
  type WorldReadinessEvent,
} from './world-readiness.ts';

const run = (events: WorldReadinessEvent[], from: WorldReadiness = INITIAL_WORLD_READINESS) =>
  events.reduce(worldReadiness, from);

const mapApplied = (...ids: string[]): WorldReadinessEvent => ({
  type: 'mapApplied',
  bakedLayouts: ids.map((roomInstanceId) => ({ roomInstanceId })),
});
const MAP = mapApplied('a');
const MODELS: WorldReadinessEvent = { type: 'modelsReady' };
const colliders = (roomInstanceId: string): WorldReadinessEvent => ({ type: 'collidersReady', roomInstanceId });
const COLLIDERS = colliders('a');

describe('worldReadiness', () => {
  it.each([
    [[MAP, MODELS, COLLIDERS]],
    [[COLLIDERS, MAP, MODELS]],
    [[MODELS, COLLIDERS, MAP]],
  ])('is ready only once map, models and colliders are all in (%#)', (events) => {
    expect(run(events.slice(0, 2)).type).toBe('loading');
    expect(run(events)).toEqual({ type: 'ready' });
  });

  it('treats a map without baked layouts as having its colliders', () => {
    expect(run([mapApplied(), MODELS])).toEqual({ type: 'ready' });
  });

  it('waits for the colliders of every placement, in any order', () => {
    const map = mapApplied('a', 'b', 'c');
    expect(run([map, MODELS, colliders('c'), colliders('a')]).type).toBe('loading');
    expect(run([colliders('b'), map, MODELS, colliders('c'), colliders('a')])).toEqual({ type: 'ready' });
  });

  it('does not count one placement ready twice for another', () => {
    const map = mapApplied('a', 'b');
    expect(run([map, MODELS, colliders('a'), colliders('a')]).type).toBe('loading');
  });

  it('fails when any placement fails, even after others are ready', () => {
    const map = mapApplied('a', 'b');
    expect(run([map, MODELS, colliders('a'), { type: 'collidersFailed', message: '404' }])).toEqual({
      type: 'failed',
      message: '404',
    });
  });

  it.each([
    { type: 'mapFailed', message: 'no map' } as const,
    { type: 'collidersFailed', message: 'bad glb' } as const,
  ])('fails with the message of $type', (event) => {
    expect(run([MAP, event])).toEqual({ type: 'failed', message: event.message });
  });

  it('stays failed whatever arrives after a failure', () => {
    const failed = run([{ type: 'collidersFailed', message: 'bad glb' }]);
    expect(run([MAP, MODELS, COLLIDERS], failed)).toBe(failed);
  });

  it('stays ready through later map switches and collider resets', () => {
    const ready = run([MAP, MODELS, COLLIDERS]);
    expect(
      run([MAP, COLLIDERS, { type: 'mapFailed', message: 'x' }, { type: 'collidersFailed', message: 'y' }], ready),
    ).toBe(ready);
  });
});
