import { describe, it, expect, afterEach } from 'vitest';
import { createLiveHarness, isSupabaseAvailable, type LiveHarness } from './_helpers.ts';

const supabaseUp = await isSupabaseAvailable();

let harness: LiveHarness;

afterEach(async () => {
  await harness?.cleanup();
});

describe.skipIf(!supabaseUp)('integration: SupabaseChannel presence', () => {
  it('two clients see each other join and leave', async () => {
    harness = await createLiveHarness();
    const A = await harness.add('alice');

    const aJoined: string[] = [];
    const aLeft: string[] = [];
    A.channel.onPresenceChange((j, l) => {
      aJoined.push(...j);
      aLeft.push(...l);
    });

    const B = await harness.add('bob');
    await harness.waitFor(() => aJoined.includes('bob'));

    harness.remove('bob');
    await harness.waitFor(() => aLeft.includes('bob'));

    expect(aJoined).toContain('bob');
    expect(aLeft).toContain('bob');
    expect(B.id).toBe('bob');
  });

  it('listPresent reflects current peers', async () => {
    harness = await createLiveHarness();
    const A = await harness.add('alice');
    await harness.add('bob');
    await harness.waitFor(() => A.channel.listPresent().includes('bob'));
    expect(A.channel.listPresent().sort()).toEqual(['alice', 'bob']);
  });
});
