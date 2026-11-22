import { z } from 'zod';

export const REPORT_REASONS = ['harassment', 'spam', 'inappropriate', 'impersonation', 'other'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export const REPORT_NOTE_MAX = 500;
export const MAX_BLOCKS = 200;

export const ZReportRequest = z.object({
  officeId: z.string().min(1).max(100).optional(),
  login: z.string().min(1).max(200),
  reason: z.enum(REPORT_REASONS),
  note: z.string().max(REPORT_NOTE_MAX).optional(),
});
export type ReportRequest = z.infer<typeof ZReportRequest>;

export interface BlockedPerson {
  login: string;
  name: string | null;
}

export interface SocialCapabilities {
  block: boolean;
  report: boolean;
  nearbyChat: boolean;
  directChat: boolean;
}

export const NO_SOCIAL: SocialCapabilities = { block: false, report: false, nearbyChat: false, directChat: false };
