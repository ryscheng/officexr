import { useEffect, useMemo, useSyncExternalStore } from 'react';
import {
  DEFAULT_WORLD_CONSTANTS,
  type Actions,
  type Store,
  type WorldConstants,
} from '@officexr/sdk';
import {
  FilesystemWorldConstantsStorage,
  WorldConstantsPushError,
  type WorldConstantsStorage,
} from '@officexr/world/scenes';
import { useTestStorages } from '../../test-harness/TestStorageContext.tsx';

export const SAVE_DEBOUNCE_MS = 500;

export type PersistenceStatus =
  | { type: 'loading' }
  | { type: 'clean' }
  | { type: 'dirty' }
  | { type: 'saving' }
  | { type: 'failed'; message: string };

/**
 * Loads the saved world constants into the store, then debounces local
 * edits into saves. While an edit is unsaved or unacknowledged, any other
 * value landing in the store (a server push, or the echo of an earlier
 * save) is overwritten with the pending edit.
 */
class WorldConstantsPersistence {
  private status: PersistenceStatus = { type: 'loading' };
  private pending: WorldConstants | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private saves: Promise<void> = Promise.resolve();
  private listeners = new Set<() => void>();
  private loadGeneration = 0;
  private active = false;

  constructor(
    private readonly store: Store,
    private readonly actions: Actions,
    private readonly storage: WorldConstantsStorage,
  ) {}

  getStatus = (): PersistenceStatus => this.status;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  start(): () => void {
    this.active = true;
    const off = this.store.subscribe(
      (s) => s.worldConstants,
      // Deferred so the re-apply never runs as a nested setState inside the
      // store's own listener loop.
      () => queueMicrotask(this.reapplyPending),
    );
    void this.load();
    return () => {
      this.active = false;
      off();
      this.saveUnsavedOnStop();
    };
  }

  edit = (update: (prev: WorldConstants) => WorldConstants): void => {
    const next = update(this.store.getState().worldConstants);
    this.pending = next;
    this.actions.setWorldConstants(next);
    this.setStatus({ type: 'dirty' });
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(this.flush, SAVE_DEBOUNCE_MS);
  };

  retry = (): void => {
    if (this.status.type !== 'failed') {
      return;
    }
    if (this.pending) {
      this.flush();
    } else {
      void this.load();
    }
  };

  private async load(): Promise<void> {
    const generation = ++this.loadGeneration;
    this.setStatus({ type: 'loading' });
    const isCurrent = () =>
      this.active && generation === this.loadGeneration && this.status.type === 'loading';
    let doc: WorldConstants | null;
    try {
      doc = await this.storage.load();
    } catch (err) {
      if (isCurrent()) {
        this.setStatus({ type: 'failed', message: `load failed: ${errorMessage(err)}` });
      }
      return;
    }
    if (isCurrent()) {
      this.actions.setWorldConstants(doc ?? DEFAULT_WORLD_CONSTANTS);
      this.setStatus({ type: 'clean' });
    }
  }

  private flush = (): void => {
    this.timer = null;
    const doc = this.pending;
    if (!doc) {
      return;
    }
    this.setStatus({ type: 'saving' });
    // Chained so an older save can never land after a newer one.
    this.saves = this.saves.then(() => this.save(doc));
  };

  private async save(doc: WorldConstants): Promise<void> {
    try {
      await this.storage.save(doc);
    } catch (err) {
      if (this.pending === doc) {
        this.setStatus({ type: 'failed', message: describeSaveFailure(err) });
      }
      return;
    }
    if (this.pending === doc) {
      this.pending = null;
      this.setStatus({ type: 'clean' });
    }
  }

  private reapplyPending = (): void => {
    if (this.pending && this.store.getState().worldConstants !== this.pending) {
      this.actions.setWorldConstants(this.pending);
    }
  };

  private saveUnsavedOnStop(): void {
    if (!this.timer) {
      return;
    }
    clearTimeout(this.timer);
    this.timer = null;
    const doc = this.pending;
    if (doc) {
      this.saves = this.saves.then(() => this.storage.save(doc)).catch((err) => {
        console.warn('[world-constants] save on exit failed:', err);
      });
    }
  }

  private setStatus(status: PersistenceStatus): void {
    this.status = status;
    for (const l of [...this.listeners]) {
      l();
    }
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function describeSaveFailure(err: unknown): string {
  if (err instanceof WorldConstantsPushError) {
    return `saved, but push to ${err.failed.map((f) => f.target).join(', ')} failed`;
  }
  return `save failed: ${errorMessage(err)}`;
}

export interface UseWorldConstantsPersistenceResult {
  status: PersistenceStatus;
  /** Applies the update to the store now and saves the result once edits pause. */
  edit: (update: (prev: WorldConstants) => WorldConstants) => void;
  /** Re-runs the failed save (or load). */
  retry: () => void;
}

/** Storage resolves as `storage` → the `?test=1` test storage → Filesystem. */
export function useWorldConstantsPersistence(opts: {
  store: Store;
  actions: Actions;
  storage?: WorldConstantsStorage;
}): UseWorldConstantsPersistenceResult {
  const { store, actions } = opts;
  const testStorages = useTestStorages();
  const storage = useMemo(
    () =>
      opts.storage ?? testStorages?.worldConstantsStorage ?? new FilesystemWorldConstantsStorage(),
    [opts.storage, testStorages],
  );
  const persistence = useMemo(
    () => new WorldConstantsPersistence(store, actions, storage),
    [store, actions, storage],
  );
  useEffect(() => persistence.start(), [persistence]);
  const status = useSyncExternalStore(persistence.subscribe, persistence.getStatus);
  return useMemo(
    () => ({ status, edit: persistence.edit, retry: persistence.retry }),
    [status, persistence],
  );
}
