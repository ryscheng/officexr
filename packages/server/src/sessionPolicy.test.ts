import { describe, expect, it } from 'vitest';
import type { QueryOffices } from './api';
import type { Office } from './shared';
import { officeSessionPolicy } from './sessionPolicy';

const office = (debug_enabled: boolean): Office => ({
  id: 'o1',
  name: 'HQ',
  description: null,
  map_name: null,
  created_by_login: 'a@example.com',
  debug_enabled,
});
const queryingOffices = (offices: Office[]): QueryOffices => async (id) => offices.filter((o) => o.id === id);

describe('officeSessionPolicy', () => {
  it('allows only the creator of a debug-enabled office', async () => {
    const policy = officeSessionPolicy(queryingOffices([office(true)]));
    expect(await policy('o1', 'a@example.com')).toBe(true);
    expect(await policy('o1', 'b@example.com')).toBe(false);
  });

  it('refuses a non-debug office and an unknown one', async () => {
    expect(await officeSessionPolicy(queryingOffices([office(false)]))('o1', 'a@example.com')).toBe(false);
    expect(await officeSessionPolicy(queryingOffices([]))('o1', 'a@example.com')).toBe(false);
  });

  it('resolves false when the lookup outlasts the timeout', async () => {
    const policy = officeSessionPolicy(() => new Promise(() => {}), 10);
    expect(await policy('o1', 'a@example.com')).toBe(false);
  });
});
