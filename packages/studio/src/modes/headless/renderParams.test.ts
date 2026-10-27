import { describe, expect, it } from 'vitest';
import { parseRenderParams } from './renderParams.ts';

const parse = (query: string) => parseRenderParams(new URLSearchParams(query));

describe('parseRenderParams', () => {
  it('applies the defaults for camera and size', () => {
    expect(parse('target=map&name=office')).toEqual({
      ok: true,
      params: { target: 'map', name: 'office', camera: { type: 'iso' }, width: 1024, height: 768 },
    });
  });

  it.each(['map', 'room', 'layout'])('accepts target=%s', (target) => {
    const result = parse(`target=${target}&name=x`);
    expect(result.ok && result.params.target).toBe(target);
  });

  it('parses top and a sized render', () => {
    expect(parse('target=room&name=r&camera=top&w=320&h=200')).toMatchObject({
      ok: true,
      params: { camera: { type: 'top' }, width: 320, height: 200 },
    });
  });

  it('parses a custom camera, with and without a target', () => {
    expect(parse('target=map&name=m&camera=custom&px=1&py=2.5&pz=-3&tx=4&ty=5&tz=6')).toMatchObject({
      ok: true,
      params: { camera: { type: 'custom', position: [1, 2.5, -3], target: [4, 5, 6] } },
    });
    expect(parse('target=map&name=m&camera=custom&px=1&py=2&pz=3')).toMatchObject({
      ok: true,
      params: { camera: { type: 'custom', position: [1, 2, 3], target: undefined } },
    });
  });

  it.each([
    ['missing target', 'name=x'],
    ['unknown target', 'target=building&name=x'],
    ['missing name', 'target=map'],
    ['path-like name', 'target=map&name=..'],
    ['unknown camera', 'target=map&name=x&camera=fisheye'],
    ['custom without a position', 'target=map&name=x&camera=custom'],
    ['partial position', 'target=map&name=x&camera=custom&px=1&py=2'],
    ['partial target', 'target=map&name=x&camera=custom&px=1&py=2&pz=3&tx=1'],
    ['non-numeric coordinate', 'target=map&name=x&camera=custom&px=a&py=2&pz=3'],
    ['empty coordinate', 'target=map&name=x&camera=custom&px=&py=2&pz=3'],
    ['non-finite coordinate', 'target=map&name=x&camera=custom&px=Infinity&py=2&pz=3'],
    ['fractional width', 'target=map&name=x&w=100.5'],
    ['zero height', 'target=map&name=x&h=0'],
    ['oversized width', 'target=map&name=x&w=99999'],
  ])('rejects %s', (_label, query) => {
    const result = parse(query);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toBeTruthy();
  });
});
