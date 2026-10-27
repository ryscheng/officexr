import React, { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import { bakedLayoutUrl } from '@officexr/world/app';
import { useApplication } from '@officexr/world/react';
import {
  FilesystemLayoutStorage,
  FilesystemMapStorage,
  FilesystemRoomStorage,
} from '@officexr/world/scenes';
import {
  BakedLayout,
  BakedLayoutErrorBoundary,
  DEFAULT_EDITOR_LIGHTING,
  EndlessGrid,
  LightingRig,
  ObjectInstances,
} from '@officexr/world/renderer';
import { useTestStorages } from '../../test-harness/TestStorageContext.tsx';
import { RoomsLayer } from '../map/MapEditorCanvas.tsx';
import { ReadySignal } from './ReadySignal.tsx';
import { bakedLayoutNames, loadRenderContent, type RenderContent, type RenderStorages } from './renderContent.ts';
import { frameCamera, type Bounds, type CameraSetup } from './renderFraming.ts';
import { parseRenderParams, type RenderParams } from './renderParams.ts';

interface RenderSentinels {
  __officexrRenderReady?: { bounds: Bounds; metresPerPixel?: number };
  __officexrRenderError?: string;
}

const sentinels = () => window as unknown as RenderSentinels;
const noop = () => {};
const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

type PageState =
  | { status: 'loading' }
  | { status: 'ready'; content: RenderContent }
  | { status: 'error'; message: string };

function useRenderStorages(): RenderStorages {
  const testStorages = useTestStorages();
  return useMemo(
    () => ({
      maps: testStorages?.mapStorage ?? new FilesystemMapStorage(),
      rooms: testStorages?.roomStorage ?? new FilesystemRoomStorage(),
      layouts: testStorages?.layoutStorage ?? new FilesystemLayoutStorage(),
    }),
    [testStorages],
  );
}

/**
 * Draws one stored map, room or layout from the requested camera.
 *
 * Mounted by HeadlessApp on `?op=render`. `window.__officexrRenderReady`
 * is set once every model and baked GLB has loaded and a few frames have
 * rendered; `window.__officexrRenderError` is set instead when the
 * parameters, the document or an asset are bad.
 */
export function RenderPage() {
  const api = useApplication();
  const storages = useRenderStorages();
  const parsed = useMemo(() => parseRenderParams(new URLSearchParams(window.location.search)), []);
  const [state, setState] = useState<PageState>({ status: 'loading' });

  // The sentinel is set here, not from a render, so the ready signal can never race past an error.
  const fail = useCallback((message: string) => {
    const w = sentinels();
    w.__officexrRenderError ??= message;
    setState({ status: 'error', message: w.__officexrRenderError });
  }, []);

  useEffect(() => {
    if (!parsed.ok) {
      fail(parsed.error);
      return;
    }
    let cancelled = false;
    loadRenderContent(api, storages, parsed.params).then(
      (content) => !cancelled && setState({ status: 'ready', content }),
      (err) => !cancelled && fail(errorMessage(err)),
    );
    return () => {
      cancelled = true;
    };
  }, [api, storages, parsed, fail]);
  useEffect(
    () => () => {
      delete sentinels().__officexrRenderReady;
      delete sentinels().__officexrRenderError;
    },
    [],
  );

  if (state.status === 'error') {
    return <pre style={{ color: '#fcc', fontFamily: 'monospace', padding: 16 }}>{state.message}</pre>;
  }
  if (state.status === 'loading' || !parsed.ok) {
    return null;
  }
  return <RenderCanvas params={parsed.params} content={state.content} onError={fail} />;
}

function RenderCanvas({
  params,
  content,
  onError,
}: {
  params: RenderParams;
  content: RenderContent;
  onError: (message: string) => void;
}) {
  const setup = useMemo(() => frameCamera(params.camera, content.bounds, params), [params, content.bounds]);
  const ortho = setup.type === 'orthographic';
  const cameraProps = ortho
    ? { position: setup.position, up: setup.up, zoom: setup.zoom, near: setup.near, far: setup.far }
    : { position: setup.position, fov: setup.fov, near: setup.near, far: setup.far };
  const glbUrls = useMemo(
    () => [...bakedLayoutNames(content).map((n) => bakedLayoutUrl(n)), ...content.modelUrls],
    [content],
  );
  const onAssetError = (err: Error) => onError(`failed to load asset: ${err.message}`);

  return (
    <div
      data-render-target={params.target}
      style={{ position: 'absolute', top: 0, left: 0, width: params.width, height: params.height }}
    >
      <Canvas
        orthographic={ortho}
        dpr={1}
        camera={cameraProps}
        gl={{ preserveDrawingBuffer: true, antialias: true, alpha: false }}
        style={{ width: '100%', height: '100%' }}
        onCreated={({ camera }) => camera.lookAt(...setup.target)}
      >
        <color attach="background" args={['#1b1d22']} />
        <LightingRig lighting={DEFAULT_EDITOR_LIGHTING} />
        <EndlessGrid fadeDistance={400} />
        <Suspense fallback={null}>
          <BakedLayoutErrorBoundary resetKey={params.name} onError={onAssetError}>
            {/* Baked layouts suspend in their own boundary, so the ready signal
                would otherwise fire before their GLBs arrive. */}
            <PreloadGlbs urls={glbUrls} />
            <RenderedContent content={content} onAssetError={onAssetError} />
          </BakedLayoutErrorBoundary>
          <ReadySignal onReady={() => reportReady(content.bounds, setup)} />
        </Suspense>
      </Canvas>
    </div>
  );
}

function reportReady(bounds: Bounds, setup: CameraSetup) {
  const w = sentinels();
  if (w.__officexrRenderError === undefined) {
    w.__officexrRenderReady = {
      bounds,
      metresPerPixel: setup.type === 'orthographic' ? setup.metresPerPixel : undefined,
    };
  }
}

function PreloadGlbs({ urls }: { urls: string[] }) {
  useGLTF(urls);
  return null;
}

function RenderedContent({
  content,
  onAssetError,
}: {
  content: RenderContent;
  onAssetError: (err: Error) => void;
}) {
  if (content.type === 'map') {
    return (
      <RoomsLayer
        doc={content.doc}
        rooms={content.rooms}
        layouts={content.layouts}
        selection={null}
        onSelect={noop}
        onMove={noop}
        tool="select"
        onPlaceSpawn={noop}
      />
    );
  }
  return (
    <>
      {content.type === 'room' && content.layoutName ? (
        <BakedLayout
          gltfPath={bakedLayoutUrl(content.layoutName)}
          layoutName={content.layoutName}
          onLoadError={onAssetError}
        />
      ) : null}
      <ObjectInstances worldObjects={content.worldObjects} />
    </>
  );
}
