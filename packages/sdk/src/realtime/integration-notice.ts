import { z } from 'zod';

export const INTEGRATION_NOTICE_KIND = 'integration:notice';

/** A short note from the server to one player, such as a reply to a Slack ping. */
export const ZIntegrationNotice = z.object({ from: z.string().min(1).max(100), text: z.string().min(1).max(200) });
export type IntegrationNotice = z.infer<typeof ZIntegrationNotice>;
