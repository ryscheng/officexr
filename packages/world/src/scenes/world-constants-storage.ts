import { parseWorldConstants, type WorldConstants } from '@officexr/sdk';
import { FilesystemSingleDocumentStorage } from './filesystem-single-document-storage.ts';

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
export class FilesystemWorldConstantsStorage
  extends FilesystemSingleDocumentStorage<WorldConstants>
  implements WorldConstantsStorage
{
  constructor(opts: { basePath?: string } = {}) {
    super(opts.basePath ?? '/api/world-settings', 'world-constants-storage', parseWorldConstants);
  }

  protected override async rejectSave(r: Response): Promise<never> {
    if (r.status === 502) {
      // A proxy's own 502 has no `failed` list; fall through to the generic error.
      const body = (await r.json().catch(() => null)) as { failed?: unknown } | null;
      if (Array.isArray(body?.failed)) {
        throw new WorldConstantsPushError(body.failed as WorldConstantsPushFailure[]);
      }
    }
    return super.rejectSave(r);
  }
}
