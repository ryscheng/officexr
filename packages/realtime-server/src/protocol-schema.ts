import { ZNetEvent } from '@officexr/sdk';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { ZFrame, ZPresenceData } from './protocol.ts';

export const PROTOCOL_SCHEMA_PATH = new URL('../../../schemas/protocol.schema.json', import.meta.url);

/** JSON Schema for every wire frame (`t`-tagged) and every NetEvent (`kind`-tagged). */
export function protocolSchemaJson(): string {
  const schema = zodToJsonSchema(ZFrame, {
    name: 'Frame',
    definitions: { NetEvent: ZNetEvent, PresenceData: ZPresenceData },
  });
  // zod-to-json-schema emits `anyOf` for unions, `$ref` paths included. Every union here has mutually
  // exclusive branches (tagged by `t`/`kind`, or nullable), so `oneOf` is the tighter contract for typify.
  return `${JSON.stringify(schema, null, 2).replaceAll('anyOf', 'oneOf')}\n`;
}
