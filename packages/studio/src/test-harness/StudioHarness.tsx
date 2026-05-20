import React, { useMemo } from 'react';
import { ApplicationProvider } from '@officexr/world/react';
import type { ApplicationApi } from '@officexr/world/app';
import { createTestApi } from './createTestApi.ts';

export interface StudioHarnessProps {
  /** Override the application api. Defaults to a fresh
   *  `createTestApi()` (hermetic catalog, no network). */
  api?: ApplicationApi;
  children: React.ReactNode;
}

/**
 * The standard wrapper for Tier 2/3 studio tests. Mounts children
 * under an `<ApplicationProvider>` built from a hermetic
 * `ApplicationApi`, so `useApplication` / `useCatalog` / `useCatalogReady`
 * resolve without touching the dev server. Pair with an
 * `InMemory*Storage` passed into the editor hook for fully hermetic
 * load/save.
 */
export function StudioHarness({ api, children }: StudioHarnessProps) {
  const resolved = useMemo(() => api ?? createTestApi(), [api]);
  return <ApplicationProvider api={resolved}>{children}</ApplicationProvider>;
}
