import { Suspense, useEffect, useEffectEvent, useState, type ReactNode } from 'react';
import { useGLTF } from '@react-three/drei';
import { ResetKeyErrorBoundary } from './ResetKeyErrorBoundary.tsx';

/**
 * Renders `render(shown)`, where `shown` trails `value`: when `value` changes to one whose
 * `urlsOf` GLBs aren't cached yet, the old `shown` stays on screen while they load in the
 * background, and the swap happens once they're in. Each model therefore suspends only its own
 * boundary, never the whole canvas — an uncached character no longer blanks the world.
 *
 * A load failure swaps anyway, so `render` sees the failing value and its own error handling
 * (e.g. `ModelWithFallback`) decides what to show.
 */
export function SwapWhenLoaded<T>(props: {
  value: T;
  /** Identity of a value; a change of key is a change of model. */
  keyOf: (value: T) => string;
  /** The GLBs `render(value)` loads. */
  urlsOf: (value: T) => string[];
  render: (value: T) => ReactNode;
  /** Suspends until `urls` are cached; throws if one fails. */
  useLoad?: (urls: string[]) => void;
}) {
  const { value, keyOf, urlsOf, render, useLoad = useGLTF } = props;
  const [shown, setShown] = useState(value);
  const pendingKey = keyOf(value);
  const pending = pendingKey !== keyOf(shown);
  const swap = () => setShown(value);
  return (
    <>
      {/* Catches the first load, before there is an earlier model to keep showing. */}
      <Suspense fallback={null}>{render(shown)}</Suspense>
      {pending && (
        <ResetKeyErrorBoundary key={pendingKey} resetKey={pendingKey} onError={swap}>
          <Suspense fallback={null}>
            <Preload key={pendingKey} urls={urlsOf(value)} useLoad={useLoad} onLoaded={swap} />
          </Suspense>
        </ResetKeyErrorBoundary>
      )}
    </>
  );
}

function Preload(props: { urls: string[]; useLoad: (urls: string[]) => void; onLoaded: () => void }) {
  props.useLoad(props.urls);
  const onLoaded = useEffectEvent(props.onLoaded);
  useEffect(() => {
    onLoaded();
  }, []);
  return null;
}
