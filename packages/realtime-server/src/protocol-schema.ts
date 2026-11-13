import { ZNetEvent } from '@officexr/sdk';
import { ZodFirstPartyTypeKind } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { ZFrame, ZPresenceData } from './protocol.ts';

const NAMED_DEFINITIONS = new Map<unknown, string>([
  [ZNetEvent._def, 'NetEvent'],
  [ZPresenceData._def, 'PresenceData'],
]);

export const PROTOCOL_SCHEMA_PATH = new URL('../../../schemas/protocol.schema.json', import.meta.url);

/** JSON Schema for every wire frame (`t`-tagged) and every NetEvent (`kind`-tagged). */
export function protocolSchemaJson(): string {
  const schema = zodToJsonSchema(ZFrame, {
    name: 'Frame',
    definitions: { NetEvent: ZNetEvent, PresenceData: ZPresenceData },
    // typify can't resolve the deep pointer $refs the other strategies emit, so inline everything
    // except the named definitions, which postProcess points back at by name.
    $refStrategy: 'none',
    // Peers may send extra keys, so only `.strict()` objects are closed.
    removeAdditionalStrategy: 'strict',
    postProcess: (json, def, refs) => {
      const name = NAMED_DEFINITIONS.get(def);
      if (name && refs.currentPath.join('/') !== `#/definitions/${name}`) {
        return { $ref: `#/definitions/${name}` };
      }
      // Exactly one branch of a discriminated union matches; zod-to-json-schema emits `anyOf`.
      if (json && 'anyOf' in json && 'typeName' in def && def.typeName === ZodFirstPartyTypeKind.ZodDiscriminatedUnion) {
        const { anyOf, ...rest } = json;
        return { ...rest, oneOf: anyOf };
      }
      return json;
    },
  });
  return `${JSON.stringify(schema, null, 2)}\n`;
}
