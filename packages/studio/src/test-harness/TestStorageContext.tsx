import React, { createContext, useContext } from 'react';
import type {
  LayoutStorage,
  MapStorage,
  RoomStorage,
} from '@officexr/world/scenes';

/**
 * Storages a hermetic test session injects into the editors. When the
 * studio boots in test mode (`?test=1`), `App.tsx` mounts a provider
 * with in-memory storages; the document hooks read this context as a
 * default when no explicit `storage` option is passed.
 *
 * This is the ONE production-code seam the Playwright hermetic harness
 * needs. It's intentionally tiny and side-effect-free: in normal
 * (non-test) operation the context value is `null` and every hook falls
 * back to its Filesystem/LocalStorage stack exactly as before.
 */
export interface TestStorages {
  mapStorage?: MapStorage;
  roomStorage?: RoomStorage;
  layoutStorage?: LayoutStorage;
}

const TestStorageCtx = createContext<TestStorages | null>(null);

export function TestStorageProvider(props: {
  value: TestStorages;
  children: React.ReactNode;
}) {
  return (
    <TestStorageCtx.Provider value={props.value}>
      {props.children}
    </TestStorageCtx.Provider>
  );
}

/** Returns the injected test storages, or `null` in normal operation. */
export function useTestStorages(): TestStorages | null {
  return useContext(TestStorageCtx);
}
