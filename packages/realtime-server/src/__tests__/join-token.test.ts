import { describe, expect, it } from 'vitest';
import { signJoinToken, verifyJoinToken } from '../join-token.ts';

const SECRET = 'secret';

describe('join token', () => {
  it('round-trips the login', () => {
    const token = signJoinToken(SECRET, { login: 'ann', ttlMs: 1000, now: 0 });
    expect(verifyJoinToken(SECRET, token, 500)).toEqual({ login: 'ann' });
  });

  it('rejects a tampered payload', () => {
    const [, sig] = signJoinToken(SECRET, { login: 'ann', ttlMs: 1000, now: 0 }).split('.');
    const forged = Buffer.from(JSON.stringify({ login: 'bob', exp: 1000 })).toString('base64url');
    expect(verifyJoinToken(SECRET, `${forged}.${sig}`, 500)).toBeNull();
  });

  it('rejects a tampered or truncated signature', () => {
    const token = signJoinToken(SECRET, { login: 'ann', ttlMs: 1000, now: 0 });
    expect(verifyJoinToken(SECRET, `${token}A`, 500)).toBeNull();
    expect(verifyJoinToken(SECRET, token.slice(0, -2), 500)).toBeNull();
  });

  it('rejects a token signed with another secret', () => {
    const token = signJoinToken('other', { login: 'ann', ttlMs: 1000, now: 0 });
    expect(verifyJoinToken(SECRET, token, 500)).toBeNull();
  });

  it('rejects an expired token', () => {
    const token = signJoinToken(SECRET, { login: 'ann', ttlMs: 1000, now: 0 });
    expect(verifyJoinToken(SECRET, token, 1000)).toBeNull();
    expect(verifyJoinToken(SECRET, token, 5000)).toBeNull();
  });

  it('rejects an invalid login even when correctly signed', () => {
    expect(verifyJoinToken(SECRET, signJoinToken(SECRET, { login: 'ann#t1', ttlMs: 1000, now: 0 }), 1)).toBeNull();
    expect(verifyJoinToken(SECRET, signJoinToken(SECRET, { login: '', ttlMs: 1000, now: 0 }), 1)).toBeNull();
  });

  it.each(['', 'abc', 'a.b.c', '.', 'e30.', 'not-base64!.sig'])('rejects malformed %j', (token) => {
    expect(verifyJoinToken(SECRET, token, 0)).toBeNull();
  });
});
