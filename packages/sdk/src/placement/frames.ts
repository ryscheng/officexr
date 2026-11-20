import { z } from 'zod';
import { ZPropPlacement } from './props.ts';

export const PROP_OP_KIND = 'prop:op';
export const PROP_OP_RESULT_KIND = 'prop:op-result';

export const HELD_DENIED_KIND = 'held:denied';

const reqId = z.string().min(1).max(40).optional();

export const ZPropOp = z.discriminatedUnion('op', [
  ZPropPlacement.extend({ op: z.literal('place'), reqId }),
  ZPropPlacement.extend({ op: z.literal('update'), id: z.string().min(1).max(64), reqId }),
  z.object({ op: z.literal('remove'), id: z.string().min(1).max(64), reqId }),
]);
export type PropOp = z.infer<typeof ZPropOp>;

export const PROP_OP_ERRORS = ['invalid', 'limit', 'not-found', 'unavailable'] as const;

export const ZPropOpResult = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), reqId }),
  z.object({ ok: z.literal(false), error: z.enum(PROP_OP_ERRORS), reqId }),
]);
export type PropOpResult = z.infer<typeof ZPropOpResult>;
