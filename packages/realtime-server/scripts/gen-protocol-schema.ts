import { writeFileSync } from 'node:fs';
import { protocolSchemaJson, PROTOCOL_SCHEMA_PATH } from '../src/protocol-schema.ts';

writeFileSync(PROTOCOL_SCHEMA_PATH, protocolSchemaJson());
