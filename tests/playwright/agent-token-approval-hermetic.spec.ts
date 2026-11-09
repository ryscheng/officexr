/**
 * Agent token approval panel in hermetic mode (`?test=1`): a fake `AgentTokensClient` (seeded as
 * `agentTokensClient`) stands in for the REST API. The approval link's `agentTokenRequest` opens and highlights.
 */

import { expect, test } from '@playwright/test';

test('opens from an approval link, highlights the request and approves it', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __OFFICEXR_TEST_SEED__: Record<string, unknown> };
    let pending = ['abc', 'other'].map((id) => ({
      id,
      purpose: `purpose ${id}`,
      clientId: 'claude',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    }));
    w.__OFFICEXR_TEST_SEED__ = {
      agentTokensClient: {
        listPending: async () => pending,
        approve: async (id: string) => {
          pending = pending.filter((r) => r.id !== id);
        },
        deny: async (id: string) => {
          pending = pending.filter((r) => r.id !== id);
        },
      },
    };
  });
  await page.goto('/?test=1&agentTokenRequest=abc', { waitUntil: 'domcontentloaded' });

  const panel = page.getByRole('region', { name: 'Agent tokens' });
  const linked = panel.locator('[data-highlighted="true"]');
  await expect(linked).toContainText('purpose abc');
  await expect(linked).toContainText('Gives this agent a 60-minute API token that acts as you.');
  await linked.getByRole('button', { name: 'Approve' }).click();

  await expect(panel.getByText('Approved. Your agent has 60 seconds to collect its token.')).toBeVisible();
  await expect(panel.getByText('purpose abc')).toHaveCount(0);
  await expect(panel.getByText('purpose other')).toBeVisible();
});
