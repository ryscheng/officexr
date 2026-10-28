// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Dialog } from './Dialog';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  // jsdom doesn't implement it, so the test defines it.
  delete (document as Partial<Document>).exitPointerLock;
});

it('releases a locked pointer when it opens', () => {
  Object.defineProperty(document, 'exitPointerLock', { value: () => {}, configurable: true, writable: true });
  const exitPointerLock = vi.spyOn(document, 'exitPointerLock');
  render(
    <Dialog title="T" onClose={() => {}}>
      body
    </Dialog>,
  );
  expect(exitPointerLock).toHaveBeenCalledTimes(1);
});
