// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Dialog } from './Dialog';

afterEach(cleanup);

it('releases a locked pointer when it opens', () => {
  const exitPointerLock = vi.fn();
  document.exitPointerLock = exitPointerLock;
  render(
    <Dialog title="T" onClose={() => {}}>
      body
    </Dialog>,
  );
  expect(exitPointerLock).toHaveBeenCalledTimes(1);
});
