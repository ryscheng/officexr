// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { startOfficeSync } from '@officexr/core-refactor';
import { useOfficeSession } from './useOfficeSession';

afterEach(cleanup);

describe('useOfficeSession', () => {
  it('starts the realtime sync with the self player held', () => {
    const start = vi.fn<typeof startOfficeSync>(() => new Promise(() => {}));
    renderHook(() => useOfficeSession('o1', { login: 'a@example.com', name: 'A' }, 'p1', true, start));

    expect(start).toHaveBeenCalledOnce();
    expect(start.mock.calls[0][0]).toMatchObject({ holdSelf: true });
  });
});
