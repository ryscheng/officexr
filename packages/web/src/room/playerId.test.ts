// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import type { Identity, Office } from '../../server/api';
import { playerIdFor } from './playerId';

afterEach(() => sessionStorage.clear());

const me: Identity = { login: 'a@example.com', name: 'Alice' };
const office = (over: Partial<Office>): Office => ({
  id: 'o1',
  name: 'HQ',
  description: null,
  map_name: null,
  created_by_login: me.login,
  debug_enabled: true,
  ...over,
});

describe('playerIdFor', () => {
  it('gives the creator of a debug office a per-tab id that survives a remount', () => {
    sessionStorage.setItem('officexr.tab.o1', 'abc');
    expect(playerIdFor(office({}), me)).toBe('a@example.com#abc');
    expect(playerIdFor(office({}), me)).toBe('a@example.com#abc');
  });

  it('keeps the plain login without debug or for anyone but the creator', () => {
    expect(playerIdFor(office({ debug_enabled: false }), me)).toBe(me.login);
    expect(playerIdFor(office({ created_by_login: 'b@example.com' }), me)).toBe(me.login);
  });
});
