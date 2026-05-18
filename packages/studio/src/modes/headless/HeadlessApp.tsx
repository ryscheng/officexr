import React, { useEffect } from 'react';
import { useApplication } from '@officexr/world/react';
import { BakeRunner } from './BakeRunner.tsx';
import { BoundsScene } from './BoundsScene.tsx';

/**
 * Headless test harness. Routed by App when `?op=...` is present in
 * the URL. Mounts the operation-specific component inside the same
 * ApplicationProvider the regular UI uses, so the bake / visual
 * scenes consume the SAME application api.
 *
 * Single bridge to Playwright: `window.officexrApi` holds the live
 * ApplicationApi object. Drivers call methods on it via
 * `page.evaluate` rather than scraping the DOM.
 */
export function HeadlessApp({ op, sceneId }: { op: string; sceneId?: string }) {
  const api = useApplication();

  // Single Playwright bridge: expose the api itself. Drivers reach
  // every service (catalog, bake, scenes, …) through this getter.
  useEffect(() => {
    const w = window as unknown as { officexrApi?: typeof api };
    w.officexrApi = api;
    return () => {
      delete w.officexrApi;
    };
  }, [api]);

  if (op === 'bake') {
    return <BakeRunner />;
  }
  if (op === 'bounds-scene') {
    return <BoundsScene sceneId={sceneId ?? 'blue-and-large-a'} />;
  }
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: '#000',
        color: '#fcc',
        fontFamily: 'monospace',
        padding: 16,
      }}
    >
      <h1>Unknown headless op</h1>
      <p>Got `?op={op}`. Known: bake, bounds-scene.</p>
    </div>
  );
}
