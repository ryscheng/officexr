import type { WorldConstants } from '@officexr/sdk';
import { InMemoryWorldConstantsStorage } from '@officexr/world/scenes';

/** Shape of `window.__OFFICEXR_TEST_API__`, which a Playwright spec reads. */
export interface TestApi {
  /** Every document saved to the world-constants storage, oldest first. */
  worldConstantsSaves: WorldConstants[];
}

export class RecordingWorldConstantsStorage extends InMemoryWorldConstantsStorage {
  constructor(
    private readonly saves: WorldConstants[],
    opts: { seed?: WorldConstants },
  ) {
    super(opts);
  }

  override async save(doc: WorldConstants): Promise<void> {
    this.saves.push(structuredClone(doc));
    await super.save(doc);
  }
}

/** Created once per page: StrictMode builds the storages twice and keeps one. */
export function testApi(): TestApi {
  const g = globalThis as { __OFFICEXR_TEST_API__?: TestApi };
  g.__OFFICEXR_TEST_API__ ??= { worldConstantsSaves: [] };
  return g.__OFFICEXR_TEST_API__;
}
