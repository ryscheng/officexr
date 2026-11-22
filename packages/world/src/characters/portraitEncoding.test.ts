import { describe, expect, it, vi } from 'vitest';
import { encodePortrait, PORTRAIT_QUALITY } from './portraitEncoding.ts';

describe('encodePortrait', () => {
  it('encodes WebP at the portrait quality when the browser can', () => {
    const toDataURL = vi.fn((_type?: string, _quality?: number) => 'data:image/webp;base64,AAAA');
    expect(encodePortrait({ toDataURL })).toBe('data:image/webp;base64,AAAA');
    expect(toDataURL).toHaveBeenCalledTimes(1);
    expect(toDataURL).toHaveBeenCalledWith('image/webp', PORTRAIT_QUALITY);
  });

  it('falls back to PNG when the browser answers a WebP request with PNG', () => {
    const toDataURL = vi.fn((type?: string, _quality?: number) => (type === 'image/png' ? 'data:image/png;base64,BBBB' : 'data:image/png;base64,CCCC'));
    expect(encodePortrait({ toDataURL })).toBe('data:image/png;base64,BBBB');
    expect(toDataURL).toHaveBeenLastCalledWith('image/png');
  });
});
