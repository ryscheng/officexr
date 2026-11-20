import { describe, expect, it } from 'vitest';
import { createSecretBox } from './secretBox';

const SECRET = 'a-long-test-secret-value';

describe('createSecretBox', () => {
  it('round-trips a value for the same context', () => {
    const box = createSecretBox(SECRET);
    const sealed = box.encrypt('1//refresh-token', 'a@example.com');
    expect(box.decrypt(sealed, 'a@example.com')).toBe('1//refresh-token');
  });

  it('never writes the plaintext, and seals the same value differently each time', () => {
    const box = createSecretBox(SECRET);
    const first = box.encrypt('1//refresh-token', 'a@example.com');
    expect(first.startsWith('v1.')).toBe(true);
    expect(first).not.toContain('refresh-token');
    expect(box.encrypt('1//refresh-token', 'a@example.com')).not.toBe(first);
  });

  it('refuses a value sealed for another login', () => {
    const box = createSecretBox(SECRET);
    expect(() => box.decrypt(box.encrypt('token', 'a@example.com'), 'b@example.com')).toThrow();
  });

  it('refuses a value sealed with another secret', () => {
    const sealed = createSecretBox(SECRET).encrypt('token', 'a@example.com');
    expect(() => createSecretBox('another-long-test-secret').decrypt(sealed, 'a@example.com')).toThrow();
  });

  it('refuses a tampered ciphertext, tag or format', () => {
    const box = createSecretBox(SECRET);
    const [version, iv, tag, body] = box.encrypt('token-value', 'a@example.com').split('.');
    const flipped = Buffer.from(body, 'base64url');
    flipped[0] ^= 1;
    expect(() => box.decrypt([version, iv, tag, flipped.toString('base64url')].join('.'), 'a@example.com')).toThrow();
    expect(() => box.decrypt([version, iv, 'AAAA', body].join('.'), 'a@example.com')).toThrow();
    expect(() => box.decrypt('v2.a.b.c', 'a@example.com')).toThrow('Unrecognized');
    expect(() => box.decrypt('', 'a@example.com')).toThrow('Unrecognized');
  });

  it('refuses a secret too short to derive a key from', () => {
    expect(() => createSecretBox('short')).toThrow('at least 16');
  });
});
