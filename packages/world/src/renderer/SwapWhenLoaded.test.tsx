// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { ModelWithFallback } from './ModelWithFallback.tsx';
import { SwapWhenLoaded } from './SwapWhenLoaded.tsx';

afterEach(() => {
  cleanup();
});

/** A suspending loader whose per-URL loads the test settles by hand. */
function fakeLoader(cached: string[]) {
  const loaded = new Set(cached);
  const failed = new Set<string>();
  const pending = new Map<string, { promise: Promise<void>; settle: () => void }>();
  const useLoad = (urls: string[]) => {
    for (const url of urls) {
      if (failed.has(url)) {
        throw new Error(`404 ${url}`);
      }
      if (!loaded.has(url)) {
        let settle!: () => void;
        const promise = new Promise<void>((r) => (settle = r));
        const entry = pending.get(url) ?? { promise, settle };
        pending.set(url, entry);
        throw entry.promise;
      }
    }
  };
  const finish = async (url: string, outcome: 'ok' | 'fail') => {
    (outcome === 'ok' ? loaded : failed).add(url);
    await act(async () => {
      pending.get(url)?.settle();
    });
  };
  return { useLoad, finish };
}

function Model(props: { url: string; useLoad: (urls: string[]) => void }) {
  props.useLoad([props.url]);
  return <span>{props.url}</span>;
}

function renderSwap(url: string, loader: ReturnType<typeof fakeLoader>) {
  return (
    <SwapWhenLoaded
      value={url}
      keyOf={(u) => u}
      urlsOf={(u) => [u]}
      useLoad={loader.useLoad}
      render={(u) => (
        <ModelWithFallback
          url={u}
          fallbackUrl="Mage.glb"
          render={(m) => <Model url={m} useLoad={loader.useLoad} />}
        />
      )}
    />
  );
}

describe('SwapWhenLoaded', () => {
  it('keeps showing the current model while the next one loads, then swaps', async () => {
    const loader = fakeLoader(['Mage.glb']);
    const { container, rerender } = render(renderSwap('Mage.glb', loader));
    expect(container.textContent).toBe('Mage.glb');

    rerender(renderSwap('Robot.glb', loader));
    expect(container.textContent).toBe('Mage.glb');

    await loader.finish('Robot.glb', 'ok');
    expect(container.textContent).toBe('Robot.glb');
  });

  it('swaps on a failed load so the renderer can show its own fallback', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const loader = fakeLoader(['Mage.glb']);
    const { container, rerender } = render(
      <div>
        <span>world</span>
        {renderSwap('Mage.glb', loader)}
      </div>,
    );
    rerender(
      <div>
        <span>world</span>
        {renderSwap('broken.glb', loader)}
      </div>,
    );
    await loader.finish('broken.glb', 'fail');
    consoleError.mockRestore();
    consoleWarn.mockRestore();
    expect(container.textContent).toBe('worldMage.glb');
  });

  it('shows the rest of the tree while a first model loads', async () => {
    const loader = fakeLoader([]);
    const { container } = render(
      <div>
        <span>world</span>
        {renderSwap('Robot.glb', loader)}
      </div>,
    );
    expect(container.textContent).toBe('world');
    await loader.finish('Robot.glb', 'ok');
    expect(container.textContent).toBe('worldRobot.glb');
  });

  it('skips a model superseded before it finished loading', async () => {
    const loader = fakeLoader(['Mage.glb']);
    const { container, rerender } = render(renderSwap('Mage.glb', loader));
    rerender(renderSwap('Robot.glb', loader));
    rerender(renderSwap('Knight.glb', loader));
    await loader.finish('Robot.glb', 'ok');
    expect(container.textContent).toBe('Mage.glb');
    await loader.finish('Knight.glb', 'ok');
    expect(container.textContent).toBe('Knight.glb');
  });
});
