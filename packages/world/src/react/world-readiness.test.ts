import { describe, expect, it } from 'vitest';
import {
  INITIAL_WORLD_READINESS,
  worldReadiness,
  type WorldReadiness,
  type WorldReadinessEvent,
} from './world-readiness.ts';

const run = (events: WorldReadinessEvent[], from: WorldReadiness = INITIAL_WORLD_READINESS) =>
  events.reduce(worldReadiness, from);

const MAP: WorldReadinessEvent = { type: 'mapApplied', bakedColliders: true };
const MODELS: WorldReadinessEvent = { type: 'modelsReady' };
const COLLIDERS: WorldReadinessEvent = { type: 'collidersReady' };

describe('worldReadiness', () => {
  it.each([
    [[MAP, MODELS, COLLIDERS]],
    [[COLLIDERS, MAP, MODELS]],
    [[MODELS, COLLIDERS, MAP]],
  ])('is ready only once map, models and colliders are all in (%#)', (events) => {
    expect(run(events.slice(0, 2)).type).toBe('loading');
    expect(run(events)).toEqual({ type: 'ready' });
  });

  it('treats a map without baked colliders as having its colliders', () => {
    expect(run([{ type: 'mapApplied', bakedColliders: false }, MODELS])).toEqual({ type: 'ready' });
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
