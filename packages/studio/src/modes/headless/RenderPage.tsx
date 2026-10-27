import React, { Suspense, useEffect, useMemo, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
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
import { loadRenderContent, type RenderContent, type RenderStorages } from './renderContent.ts';
import { frameCamera, type Bounds, type CameraSetup } from './renderFraming.ts';
import { parseRenderParams, type RenderParams } from './renderParams.ts';

interface RenderSentinels {
  __officexrRenderReady?: { bounds: Bounds; metresPerPixel?: number };
  __officexrRenderError?: string;
}

const sentinels = () => window as unknown as RenderSentinels;
const noop = () => {};

type PageState =
  | { status: 'loading' }
  | { status: 'ready'; content: RenderContent }
  | { status: 'error'; message: string };

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));
const bakedLoadMessage = (err: Error) => `baked layout failed to load: ${err.message}`;

/** Loads the document named by `params`; the first failure sticks. */
function useRenderContent(params: RenderParams | null): [PageState, (message: string) => void] {
  const api = useApplication();
  const testStorages = useTestStorages();
  const storages = useMemo<RenderStorages>(
    () => ({
      maps: testStorages?.mapStorage ?? new FilesystemMapStorage(),
      rooms: testStorages?.roomStorage ?? new FilesystemRoomStorage(),
      layouts: testStorages?.layoutStorage ?? new FilesystemLayoutStorage(),
    }),
    [testStorages],
  );
  const [state, setState] = useState<PageState>({ status: 'loading' });

  useEffect(() => {
    if (!params) {
      return;
    }
    let cancelled = false;
    loadRenderContent(api, storages, params).then(
      (content) => !cancelled && setState({ status: 'ready', content }),
      (err) => !cancelled && setState({ status: 'error', message: errorMessage(err) }),
    );
    return () => {
      cancelled = true;
    };
  }, [api, storages, params]);

  const fail = (message: string) => setState((prev) => (prev.status === 'error' ? prev : { status: 'error', message }));
  return [state, fail];
}

/**
 * Draws one stored map, room or layout from the requested camera.
 *
 * Mounted by HeadlessApp on `?op=render`. `window.__officexrRenderReady`
 * is set once every model and baked GLB has loaded and a few frames have
 * rendered; `window.__officexrRenderError` is set instead when the
 * parameters, the document or a baked GLB are bad.
 */
export function RenderPage() {
  const parsed = useMemo(() => parseRenderParams(new URLSearchParams(window.location.search)), []);
  const params = parsed.ok ? parsed.params : null;
  const [loaded, fail] = useRenderContent(params);
  const state: PageState = parsed.ok ? loaded : { status: 'error', message: parsed.error };

  useEffect(() => {
    if (state.status === 'error') {
      sentinels().__officexrRenderError = state.message;
    }
  }, [state]);
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
  if (state.status === 'loading' || !params) {
    return null;
  }
  return <RenderCanvas params={params} content={state.content} onError={fail} />;
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
  const bakedUrls = useMemo(() => content.bakedLayoutNames.map((n) => bakedLayoutUrl(n)), [content]);

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
        onCreated={({ camera }) => camera.lookAt(new THREE.Vector3(...setup.target))}
      >
        <color attach="background" args={['#1b1d22']} />
        <LightingRig lighting={DEFAULT_EDITOR_LIGHTING} />
        <EndlessGrid fadeDistance={400} />
        <Suspense fallback={null}>
          {/* Baked layouts suspend in their own boundary, so the ready signal
              would otherwise fire before their GLBs arrive. */}
          <BakedLayoutErrorBoundary
            resetKey={params.name}
            onError={(err) => onError(bakedLoadMessage(err))}
          >
            <PreloadGlbs urls={bakedUrls} />
          </BakedLayoutErrorBoundary>
          <RenderedContent content={content} onError={onError} />
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

function RenderedContent({ content, onError }: { content: RenderContent; onError: (message: string) => void }) {
  if (content.type === 'map') {
    return (
      <RoomsLayer
        instances={content.placements}
        rooms={content.rooms}
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
          onLoadError={(err) => onError(bakedLoadMessage(err))}
        />
      ) : null}
      <ObjectInstances worldObjects={content.worldObjects} />
    </>
  );
}
