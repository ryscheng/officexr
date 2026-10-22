import { parseWorldConstants, type WorldConstants } from '@officexr/sdk';

/** One realtime server the studio failed to push a saved document to. */
export type WorldConstantsPushFailure = {
  target: string;
  status?: number;
  error?: string;
};

/** Thrown by `save` when the document was written but not every target accepted it. */
export class WorldConstantsPushError extends Error {
  constructor(readonly failed: WorldConstantsPushFailure[]) {
    super(`world-constants push failed: ${failed.map((f) => f.target).join(', ')}`);
    this.name = 'WorldConstantsPushError';
  }
}

/** Single-document storage; `load` is null until a document has been saved. */
export interface WorldConstantsStorage {
  load(): Promise<WorldConstants | null>;
  save(doc: WorldConstants): Promise<void>;
}

export class InMemoryWorldConstantsStorage implements WorldConstantsStorage {
  private doc: WorldConstants | null;

  constructor(opts: { seed?: WorldConstants } = {}) {
    this.doc = opts.seed ? structuredClone(opts.seed) : null;
  }

  async load(): Promise<WorldConstants | null> {
    return this.doc ? structuredClone(this.doc) : null;
  }

  async save(doc: WorldConstants): Promise<void> {
    this.doc = structuredClone(doc);
  }
}

/** Talks to `/api/world-settings`; a 502 means saved on disk but not pushed everywhere. */
export class FilesystemWorldConstantsStorage implements WorldConstantsStorage {
  private base: string;

  constructor(opts: { basePath?: string } = {}) {
    this.base = (opts.basePath ?? '/api/world-settings').replace(/\/$/, '');
  }

  async load(): Promise<WorldConstants | null> {
    const r = await fetch(this.base);
    if (r.status === 404) {
      return null;
    }
    if (!r.ok) {
      throw new Error(`world-constants-storage load: ${r.status}`);
    }
    return parseWorldConstants(await r.json());
  }

  async save(doc: WorldConstants): Promise<void> {
    const r = await fetch(this.base, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(doc),
    });
    if (r.status === 502) {
      const body = (await r.json()) as { failed: WorldConstantsPushFailure[] };
      throw new WorldConstantsPushError(body.failed);
    }
    if (!r.ok) {
      throw new Error(`world-constants-storage save: ${r.status}`);
    }
  }
}
