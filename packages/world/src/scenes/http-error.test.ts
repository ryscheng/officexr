import { describe, expect, it } from 'vitest';
import { httpError } from './storage.ts';

describe('httpError', () => {
  it('appends the server error message', async () => {
    const r = new Response(JSON.stringify({ error: 'bad doc' }), { status: 400 });
    expect((await httpError('room-storage save', r)).message).toBe('room-storage save: 400 bad doc');
  });

  it('falls back to the status when the body has no error', async () => {
    expect((await httpError('room-storage save', new Response('<html>', { status: 502 }))).message).toBe(
      'room-storage save: 502',
    );
    expect((await httpError('x', new Response('{}', { status: 500 }))).message).toBe('x: 500');
  });
});
