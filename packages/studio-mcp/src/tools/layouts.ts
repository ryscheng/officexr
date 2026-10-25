import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { StudioDocuments } from '../studio-documents.ts';
import { registerDocumentTools } from './documents.ts';

export function registerLayoutTools(server: McpServer, { layouts }: StudioDocuments): void {
  registerDocumentTools(server, layouts, {
    noun: 'layout',
    description:
      'A layout is a command list for static structural geometry (walls, floors) in integer voxel ' +
      'coordinates [x, y, z], the same commands as a room. It is the source that gets baked into one optimized model.',
  });
}
