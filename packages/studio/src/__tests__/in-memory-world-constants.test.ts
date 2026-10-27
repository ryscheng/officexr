import { describe, expect, it } from 'vitest';
import { DEFAULT_WORLD_CONSTANTS } from '@officexr/sdk';
import { createPersistentLocalState } from '@officexr/core-refactor';
import { buildInMemoryStack } from '../realtime/services.ts';

const fakeAudio = { play: async () => {}, pause: () => {} } as unknown as HTMLAudioElement;

describe('in-memory stack world constants', () => {
  it('in-browser bots follow a local world-constants change', async () => {
    const local = createPersistentLocalState({ selfId: 'local-player', officeId: 'office' });
    const stack = await buildInMemoryStack({ local, audio: fakeAudio });
    try {
      await stack.bots.setCount(1);
      const [bot] = stack.bots.list();
      expect(bot!.getWorldConstants()?.animation.walkSpeed).toBe(
        DEFAULT_WORLD_CONSTANTS.animation.walkSpeed,
      );

      local.actions.setWorldConstants({
        ...DEFAULT_WORLD_CONSTANTS,
        animation: { ...DEFAULT_WORLD_CONSTANTS.animation, walkSpeed: 4.5 },
      });

      expect(bot!.getWorldConstants()?.animation.walkSpeed).toBe(4.5);
    } finally {
      await stack.teardown();
    }
  });
});
