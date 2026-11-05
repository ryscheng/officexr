// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { ModelWithFallback } from './ModelWithFallback.tsx';

afterEach(() => {
  cleanup();
});

function Model({ url }: { url: string }) {
  if (url === 'broken.glb') {
    throw new Error('404');
  }
  return <span>{url}</span>;
}

describe('ModelWithFallback', () => {
  it('renders the fallback URL when the model URL fails to load', () => {
    // React logs the caught error; keep the test output clean.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { container } = render(
      <ModelWithFallback url="broken.glb" fallbackUrl="Mage.glb" render={(url) => <Model url={url} />} />,
    );
    consoleError.mockRestore();
    consoleWarn.mockRestore();
    expect(container.textContent).toBe('Mage.glb');
  });

  it('renders the model URL when it loads', () => {
    const { container } = render(
      <ModelWithFallback url="Ghost.glb" fallbackUrl="Mage.glb" render={(url) => <Model url={url} />} />,
    );
    expect(container.textContent).toBe('Ghost.glb');
  });

  it('renders nothing instead of throwing when the fallback fails too', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { container } = render(
      <ModelWithFallback url="broken.glb" fallbackUrl="broken.glb" render={(url) => <Model url={url} />} />,
    );
    consoleError.mockRestore();
    consoleWarn.mockRestore();
    expect(container.textContent).toBe('');
  });
});
