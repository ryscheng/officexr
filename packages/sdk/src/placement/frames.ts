import { z } from 'zod';
import { ZPropPlacement } from './props.ts';

export const PROP_OP_KIND = 'prop:op';
export const PROP_OP_RESULT_KIND = 'prop:op-result';

export const ZPropOp = z.discriminatedUnion('op', [
  ZPropPlacement.extend({ op: z.literal('place') }),
  ZPropPlacement.extend({ op: z.literal('update'), id: z.string().min(1).max(64) }),
  z.object({ op: z.literal('remove'), id: z.string().min(1).max(64) }),
]);
export type PropOp = z.infer<typeof ZPropOp>;

export const PROP_OP_ERRORS = ['invalid', 'limit', 'not-found', 'unavailable'] as const;

export const ZPropOpResult = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), error: z.enum(PROP_OP_ERRORS) }),
]);
export type PropOpResult = z.infer<typeof ZPropOpResult>;
