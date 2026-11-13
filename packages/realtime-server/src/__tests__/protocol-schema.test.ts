import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PROTOCOL_SCHEMA_PATH, protocolSchemaJson } from '../protocol-schema.ts';

describe('schemas/protocol.schema.json', () => {
  it('matches a fresh generation (run `pnpm --filter @officexr/realtime-server gen:protocol-schema`)', () => {
    expect(readFileSync(PROTOCOL_SCHEMA_PATH, 'utf8')).toBe(protocolSchemaJson());
  });
});
