import { describe, expect, it } from 'vitest';
import { hasInviteFlag, roomPath, withoutInviteFlag } from './inviteFlag';

describe('invite flag', () => {
  it('marks a new office path once and reads it back', () => {
    expect(roomPath('abc', { welcome: true })).toBe('/room/abc?invite=1');
    expect(roomPath('abc')).toBe('/room/abc');
    expect(hasInviteFlag('?invite=1')).toBe(true);
    expect(hasInviteFlag('')).toBe(false);
    expect(hasInviteFlag('?invite=0')).toBe(false);
  });

  it('removes only its own parameter', () => {
    expect(withoutInviteFlag('?invite=1')).toBe('');
    expect(withoutInviteFlag('?a=1&invite=1')).toBe('?a=1');
    expect(hasInviteFlag(withoutInviteFlag('?invite=1'))).toBe(false);
  });
});
