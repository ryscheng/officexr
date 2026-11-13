import { ZNetEvent } from '@officexr/sdk';
import { ZodFirstPartyTypeKind } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { ZFrame, ZPresenceData } from './protocol.ts';

export const PROTOCOL_SCHEMA_PATH = new URL('../../../schemas/protocol.schema.json', import.meta.url);

/** JSON Schema for every wire frame (`t`-tagged) and every NetEvent (`kind`-tagged). */
export function protocolSchemaJson(): string {
  const schema = zodToJsonSchema(ZFrame, {
    name: 'Frame',
    definitions: { NetEvent: ZNetEvent, PresenceData: ZPresenceData },
    // Inline everything: typify can't resolve the deep pointer $refs the default strategy emits.
    $refStrategy: 'none',
    // Peers may send extra keys, so only `.strict()` objects are closed.
    removeAdditionalStrategy: 'strict',
    // Exactly one branch of a discriminated union matches; zod-to-json-schema emits `anyOf`.
    postProcess: (json, def) => {
      if (json && 'anyOf' in json && 'typeName' in def && def.typeName === ZodFirstPartyTypeKind.ZodDiscriminatedUnion) {
        const { anyOf, ...rest } = json;
        return { ...rest, oneOf: anyOf };
      }
      return json;
    },
  });
  return `${JSON.stringify(schema, null, 2)}\n`;
}
