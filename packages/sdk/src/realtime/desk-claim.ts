import { z } from 'zod';

export const DESK_CLAIM_KIND = 'desk:claim';
export const DESK_CLAIM_RESULT_KIND = 'desk:claim-result';

/** A null `deskId` releases the sender's claim. */
export const ZDeskClaim = z.object({ deskId: z.string().nullable() });
export type DeskClaim = z.infer<typeof ZDeskClaim>;

/** `until` is an ISO instant so each viewer formats it in their own zone. */
export const ZClaimantCalendar = z.object({ busy: z.boolean(), until: z.string().min(1) });
export type ClaimantCalendar = z.infer<typeof ZClaimantCalendar>;

export const ZClaimantSlack = z.object({ text: z.string().max(200), emoji: z.string().max(100).optional() });
export type ClaimantSlack = z.infer<typeof ZClaimantSlack>;

/** What the server knows about a claimant, so an offline login can still be drawn at its desk. */
export const ZDeskClaimant = z.object({
  characterId: z.string().min(1).optional(),
  claimedAt: z.string().min(1).optional(),
  calendar: ZClaimantCalendar.optional(),
  slack: ZClaimantSlack.optional(),
});
export type DeskClaimant = z.infer<typeof ZDeskClaimant>;

export const ZDeskClaimResult = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), error: z.enum(['taken', 'unknown-desk', 'unavailable']) }),
]);
export type DeskClaimResult = z.infer<typeof ZDeskClaimResult>;
