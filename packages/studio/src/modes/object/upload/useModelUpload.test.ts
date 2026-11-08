import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ModelSourcesClient } from './modelSourcesClient.ts';
import { useModelUpload } from './useModelUpload.ts';

describe('useModelUpload', () => {
  it('ignores a second start while running and clears results on reset', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let urlCalls = 0;
    const client: ModelSourcesClient = {
      requestUploadUrls: async () => {
        urlCalls++;
        await gate;
        return [];
      },
      put: async () => {},
      finalize: async () => {
        throw new Error('unused');
      },
      recoverKind: async () => null,
    };
    const file = new File(['x'], 'a.png');
    file.arrayBuffer = async () => new ArrayBuffer(1);
    const { result } = renderHook(() => useModelUpload({ client, onFinalized: () => {} }));

    let first!: Promise<void>;
    act(() => {
      first = result.current.start('p', [{ path: 'a.png', file }]);
      void result.current.start('p', [{ path: 'a.png', file }]);
    });
    result.current.reset();
    expect(result.current.files).toHaveLength(1);
    release();
    await act(() => first);
    expect(urlCalls).toBe(1);

    act(() => result.current.reset());
    expect(result.current.files).toEqual([]);
  });
});
